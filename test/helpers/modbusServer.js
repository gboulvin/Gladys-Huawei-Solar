// In-process Modbus TCP server on 127.0.0.1, playing a SUN2000 inverter with
// a power meter and a LUNA2000 battery. Loopback only: tests never leave the
// machine.

import net from 'node:net';

export class RegisterMap {
  constructor() {
    this.values = new Map();
    this.writes = [];
    this.unavailable = new Set(); // addresses answering "illegal address"
  }

  u16(address, value) {
    this.values.set(address, value & 0xffff);
    return this;
  }

  i16(address, value) {
    return this.u16(address, value < 0 ? value + 0x10000 : value);
  }

  u32(address, value) {
    this.u16(address, Math.floor(value / 0x10000));
    return this.u16(address + 1, value % 0x10000);
  }

  i32(address, value) {
    return this.u32(address, value < 0 ? value + 0x100000000 : value);
  }

  str(address, count, text) {
    const buffer = Buffer.alloc(count * 2);
    buffer.write(text, 'latin1');
    for (let i = 0; i < count; i += 1) {
      this.u16(address + i, buffer.readUInt16BE(i * 2));
    }
    return this;
  }

  get(address) {
    return this.values.get(address) ?? 0;
  }
}

/**
 * A typical residential installation: SUN2000-6KTL-M1, meter, LUNA2000 10 kWh.
 */
export function residentialRegisters({ battery = true, meter = true } = {}) {
  const map = new RegisterMap()
    .str(30000, 15, 'SUN2000-6KTL-M1')
    .str(30015, 10, 'HV2150012345')
    .u32(30073, 6000)
    .i32(32064, 4200) // input power
    .i32(32080, 4000) // active power
    .u16(32085, 5001) // 50.01 Hz
    .u16(32086, 9850) // 98.5 %
    .i16(32087, 452) // 45.2 °C
    .u16(32089, 0x0200) // on-grid
    .u32(32106, 1234567) // 12345.67 kWh
    .u32(32114, 1850); // 18.5 kWh
  if (meter) {
    map
      .u16(37100, 1)
      .i32(37101, 2351) // 235.1 V
      .i32(37107, -850) // -8.5 A
      .i32(37113, 1500) // exporting 1500 W
      .i16(37118, 5000)
      .i32(37119, 456789) // exported 4567.89 kWh
      .i32(37121, 98765); // imported 987.65 kWh
  } else {
    for (let a = 37100; a < 37123; a += 1) map.unavailable.add(a);
  }
  if (battery) {
    map
      .str(37052, 10, 'BAT0012345')
      .u32(37758, 10000) // 10 kWh
      .u16(37760, 755) // 75.5 %
      .u16(37762, 2) // running
      .i32(37765, 500) // charging 500 W
      .u32(37780, 123400) // 1234 kWh charged
      .u32(37782, 110000) // 1100 kWh discharged
      .u32(37784, 520)
      .u32(37786, 310)
      .u16(47086, 2); // maximise self-consumption
  }
  return map;
}

export async function startModbusServer(registers) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 7 && buffer.length >= 6 + buffer.readUInt16BE(4)) {
        const length = buffer.readUInt16BE(4);
        const frame = buffer.subarray(0, 6 + length);
        buffer = buffer.subarray(6 + length);
        socket.write(answer(registers, frame));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    registers,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function answer(registers, frame) {
  const header = frame.subarray(0, 7);
  const pdu = frame.subarray(7);
  const fc = pdu[0];
  const address = pdu.readUInt16BE(1);
  const reply = (body) => {
    const out = Buffer.concat([header, body]);
    out.writeUInt16BE(body.length + 1, 4);
    return out;
  };
  const exception = (code) => reply(Buffer.from([fc | 0x80, code]));
  if (fc === 0x03) {
    const count = pdu.readUInt16BE(3);
    const body = Buffer.alloc(2 + count * 2);
    body[0] = fc;
    body[1] = count * 2;
    for (let i = 0; i < count; i += 1) {
      if (registers.unavailable.has(address + i)) return exception(0x02);
      body.writeUInt16BE(registers.get(address + i), 2 + i * 2);
    }
    return reply(body);
  }
  if (fc === 0x06) {
    const value = pdu.readUInt16BE(3);
    registers.u16(address, value);
    registers.writes.push({ address, values: [value] });
    return reply(Buffer.from(pdu.subarray(0, 5)));
  }
  if (fc === 0x10) {
    const count = pdu.readUInt16BE(3);
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const value = pdu.readUInt16BE(6 + i * 2);
      registers.u16(address + i, value);
      values.push(value);
    }
    registers.writes.push({ address, values });
    return reply(Buffer.from(pdu.subarray(0, 5)));
  }
  return exception(0x01);
}
