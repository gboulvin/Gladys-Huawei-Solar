// -----------------------------------------------------------------------------
// Device kind: SUN2000 INVERTER
// Read-only: AC production, PV input, today's and lifetime yield, internal
// temperature and operating status. Keyed on the inverter serial number,
// which both the local and the cloud channels report.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INVERTER_STATUS_LABELS } from '../huawei/status.js';
import { POLL_FREQUENCY, numericState, textState } from './common.js';

const DEVICE_TYPE = 'inverter';

// Feature keys: part of the external ids, never rename one.
export const INVERTER_FEATURE = {
  PRODUCTION_POWER: 'production-power',
  PRODUCTION_INDEX: 'production-index',
  DAILY_PRODUCTION: 'daily-production',
  PV_INPUT_POWER: 'pv-input-power',
  TEMPERATURE: 'temperature',
  STATUS: 'status',
};

export const inverter = {
  type: DEVICE_TYPE,

  entities(snapshot) {
    return snapshot.inverters;
  },

  ids(gladys, entity) {
    return gladys.externalIds(DEVICE_TYPE, entity.sn);
  },

  buildDevice(gladys, entity) {
    const ids = this.ids(gladys, entity);
    // A little headroom over the rated power, for the dashboard gauges.
    const maxPower = entity.ratedPower ? Math.round(entity.ratedPower * 1.1) : 100_000;
    return {
      name: `Huawei ${entity.model}`,
      external_id: ids.device,
      model: entity.model,
      should_poll: true,
      poll_frequency: POLL_FREQUENCY,
      params: [{ name: 'serial_number', value: entity.sn }],
      features: [
        {
          name: 'Solar production',
          external_id: ids.feature(INVERTER_FEATURE.PRODUCTION_POWER),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: maxPower,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
        {
          name: 'Total production',
          external_id: ids.feature(INVERTER_FEATURE.PRODUCTION_INDEX),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
          unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
          min: 0,
          max: 100_000_000,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
        {
          name: "Today's production",
          external_id: ids.feature(INVERTER_FEATURE.DAILY_PRODUCTION),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
          unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
          min: 0,
          max: 10_000,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
        {
          name: 'PV input power',
          external_id: ids.feature(INVERTER_FEATURE.PV_INPUT_POWER),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: maxPower,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
        {
          name: 'Internal temperature',
          external_id: ids.feature(INVERTER_FEATURE.TEMPERATURE),
          category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
          unit: DEVICE_FEATURE_UNITS.CELSIUS,
          min: -40,
          max: 120,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
        {
          name: 'Status',
          external_id: ids.feature(INVERTER_FEATURE.STATUS),
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
    return [
      ...numericState(ids.feature(INVERTER_FEATURE.PRODUCTION_POWER), entity.activePower),
      ...numericState(ids.feature(INVERTER_FEATURE.PRODUCTION_INDEX), entity.totalYield),
      ...numericState(ids.feature(INVERTER_FEATURE.DAILY_PRODUCTION), entity.dailyYield),
      ...numericState(ids.feature(INVERTER_FEATURE.PV_INPUT_POWER), entity.inputPower),
      ...numericState(ids.feature(INVERTER_FEATURE.TEMPERATURE), entity.temperature),
      // Device states are not translated by Gladys: the English label.
      ...textState(ids.feature(INVERTER_FEATURE.STATUS), INVERTER_STATUS_LABELS[entity.status]?.en),
    ];
  },
};
