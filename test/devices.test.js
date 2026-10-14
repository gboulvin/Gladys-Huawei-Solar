import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  buildDiscoveredDevices,
  buildTransportEntries,
  findDevice,
  statesOfDevice,
} from '../src/devices/index.js';
import { battery, BATTERY_FEATURE } from '../src/devices/battery.js';
import { createHub, sampleSnapshot } from './helpers/fixtures.js';

const snapshot = sampleSnapshot();

test('one device per inverter, meter and battery, accepted by Gladys', async () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, snapshot);
  assert.deepEqual(
    devices.map((d) => d.external_id),
    [
      'ext:test-integration:inverter:HV2150012345',
      'ext:test-integration:power-meter:HV2150012345',
      'ext:test-integration:battery:HV2150012345',
    ],
  );
  // The fake Gladys refuses unknown categories, types, units and poll frequencies.
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});

test('no snapshot, no device', () => {
  assert.deepEqual(buildDiscoveredDevices(createFakeGladys(), null), []);
});

test('the states of every device are accepted by Gladys and target its features', async () => {
  const gladys = createFakeGladys();
  for (const device of buildDiscoveredDevices(gladys, snapshot)) {
    const states = statesOfDevice(gladys, device.external_id, snapshot);
    assert.ok(states.length > 0);
    const featureIds = new Set(device.features.map((f) => f.external_id));
    for (const state of states) {
      assert.ok(featureIds.has(state.device_feature_external_id), state.device_feature_external_id);
    }
    await gladys.publishStates(states);
  }
});

test('inverter, meter and battery values', () => {
  const gladys = createFakeGladys();
  const value = (type, feature) => {
    const states = statesOfDevice(gladys, `ext:test-integration:${type}:HV2150012345`, snapshot);
    const state = states.find((s) => s.device_feature_external_id.endsWith(`:${feature}`));
    return state?.text ?? state?.state;
  };
  assert.equal(value('inverter', 'production-power'), 4000);
  assert.equal(value('inverter', 'production-index'), 12345.67);
  assert.equal(value('inverter', 'status'), 'Producing (on-grid)');
  assert.equal(value('power-meter', 'grid-power'), -1500);
  assert.equal(value('power-meter', 'import-power'), 0);
  assert.equal(value('power-meter', 'export-power'), 1500);
  assert.equal(value('power-meter', 'house-power'), 2500);
  assert.equal(value('battery', 'level'), 75.5);
  assert.equal(value('battery', 'charge-power'), 500);
  assert.equal(value('battery', 'discharge-power'), 0);
  assert.equal(value('battery', 'energy-remaining'), 7.55);
  assert.equal(value('battery', 'working-mode'), 'maximise_self_consumption');
});

test('unknown values are left out, never published as null', () => {
  const gladys = createFakeGladys();
  const cloudLike = sampleSnapshot({
    batteries: [
      { ...snapshot.batteries[0], chargeIndex: null, dischargeIndex: null, capacity: null },
    ],
  });
  const states = statesOfDevice(gladys, 'ext:test-integration:battery:HV2150012345', cloudLike);
  assert.ok(
    states.every((s) => (s.state !== null && s.state !== undefined) || typeof s.text === 'string'),
  );
  assert.ok(!states.some((s) => s.device_feature_external_id.endsWith(':charge-index')));
});

test('the battery working mode is set through the local connection', async () => {
  const gladys = createFakeGladys();
  const { hub, drivers } = createHub();
  const entity = snapshot.batteries[0];
  const feature = { external_id: battery.ids(gladys, entity).feature(BATTERY_FEATURE.MODE) };
  await battery.onSetValue(gladys, { hub, entity, feature, value: 'time_of_use' });
  assert.deepEqual(drivers.local.commands, [['setBatteryMode', 'time_of_use']]);
  assert.equal(gladys.fake.lastState(feature.external_id), 'time_of_use');
  await assert.rejects(
    battery.onSetValue(gladys, { hub, entity, feature, value: 'bogus' }),
    /Unsupported/,
  );
});

test('findDevice routes an external id to its kind', () => {
  const gladys = createFakeGladys();
  assert.equal(
    findDevice(gladys, 'ext:test-integration:battery:HV2150012345', snapshot).kind,
    battery,
  );
  assert.equal(findDevice(gladys, 'ext:test-integration:battery:unknown', snapshot), null);
});

test('every device carries the transport of the hub', () => {
  const gladys = createFakeGladys();
  const entries = buildTransportEntries(gladys, snapshot, { transport: 'cloud', degraded: true });
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.transport === 'cloud' && e.degraded === true));
});
