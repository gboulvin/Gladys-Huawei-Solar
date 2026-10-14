// Shared test data: a normalized snapshot, fake drivers, a ready hub.

import { SolarHub, computeHouse } from '../../src/hub.js';
import { normalizeConfig } from '../../src/config.js';

export function sampleSnapshot(overrides = {}) {
  const snapshot = {
    source: 'local',
    fetchedAt: '2026-06-21T12:00:00.000Z',
    plant: { id: 'HV2150012345', name: 'SUN2000-6KTL-M1', dailyIncome: null },
    inverters: [
      {
        sn: 'HV2150012345',
        model: 'SUN2000-6KTL-M1',
        ratedPower: 6000,
        activePower: 4000,
        inputPower: 4200,
        gridFrequency: 50.01,
        efficiency: 98.5,
        temperature: 45.2,
        totalYield: 12345.67,
        dailyYield: 18.5,
        statusCode: 0x0200,
        status: 'on_grid',
      },
    ],
    meters: [
      {
        id: 'HV2150012345',
        online: true,
        power: -1500,
        voltage: 235.1,
        current: -8.5,
        frequency: 50,
        exportIndex: 4567.89,
        importIndex: 987.65,
      },
    ],
    batteries: [
      {
        id: 'HV2150012345',
        capacity: 10,
        soc: 75.5,
        status: 'running',
        power: 500,
        chargeIndex: 1234,
        dischargeIndex: 1100,
        dailyCharge: 5.2,
        dailyDischarge: 3.1,
        mode: 'maximise_self_consumption',
      },
    ],
    ...overrides,
  };
  snapshot.house = computeHouse(snapshot);
  return snapshot;
}

/**
 * A driver serving the given snapshots in turn (the last one repeats), and
 * recording the commands it receives.
 */
export function fakeDriver(...snapshots) {
  let index = 0;
  return {
    reads: 0,
    commands: [],
    fail: null,
    async readSnapshot() {
      this.reads += 1;
      if (this.fail) throw this.fail;
      const {
        source: _s,
        fetchedAt: _f,
        house: _h,
        ...raw
      } = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return structuredClone(raw);
    },
    async setBatteryMode(mode) {
      this.commands.push(['setBatteryMode', mode]);
    },
    async forceBattery(options) {
      this.commands.push(['forceBattery', options]);
    },
    async stopForcedBattery() {
      this.commands.push(['stopForcedBattery']);
    },
    async setGridExportLimit(options) {
      this.commands.push(['setGridExportLimit', options]);
    },
    async setInverterRunning(running) {
      this.commands.push(['setInverterRunning', running]);
    },
    close() {},
  };
}

export const LOCAL_CONFIG = normalizeConfig({ modbus_host: '192.168.1.50' });
export const CLOUD_CONFIG = normalizeConfig({
  fusionsolar_username: 'api-user',
  fusionsolar_password: 'system-code',
});
export const BOTH_CONFIG = normalizeConfig({
  modbus_host: '192.168.1.50',
  fusionsolar_username: 'api-user',
  fusionsolar_password: 'system-code',
});

/**
 * A hub on fake drivers, configured.
 */
export function createHub({ config = LOCAL_CONFIG, local, cloud, now } = {}) {
  const drivers = {
    local: local ?? fakeDriver(sampleSnapshot()),
    cloud: cloud ?? fakeDriver(sampleSnapshot()),
  };
  const hub = new SolarHub({
    createLocal: () => drivers.local,
    createCloud: () => drivers.cloud,
    now,
  });
  hub.configure(config);
  return { hub, drivers };
}
