import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { ModbusTcpClient } from '../src/modbus/client.js';
import { LocalDriver, REGISTERS } from '../src/huawei/local.js';
import { residentialRegisters, startModbusServer } from './helpers/modbusServer.js';

let server;
const drivers = [];

function driverFor(srv, unitId = 1) {
  const driver = new LocalDriver({
    host: '127.0.0.1',
    port: srv.port,
    unitId,
    connectDelayMs: 0,
    timeoutMs: 2000,
  });
  drivers.push(driver);
  return driver;
}

before(async () => {
  server = await startModbusServer(residentialRegisters());
});

after(async () => {
  for (const driver of drivers) driver.close();
  await server.close();
});

test('the client reads holding registers and serializes concurrent requests', async () => {
  const client = new ModbusTcpClient({ host: '127.0.0.1', port: server.port, connectDelayMs: 0 });
  try {
    const [a, b] = await Promise.all([
      client.readHoldingRegisters(1, 32089, 1),
      client.readHoldingRegisters(1, 37760, 1),
    ]);
    assert.equal(a.readUInt16BE(0), 0x0200);
    assert.equal(b.readUInt16BE(0), 755);
  } finally {
    client.close();
  }
});

test('a Modbus exception is reported as an error', async () => {
  const srv = await startModbusServer(residentialRegisters({ meter: false }));
  const client = new ModbusTcpClient({ host: '127.0.0.1', port: srv.port, connectDelayMs: 0 });
  try {
    await assert.rejects(client.readHoldingRegisters(1, 37100, 2), /illegal data address/);
  } finally {
    client.close();
    await srv.close();
  }
});

test('an unreachable inverter fails fast', async () => {
  const client = new ModbusTcpClient({ host: '127.0.0.1', port: 1, connectDelayMs: 0 });
  await assert.rejects(client.readHoldingRegisters(1, 30000, 1), /Cannot connect/);
});

test('the local driver reads and normalizes the whole installation', async () => {
  const snapshot = await driverFor(server).readSnapshot();
  const [inverter] = snapshot.inverters;
  assert.equal(inverter.sn, 'HV2150012345');
  assert.equal(inverter.model, 'SUN2000-6KTL-M1');
  assert.equal(inverter.ratedPower, 6000);
  assert.equal(inverter.activePower, 4000);
  assert.equal(inverter.inputPower, 4200);
  assert.equal(inverter.temperature, 45.2);
  assert.equal(inverter.efficiency, 98.5);
  assert.equal(inverter.totalYield, 12345.67);
  assert.equal(inverter.dailyYield, 18.5);
  assert.equal(inverter.status, 'on_grid');

  const [meter] = snapshot.meters;
  assert.equal(meter.id, 'HV2150012345', 'the meter is keyed on its inverter');
  assert.equal(meter.power, -1500, 'exporting reads negative (Gladys convention)');
  assert.equal(meter.voltage, 235.1);
  assert.equal(meter.current, -8.5);
  assert.equal(meter.exportIndex, 4567.89);
  assert.equal(meter.importIndex, 987.65);

  const [battery] = snapshot.batteries;
  assert.equal(battery.capacity, 10);
  assert.equal(battery.soc, 75.5);
  assert.equal(battery.power, 500);
  assert.equal(battery.status, 'running');
  assert.equal(battery.mode, 'maximise_self_consumption');
  assert.equal(battery.chargeIndex, 1234);
  assert.equal(battery.dischargeIndex, 1100);
});

test('an installation without meter nor battery only reports the inverter', async () => {
  const srv = await startModbusServer(residentialRegisters({ meter: false, battery: false }));
  try {
    const snapshot = await driverFor(srv).readSnapshot();
    assert.equal(snapshot.inverters.length, 1);
    assert.deepEqual(snapshot.meters, []);
    assert.deepEqual(snapshot.batteries, []);
  } finally {
    await srv.close();
  }
});

test('a forced charge writes power, duration, mode, then the command', async () => {
  server.registers.writes = [];
  await driverFor(server).forceBattery({ direction: 'charge', power: 3000, duration: 90 });
  assert.deepEqual(server.registers.writes, [
    { address: REGISTERS.STORAGE_FORCIBLE_CHARGE_POWER, values: [0, 3000] },
    { address: REGISTERS.STORAGE_FORCED_PERIOD, values: [90] },
    { address: REGISTERS.STORAGE_FORCIBLE_SETTING_MODE, values: [0] },
    { address: REGISTERS.STORAGE_FORCIBLE_CHARGE_DISCHARGE, values: [1] },
  ]);
});

test('a forced discharge uses the discharge power register', async () => {
  server.registers.writes = [];
  await driverFor(server).forceBattery({ direction: 'discharge', power: 70000, duration: 5000 });
  assert.deepEqual(server.registers.writes[0], {
    address: REGISTERS.STORAGE_FORCIBLE_DISCHARGE_POWER,
    values: [1, 70000 - 0x10000],
  });
  assert.deepEqual(server.registers.writes[1].values, [1440], 'the duration is capped to a day');
  assert.deepEqual(server.registers.writes.at(-1).values, [2]);
});

test('battery working mode and stop', async () => {
  server.registers.writes = [];
  const driver = driverFor(server);
  await driver.setBatteryMode('time_of_use');
  await driver.stopForcedBattery();
  assert.deepEqual(server.registers.writes, [
    { address: REGISTERS.STORAGE_WORKING_MODE, values: [5] },
    { address: REGISTERS.STORAGE_FORCIBLE_CHARGE_DISCHARGE, values: [0] },
  ]);
  await assert.rejects(driver.setBatteryMode('adaptive'), /Unsupported/);
});

test('grid export limit modes', async () => {
  const driver = driverFor(server);
  server.registers.writes = [];
  await driver.setGridExportLimit({ mode: 'limited', limit: 3000 });
  assert.deepEqual(server.registers.writes, [
    { address: REGISTERS.MAXIMUM_FEED_GRID_POWER, values: [0, 3000] },
    { address: REGISTERS.ACTIVE_POWER_CONTROL_MODE, values: [6] },
  ]);
  server.registers.writes = [];
  await driver.setGridExportLimit({ mode: 'zero_export' });
  await driver.setGridExportLimit({ mode: 'unlimited' });
  assert.deepEqual(
    server.registers.writes.map((w) => w.values[0]),
    [5, 0],
  );
});

test('inverter startup and shutdown', async () => {
  const driver = driverFor(server);
  server.registers.writes = [];
  await driver.setInverterRunning(false);
  await driver.setInverterRunning(true);
  assert.deepEqual(
    server.registers.writes.map((w) => w.address),
    [REGISTERS.SHUTDOWN, REGISTERS.STARTUP],
  );
});
