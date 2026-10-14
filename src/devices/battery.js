// -----------------------------------------------------------------------------
// Device kind: LUNA2000 BATTERY
// State of charge, charge / discharge power and indexes, remaining energy,
// status — and the working mode, a select the user can change from Gladys
// (local Modbus connection only: the FusionSolar API used here is read-only).
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  BATTERY_MODE_LABELS,
  BATTERY_STATUS_LABELS,
  SELECTABLE_BATTERY_MODES,
} from '../huawei/status.js';
import { POLL_FREQUENCY, numericState, textState } from './common.js';

const DEVICE_TYPE = 'battery';

const logger = createLogger({ name: DEVICE_TYPE });

const MAX_BATTERY_POWER = 20_000;

// Feature keys: part of the external ids, never rename one.
export const BATTERY_FEATURE = {
  LEVEL: 'level',
  CHARGE_POWER: 'charge-power',
  DISCHARGE_POWER: 'discharge-power',
  CHARGE_INDEX: 'charge-index',
  DISCHARGE_INDEX: 'discharge-index',
  ENERGY_REMAINING: 'energy-remaining',
  MODE: 'working-mode',
  STATUS: 'status',
};

const sensor = (name, externalId, type, unit, min, max) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.BATTERY_STORAGE,
  type,
  unit,
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

export const battery = {
  type: DEVICE_TYPE,

  entities(snapshot) {
    return snapshot.batteries;
  },

  ids(gladys, entity) {
    return gladys.externalIds(DEVICE_TYPE, entity.id);
  },

  buildDevice(gladys, entity) {
    const ids = this.ids(gladys, entity);
    const T = DEVICE_FEATURE_TYPES.BATTERY_STORAGE;
    const U = DEVICE_FEATURE_UNITS;
    return {
      name: 'Huawei LUNA2000 battery',
      external_id: ids.device,
      should_poll: true,
      poll_frequency: POLL_FREQUENCY,
      features: [
        sensor(
          'Battery level',
          ids.feature(BATTERY_FEATURE.LEVEL),
          T.BATTERY_LEVEL,
          U.PERCENT,
          0,
          100,
        ),
        sensor(
          'Charge power',
          ids.feature(BATTERY_FEATURE.CHARGE_POWER),
          T.CHARGE_POWER,
          U.WATT,
          0,
          MAX_BATTERY_POWER,
        ),
        sensor(
          'Discharge power',
          ids.feature(BATTERY_FEATURE.DISCHARGE_POWER),
          T.DISCHARGE_POWER,
          U.WATT,
          0,
          MAX_BATTERY_POWER,
        ),
        sensor(
          'Total charged',
          ids.feature(BATTERY_FEATURE.CHARGE_INDEX),
          T.CHARGE_INDEX,
          U.KILOWATT_HOUR,
          0,
          10_000_000,
        ),
        sensor(
          'Total discharged',
          ids.feature(BATTERY_FEATURE.DISCHARGE_INDEX),
          T.DISCHARGE_INDEX,
          U.KILOWATT_HOUR,
          0,
          10_000_000,
        ),
        sensor(
          'Energy remaining',
          ids.feature(BATTERY_FEATURE.ENERGY_REMAINING),
          T.BATTERY_ENERGY_REMAINING,
          U.KILOWATT_HOUR,
          0,
          1_000,
        ),
        {
          name: 'Working mode',
          external_id: ids.feature(BATTERY_FEATURE.MODE),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
          read_only: false,
          has_feedback: true,
          keep_history: false,
          supported_options: SELECTABLE_BATTERY_MODES.map((mode, index) => ({
            value: mode,
            label: BATTERY_MODE_LABELS[mode].en,
            sort_order: index,
          })),
        },
        {
          name: 'Status',
          external_id: ids.feature(BATTERY_FEATURE.STATUS),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
          read_only: true,
          has_feedback: false,
          keep_history: false,
        },
      ],
    };
  },

  states(gladys, entity) {
    const ids = this.ids(gladys, entity);
    const power = entity.power;
    const hasPower = typeof power === 'number';
    const remaining =
      typeof entity.capacity === 'number' && typeof entity.soc === 'number'
        ? Math.round(entity.capacity * entity.soc) / 100
        : null;
    return [
      ...numericState(ids.feature(BATTERY_FEATURE.LEVEL), entity.soc),
      ...numericState(
        ids.feature(BATTERY_FEATURE.CHARGE_POWER),
        hasPower ? Math.max(0, power) : null,
      ),
      ...numericState(
        ids.feature(BATTERY_FEATURE.DISCHARGE_POWER),
        hasPower ? Math.max(0, -power) : null,
      ),
      ...numericState(ids.feature(BATTERY_FEATURE.CHARGE_INDEX), entity.chargeIndex),
      ...numericState(ids.feature(BATTERY_FEATURE.DISCHARGE_INDEX), entity.dischargeIndex),
      ...numericState(ids.feature(BATTERY_FEATURE.ENERGY_REMAINING), remaining),
      ...textState(ids.feature(BATTERY_FEATURE.MODE), entity.mode),
      ...textState(ids.feature(BATTERY_FEATURE.STATUS), BATTERY_STATUS_LABELS[entity.status]?.en),
    ];
  },

  /**
   * The user picked a working mode in Gladys.
   */
  async onSetValue(gladys, { hub, entity, feature, value }) {
    const ids = this.ids(gladys, entity);
    if (feature.external_id !== ids.feature(BATTERY_FEATURE.MODE)) {
      throw new Error(`Feature ${feature.external_id} is read-only`);
    }
    if (!SELECTABLE_BATTERY_MODES.includes(value)) {
      throw new Error(`Unsupported battery working mode: ${value}`);
    }
    logger.info(`Working mode <- ${value}`);
    await hub.local().setBatteryMode(value);
    hub.invalidate();
    await gladys.publishState(feature.external_id, { text: value });
  },
};
