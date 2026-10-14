// End to end: the whole integration against the SDK's fake Gladys, with fake
// drivers behind the hub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { SolarHub } from '../src/hub.js';
import { fakeDriver, sampleSnapshot } from './helpers/fixtures.js';

const CONFIG = {
  modbus_host: '192.168.1.50',
  fusionsolar_username: 'u',
  fusionsolar_password: 'p',
};

async function start({
  config = CONFIG,
  local = fakeDriver(sampleSnapshot()),
  cloud = fakeDriver(sampleSnapshot()),
} = {}) {
  const gladys = createFakeGladys({ config });
  const hub = new SolarHub({ createLocal: () => local, createCloud: () => cloud });
  const app = registerHandlers(gladys, { hub, loopIntervalMs: 3_600_000 });
  await gladys.connect();
  return { gladys, app, hub, local, cloud };
}

test('on connection, the devices are discovered and the status is connected', async () => {
  const { gladys, app } = await start();
  try {
    assert.equal(gladys.fake.discoveredDevices.length, 3);
    assert.equal(gladys.fake.connectionStatus.connected, true);
    assert.ok(gladys.fake.transports.every((t) => t.transport === 'local'));
    assert.ok(gladys.fake.widgetRefreshes.length > 0);
  } finally {
    app.stop();
  }
});

test('a poll publishes the states of the polled device', async () => {
  const { gladys, app } = await start();
  try {
    const inverter = gladys.fake.discoveredDevices.find((d) =>
      d.external_id.includes(':inverter:'),
    );
    assert.deepEqual(await gladys.fake.poll(inverter), { success: true });
    assert.equal(gladys.fake.lastState(`${inverter.external_id}:production-power`), 4000);
  } finally {
    app.stop();
  }
});

test('an unconfigured integration says what to fill in', async () => {
  const { gladys, app } = await start({ config: {} });
  try {
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.deepEqual(gladys.fake.discoveredDevices, []);
  } finally {
    app.stop();
  }
});

test('an unreachable installation is reported', async () => {
  const local = fakeDriver(sampleSnapshot());
  local.fail = new Error('ECONNREFUSED');
  const { gladys, app } = await start({ config: { modbus_host: '192.168.1.50' }, local });
  try {
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.match(gladys.fake.connectionStatus.message.en, /ECONNREFUSED/);
  } finally {
    app.stop();
  }
});

test('the battery mode select goes through onSetValue', async () => {
  const { gladys, app, local } = await start();
  try {
    const battery = gladys.fake.discoveredDevices.find((d) => d.external_id.includes(':battery:'));
    const feature = battery.features.find((f) => f.external_id.endsWith(':working-mode'));
    assert.deepEqual(await gladys.fake.setValue(battery, feature, 'time_of_use'), {
      success: true,
    });
    assert.deepEqual(local.commands, [['setBatteryMode', 'time_of_use']]);
  } finally {
    app.stop();
  }
});

test('scene actions, widgets and the test action are wired', async () => {
  const { gladys, app } = await start();
  try {
    const action = await gladys.fake.sceneAction('read_live_data', {});
    assert.equal(action.success, true);
    const widget = await gladys.fake.widgetGet('solar_overview', {
      settings: {},
      language: 'fr',
      units: 'metric',
    });
    assert.equal(widget.success, true);
    const message = await gladys.fake.action('test_connection', {});
    assert.equal(message.success, true);
    assert.match(JSON.stringify(message.data), /Local Modbus: OK/);
    assert.match(JSON.stringify(message.data), /FusionSolar cloud: OK/);
  } finally {
    app.stop();
  }
});

test('a scene event is fired when a new reading crosses a battery level', async () => {
  const local = fakeDriver(
    sampleSnapshot(),
    sampleSnapshot({ batteries: [{ ...sampleSnapshot().batteries[0], soc: 81 }] }),
  );
  const { gladys, app, hub } = await start({ local });
  try {
    await hub.refresh({ force: true });
    assert.deepEqual(
      gladys.fake.sceneEvents.map((e) => [e.key, e.data.level]),
      [['battery_level_crossed', '80']],
    );
  } finally {
    app.stop();
  }
});

test('a configuration update re-initializes the integration', async () => {
  const { gladys, app } = await start({ config: {} });
  try {
    await gladys.fake.configUpdated({ modbus_host: '192.168.1.50' });
    assert.equal(gladys.fake.discoveredDevices.length, 3);
    assert.equal(gladys.fake.connectionStatus.connected, true);
  } finally {
    app.stop();
  }
});
