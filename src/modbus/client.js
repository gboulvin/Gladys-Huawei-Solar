// -----------------------------------------------------------------------------
// Minimal Modbus TCP client (no dependency): the three function codes a
// Huawei SUN2000 inverter / SDongle / EMMA needs.
//
//   - 0x03 read holding registers
//   - 0x06 write single register
//   - 0x10 write multiple registers
//
// Huawei-specific behaviour this client accounts for:
//   - the dongle accepts ONE request at a time per connection: requests are
//     queued and sent sequentially;
//   - the first request right after the TCP handshake is often dropped: the
//     client waits `connectDelayMs` (1 s by default) before talking;
//   - the device closes idle connections: the client reconnects lazily on the
//     next request.
// -----------------------------------------------------------------------------

import net from 'node:net';

const FC_READ_HOLDING = 0x03;
const FC_WRITE_SINGLE = 0x06;
const FC_WRITE_MULTIPLE = 0x10;

// Standard Modbus exception codes, plus the Huawei-specific ones that show up
// when a register needs an installer login or does not exist on this model.
const EXCEPTION_MESSAGES = {
  0x01: 'illegal function',
  0x02: 'illegal data address (register not supported by this device)',
  0x03: 'illegal data value',
  0x04: 'slave device failure',
  0x05: 'acknowledge',
  0x06: 'slave device busy',
  0x0a: 'gateway path unavailable',
  0x0b: 'gateway target device failed to respond',
  0x80: 'no permission (installer login required)',
};

export class ModbusError extends Error {
  constructor(message, { code, exception } = {}) {
    super(message);
    this.name = 'ModbusError';
    this.code = code;
    this.exception = exception;
  }
}

export class ModbusTcpClient {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port=502]
   * @param {number} [options.timeoutMs=5000] per request
   * @param {number} [options.connectDelayMs=1000] wait after connecting
   * @param {(options: object) => import('node:net').Socket} [options.connect]
   *   socket factory, for tests
   */
  constructor({ host, port = 502, timeoutMs = 5000, connectDelayMs = 1000, connect } = {}) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.connectDelayMs = connectDelayMs;
    this.connectFn = connect ?? ((opts) => net.createConnection(opts));
    this.socket = null;
    this.connecting = null;
    this.transactionId = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.queue = Promise.resolve();
  }

  async connect() {
    if (this.socket) {
      return;
    }
    if (!this.connecting) {
      this.connecting = new Promise((resolve, reject) => {
        const socket = this.connectFn({ host: this.host, port: this.port });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new ModbusError(`Connection to ${this.host}:${this.port} timed out`));
        }, this.timeoutMs);
        socket.once('connect', () => {
          clearTimeout(timer);
          socket.setNoDelay(true);
          this.socket = socket;
          socket.on('data', (chunk) => this.onData(chunk));
          socket.on('close', () => this.onClose());
          setTimeout(resolve, this.connectDelayMs);
        });
        // `on`, not `once`: a second error event without a listener would
        // crash the process.
        socket.on('error', (err) => {
          clearTimeout(timer);
          if (this.socket === socket) {
            this.onClose(err);
          } else {
            reject(new ModbusError(`Cannot connect to ${this.host}:${this.port}: ${err.message}`));
          }
        });
      }).finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
  }

  onClose(err) {
    const socket = this.socket;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    socket?.destroy();
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new ModbusError(`Connection closed${err ? `: ${err.message}` : ''}`));
    }
    this.pending.clear();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // MBAP header: transaction id (2), protocol id (2), length (2), unit id (1).
    while (this.buffer.length >= 7) {
      const length = this.buffer.readUInt16BE(4);
      if (this.buffer.length < 6 + length) {
        return;
      }
      const frame = this.buffer.subarray(0, 6 + length);
      this.buffer = this.buffer.subarray(6 + length);
      const id = frame.readUInt16BE(0);
      const request = this.pending.get(id);
      if (!request) {
        continue; // late answer of a request that already timed out
      }
      this.pending.delete(id);
      clearTimeout(request.timer);
      const pdu = frame.subarray(7);
      if (pdu[0] & 0x80) {
        const exception = pdu[1];
        request.reject(
          new ModbusError(`Modbus exception: ${EXCEPTION_MESSAGES[exception] ?? exception}`, {
            exception,
          }),
        );
      } else if (pdu[0] !== request.functionCode) {
        request.reject(new ModbusError(`Unexpected function code ${pdu[0]}`));
      } else {
        request.resolve(pdu);
      }
    }
  }

  // Serialize the requests: one in flight at a time.
  request(unitId, pdu) {
    const run = () => this.send(unitId, pdu);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async send(unitId, pdu) {
    await this.connect();
    this.transactionId = (this.transactionId + 1) & 0xffff;
    const id = this.transactionId;
    const header = Buffer.alloc(7);
    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(pdu.length + 1, 4);
    header.writeUInt8(unitId, 6);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ModbusError(`Request to ${this.host}:${this.port} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, functionCode: pdu[0] });
      this.socket.write(Buffer.concat([header, pdu]));
    });
  }

  /**
   * Read `count` holding registers starting at `address`.
   * @returns {Promise<Buffer>} the raw register bytes (2 per register)
   */
  async readHoldingRegisters(unitId, address, count) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(FC_READ_HOLDING, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(count, 3);
    const response = await this.request(unitId, pdu);
    const byteCount = response[1];
    if (byteCount !== count * 2) {
      throw new ModbusError(`Expected ${count * 2} bytes, got ${byteCount}`);
    }
    return Buffer.from(response.subarray(2, 2 + byteCount));
  }

  async writeSingleRegister(unitId, address, value) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(FC_WRITE_SINGLE, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(value & 0xffff, 3);
    await this.request(unitId, pdu);
  }

  /**
   * @param {Buffer} data register bytes (2 per register)
   */
  async writeMultipleRegisters(unitId, address, data) {
    const count = data.length / 2;
    const pdu = Buffer.alloc(6 + data.length);
    pdu.writeUInt8(FC_WRITE_MULTIPLE, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(count, 3);
    pdu.writeUInt8(data.length, 5);
    data.copy(pdu, 6);
    await this.request(unitId, pdu);
  }

  close() {
    this.onClose();
  }
}
