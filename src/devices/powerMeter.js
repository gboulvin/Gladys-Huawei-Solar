// -----------------------------------------------------------------------------
// Device kind: POWER METER (DTSU666-H / DDSU666-H, wired to the inverter)
// The grid exchange — net power, import / export split and indexes — plus the
// house consumption the hub derives from it and the solar production.
//
// Sign convention (Gladys grid sensor): positive when drawing from the grid,
// negative when exporting. Huawei reports the opposite, the drivers flip it.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { POLL_FREQUENCY, numericState } from './common.js';

const DEVICE_TYPE = 'power-meter';

const MAX_GRID_POWER = 50_000;

// Feature keys: part of the external ids, never rename one.
export const METER_FEATURE = {
  GRID_POWER: 'grid-power',
  IMPORT_POWER: 'import-power',
  EXPORT_POWER: 'export-power',
  IMPORT_INDEX: 'import-index',
  EXPORT_INDEX: 'export-index',
  VOLTAGE: 'voltage',
  CURRENT: 'current',
  HOUSE_POWER: 'house-power',
};

const sensor = (name, externalId, category, type, unit, min, max) => ({
  name,
  external_id: externalId,
  category,
  type,
  unit,
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

export const powerMeter = {
  type: DEVICE_TYPE,

  entities(snapshot) {
    return snapshot.meters;
  },

  ids(gladys, entity) {
    return gladys.externalIds(DEVICE_TYPE, entity.id);
  },

  buildDevice(gladys, entity) {
    const ids = this.ids(gladys, entity);
    const { GRID_SENSOR, ENERGY_SENSOR, HOME_OUTPUT_SENSOR } = DEVICE_FEATURE_TYPES;
    const C = DEVICE_FEATURE_CATEGORIES;
    const U = DEVICE_FEATURE_UNITS;
    return {
      name: 'Huawei power meter',
      external_id: ids.device,
      should_poll: true,
      poll_frequency: POLL_FREQUENCY,
      features: [
        sensor(
          'Grid power',
          ids.feature(METER_FEATURE.GRID_POWER),
          C.GRID_SENSOR,
          GRID_SENSOR.POWER,
          U.WATT,
          -MAX_GRID_POWER,
          MAX_GRID_POWER,
        ),
        sensor(
          'Grid import power',
          ids.feature(METER_FEATURE.IMPORT_POWER),
          C.GRID_SENSOR,
          GRID_SENSOR.INPUT_POWER,
          U.WATT,
          0,
          MAX_GRID_POWER,
        ),
        sensor(
          'Grid export power',
          ids.feature(METER_FEATURE.EXPORT_POWER),
          C.GRID_SENSOR,
          GRID_SENSOR.OUTPUT_POWER,
          U.WATT,
          0,
          MAX_GRID_POWER,
        ),
        sensor(
          'Grid import index',
          ids.feature(METER_FEATURE.IMPORT_INDEX),
          C.GRID_SENSOR,
          GRID_SENSOR.INPUT_INDEX,
          U.KILOWATT_HOUR,
          0,
          100_000_000,
        ),
        sensor(
          'Grid export index',
          ids.feature(METER_FEATURE.EXPORT_INDEX),
          C.GRID_SENSOR,
          GRID_SENSOR.OUTPUT_INDEX,
          U.KILOWATT_HOUR,
          0,
          100_000_000,
        ),
        sensor(
          'House consumption',
          ids.feature(METER_FEATURE.HOUSE_POWER),
          C.HOME_OUTPUT_SENSOR,
          HOME_OUTPUT_SENSOR.POWER,
          U.WATT,
          0,
          MAX_GRID_POWER,
        ),
        sensor(
          'Grid voltage',
          ids.feature(METER_FEATURE.VOLTAGE),
          C.ENERGY_SENSOR,
          ENERGY_SENSOR.VOLTAGE,
          U.VOLT,
          0,
          500,
        ),
        sensor(
          'Grid current',
          ids.feature(METER_FEATURE.CURRENT),
          C.ENERGY_SENSOR,
          ENERGY_SENSOR.CURRENT,
          U.AMPERE,
          -200,
          200,
        ),
      ],
    };
  },

  /**
   * @param {object} entity the meter
   * @param {object} snapshot the whole snapshot (house consumption)
   */
  states(gladys, entity, snapshot) {
    const ids = this.ids(gladys, entity);
    const power = entity.power;
    const hasPower = typeof power === 'number';
    // The house consumption is computed over the whole installation: it is
    // attached to the first meter only.
    const house = snapshot.meters[0] === entity ? snapshot.house?.power : null;
    return [
      ...numericState(ids.feature(METER_FEATURE.GRID_POWER), power),
      ...numericState(
        ids.feature(METER_FEATURE.IMPORT_POWER),
        hasPower ? Math.max(0, power) : null,
      ),
      ...numericState(
        ids.feature(METER_FEATURE.EXPORT_POWER),
        hasPower ? Math.max(0, -power) : null,
      ),
      ...numericState(ids.feature(METER_FEATURE.IMPORT_INDEX), entity.importIndex),
      ...numericState(ids.feature(METER_FEATURE.EXPORT_INDEX), entity.exportIndex),
      ...numericState(ids.feature(METER_FEATURE.HOUSE_POWER), house),
      ...numericState(ids.feature(METER_FEATURE.VOLTAGE), entity.voltage),
      ...numericState(ids.feature(METER_FEATURE.CURRENT), entity.current),
    ];
  },
};
