import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOTH_CONFIG,
  CLOUD_CONFIG,
  LOCAL_CONFIG,
  createHub,
  fakeDriver,
  sampleSnapshot,
} from './helpers/fixtures.js';
import { normalizeConfig } from '../src/config.js';
import { CommandUnavailableError } from '../src/hub.js';

test('the house consumption is production plus grid import', async () => {
  const { hub } = createHub();
  const snapshot = await hub.refresh();
  // 4000 W produced, 1500 W exported -> 2500 W consumed.
  assert.deepEqual(snapshot.house, { power: 2500 });
  assert.equal(snapshot.source, 'local');
});

test('concurrent polls share one read, and the snapshot is cached', async () => {
  let clock = 0;
  const { hub, drivers } = createHub({ now: () => clock });
  await Promise.all([hub.refresh(), hub.refresh(), hub.refresh()]);
  assert.equal(drivers.local.reads, 1);
  clock = 30_000;
  await hub.refresh();
  assert.equal(drivers.local.reads, 1, 'within the 60 s interval');
  clock = 56_000;
  await hub.refresh();
  assert.equal(drivers.local.reads, 2, 'due within the tolerance');
  await hub.refresh({ force: true });
  assert.equal(drivers.local.reads, 3);
});

test('the cloud is never read more than every 5 minutes', async () => {
  let clock = 0;
  const { hub, drivers } = createHub({ config: CLOUD_CONFIG, now: () => clock });
  await hub.refresh();
  clock = 120_000;
  await hub.refresh();
  assert.equal(drivers.cloud.reads, 1);
  clock = 300_000;
  await hub.refresh();
  assert.equal(drivers.cloud.reads, 2);
});

test('local is preferred by default, cloud when the toggle says so', async () => {
  const { hub } = createHub({ config: BOTH_CONFIG });
  assert.equal((await hub.refresh()).source, 'local');
  assert.deepEqual(hub.transport(), { transport: 'local' });

  const cloudFirst = createHub({
    config: normalizeConfig({ ...BOTH_CONFIG, GLADYS_PREFER_LOCAL: false }),
  });
  assert.equal((await cloudFirst.hub.refresh()).source, 'cloud');
});

test('a failing preferred channel falls back, flagged degraded', async () => {
  const local = fakeDriver(sampleSnapshot());
  local.fail = new Error('ECONNREFUSED');
  const { hub } = createHub({ config: BOTH_CONFIG, local });
  assert.equal((await hub.refresh()).source, 'cloud');
  const transport = hub.transport();
  assert.equal(transport.transport, 'cloud');
  assert.equal(transport.degraded, true);
  assert.ok(
    transport.message.en && transport.message.fr && transport.message.de && transport.message.es,
  );
});

test('every channel failing makes the installation unreachable', async () => {
  const local = fakeDriver(sampleSnapshot());
  local.fail = new Error('timeout');
  const { hub } = createHub({ config: LOCAL_CONFIG, local });
  await assert.rejects(hub.refresh(), /timeout/);
  assert.deepEqual(hub.transport(), { transport: 'unreachable' });
});

test('commands need the local connection', () => {
  const { hub } = createHub({ config: CLOUD_CONFIG });
  assert.throws(() => hub.local(), CommandUnavailableError);
});

test('listeners receive the new and the previous snapshot', async () => {
  const { hub } = createHub();
  const seen = [];
  hub.onSnapshot((snapshot, previous) => seen.push([snapshot.source, previous?.source ?? null]));
  await hub.refresh();
  await hub.refresh({ force: true });
  assert.deepEqual(seen, [
    ['local', null],
    ['local', 'local'],
  ]);
});

test('a read started before a reconfiguration is discarded', async () => {
  let release;
  const slow = fakeDriver(sampleSnapshot());
  const original = slow.readSnapshot.bind(slow);
  slow.readSnapshot = () => new Promise((resolve) => (release = () => resolve(original())));
  const { hub, drivers } = createHub({ local: slow });
  const pending = hub.refresh();
  drivers.local = fakeDriver(sampleSnapshot());
  hub.configure(LOCAL_CONFIG);
  const fresh = hub.refresh();
  release();
  await assert.rejects(pending, /configuration changed/);
  assert.equal((await fresh).source, 'local');
  assert.equal(drivers.local.reads, 1);
});
