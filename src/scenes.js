// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// Declared in the manifest `scene_actions` field and handled here, keyed by
// the same `key`; index.js registers each one with `gladys.onSceneAction`.
//
//   - commands (battery, export limit, inverter on/off) go through the local
//     Modbus connection: FusionSolar's control API is not used;
//   - a command that cannot run is an OUTPUT (`success: false` + `message`),
//     not a thrown error: a scene action is never a condition, the scene
//     author gates the following actions on `success`;
//   - `read_live_data` exposes the current values to the following actions,
//     e.g. "if the battery is above 80 %, start the water heater".
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { EXPORT_LIMIT_MODE } from './huawei/local.js';
import { SELECTABLE_BATTERY_MODES } from './huawei/status.js';

const logger = createLogger({ name: 'scenes' });

const ok = (message) => ({ success: true, message });

async function command(hub, description, run) {
  try {
    await run(hub.local());
    hub.invalidate();
    return ok(description);
  } catch (err) {
    logger.error(`Scene command failed: ${description}`, err);
    return { success: false, message: err.message };
  }
}

const toNumber = (value, fallback) => {
  const number = Number(value);
  return value === undefined || value === null || value === '' || !Number.isFinite(number)
    ? fallback
    : number;
};

export const SCENE_ACTIONS = {
  async force_battery_charge(_gladys, { hub, fields }) {
    const power = toNumber(fields.power, 2500);
    const duration = toNumber(fields.duration, 60);
    return command(hub, `Battery charging at ${power} W for ${duration} min`, (local) =>
      local.forceBattery({ direction: 'charge', power, duration }),
    );
  },

  async force_battery_discharge(_gladys, { hub, fields }) {
    const power = toNumber(fields.power, 2500);
    const duration = toNumber(fields.duration, 60);
    return command(hub, `Battery discharging at ${power} W for ${duration} min`, (local) =>
      local.forceBattery({ direction: 'discharge', power, duration }),
    );
  },

  async stop_battery_forced_mode(_gladys, { hub }) {
    return command(hub, 'Forced charge/discharge stopped', (local) => local.stopForcedBattery());
  },

  async set_battery_working_mode(_gladys, { hub, fields }) {
    if (!SELECTABLE_BATTERY_MODES.includes(fields.mode)) {
      return { success: false, message: `Unsupported working mode: ${fields.mode}` };
    }
    return command(hub, `Battery working mode set to ${fields.mode}`, (local) =>
      local.setBatteryMode(fields.mode),
    );
  },

  async set_grid_export_limit(_gladys, { hub, fields }) {
    const mode = fields.mode;
    if (!Object.values(EXPORT_LIMIT_MODE).includes(mode)) {
      return { success: false, message: `Unsupported export limit mode: ${mode}` };
    }
    const limit = toNumber(fields.limit, 0);
    const description =
      mode === EXPORT_LIMIT_MODE.LIMITED
        ? `Grid export limited to ${limit} W`
        : `Grid export: ${mode}`;
    return command(hub, description, (local) => local.setGridExportLimit({ mode, limit }));
  },

  async set_inverter_state(_gladys, { hub, fields }) {
    const running = fields.state === 'start';
    return command(hub, running ? 'Inverter started' : 'Inverter shut down', (local) =>
      local.setInverterRunning(running),
    );
  },

  async read_live_data(_gladys, { hub }) {
    try {
      const snapshot = await hub.refresh();
      const sum = (list, pick) => list.reduce((total, item) => total + (pick(item) ?? 0), 0);
      const [firstInverter] = snapshot.inverters;
      const [firstBattery] = snapshot.batteries;
      return {
        success: true,
        production_power: sum(snapshot.inverters, (inv) => inv.activePower),
        daily_production: Math.round(sum(snapshot.inverters, (inv) => inv.dailyYield) * 100) / 100,
        grid_power: sum(snapshot.meters, (meter) => meter.power),
        house_power: snapshot.house?.power ?? 0,
        battery_level: firstBattery?.soc ?? 0,
        battery_power: firstBattery?.power ?? 0,
        inverter_status: firstInverter?.status ?? 'other',
      };
    } catch (err) {
      logger.error('read_live_data failed', err);
      return { success: false, message: err.message };
    }
  },
};
