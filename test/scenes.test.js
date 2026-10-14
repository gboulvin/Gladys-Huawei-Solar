import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TRIGGER, computeSceneEvents, createTriggerListener } from '../src/triggers.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { CLOUD_CONFIG, createHub, sampleSnapshot } from './helpers/fixtures.js';
import { normalizeConfig } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const config = normalizeConfig();
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const declaration = (list, key) => manifest[list].find((entry) => entry.key === key);

const withInverter = (changes) =>
  sampleSnapshot({ inverters: [{ ...sampleSnapshot().inverters[0], ...changes }] });
const withMeter = (power) => sampleSnapshot({ meters: [{ ...sampleSnapshot().meters[0], power }] });
const withBattery = (soc) =>
  sampleSnapshot({ batteries: [{ ...sampleSnapshot().batteries[0], soc }] });

// Every event only carries keys the trigger declares, primitive values, and
// filter values among the declared options.
function assertDeclared(event) {
  const trigger = declaration('scene_triggers', event.key);
  assert.ok(trigger, `trigger ${event.key} is declared`);
  const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
  for (const [key, value] of Object.entries(event.data)) {
    assert.ok(declared.includes(key), `${event.key}: data.${key} is not declared`);
    assert.ok(
      value === null || typeof value !== 'object',
      `${event.key}: data.${key} is primitive`,
    );
    const field = trigger.fields.find((f) => f.key === key && f.options);
    if (field) {
      assert.ok(
        field.options.some((option) => option.value === value),
        `${event.key}: data.${key} "${value}" is one of the filter options`,
      );
    }
  }
}

test('no event on the first snapshot', () => {
  assert.deepEqual(computeSceneEvents(createFakeGladys(), sampleSnapshot(), null, config), []);
});

test('an inverter status change fires inverter_status_changed once', () => {
  const gladys = createFakeGladys();
  const before = withInverter({ status: 'no_irradiation', activePower: 0 });
  const after = withInverter({ status: 'on_grid', activePower: 150 });
  const events = computeSceneEvents(gladys, after, before, config);
  assert.equal(events.length, 1);
  assert.equal(events[0].key, TRIGGER.INVERTER_STATUS_CHANGED);
  assert.deepEqual(events[0].data, {
    device: 'ext:test-integration:inverter:HV2150012345',
    status: 'on_grid',
    previous_status: 'no_irradiation',
    production_power: 150,
  });
  assertDeclared(events[0]);
  assert.deepEqual(computeSceneEvents(gladys, after, after, config), [], 'no change, no event');
});

test('grid flow changes respect the dead band', () => {
  const gladys = createFakeGladys();
  assert.deepEqual(computeSceneEvents(gladys, withMeter(-50), withMeter(80), config), []);
  const events = computeSceneEvents(gladys, withMeter(-800), withMeter(50), config);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.flow, 'exporting');
  assert.equal(events[0].data.previous_flow, 'idle');
  assert.equal(events[0].data.grid_power, -800);
  assertDeclared(events[0]);
});

test('battery levels fire once per crossed level, both ways', () => {
  const gladys = createFakeGladys();
  const rising = computeSceneEvents(gladys, withBattery(100), withBattery(89), config);
  assert.deepEqual(
    rising.map((e) => [e.data.direction, e.data.level]),
    [
      ['rising', '90'],
      ['rising', '100'],
    ],
  );
  const falling = computeSceneEvents(gladys, withBattery(19.5), withBattery(20), config);
  assert.deepEqual(
    falling.map((e) => [e.data.direction, e.data.level]),
    [['falling', '20']],
  );
  [...rising, ...falling].forEach(assertDeclared);
});

test('the listener publishes the events to Gladys', async () => {
  const gladys = createFakeGladys();
  const listener = createTriggerListener(gladys, () => config);
  await listener(withBattery(50), withBattery(49));
  assert.equal(gladys.fake.sceneEvents.length, 1);
  assert.equal(gladys.fake.sceneEvents[0].key, TRIGGER.BATTERY_LEVEL_CROSSED);
});

test('scene commands reach the local driver and return the declared outputs', async () => {
  const gladys = createFakeGladys();
  const { hub, drivers } = createHub();
  const runs = [
    ['force_battery_charge', { power: 3000, duration: 30 }],
    ['force_battery_discharge', { power: 2000, duration: 15 }],
    ['stop_battery_forced_mode', {}],
    ['set_battery_working_mode', { mode: 'fully_fed_to_grid' }],
    ['set_grid_export_limit', { mode: 'limited', limit: 2500 }],
    ['set_inverter_state', { state: 'stop' }],
  ];
  for (const [key, fields] of runs) {
    const outputs = await SCENE_ACTIONS[key](gladys, { hub, fields, config });
    assert.equal(outputs.success, true, key);
    const declared = keysOf(declaration('scene_actions', key).outputs);
    for (const output of Object.keys(outputs)) {
      assert.ok(declared.includes(output), `${key}: output "${output}" is not declared`);
    }
  }
  assert.deepEqual(drivers.local.commands, [
    ['forceBattery', { direction: 'charge', power: 3000, duration: 30 }],
    ['forceBattery', { direction: 'discharge', power: 2000, duration: 15 }],
    ['stopForcedBattery'],
    ['setBatteryMode', 'fully_fed_to_grid'],
    ['setGridExportLimit', { mode: 'limited', limit: 2500 }],
    ['setInverterRunning', false],
  ]);
});

test('a command without the local connection is an output, not a failure', async () => {
  const { hub } = createHub({ config: CLOUD_CONFIG });
  const outputs = await SCENE_ACTIONS.stop_battery_forced_mode(createFakeGladys(), {
    hub,
    fields: {},
  });
  assert.equal(outputs.success, false);
  assert.match(outputs.message, /local Modbus/);
});

test('invalid choices are refused through the outputs', async () => {
  const { hub, drivers } = createHub();
  const gladys = createFakeGladys();
  assert.equal(
    (await SCENE_ACTIONS.set_battery_working_mode(gladys, { hub, fields: { mode: 'x' } })).success,
    false,
  );
  assert.equal(
    (await SCENE_ACTIONS.set_grid_export_limit(gladys, { hub, fields: { mode: 'x' } })).success,
    false,
  );
  assert.deepEqual(drivers.local.commands, []);
});

test('read_live_data exposes the current values', async () => {
  const { hub } = createHub();
  const outputs = await SCENE_ACTIONS.read_live_data(createFakeGladys(), { hub, fields: {} });
  assert.deepEqual(outputs, {
    success: true,
    production_power: 4000,
    daily_production: 18.5,
    grid_power: -1500,
    house_power: 2500,
    battery_level: 75.5,
    battery_power: 500,
    inverter_status: 'on_grid',
  });
  const declared = keysOf(declaration('scene_actions', 'read_live_data').outputs);
  for (const key of Object.keys(outputs)) assert.ok(declared.includes(key), key);
});
