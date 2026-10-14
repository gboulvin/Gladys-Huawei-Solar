import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudDriver, toNumber } from '../src/huawei/cloud.js';

const STATION = 'NE=33554875';

/**
 * A fake FusionSolar Northbound server, as a `fetch` function.
 */
function fakeFusionSolar({ legacyStations = false, expireOnce = false, rateLimited = false } = {}) {
  const calls = [];
  let expired = expireOnce;
  const json = (body, headers = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const fetchFn = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body, token: init.headers['XSRF-TOKEN'] });
    if (path === '/thirdData/login') {
      if (body.systemCode !== 'system-code') return json({ success: false, failCode: 20001 });
      return json({ success: true, failCode: 0 }, { 'xsrf-token': `token-${calls.length}` });
    }
    if (expired) {
      expired = false;
      return json({ success: false, failCode: 305 });
    }
    if (rateLimited) return json({ success: false, failCode: 407 });
    switch (path) {
      case '/thirdData/stations':
        if (legacyStations) return json({ success: false, failCode: 404 });
        return json({ success: true, data: { list: [{ plantCode: STATION, plantName: 'Home' }] } });
      case '/thirdData/getStationList':
        return json({ success: true, data: [{ stationCode: STATION, stationName: 'Home' }] });
      case '/thirdData/getDevList':
        return json({
          success: true,
          data: [
            {
              id: 1001,
              devTypeId: 38,
              esnCode: 'HV2150012345',
              stationCode: STATION,
              devName: 'Inverter',
              invType: 'SUN2000-6KTL-M1',
            },
            { id: 1002, devTypeId: 47, esnCode: '', stationCode: STATION, devName: 'Meter' },
            {
              id: 1003,
              devTypeId: 39,
              esnCode: 'BAT0012345',
              stationCode: STATION,
              devName: 'Battery',
            },
            { id: 1004, devTypeId: 62, esnCode: 'DONGLE', stationCode: STATION, devName: 'Dongle' },
          ],
        });
      case '/thirdData/getStationRealKpi':
        return json({
          success: true,
          data: [{ stationCode: STATION, dataItemMap: { day_power: '18.5', day_income: 3.21 } }],
        });
      case '/thirdData/getDevRealKpi': {
        const maps = {
          38: {
            active_power: 4.0,
            mppt_power: '4.2',
            day_cap: 18.5,
            total_cap: 12345.67,
            temperature: 45.2,
            efficiency: 98.5,
            inverter_state: 512,
            elec_freq: 50.01,
          },
          47: {
            active_power: 1500,
            meter_u: 235.1,
            meter_i: -8.5,
            grid_frequency: 50,
            active_cap: 4567.89,
            reverse_active_cap: 987.65,
            run_state: 1,
          },
          39: {
            battery_soc: 75.5,
            ch_discharge_power: -800,
            battery_status: 2,
            ch_discharge_model: 4,
          },
        };
        return json({
          success: true,
          data: body.devIds
            .split(',')
            .map((devId) => ({ devId: Number(devId), dataItemMap: maps[body.devTypeId] })),
        });
      }
      default:
        return new Response('not found', { status: 404 });
    }
  };
  return { fetchFn, calls };
}

const driverWith = (server, password = 'system-code') =>
  new CloudDriver({
    baseUrl: 'https://eu5.fusionsolar.huawei.com/',
    username: 'api-user',
    password,
    fetch: server.fetchFn,
  });

test('toNumber accepts numbers and numeric strings only', () => {
  assert.equal(toNumber('4.2'), 4.2);
  assert.equal(toNumber(3), 3);
  assert.equal(toNumber('N/A'), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(''), null);
});

test('the cloud driver logs in, then sends the session token', async () => {
  const server = fakeFusionSolar();
  await driverWith(server).readSnapshot();
  assert.equal(server.calls[0].path, '/thirdData/login');
  assert.ok(server.calls.slice(1).every((call) => call.token === 'token-1'));
});

test('the cloud snapshot is normalized like the local one', async () => {
  const snapshot = await driverWith(fakeFusionSolar()).readSnapshot();
  const [inverter] = snapshot.inverters;
  assert.equal(inverter.sn, 'HV2150012345');
  assert.equal(inverter.activePower, 4000, 'kW are converted to W');
  assert.equal(inverter.inputPower, 4200);
  assert.equal(inverter.status, 'on_grid', '512 = 0x0200');
  assert.equal(inverter.dailyYield, 18.5);

  const [meter] = snapshot.meters;
  assert.equal(meter.id, 'HV2150012345', 'keyed on the plant inverter, like the local driver');
  assert.equal(meter.power, -1500);
  assert.equal(meter.importIndex, 987.65);
  assert.equal(meter.exportIndex, 4567.89);

  const [battery] = snapshot.batteries;
  assert.equal(battery.id, 'HV2150012345');
  assert.equal(battery.soc, 75.5);
  assert.equal(battery.power, -800);
  assert.equal(battery.mode, 'maximise_self_consumption');

  assert.equal(snapshot.plant.dailyIncome, 3.21);
  assert.equal(snapshot.plant.name, 'Home');
});

test('an expired session logs in again once', async () => {
  const server = fakeFusionSolar({ expireOnce: true });
  await driverWith(server).readSnapshot();
  assert.equal(server.calls.filter((c) => c.path === '/thirdData/login').length, 2);
});

test('the legacy station list is used when the new endpoint fails', async () => {
  const server = fakeFusionSolar({ legacyStations: true });
  const snapshot = await driverWith(server).readSnapshot();
  assert.equal(snapshot.plant.id, STATION);
  assert.ok(server.calls.some((c) => c.path === '/thirdData/getStationList'));
});

test('a wrong system code is reported clearly', async () => {
  await assert.rejects(driverWith(fakeFusionSolar(), 'wrong').readSnapshot(), /login refused/);
});

test('the rate limit is reported as such', async () => {
  await assert.rejects(
    driverWith(fakeFusionSolar({ rateLimited: true })).readSnapshot(),
    /rate limit/,
  );
});

test('the device list is cached between two reads', async () => {
  const server = fakeFusionSolar();
  const driver = driverWith(server);
  await driver.readSnapshot();
  await driver.readSnapshot();
  assert.equal(server.calls.filter((c) => c.path === '/thirdData/getDevList').length, 1);
});
