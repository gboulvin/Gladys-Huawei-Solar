// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or numbers typed as strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in
// the `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  modbus_host: '',
  modbus_port: 502,
  modbus_unit_id: 1,
  fusionsolar_url: 'https://eu5.fusionsolar.huawei.com',
  fusionsolar_username: '',
  fusionsolar_password: '',
  // Seconds between two reads of the installation. Gladys polls at most once
  // a minute: slower intervals are applied by the hub (see src/hub.js).
  poll_frequency: 60,
  // Dead band, in W, under which the grid exchange counts as balanced (scene
  // trigger `grid_flow_changed`, avoids flapping around zero).
  grid_threshold: 100,
  // Reserved key (NOT in config_schema): the manifest declares both 'local'
  // and 'cloud' transports, so Gladys shows a "Prefer the local connection"
  // toggle and sends the choice here. Read-only, defaults to true.
  GLADYS_PREFER_LOCAL: true,
};

// FusionSolar Northbound rate limits: never ask it more than every 5 min.
export const CLOUD_MIN_INTERVAL_S = 300;

const toNumber = (value, fallback) => {
  const number = Number(value);
  return value === undefined || value === null || value === '' || !Number.isFinite(number)
    ? fallback
    : number;
};

const toText = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    modbus_host: toText(raw.modbus_host),
    modbus_port: toNumber(raw.modbus_port, DEFAULT_CONFIG.modbus_port),
    modbus_unit_id: toNumber(raw.modbus_unit_id, DEFAULT_CONFIG.modbus_unit_id),
    fusionsolar_url: toText(raw.fusionsolar_url) || DEFAULT_CONFIG.fusionsolar_url,
    fusionsolar_username: toText(raw.fusionsolar_username),
    fusionsolar_password:
      typeof raw.fusionsolar_password === 'string' ? raw.fusionsolar_password : '',
    poll_frequency: Math.max(30, toNumber(raw.poll_frequency, DEFAULT_CONFIG.poll_frequency)),
    grid_threshold: Math.max(0, toNumber(raw.grid_threshold, DEFAULT_CONFIG.grid_threshold)),
    // The preference is a boolean; anything but an explicit false means true.
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
  };
}

export function hasLocal(config) {
  return config.modbus_host !== '';
}

export function hasCloud(config) {
  return config.fusionsolar_username !== '' && config.fusionsolar_password !== '';
}
