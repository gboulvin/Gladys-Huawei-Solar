// -----------------------------------------------------------------------------
// Cloud driver: Huawei FusionSolar "Northbound" API (Smart PV Management
// System Northbound Interface).
//
// The account is a dedicated API account (user name + "system code"), created
// by the installer — or by the owner on some regions — under
// System > Company Management > Northbound Management. A regular FusionSolar
// app login does NOT work here.
//
// The API is rate-limited (real-time KPIs: about once every 5 minutes per
// device type, the device list a few times a day), so this driver:
//   - caches the station and device lists for 6 hours;
//   - is never asked more than once every 5 minutes by the hub (see
//     CLOUD_MIN_INTERVAL_S in src/config.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  BATTERY_MODE,
  batteryModeFromCloud,
  normalizeBatteryStatus,
  normalizeInverterStatus,
} from './status.js';

const logger = createLogger({ name: 'huawei-cloud' });

// FusionSolar device types (devTypeId).
export const DEV_TYPE = {
  STRING_INVERTER: 1,
  RESIDENTIAL_INVERTER: 38,
  BATTERY: 39,
  POWER_METER: 47,
};

const INVERTER_TYPES = [DEV_TYPE.STRING_INVERTER, DEV_TYPE.RESIDENTIAL_INVERTER];

// failCode values worth a dedicated handling.
const FAIL_CODE = {
  NOT_LOGGED_IN: 305,
  RATE_LIMITED: 407,
};

const LIST_CACHE_MS = 6 * 60 * 60 * 1000;

export class CloudApiError extends Error {
  constructor(message, { failCode } = {}) {
    super(message);
    this.name = 'CloudApiError';
    this.failCode = failCode;
  }
}

/**
 * FusionSolar returns numbers as numbers, strings, or null / "N/A".
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const round = (value, digits = 2) => {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export class CloudDriver {
  /**
   * @param {object} options
   * @param {string} options.baseUrl e.g. https://eu5.fusionsolar.huawei.com
   * @param {string} options.username Northbound API user name
   * @param {string} options.password Northbound API system code
   * @param {typeof fetch} [options.fetch] injected in tests
   */
  constructor({ baseUrl, username, password, fetch: fetchFn, timeoutMs = 20_000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.fetch = fetchFn ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.lists = null;
  }

  async post(path, body, headers = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new CloudApiError(`FusionSolar answered HTTP ${response.status} on ${path}`);
    }
    return { response, json: await response.json() };
  }

  async login() {
    const { response, json } = await this.post('/thirdData/login', {
      userName: this.username,
      systemCode: this.password,
    });
    if (!json?.success) {
      throw new CloudApiError(
        `FusionSolar login refused (failCode ${json?.failCode ?? '?'}): check the API account`,
        { failCode: json?.failCode },
      );
    }
    const token =
      response.headers.get('xsrf-token') ??
      /XSRF-TOKEN=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
    if (!token) {
      throw new CloudApiError('FusionSolar login answered without a session token');
    }
    this.token = token;
    logger.info('Logged in to FusionSolar');
  }

  /**
   * Call an authenticated endpoint, logging in (again) when needed.
   */
  async call(path, body, { retried = false } = {}) {
    if (!this.token) {
      await this.login();
    }
    const { json } = await this.post(path, body, {
      'XSRF-TOKEN': this.token,
      Cookie: `XSRF-TOKEN=${this.token}`,
    });
    if (json?.success) {
      return json.data;
    }
    if (json?.failCode === FAIL_CODE.NOT_LOGGED_IN && !retried) {
      this.token = null;
      return this.call(path, body, { retried: true });
    }
    if (json?.failCode === FAIL_CODE.RATE_LIMITED) {
      throw new CloudApiError('FusionSolar rate limit reached, retrying later', {
        failCode: json.failCode,
      });
    }
    throw new CloudApiError(
      `FusionSolar ${path} failed (failCode ${json?.failCode ?? '?'}${json?.message ? `: ${json.message}` : ''})`,
      { failCode: json?.failCode },
    );
  }

  async stations() {
    try {
      const data = await this.call('/thirdData/stations', { pageNo: 1 });
      return (data?.list ?? []).map((s) => ({ code: s.plantCode, name: s.plantName }));
    } catch (err) {
      if (err.failCode === FAIL_CODE.RATE_LIMITED) throw err;
      // Older Northbound servers only know the legacy endpoint.
      logger.debug(`/thirdData/stations failed (${err.message}), trying getStationList`);
      const data = await this.call('/thirdData/getStationList', {});
      return (data ?? []).map((s) => ({ code: s.stationCode, name: s.stationName }));
    }
  }

  async loadLists() {
    if (this.lists && Date.now() - this.lists.at < LIST_CACHE_MS) {
      return this.lists;
    }
    const stations = await this.stations();
    if (stations.length === 0) {
      throw new CloudApiError('No plant visible to this FusionSolar API account');
    }
    const devices = await this.call('/thirdData/getDevList', {
      stationCodes: stations.map((s) => s.code).join(','),
    });
    this.lists = { at: Date.now(), stations, devices: devices ?? [] };
    return this.lists;
  }

  async realKpi(devices, devTypeId) {
    const ofType = devices.filter((d) => d.devTypeId === devTypeId);
    if (ofType.length === 0) {
      return [];
    }
    const data = await this.call('/thirdData/getDevRealKpi', {
      devIds: ofType.map((d) => d.id).join(','),
      devTypeId,
    });
    return ofType.map((device) => ({
      device,
      kpi:
        (data ?? []).find((entry) => String(entry.devId) === String(device.id))?.dataItemMap ?? {},
    }));
  }

  /**
   * One full read, in the normalized snapshot format (see src/hub.js).
   */
  async readSnapshot() {
    const { stations, devices } = await this.loadLists();
    const stationKpis = await this.call('/thirdData/getStationRealKpi', {
      stationCodes: stations.map((s) => s.code).join(','),
    });

    const inverterKpis = [];
    for (const type of INVERTER_TYPES) {
      inverterKpis.push(...(await this.realKpi(devices, type)));
    }
    const inverters = inverterKpis.map(({ device, kpi }) => {
      const statusCode = toNumber(kpi.inverter_state);
      const activePower = toNumber(kpi.active_power);
      const inputPower = toNumber(kpi.mppt_power);
      return {
        sn: device.esnCode || String(device.id),
        stationCode: device.stationCode,
        model: device.invType || device.model || device.devName || 'SUN2000',
        ratedPower: null,
        // The cloud reports inverter powers in kW.
        activePower: activePower === null ? null : Math.round(activePower * 1000),
        inputPower: inputPower === null ? null : Math.round(inputPower * 1000),
        gridFrequency: toNumber(kpi.elec_freq),
        efficiency: toNumber(kpi.efficiency),
        temperature: toNumber(kpi.temperature),
        totalYield: round(toNumber(kpi.total_cap)),
        dailyYield: round(toNumber(kpi.day_cap)),
        statusCode,
        status: normalizeInverterStatus(statusCode),
      };
    });

    // Meters and batteries have no stable link to "their" inverter in the
    // API: they take the serial number of the first inverter of their plant,
    // like the local driver does, so their Gladys devices stay the same when
    // switching between local and cloud.
    const ownerId = (stationCode, kind, taken) => {
      const sn =
        inverters.find((inv) => inv.stationCode === stationCode)?.sn ?? stationCode ?? 'plant';
      const count = taken.get(`${kind}:${sn}`) ?? 0;
      taken.set(`${kind}:${sn}`, count + 1);
      return count === 0 ? sn : `${sn}-${count + 1}`;
    };
    const taken = new Map();

    const meters = (await this.realKpi(devices, DEV_TYPE.POWER_METER)).map(({ device, kpi }) => {
      const exportPower = toNumber(kpi.active_power) ?? 0;
      return {
        id: ownerId(device.stationCode, 'meter', taken),
        online: toNumber(kpi.run_state) !== 0,
        power: -exportPower,
        voltage: toNumber(kpi.meter_u),
        current: toNumber(kpi.meter_i),
        frequency: toNumber(kpi.grid_frequency),
        exportIndex: round(toNumber(kpi.active_cap)),
        importIndex: round(toNumber(kpi.reverse_active_cap)),
      };
    });

    const batteries = (await this.realKpi(devices, DEV_TYPE.BATTERY)).map(({ device, kpi }) => {
      const modeCode = toNumber(kpi.ch_discharge_model);
      return {
        id: ownerId(device.stationCode, 'battery', taken),
        capacity: null,
        soc: toNumber(kpi.battery_soc),
        status: normalizeBatteryStatus(toNumber(kpi.battery_status)),
        power: toNumber(kpi.ch_discharge_power),
        chargeIndex: null,
        dischargeIndex: null,
        dailyCharge: null,
        dailyDischarge: null,
        mode: modeCode === null ? BATTERY_MODE.OTHER : batteryModeFromCloud(modeCode),
      };
    });

    const firstStation = stations[0];
    const firstKpi = (stationKpis ?? []).find((s) => s.stationCode === firstStation.code);
    return {
      plant: {
        id: firstStation.code,
        name: firstStation.name,
        dailyIncome: toNumber(firstKpi?.dataItemMap?.day_income),
        dailyYield: toNumber(firstKpi?.dataItemMap?.day_power),
      },
      inverters,
      meters,
      batteries,
    };
  }

  close() {}
}
