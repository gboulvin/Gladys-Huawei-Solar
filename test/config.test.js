import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCloud, hasLocal, normalizeConfig } from '../src/config.js';

test('defaults apply to an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('numbers typed as strings are converted, blanks fall back to the defaults', () => {
  const config = normalizeConfig({ modbus_port: '6607', modbus_unit_id: '0', poll_frequency: '' });
  assert.equal(config.modbus_port, 6607);
  assert.equal(config.modbus_unit_id, 0);
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
});

test('the refresh interval cannot go under 30 s', () => {
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 30);
});

test('channels are configured by their fields', () => {
  assert.equal(hasLocal(normalizeConfig({ modbus_host: '  ' })), false);
  assert.equal(hasLocal(normalizeConfig({ modbus_host: '192.168.1.50' })), true);
  assert.equal(hasCloud(normalizeConfig({ fusionsolar_username: 'u' })), false);
  assert.equal(
    hasCloud(normalizeConfig({ fusionsolar_username: 'u', fusionsolar_password: 'p' })),
    true,
  );
});

test('only an explicit false disables the local preference', () => {
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).GLADYS_PREFER_LOCAL, false);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: undefined }).GLADYS_PREFER_LOCAL, true);
});
