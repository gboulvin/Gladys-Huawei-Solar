import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTERY_MODE_LABELS,
  BATTERY_STATUS_LABELS,
  GRID_FLOW_LABELS,
  INVERTER_STATUS,
  INVERTER_STATUS_LABELS,
  batteryModeFromCloud,
  batteryModeFromLocal,
  gridFlowOf,
  normalizeInverterStatus,
} from '../src/huawei/status.js';

test('inverter state codes fold into the scene vocabulary', () => {
  assert.equal(normalizeInverterStatus(0x0000), 'standby');
  assert.equal(normalizeInverterStatus(0x0100), 'starting');
  assert.equal(normalizeInverterStatus(0x0200), 'on_grid');
  assert.equal(normalizeInverterStatus(0x0201), 'limited');
  assert.equal(normalizeInverterStatus(0x0203), 'off_grid');
  assert.equal(normalizeInverterStatus(0x0300), 'fault');
  assert.equal(normalizeInverterStatus(0x0305), 'shutdown');
  assert.equal(normalizeInverterStatus(0x0401), 'on_grid');
  assert.equal(normalizeInverterStatus(0xa000), 'no_irradiation');
  assert.equal(normalizeInverterStatus(0x0800), 'other');
  assert.equal(normalizeInverterStatus(null), 'other');
});

test('battery working modes from both channels', () => {
  assert.equal(batteryModeFromLocal(2), 'maximise_self_consumption');
  assert.equal(batteryModeFromLocal(5), 'time_of_use');
  assert.equal(batteryModeFromLocal(42), 'other');
  assert.equal(batteryModeFromCloud(4), 'maximise_self_consumption');
  assert.equal(batteryModeFromCloud(5), 'fully_fed_to_grid');
});

test('grid flow uses a dead band', () => {
  assert.equal(gridFlowOf(150, 100), 'importing');
  assert.equal(gridFlowOf(-150, 100), 'exporting');
  assert.equal(gridFlowOf(80, 100), 'idle');
});

test('every label exists in English, French, German and Spanish', () => {
  const tables = [
    INVERTER_STATUS_LABELS,
    BATTERY_STATUS_LABELS,
    BATTERY_MODE_LABELS,
    GRID_FLOW_LABELS,
  ];
  for (const table of tables) {
    for (const [key, label] of Object.entries(table)) {
      assert.deepEqual(Object.keys(label).sort(), ['de', 'en', 'es', 'fr'], key);
    }
  }
  for (const status of Object.values(INVERTER_STATUS)) {
    assert.ok(INVERTER_STATUS_LABELS[status], status);
  }
});
