// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
// Two widgets, declared in the manifest `widgets` field:
//   - `solar_overview`: live production / house / grid / battery tiles, the
//     production and consumption chart, and a status list (inverter status,
//     today's production, grid exchange, connection);
//   - `battery_control`: battery level and power, working mode, and buttons
//     to force a charge or a discharge, stop it, or change the working mode
//     (local Modbus connection only).
//
// Device-bound tiles and charts are LIVE (they follow the published states);
// the computed parts are cached by the core until `ttl_seconds`, and
// refreshWidgets() nudges them after every new snapshot of the hub.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_TRANSPORTS,
  WIDGET_BUTTON_STYLES,
  WIDGET_CHART_INTERVALS,
  WIDGET_CHART_TYPES,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';
import { firstFeatureId } from './devices/index.js';
import { inverter, INVERTER_FEATURE } from './devices/inverter.js';
import { powerMeter, METER_FEATURE } from './devices/powerMeter.js';
import { battery, BATTERY_FEATURE } from './devices/battery.js';
import {
  BATTERY_MODE_LABELS,
  BATTERY_STATUS_LABELS,
  GRID_FLOW,
  GRID_FLOW_LABELS,
  INVERTER_STATUS,
  INVERTER_STATUS_LABELS,
  SELECTABLE_BATTERY_MODES,
  gridFlowOf,
} from './huawei/status.js';
import { SCENE_ACTIONS } from './scenes.js';

const logger = createLogger({ name: 'widgets' });

// Widget keys, as declared in the manifest.
export const SOLAR_OVERVIEW_WIDGET = 'solar_overview';
export const BATTERY_CONTROL_WIDGET = 'battery_control';

const BATTERY_ACTION = {
  CHARGE: 'force_charge',
  DISCHARGE: 'force_discharge',
  STOP: 'stop',
  MODE: 'set_mode',
};

const INVERTER_STATUS_COLORS = {
  [INVERTER_STATUS.ON_GRID]: WIDGET_COLORS.SUCCESS,
  [INVERTER_STATUS.LIMITED]: WIDGET_COLORS.WARNING,
  [INVERTER_STATUS.OFF_GRID]: WIDGET_COLORS.INFO,
  [INVERTER_STATUS.FAULT]: WIDGET_COLORS.DANGER,
  [INVERTER_STATUS.SHUTDOWN]: WIDGET_COLORS.WARNING,
};

const GRID_FLOW_COLORS = {
  [GRID_FLOW.IMPORTING]: WIDGET_COLORS.WARNING,
  [GRID_FLOW.EXPORTING]: WIDGET_COLORS.SUCCESS,
  [GRID_FLOW.IDLE]: WIDGET_COLORS.NEUTRAL,
};

const TRANSPORT_STATUS = {
  [DEVICE_TRANSPORTS.LOCAL]: {
    value: {
      en: 'Local (Modbus)',
      fr: 'Locale (Modbus)',
      de: 'Lokal (Modbus)',
      es: 'Local (Modbus)',
    },
    color: WIDGET_COLORS.SUCCESS,
  },
  [DEVICE_TRANSPORTS.CLOUD]: {
    value: {
      en: 'FusionSolar cloud',
      fr: 'Cloud FusionSolar',
      de: 'FusionSolar-Cloud',
      es: 'Nube FusionSolar',
    },
    color: WIDGET_COLORS.INFO,
  },
  [DEVICE_TRANSPORTS.UNREACHABLE]: {
    value: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
    color: WIDGET_COLORS.DANGER,
  },
};

const LABELS = {
  production: { en: 'Production', fr: 'Production', de: 'Erzeugung', es: 'Producción' },
  house: { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' },
  grid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  inverter: { en: 'Inverter', fr: 'Onduleur', de: 'Wechselrichter', es: 'Inversor' },
  today: {
    en: "Today's production",
    fr: 'Production du jour',
    de: 'Heutige Erzeugung',
    es: 'Producción de hoy',
  },
  income: {
    en: "Today's income",
    fr: 'Gain du jour',
    de: 'Heutiger Ertrag',
    es: 'Ingresos de hoy',
  },
  exchange: {
    en: 'Grid exchange',
    fr: 'Échange réseau',
    de: 'Netzaustausch',
    es: 'Intercambio con la red',
  },
  connection: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  mode: {
    en: 'Working mode',
    fr: 'Mode de fonctionnement',
    de: 'Betriebsmodus',
    es: 'Modo de funcionamiento',
  },
  status: { en: 'Status', fr: 'État', de: 'Status', es: 'Estado' },
  chart: {
    en: 'Production & consumption',
    fr: 'Production et consommation',
    de: 'Erzeugung und Verbrauch',
    es: 'Producción y consumo',
  },
  waiting: {
    en: 'Waiting for the first reading of the installation…',
    fr: "En attente de la première lecture de l'installation…",
    de: 'Warten auf die erste Auslesung der Anlage…',
    es: 'Esperando la primera lectura de la instalación…',
  },
  noBattery: {
    en: 'No LUNA2000 battery detected on this installation.',
    fr: 'Aucune batterie LUNA2000 détectée sur cette installation.',
    de: 'Keine LUNA2000-Batterie in dieser Anlage erkannt.',
    es: 'No se ha detectado ninguna batería LUNA2000 en esta instalación.',
  },
  charge: { en: 'Force charge', fr: 'Forcer la charge', de: 'Laden erzwingen', es: 'Forzar carga' },
  discharge: {
    en: 'Force discharge',
    fr: 'Forcer la décharge',
    de: 'Entladen erzwingen',
    es: 'Forzar descarga',
  },
  stop: {
    en: 'Stop forcing',
    fr: 'Arrêter le forçage',
    de: 'Erzwingen beenden',
    es: 'Detener forzado',
  },
  changeMode: { en: 'Change mode', fr: 'Changer de mode', de: 'Modus ändern', es: 'Cambiar modo' },
  power: { en: 'Power (W)', fr: 'Puissance (W)', de: 'Leistung (W)', es: 'Potencia (W)' },
  duration: { en: 'Duration (min)', fr: 'Durée (min)', de: 'Dauer (min)', es: 'Duración (min)' },
};

const kwh = (value) => `${(Math.round((value ?? 0) * 100) / 100).toLocaleString('en-US')} kWh`;

function waitingContent() {
  return {
    ttl_seconds: 30,
    components: [{ type: 'text', text: LABELS.waiting, variant: 'caption' }],
  };
}

function connectionItem(hub) {
  const { transport, degraded } = hub.transport();
  const { value, color } = TRANSPORT_STATUS[transport];
  return {
    label: LABELS.connection,
    icon: degraded ? 'alert-triangle' : 'wifi',
    value,
    color: degraded ? WIDGET_COLORS.WARNING : color,
  };
}

function overviewContent(gladys, snapshot, hub, config) {
  const productionId = firstFeatureId(
    gladys,
    snapshot,
    inverter,
    INVERTER_FEATURE.PRODUCTION_POWER,
  );
  const houseId = firstFeatureId(gladys, snapshot, powerMeter, METER_FEATURE.HOUSE_POWER);
  const gridId = firstFeatureId(gladys, snapshot, powerMeter, METER_FEATURE.GRID_POWER);
  const batteryId = firstFeatureId(gladys, snapshot, battery, BATTERY_FEATURE.LEVEL);

  const components = [];
  if (productionId) {
    components.push({
      type: 'value',
      label: LABELS.production,
      icon: 'sun',
      device_feature: productionId,
    });
  }
  if (houseId) {
    components.push({ type: 'value', label: LABELS.house, icon: 'home', device_feature: houseId });
  }
  if (gridId) {
    components.push({
      type: 'value',
      label: LABELS.grid,
      icon: 'activity',
      device_feature: gridId,
    });
  }
  if (batteryId) {
    components.push({ type: 'gauge', label: LABELS.battery, device_feature: batteryId });
  }
  const chartFeatures = [productionId, houseId].filter(Boolean);
  if (chartFeatures.length > 0) {
    components.push({
      type: 'chart',
      title: LABELS.chart,
      chart_type: WIDGET_CHART_TYPES.AREA,
      device_features: chartFeatures,
      interval: WIDGET_CHART_INTERVALS.LAST_DAY,
    });
  }

  const items = [];
  const [firstInverter] = snapshot.inverters;
  if (firstInverter) {
    items.push({
      label: LABELS.inverter,
      icon: 'cpu',
      value: INVERTER_STATUS_LABELS[firstInverter.status],
      color: INVERTER_STATUS_COLORS[firstInverter.status] ?? WIDGET_COLORS.NEUTRAL,
    });
  }
  const dailyYield =
    snapshot.inverters.reduce((sum, inv) => sum + (inv.dailyYield ?? 0), 0) ||
    snapshot.plant?.dailyYield ||
    0;
  items.push({
    label: LABELS.today,
    icon: 'sun',
    value: kwh(dailyYield),
    color: WIDGET_COLORS.PRIMARY,
  });
  if (typeof snapshot.plant?.dailyIncome === 'number') {
    items.push({
      label: LABELS.income,
      icon: 'dollar-sign',
      value: snapshot.plant.dailyIncome.toFixed(2),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const [firstMeter] = snapshot.meters;
  if (typeof firstMeter?.power === 'number') {
    const flow = gridFlowOf(firstMeter.power, config.grid_threshold);
    items.push({
      label: LABELS.exchange,
      icon: 'repeat',
      value: GRID_FLOW_LABELS[flow],
      color: GRID_FLOW_COLORS[flow],
    });
  }
  items.push(connectionItem(hub));
  components.push({ type: 'status', items });

  return { ttl_seconds: 120, components };
}

function batteryContent(gladys, snapshot, hub) {
  const [entity] = snapshot.batteries;
  if (!entity) {
    return {
      ttl_seconds: 600,
      components: [{ type: 'text', text: LABELS.noBattery, variant: 'caption' }],
    };
  }
  const ids = battery.ids(gladys, entity);
  const powerField = {
    key: 'power',
    type: 'number',
    label: LABELS.power,
    default: 2500,
    min: 100,
    max: 15000,
    required: true,
  };
  const durationField = {
    key: 'duration',
    type: 'number',
    label: LABELS.duration,
    default: 60,
    min: 1,
    max: 1440,
    required: true,
  };
  return {
    ttl_seconds: 120,
    components: [
      { type: 'gauge', label: LABELS.battery, device_feature: ids.feature(BATTERY_FEATURE.LEVEL) },
      {
        type: 'value',
        label: LABELS.charge,
        icon: 'battery-charging',
        device_feature: ids.feature(BATTERY_FEATURE.CHARGE_POWER),
      },
      {
        type: 'value',
        label: LABELS.discharge,
        icon: 'battery',
        device_feature: ids.feature(BATTERY_FEATURE.DISCHARGE_POWER),
      },
      {
        type: 'status',
        items: [
          {
            label: LABELS.mode,
            icon: 'sliders',
            value: BATTERY_MODE_LABELS[entity.mode] ?? BATTERY_MODE_LABELS.other,
            color: WIDGET_COLORS.PRIMARY,
          },
          {
            label: LABELS.status,
            icon: 'battery',
            value: BATTERY_STATUS_LABELS[entity.status],
            color: entity.status === 'fault' ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
          },
          connectionItem(hub),
        ],
      },
      {
        type: 'button',
        label: LABELS.charge,
        icon: 'battery-charging',
        style: WIDGET_BUTTON_STYLES.PRIMARY,
        action: { key: BATTERY_ACTION.CHARGE, fields: [powerField, durationField] },
      },
      {
        type: 'button',
        label: LABELS.discharge,
        icon: 'battery',
        style: WIDGET_BUTTON_STYLES.SECONDARY,
        action: { key: BATTERY_ACTION.DISCHARGE, fields: [powerField, durationField] },
      },
      {
        type: 'button',
        label: LABELS.stop,
        icon: 'square',
        style: WIDGET_BUTTON_STYLES.DANGER,
        action: { key: BATTERY_ACTION.STOP, confirm: true },
      },
      {
        type: 'button',
        label: LABELS.changeMode,
        icon: 'sliders',
        style: WIDGET_BUTTON_STYLES.SECONDARY,
        action: {
          key: BATTERY_ACTION.MODE,
          fields: [
            {
              key: 'mode',
              type: 'select',
              label: LABELS.mode,
              required: true,
              default: SELECTABLE_BATTERY_MODES.includes(entity.mode)
                ? entity.mode
                : SELECTABLE_BATTERY_MODES[0],
              options: SELECTABLE_BATTERY_MODES.map((mode) => ({
                value: mode,
                label: BATTERY_MODE_LABELS[mode],
              })),
            },
          ],
        },
      },
    ],
  };
}

// Toast for a widget action: the outputs of the matching scene action.
function toast({ success, message }) {
  if (success) {
    return { en: 'Done.', fr: 'C’est fait.', de: 'Erledigt.', es: 'Hecho.' };
  }
  // Throwing acks the action as failed: the message reaches the user.
  throw new Error(message);
}

async function currentSnapshot(hub) {
  try {
    return await hub.refresh();
  } catch (err) {
    logger.debug(`No snapshot for the widget: ${err.message}`);
    return hub.snapshot;
  }
}

export const WIDGETS = {
  [SOLAR_OVERVIEW_WIDGET]: {
    async get(gladys, { hub, config }) {
      const snapshot = await currentSnapshot(hub);
      return snapshot ? overviewContent(gladys, snapshot, hub, config) : waitingContent();
    },
  },

  [BATTERY_CONTROL_WIDGET]: {
    async get(gladys, { hub }) {
      const snapshot = await currentSnapshot(hub);
      return snapshot ? batteryContent(gladys, snapshot, hub) : waitingContent();
    },

    async action(gladys, { hub, actionKey, values = {} }) {
      logger.info(`onWidgetAction <- ${BATTERY_CONTROL_WIDGET}.${actionKey}`);
      const context = { hub, fields: values };
      switch (actionKey) {
        case BATTERY_ACTION.CHARGE:
          return toast(await SCENE_ACTIONS.force_battery_charge(gladys, context));
        case BATTERY_ACTION.DISCHARGE:
          return toast(await SCENE_ACTIONS.force_battery_discharge(gladys, context));
        case BATTERY_ACTION.STOP:
          return toast(await SCENE_ACTIONS.stop_battery_forced_mode(gladys, context));
        case BATTERY_ACTION.MODE:
          return toast(await SCENE_ACTIONS.set_battery_working_mode(gladys, context));
        default:
          throw new Error(`Unknown widget action: ${actionKey}`);
      }
    },
  },
};

/**
 * Ask the core to re-pull every widget now (rate-limited core-side to 1 per
 * 10 s per widget, dropped while disconnected).
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
