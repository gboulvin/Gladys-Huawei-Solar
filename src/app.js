// -----------------------------------------------------------------------------
// SDK wiring: every handler, registered on the client BEFORE connect().
//
// Kept out of index.js so the tests drive the whole integration against the
// fake Gladys of the SDK (`createFakeGladys`), with fake drivers in the hub.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { SolarHub } from './hub.js';
import {
  buildDiscoveredDevices,
  buildTransportEntries,
  findDevice,
  statesOfDevice,
} from './devices/index.js';
import { createTriggerListener } from './triggers.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS, refreshWidgets } from './widgets.js';
import { testConnection } from './actions.js';

const logger = createLogger({ name: 'app' });

// An unchanged state is re-sent every 30 minutes, so it stays recently dated.
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

// Background refresh: keeps the scene triggers, the widgets and the
// connection status alive even before the user creates the devices.
const LOOP_INTERVAL_MS = 30_000;

const NOT_CONFIGURED = {
  en: 'Fill in the inverter address (local) and/or the FusionSolar API account (cloud).',
  fr: "Renseignez l'adresse de l'onduleur (local) et/ou le compte API FusionSolar (cloud).",
  de: 'Adresse des Wechselrichters (lokal) und/oder FusionSolar-API-Konto (Cloud) eintragen.',
  es: 'Indique la dirección del inversor (local) y/o la cuenta API de FusionSolar (nube).',
};

const unreachable = (err) => ({
  en: `Installation unreachable: ${err.message}`,
  fr: `Installation injoignable : ${err.message}`,
  de: `Anlage nicht erreichbar: ${err.message}`,
  es: `Instalación inaccesible: ${err.message}`,
});

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ hub?: SolarHub, loopIntervalMs?: number }} [options]
 */
export function registerHandlers(
  gladys,
  { hub = new SolarHub(), loopIntervalMs = LOOP_INTERVAL_MS } = {},
) {
  let config = normalizeConfig();
  let loop = null;
  let lastDevicesKey = null;
  let lastStatusKey = null;

  hub.onSnapshot(createTriggerListener(gladys, () => config));

  async function publishDevices(snapshot) {
    const devices = buildDiscoveredDevices(gladys, snapshot);
    lastDevicesKey = devices.map((device) => device.external_id).join('|');
    await gladys.publishDiscoveredDevices(devices);
  }

  // Connection status + transport badges, only when they change.
  async function publishStatus(error) {
    const transport = hub.transport();
    // The device list is part of the key: a new device needs its badge too.
    const key = JSON.stringify({
      transport,
      devices: lastDevicesKey,
      error: error?.message ?? null,
    });
    if (key === lastStatusKey) {
      return;
    }
    lastStatusKey = key;
    const entries = buildTransportEntries(gladys, hub.snapshot, transport);
    if (entries.length > 0) {
      await gladys.publishTransports(entries);
    }
    if (error) {
      await gladys.setConnectionStatus(false, unreachable(error));
    } else {
      await gladys.setConnectionStatus(true);
    }
  }

  // After every read: new devices (a battery added later...), status, widgets.
  hub.onSnapshot(async (snapshot) => {
    const key = buildDiscoveredDevices(gladys, snapshot)
      .map((device) => device.external_id)
      .join('|');
    if (key !== lastDevicesKey) {
      await publishDevices(snapshot);
    }
    await publishStatus(null);
    refreshWidgets(gladys);
  });

  async function refresh(options) {
    try {
      return await hub.refresh(options);
    } catch (err) {
      await publishStatus(err).catch((e) => logger.error('Status publication failed', e));
      throw err;
    }
  }

  async function initialize() {
    hub.configure(config);
    lastDevicesKey = null;
    lastStatusKey = null;
    if (!hub.isConfigured()) {
      await gladys.publishDiscoveredDevices([]);
      await gladys.setConnectionStatus(false, NOT_CONFIGURED);
      return;
    }
    try {
      const snapshot = await refresh({ force: true });
      if (lastDevicesKey === null) {
        await publishDevices(snapshot);
      }
    } catch (err) {
      logger.error('Initial read of the installation failed', err);
    }
    refreshWidgets(gladys);
  }

  function startLoop() {
    stopLoop();
    loop = setInterval(() => {
      if (hub.isConfigured()) {
        refresh().catch((err) => logger.debug(`Background refresh failed: ${err.message}`));
      }
    }, loopIntervalMs);
    loop.unref?.();
  }

  function stopLoop() {
    if (loop) {
      clearInterval(loop);
      loop = null;
    }
  }

  // --- Discovery -------------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> reading the installation');
    const snapshot = await refresh({ force: true });
    await publishDevices(snapshot);
  });

  // --- Polling: served from the hub's cached snapshot ------------------------
  gladys.onPoll(async (device) => {
    const snapshot = await refresh();
    const states = statesOfDevice(gladys, device.external_id, snapshot);
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  });

  // --- Commands --------------------------------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id}`);
    const found = findDevice(gladys, device.external_id, hub.snapshot ?? (await refresh()));
    if (!found || typeof found.kind.onSetValue !== 'function') {
      throw new Error(`No command handler for ${device.external_id}`);
    }
    await found.kind.onSetValue(gladys, { hub, entity: found.entity, feature, value });
  });

  // --- Manifest actions ------------------------------------------------------
  gladys.onAction('test_connection', () => testConnection(hub, config));

  // --- Scene actions ---------------------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(gladys, { hub, fields, config }));
  }

  // --- Dashboard widgets -----------------------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, hub, config }));
    if (typeof widget.action === 'function') {
      gladys.onWidgetAction(key, (actionKey, params, { settings, values } = {}) =>
        widget.action(gladys, { hub, actionKey, params, settings, values, config }),
      );
    }
  }

  // --- Configuration ---------------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    config = normalizeConfig(newConfig);
    await initialize();
  });

  // --- Lifecycle -------------------------------------------------------------
  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      await initialize();
      startLoop();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Initialisierung fehlgeschlagen, Protokolle der Integration prüfen.',
          es: 'La inicialización falló, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', () => {
    stopLoop();
  });

  return {
    hub,
    stop() {
      stopLoop();
      hub.close();
    },
  };
}
