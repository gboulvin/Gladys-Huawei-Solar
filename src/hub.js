// -----------------------------------------------------------------------------
// The hub: one data source for the whole installation.
//
// A Huawei installation is read in one go (inverter + power meter + battery),
// whatever the number of Gladys devices it feeds. The hub:
//   - owns the local (Modbus) and cloud (FusionSolar) drivers, as configured;
//   - picks the channel: the preferred one (GLADYS_PREFER_LOCAL toggle),
//     falling back to the other one — flagged "degraded" — when it fails;
//   - caches the normalized snapshot for the refresh interval, so the polls
//     of the inverter, meter and battery devices share ONE read;
//   - notifies the listeners (scene triggers, widgets) of every new snapshot.
//
// Normalized snapshot:
//   {
//     source: 'local' | 'cloud', fetchedAt: ISO date,
//     plant: { id, name, dailyIncome, dailyYield? },
//     inverters: [{ sn, model, ratedPower, activePower (W), inputPower (W),
//                   gridFrequency, efficiency, temperature, totalYield (kWh),
//                   dailyYield (kWh), statusCode, status }],
//     meters: [{ id, online, power (W, + = drawing from the grid), voltage,
//                current, frequency, importIndex, exportIndex (kWh) }],
//     batteries: [{ id, capacity (kWh), soc (%), status, power (W, + = charging),
//                   chargeIndex, dischargeIndex, dailyCharge, dailyDischarge, mode }],
//     house: { power (W) } | null,
//   }
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { CLOUD_MIN_INTERVAL_S, hasCloud, hasLocal } from './config.js';
import { LocalDriver } from './huawei/local.js';
import { CloudDriver } from './huawei/cloud.js';

const logger = createLogger({ name: 'hub' });

// Gladys' poll ticks drift by a few hundred milliseconds: a read due within
// the next 5 seconds runs now.
const TOLERANCE_MS = 5_000;

export const SOURCE = { LOCAL: 'local', CLOUD: 'cloud' };

export class CommandUnavailableError extends Error {
  constructor() {
    super(
      'This command needs the local Modbus connection: fill in the inverter address in the configuration.',
    );
    this.name = 'CommandUnavailableError';
  }
}

const DEGRADED_MESSAGES = {
  [SOURCE.CLOUD]: {
    en: 'Local Modbus connection failed, using the FusionSolar cloud.',
    fr: 'Connexion Modbus locale en échec, bascule sur le cloud FusionSolar.',
    de: 'Lokale Modbus-Verbindung fehlgeschlagen, FusionSolar-Cloud wird verwendet.',
    es: 'Falló la conexión Modbus local, se usa la nube FusionSolar.',
  },
  [SOURCE.LOCAL]: {
    en: 'FusionSolar cloud unavailable, using the local connection.',
    fr: 'Cloud FusionSolar indisponible, bascule sur la connexion locale.',
    de: 'FusionSolar-Cloud nicht erreichbar, lokale Verbindung wird verwendet.',
    es: 'Nube FusionSolar no disponible, se usa la conexión local.',
  },
};

/**
 * House consumption, from what the inverters deliver and what the meter
 * exchanges with the grid. Only meaningful with a meter.
 */
export function computeHouse(snapshot) {
  if (snapshot.meters.length === 0) {
    return null;
  }
  const production = snapshot.inverters.reduce((sum, inv) => sum + (inv.activePower ?? 0), 0);
  const grid = snapshot.meters.reduce((sum, meter) => sum + (meter.power ?? 0), 0);
  return { power: Math.max(0, Math.round(production + grid)) };
}

export class SolarHub {
  /**
   * @param {object} [options]
   * @param {(config) => object} [options.createLocal] driver factory (tests)
   * @param {(config) => object} [options.createCloud] driver factory (tests)
   * @param {() => number} [options.now]
   */
  constructor({ createLocal, createCloud, now } = {}) {
    this.createLocal =
      createLocal ??
      ((config) =>
        new LocalDriver({
          host: config.modbus_host,
          port: config.modbus_port,
          unitId: config.modbus_unit_id,
        }));
    this.createCloud =
      createCloud ??
      ((config) =>
        new CloudDriver({
          baseUrl: config.fusionsolar_url,
          username: config.fusionsolar_username,
          password: config.fusionsolar_password,
        }));
    this.now = now ?? Date.now;
    this.drivers = {};
    this.config = null;
    this.snapshot = null;
    this.snapshotAt = 0;
    this.inflight = null;
    this.generation = 0;
    this.status = { transport: DEVICE_TRANSPORTS.UNREACHABLE, error: null };
    this.listeners = new Set();
  }

  configure(config) {
    this.close();
    this.config = config;
    this.drivers = {
      [SOURCE.LOCAL]: hasLocal(config) ? this.createLocal(config) : null,
      [SOURCE.CLOUD]: hasCloud(config) ? this.createCloud(config) : null,
    };
    this.snapshot = null;
    this.snapshotAt = 0;
    // A read started with the previous drivers must not land in this
    // configuration (see read()).
    this.generation += 1;
    this.inflight = null;
  }

  isConfigured() {
    return Boolean(this.drivers[SOURCE.LOCAL] || this.drivers[SOURCE.CLOUD]);
  }

  // Channels to try, preferred first.
  order() {
    const preferred =
      this.config?.GLADYS_PREFER_LOCAL === false
        ? [SOURCE.CLOUD, SOURCE.LOCAL]
        : [SOURCE.LOCAL, SOURCE.CLOUD];
    return preferred.filter((source) => this.drivers[source]);
  }

  intervalMs() {
    const seconds =
      this.snapshot?.source === SOURCE.CLOUD
        ? Math.max(this.config.poll_frequency, CLOUD_MIN_INTERVAL_S)
        : this.config.poll_frequency;
    return seconds * 1000;
  }

  onSnapshot(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Force the next refresh to read the installation (after a command). */
  invalidate() {
    this.snapshotAt = 0;
  }

  /**
   * The current snapshot, read again when older than the refresh interval.
   * Concurrent callers share the same read.
   * @param {{ force?: boolean }} [options]
   */
  async refresh({ force = false } = {}) {
    if (!this.isConfigured()) {
      throw new Error('Huawei Solar is not configured yet');
    }
    const fresh = this.snapshot && this.now() - this.snapshotAt < this.intervalMs() - TOLERANCE_MS;
    if (fresh && !force) {
      return this.snapshot;
    }
    if (!this.inflight) {
      const read = this.read().finally(() => {
        if (this.inflight === read) {
          this.inflight = null;
        }
      });
      this.inflight = read;
    }
    return this.inflight;
  }

  async read() {
    const generation = this.generation;
    const drivers = this.drivers;
    const order = this.order();
    let lastError = null;
    for (const source of order) {
      try {
        const raw = await drivers[source].readSnapshot();
        if (generation !== this.generation) {
          throw new Error('The configuration changed during the read');
        }
        const snapshot = {
          ...raw,
          source,
          fetchedAt: new Date(this.now()).toISOString(),
        };
        snapshot.house = computeHouse(snapshot);
        const previous = this.snapshot;
        this.snapshot = snapshot;
        this.snapshotAt = this.now();
        this.status =
          source === order[0]
            ? { transport: source, error: null }
            : {
                transport: source,
                degraded: true,
                message: DEGRADED_MESSAGES[source],
                error: null,
              };
        for (const listener of this.listeners) {
          try {
            await listener(snapshot, previous);
          } catch (err) {
            logger.error('Snapshot listener failed', err);
          }
        }
        return snapshot;
      } catch (err) {
        logger.warn(`Reading through ${source} failed: ${err.message}`);
        lastError = err;
      }
    }
    if (generation === this.generation) {
      this.status = { transport: DEVICE_TRANSPORTS.UNREACHABLE, error: lastError };
    }
    throw lastError;
  }

  /** Transport badge entry of every device: `{ transport, degraded?, message? }`. */
  transport() {
    const { transport, degraded, message } = this.status;
    return degraded ? { transport, degraded, message } : { transport };
  }

  /** The local driver, for the commands (the cloud API is read-only here). */
  local() {
    const driver = this.drivers[SOURCE.LOCAL];
    if (!driver) {
      throw new CommandUnavailableError();
    }
    return driver;
  }

  close() {
    for (const driver of Object.values(this.drivers)) {
      try {
        driver?.close();
      } catch (err) {
        logger.debug(`Driver close failed: ${err.message}`);
      }
    }
    this.drivers = {};
  }
}
