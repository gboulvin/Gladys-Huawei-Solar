// -----------------------------------------------------------------------------
// Status vocabularies shared by the local (Modbus) and cloud (FusionSolar)
// drivers.
//
// Huawei reports the inverter state as a 16-bit code (register 32089, or
// `inverter_state` in FusionSolar, the same value in decimal). Scenes need a
// short, stable vocabulary, not 40 codes: they are folded into the statuses
// below. These keys are stored by scenes (trigger filters): never rename one.
// -----------------------------------------------------------------------------

export const INVERTER_STATUS = {
  STANDBY: 'standby',
  STARTING: 'starting',
  ON_GRID: 'on_grid',
  LIMITED: 'limited',
  OFF_GRID: 'off_grid',
  SHUTDOWN: 'shutdown',
  FAULT: 'fault',
  NO_IRRADIATION: 'no_irradiation',
  OTHER: 'other',
};

export const INVERTER_STATUS_LABELS = {
  standby: { en: 'Standby', fr: 'En veille', de: 'Standby', es: 'En espera' },
  starting: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Arrancando' },
  on_grid: {
    en: 'Producing (on-grid)',
    fr: 'En production (réseau)',
    de: 'Produktion (Netz)',
    es: 'Produciendo (red)',
  },
  limited: {
    en: 'Power limited',
    fr: 'Puissance limitée',
    de: 'Leistung begrenzt',
    es: 'Potencia limitada',
  },
  off_grid: { en: 'Off-grid', fr: 'Hors réseau', de: 'Inselbetrieb', es: 'Aislado de la red' },
  shutdown: { en: 'Shut down', fr: 'Arrêté', de: 'Abgeschaltet', es: 'Apagado' },
  fault: { en: 'Fault', fr: 'En défaut', de: 'Störung', es: 'Avería' },
  no_irradiation: {
    en: 'No sunlight',
    fr: 'Pas de soleil',
    de: 'Keine Einstrahlung',
    es: 'Sin irradiación',
  },
  other: { en: 'Other', fr: 'Autre', de: 'Sonstiges', es: 'Otro' },
};

/**
 * Fold a Huawei inverter state code into INVERTER_STATUS.
 * @param {number | null | undefined} code
 */
export function normalizeInverterStatus(code) {
  if (code === null || code === undefined || !Number.isFinite(code)) {
    return INVERTER_STATUS.OTHER;
  }
  if (code === 0xa000) return INVERTER_STATUS.NO_IRRADIATION;
  if (code >= 0x0000 && code <= 0x0003) return INVERTER_STATUS.STANDBY;
  if (code === 0x0100) return INVERTER_STATUS.STARTING;
  if (code === 0x0200) return INVERTER_STATUS.ON_GRID;
  if (code === 0x0201 || code === 0x0202) return INVERTER_STATUS.LIMITED;
  if ((code >= 0x0203 && code <= 0x0205) || code === 0x0a00) return INVERTER_STATUS.OFF_GRID;
  if (code === 0x0300) return INVERTER_STATUS.FAULT;
  if (code >= 0x0301 && code <= 0x03ff) return INVERTER_STATUS.SHUTDOWN;
  // 0x04xx: on-grid under a grid scheduling curve, still producing.
  if (code >= 0x0400 && code <= 0x04ff) return INVERTER_STATUS.ON_GRID;
  return INVERTER_STATUS.OTHER;
}

export const BATTERY_STATUS = {
  OFFLINE: 'offline',
  STANDBY: 'standby',
  RUNNING: 'running',
  FAULT: 'fault',
  SLEEP: 'sleep',
};

// Register 37762 and FusionSolar `battery_status` share the same codes.
const BATTERY_STATUS_BY_CODE = ['offline', 'standby', 'running', 'fault', 'sleep'];

export function normalizeBatteryStatus(code) {
  return BATTERY_STATUS_BY_CODE[code] ?? BATTERY_STATUS.OFFLINE;
}

export const BATTERY_STATUS_LABELS = {
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Desconectada' },
  standby: { en: 'Standby', fr: 'En veille', de: 'Standby', es: 'En espera' },
  running: { en: 'Running', fr: 'En fonctionnement', de: 'In Betrieb', es: 'En funcionamiento' },
  fault: { en: 'Fault', fr: 'En défaut', de: 'Störung', es: 'Avería' },
  sleep: { en: 'Sleep', fr: 'En sommeil', de: 'Ruhezustand', es: 'En reposo' },
};

// Battery working modes. The first three are the ones a user can select from
// Gladys; the others are only reported.
export const BATTERY_MODE = {
  MAXIMISE_SELF_CONSUMPTION: 'maximise_self_consumption',
  TIME_OF_USE: 'time_of_use',
  FULLY_FED_TO_GRID: 'fully_fed_to_grid',
  ADAPTIVE: 'adaptive',
  FIXED_CHARGE_DISCHARGE: 'fixed_charge_discharge',
  OTHER: 'other',
};

export const SELECTABLE_BATTERY_MODES = [
  BATTERY_MODE.MAXIMISE_SELF_CONSUMPTION,
  BATTERY_MODE.TIME_OF_USE,
  BATTERY_MODE.FULLY_FED_TO_GRID,
];

export const BATTERY_MODE_LABELS = {
  maximise_self_consumption: {
    en: 'Maximise self-consumption',
    fr: 'Autoconsommation maximale',
    de: 'Eigenverbrauch maximieren',
    es: 'Maximizar autoconsumo',
  },
  time_of_use: {
    en: 'Time of use',
    fr: 'Heures creuses / pleines',
    de: 'Nutzungszeit (TOU)',
    es: 'Por franjas horarias',
  },
  fully_fed_to_grid: {
    en: 'Fully fed to grid',
    fr: 'Injection totale au réseau',
    de: 'Volleinspeisung',
    es: 'Inyección total a la red',
  },
  adaptive: { en: 'Adaptive', fr: 'Adaptatif', de: 'Adaptiv', es: 'Adaptativo' },
  fixed_charge_discharge: {
    en: 'Fixed charge/discharge',
    fr: 'Charge/décharge fixe',
    de: 'Feste Ladung/Entladung',
    es: 'Carga/descarga fija',
  },
  other: { en: 'Other', fr: 'Autre', de: 'Sonstiges', es: 'Otro' },
};

// Register 47086 (storage working mode settings).
const LOCAL_MODE_BY_CODE = {
  0: BATTERY_MODE.ADAPTIVE,
  1: BATTERY_MODE.FIXED_CHARGE_DISCHARGE,
  2: BATTERY_MODE.MAXIMISE_SELF_CONSUMPTION,
  3: BATTERY_MODE.TIME_OF_USE, // time of use (LG)
  4: BATTERY_MODE.FULLY_FED_TO_GRID,
  5: BATTERY_MODE.TIME_OF_USE, // time of use (LUNA2000)
};

export const LOCAL_MODE_CODES = {
  [BATTERY_MODE.MAXIMISE_SELF_CONSUMPTION]: 2,
  [BATTERY_MODE.TIME_OF_USE]: 5,
  [BATTERY_MODE.FULLY_FED_TO_GRID]: 4,
};

export function batteryModeFromLocal(code) {
  return LOCAL_MODE_BY_CODE[code] ?? BATTERY_MODE.OTHER;
}

// FusionSolar `ch_discharge_model`.
const CLOUD_MODE_BY_CODE = {
  2: BATTERY_MODE.TIME_OF_USE,
  3: BATTERY_MODE.FIXED_CHARGE_DISCHARGE,
  4: BATTERY_MODE.MAXIMISE_SELF_CONSUMPTION,
  5: BATTERY_MODE.FULLY_FED_TO_GRID,
  6: BATTERY_MODE.TIME_OF_USE,
  7: BATTERY_MODE.MAXIMISE_SELF_CONSUMPTION,
  8: BATTERY_MODE.FULLY_FED_TO_GRID,
  9: BATTERY_MODE.TIME_OF_USE,
};

export function batteryModeFromCloud(code) {
  return CLOUD_MODE_BY_CODE[code] ?? BATTERY_MODE.OTHER;
}

// Direction of the energy exchanged with the grid, from the meter reading.
export const GRID_FLOW = {
  IMPORTING: 'importing',
  EXPORTING: 'exporting',
  IDLE: 'idle',
};

export const GRID_FLOW_LABELS = {
  importing: {
    en: 'Drawing from the grid',
    fr: 'Soutirage réseau',
    de: 'Netzbezug',
    es: 'Consumiendo de la red',
  },
  exporting: {
    en: 'Exporting to the grid',
    fr: 'Injection réseau',
    de: 'Netzeinspeisung',
    es: 'Inyectando a la red',
  },
  idle: { en: 'Balanced', fr: 'Équilibré', de: 'Ausgeglichen', es: 'Equilibrado' },
};

/**
 * @param {number} power grid power, positive when drawing from the grid
 * @param {number} threshold dead band, in W
 */
export function gridFlowOf(power, threshold) {
  if (power > threshold) return GRID_FLOW.IMPORTING;
  if (power < -threshold) return GRID_FLOW.EXPORTING;
  return GRID_FLOW.IDLE;
}
