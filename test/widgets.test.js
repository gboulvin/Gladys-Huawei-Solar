import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDiscoveredDevices } from '../src/devices/index.js';
import {
  BATTERY_CONTROL_WIDGET,
  SOLAR_OVERVIEW_WIDGET,
  WIDGETS,
  refreshWidgets,
} from '../src/widgets.js';
import {
  CLOUD_CONFIG,
  LOCAL_CONFIG,
  createHub,
  fakeDriver,
  sampleSnapshot,
} from './helpers/fixtures.js';

const gladys = createFakeGladys();

const getContent = (key, hub, config = LOCAL_CONFIG) =>
  WIDGETS[key].get(gladys, { settings: {}, language: 'en', units: 'metric', hub, config });

for (const key of Object.keys(WIDGETS)) {
  test(`the ${key} content is rendered exactly as sent`, async () => {
    const { hub } = createHub();
    assert.deepEqual(validateWidgetContent(await getContent(key, hub)), []);
  });

  test(`the ${key} content is valid before the first reading`, async () => {
    const local = fakeDriver(sampleSnapshot());
    local.fail = new Error('offline');
    const { hub } = createHub({ local });
    const content = await getContent(key, hub);
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].type, 'text');
  });
}

test('the live tiles reference features the integration publishes', async () => {
  const { hub } = createHub();
  const featureIds = new Set(
    buildDiscoveredDevices(gladys, await hub.refresh()).flatMap((d) =>
      d.features.map((f) => f.external_id),
    ),
  );
  for (const key of Object.keys(WIDGETS)) {
    const content = await getContent(key, hub);
    const bound = content.components
      .flatMap((c) => [c.device_feature, ...(c.device_features ?? [])])
      .filter(Boolean);
    assert.ok(bound.length > 0, key);
    for (const id of bound) assert.ok(featureIds.has(id), `${key}: unknown feature ${id}`);
  }
});

test('the overview shows a degraded connection as a warning', async () => {
  const local = fakeDriver(sampleSnapshot());
  local.fail = new Error('offline');
  const { hub } = createHub({ config: { ...CLOUD_CONFIG, modbus_host: '192.168.1.50' }, local });
  const content = await getContent(SOLAR_OVERVIEW_WIDGET, hub);
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((c) => c.type === 'status');
  assert.ok(status.items.some((item) => item.color === 'warning'));
});

test('without battery, the battery widget says so', async () => {
  const { hub } = createHub({ local: fakeDriver(sampleSnapshot({ batteries: [] })) });
  const content = await getContent(BATTERY_CONTROL_WIDGET, hub);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.en, /No LUNA2000/);
});

test('every button of the battery widget is handled', async () => {
  const { hub, drivers } = createHub();
  const content = await getContent(BATTERY_CONTROL_WIDGET, hub);
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.equal(buttons.length, 4);
  for (const { action } of buttons) {
    // The core applies the field defaults before relaying.
    const values = Object.fromEntries((action.fields ?? []).map((f) => [f.key, f.default]));
    const toast = await WIDGETS[BATTERY_CONTROL_WIDGET].action(gladys, {
      hub,
      actionKey: action.key,
      params: action.params ?? {},
      values,
    });
    assert.ok(toast.en.length <= 200);
  }
  assert.equal(drivers.local.commands.length, 4);
});

test('a widget command without the local connection fails with its reason', async () => {
  const { hub } = createHub({ config: CLOUD_CONFIG });
  await assert.rejects(
    WIDGETS[BATTERY_CONTROL_WIDGET].action(gladys, { hub, actionKey: 'stop', values: {} }),
    /local Modbus/,
  );
  await assert.rejects(
    WIDGETS[BATTERY_CONTROL_WIDGET].action(gladys, { hub, actionKey: 'unknown', values: {} }),
    /Unknown widget action/,
  );
});

test('refreshWidgets nudges every widget', () => {
  const fresh = createFakeGladys();
  refreshWidgets(fresh);
  assert.deepEqual(fresh.fake.widgetRefreshes, Object.keys(WIDGETS));
});
