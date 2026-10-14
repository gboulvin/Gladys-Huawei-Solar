// -----------------------------------------------------------------------------
// Local driver: Modbus TCP to a Huawei SUN2000 inverter, through its SDongle
// (port 502), an EMMA / Smart Power Sensor gateway, or the inverter's own
// WLAN access point (port 6607).
//
// Register addresses and scales come from Huawei's "SUN2000 MODBUS Interface
// Definitions". The power meter (DTSU666-H / DDSU666-H) and the LUNA2000
// battery are read THROUGH the inverter, at the same unit id.
//
// Sign conventions of the device, normalized here:
//   - meter active power (37113): positive when exporting to the grid. The
//     snapshot uses the opposite, "positive = drawing from the grid", which is
//     the Gladys grid-sensor convention;
//   - battery power (37765): positive when charging (kept as is).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ModbusTcpClient } from '../modbus/client.js';
import {
  BATTERY_MODE,
  LOCAL_MODE_CODES,
  batteryModeFromLocal,
  normalizeBatteryStatus,
  normalizeInverterStatus,
} from './status.js';

const logger = createLogger({ name: 'huawei-local' });

export const REGISTERS = {
  MODEL: 30000, // STR, 15 registers
  SERIAL_NUMBER: 30015, // STR, 10 registers
  RATED_POWER: 30073, // U32, W
  INPUT_POWER: 32064, // I32, W (block 32064..32089)
  ACCUMULATED_YIELD: 32106, // U32, /100 kWh (block 32106..32115)
  DAILY_YIELD: 32114, // U32, /100 kWh
  BATTERY_SERIAL_NUMBER: 37052, // STR, 10 registers
  METER_STATUS: 37100, // U16 (block 37100..37122)
  BATTERY_RATED_CAPACITY: 37758, // U32, Wh (block 37758..37767)
  BATTERY_TOTAL_CHARGE: 37780, // U32, /100 kWh (block 37780..37787)
  // Writable
  STARTUP: 40200, // U16, write 0
  SHUTDOWN: 40201, // U16, write 0
  STORAGE_FORCED_PERIOD: 47083, // U16, minutes
  STORAGE_WORKING_MODE: 47086, // U16
  STORAGE_FORCIBLE_CHARGE_DISCHARGE: 47100, // U16: 0 stop, 1 charge, 2 discharge
  STORAGE_FORCIBLE_SETTING_MODE: 47246, // U16: 0 duration, 1 target SOC
  STORAGE_FORCIBLE_CHARGE_POWER: 47247, // U32, W
  STORAGE_FORCIBLE_DISCHARGE_POWER: 47249, // U32, W
  ACTIVE_POWER_CONTROL_MODE: 47415, // U16
  MAXIMUM_FEED_GRID_POWER: 47416, // I32, W
};

// Register 47415 values.
export const ACTIVE_POWER_CONTROL = {
  UNLIMITED: 0,
  ZERO_EXPORT: 5,
  LIMITED_WATT: 6,
};

export const EXPORT_LIMIT_MODE = {
  UNLIMITED: 'unlimited',
  ZERO_EXPORT: 'zero_export',
  LIMITED: 'limited',
};

// --- Decoding helpers ---------------------------------------------------------

const reg = (index) => index * 2;

export const decode = {
  u16: (buffer, index, gain = 1) => buffer.readUInt16BE(reg(index)) / gain,
  i16: (buffer, index, gain = 1) => buffer.readInt16BE(reg(index)) / gain,
  u32: (buffer, index, gain = 1) => buffer.readUInt32BE(reg(index)) / gain,
  i32: (buffer, index, gain = 1) => buffer.readInt32BE(reg(index)) / gain,
  str: (buffer, index, count) =>
    buffer
      .subarray(reg(index), reg(index + count))
      .toString('latin1')
      .replace(/\0.*$/s, '')
      .trim(),
};

// Huawei answers 0x7FFF / 0xFFFF... for "value not available": keep a value
// only within the physical range of the quantity.
const within = (value, max) => (Number.isFinite(value) && value <= max ? value : null);

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const u32Buffer = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
};

const i32Buffer = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
};

export class LocalDriver {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {number} options.unitId
   * @param {ModbusTcpClient} [options.client] injected in tests
   */
  constructor({ host, port, unitId, client, timeoutMs, connectDelayMs }) {
    this.unitId = unitId;
    this.client = client ?? new ModbusTcpClient({ host, port, timeoutMs, connectDelayMs });
    this.identity = null;
  }

  read(address, count) {
    return this.client.readHoldingRegisters(this.unitId, address, count);
  }

  // Read a block that may not exist on this installation (no meter, no
  // battery): resolves null instead of throwing.
  async readOptional(address, count) {
    try {
      return await this.read(address, count);
    } catch (err) {
      logger.debug(`Optional block ${address} (${count}) not available: ${err.message}`);
      return null;
    }
  }

  async identify() {
    if (this.identity) {
      return this.identity;
    }
    const ident = await this.read(REGISTERS.MODEL, 25);
    const model = decode.str(ident, 0, 15);
    const sn = decode.str(ident, 15, 10);
    if (!sn) {
      throw new Error('The inverter returned an empty serial number');
    }
    const rated = await this.readOptional(REGISTERS.RATED_POWER, 2);
    const batterySn = await this.readOptional(REGISTERS.BATTERY_SERIAL_NUMBER, 10);
    this.identity = {
      sn,
      model: model || 'SUN2000',
      ratedPower: rated ? decode.u32(rated, 0) : null,
      batterySn: batterySn ? decode.str(batterySn, 0, 10) || null : null,
    };
    logger.info(`Inverter identified: ${this.identity.model}`);
    return this.identity;
  }

  async readInverter() {
    const { sn, model, ratedPower } = await this.identify();
    const live = await this.read(REGISTERS.INPUT_POWER, 26);
    const yields = await this.read(REGISTERS.ACCUMULATED_YIELD, 10);
    const statusCode = decode.u16(live, 25);
    const temperature = decode.i16(live, 23, 10);
    const efficiency = decode.u16(live, 22, 100);
    return {
      sn,
      model,
      ratedPower,
      inputPower: decode.i32(live, 0),
      activePower: decode.i32(live, 16),
      gridFrequency: round(decode.u16(live, 21, 100)),
      efficiency: within(efficiency, 100),
      temperature: within(temperature, 200),
      totalYield: round(decode.u32(yields, 0, 100)),
      dailyYield: round(decode.u32(yields, 8, 100)),
      statusCode,
      status: normalizeInverterStatus(statusCode),
    };
  }

  async readMeter(sn) {
    const block = await this.readOptional(REGISTERS.METER_STATUS, 23);
    if (!block) {
      return null;
    }
    const status = decode.u16(block, 0);
    const voltage = round(decode.i32(block, 1, 10), 1);
    // Status 0 with no voltage: no meter wired to this inverter.
    if (status !== 1 && voltage <= 0) {
      return null;
    }
    const exportPower = decode.i32(block, 13);
    return {
      id: sn,
      online: status === 1,
      power: -exportPower,
      voltage,
      current: round(decode.i32(block, 7, 100)),
      frequency: round(decode.i16(block, 18, 100)),
      exportIndex: round(decode.i32(block, 19, 100)),
      importIndex: round(decode.i32(block, 21, 100)),
    };
  }

  async readBattery(sn) {
    const block = await this.readOptional(REGISTERS.BATTERY_RATED_CAPACITY, 10);
    if (!block) {
      return null;
    }
    const capacityWh = decode.u32(block, 0);
    if (capacityWh <= 0 || capacityWh >= 0xffffffff) {
      return null;
    }
    const energy = await this.readOptional(REGISTERS.BATTERY_TOTAL_CHARGE, 8);
    const mode = await this.readOptional(REGISTERS.STORAGE_WORKING_MODE, 1);
    return {
      id: sn,
      capacity: round(capacityWh / 1000),
      soc: round(decode.u16(block, 2, 10), 1),
      status: normalizeBatteryStatus(decode.u16(block, 4)),
      power: decode.i32(block, 7),
      chargeIndex: energy ? round(decode.u32(energy, 0, 100)) : null,
      dischargeIndex: energy ? round(decode.u32(energy, 2, 100)) : null,
      dailyCharge: energy ? round(decode.u32(energy, 4, 100)) : null,
      dailyDischarge: energy ? round(decode.u32(energy, 6, 100)) : null,
      mode: mode ? batteryModeFromLocal(decode.u16(mode, 0)) : BATTERY_MODE.OTHER,
    };
  }

  /**
   * One full read of the installation, in the normalized snapshot format
   * (see src/hub.js).
   */
  async readSnapshot() {
    const inverter = await this.readInverter();
    const meter = await this.readMeter(inverter.sn);
    const battery = await this.readBattery(inverter.sn);
    return {
      plant: { id: inverter.sn, name: inverter.model, dailyIncome: null },
      inverters: [inverter],
      meters: meter ? [meter] : [],
      batteries: battery ? [battery] : [],
    };
  }

  // --- Commands ---------------------------------------------------------------

  async setBatteryMode(mode) {
    const code = LOCAL_MODE_CODES[mode];
    if (code === undefined) {
      throw new Error(`Unsupported battery working mode: ${mode}`);
    }
    logger.info(`Battery working mode -> ${mode} (${code})`);
    await this.client.writeSingleRegister(this.unitId, REGISTERS.STORAGE_WORKING_MODE, code);
  }

  /**
   * Forced charge or discharge for a duration, at a given power.
   * @param {{ direction: 'charge' | 'discharge', power: number, duration: number }} options
   *   power in W, duration in minutes (1 to 1440)
   */
  async forceBattery({ direction, power, duration }) {
    const minutes = Math.round(Math.min(Math.max(duration, 1), 1440));
    const watts = Math.round(Math.max(power, 0));
    const powerRegister =
      direction === 'charge'
        ? REGISTERS.STORAGE_FORCIBLE_CHARGE_POWER
        : REGISTERS.STORAGE_FORCIBLE_DISCHARGE_POWER;
    logger.info(`Forced battery ${direction}: ${watts} W for ${minutes} min`);
    await this.client.writeMultipleRegisters(this.unitId, powerRegister, u32Buffer(watts));
    await this.client.writeSingleRegister(this.unitId, REGISTERS.STORAGE_FORCED_PERIOD, minutes);
    await this.client.writeSingleRegister(this.unitId, REGISTERS.STORAGE_FORCIBLE_SETTING_MODE, 0);
    await this.client.writeSingleRegister(
      this.unitId,
      REGISTERS.STORAGE_FORCIBLE_CHARGE_DISCHARGE,
      direction === 'charge' ? 1 : 2,
    );
  }

  async stopForcedBattery() {
    logger.info('Forced battery charge/discharge -> stop');
    await this.client.writeSingleRegister(
      this.unitId,
      REGISTERS.STORAGE_FORCIBLE_CHARGE_DISCHARGE,
      0,
    );
  }

  /**
   * @param {{ mode: string, limit?: number }} options limit in W (LIMITED mode)
   */
  async setGridExportLimit({ mode, limit = 0 }) {
    logger.info(
      `Grid export limit -> ${mode}${mode === EXPORT_LIMIT_MODE.LIMITED ? ` ${limit} W` : ''}`,
    );
    if (mode === EXPORT_LIMIT_MODE.LIMITED) {
      await this.client.writeMultipleRegisters(
        this.unitId,
        REGISTERS.MAXIMUM_FEED_GRID_POWER,
        i32Buffer(Math.round(Math.max(limit, 0))),
      );
      await this.client.writeSingleRegister(
        this.unitId,
        REGISTERS.ACTIVE_POWER_CONTROL_MODE,
        ACTIVE_POWER_CONTROL.LIMITED_WATT,
      );
    } else if (mode === EXPORT_LIMIT_MODE.ZERO_EXPORT) {
      await this.client.writeSingleRegister(
        this.unitId,
        REGISTERS.ACTIVE_POWER_CONTROL_MODE,
        ACTIVE_POWER_CONTROL.ZERO_EXPORT,
      );
    } else if (mode === EXPORT_LIMIT_MODE.UNLIMITED) {
      await this.client.writeSingleRegister(
        this.unitId,
        REGISTERS.ACTIVE_POWER_CONTROL_MODE,
        ACTIVE_POWER_CONTROL.UNLIMITED,
      );
    } else {
      throw new Error(`Unsupported export limit mode: ${mode}`);
    }
  }

  async setInverterRunning(running) {
    logger.info(`Inverter -> ${running ? 'startup' : 'shutdown'}`);
    await this.client.writeSingleRegister(
      this.unitId,
      running ? REGISTERS.STARTUP : REGISTERS.SHUTDOWN,
      0,
    );
  }

  close() {
    this.client.close();
  }
}
