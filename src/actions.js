// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { hasCloud, hasLocal } from './config.js';

const logger = createLogger({ name: 'actions' });

const describe = (snapshot) => {
  const parts = [`${snapshot.inverters.length} inverter(s)`];
  if (snapshot.meters.length) parts.push(`${snapshot.meters.length} meter(s)`);
  if (snapshot.batteries.length) parts.push(`${snapshot.batteries.length} battery(ies)`);
  const production = snapshot.inverters.reduce((sum, inv) => sum + (inv.activePower ?? 0), 0);
  return { parts: parts.join(', '), production };
};

/**
 * `test_connection`: read the installation through EVERY configured channel,
 * independently of the preference, and say what each one sees.
 */
export async function testConnection(hub, config) {
  const lines = { en: [], fr: [], de: [], es: [] };
  const channels = [
    [
      'local',
      hasLocal(config),
      { en: 'Local Modbus', fr: 'Modbus local', de: 'Lokales Modbus', es: 'Modbus local' },
    ],
    [
      'cloud',
      hasCloud(config),
      {
        en: 'FusionSolar cloud',
        fr: 'Cloud FusionSolar',
        de: 'FusionSolar-Cloud',
        es: 'Nube FusionSolar',
      },
    ],
  ];
  let anyConfigured = false;
  for (const [source, configured, name] of channels) {
    if (!configured) continue;
    anyConfigured = true;
    try {
      const { parts, production } = describe(await hub.drivers[source].readSnapshot());
      lines.en.push(`${name.en}: OK — ${parts}, producing ${production} W.`);
      lines.fr.push(`${name.fr} : OK — ${parts}, production ${production} W.`);
      lines.de.push(`${name.de}: OK — ${parts}, Erzeugung ${production} W.`);
      lines.es.push(`${name.es}: OK — ${parts}, produciendo ${production} W.`);
    } catch (err) {
      logger.warn(`test_connection ${source} failed: ${err.message}`);
      lines.en.push(`${name.en}: failed — ${err.message}`);
      lines.fr.push(`${name.fr} : échec — ${err.message}`);
      lines.de.push(`${name.de}: fehlgeschlagen — ${err.message}`);
      lines.es.push(`${name.es}: error — ${err.message}`);
    }
  }
  if (!anyConfigured) {
    return {
      en: 'Nothing to test: fill in the inverter address and/or the FusionSolar API account first.',
      fr: "Rien à tester : renseignez d'abord l'adresse de l'onduleur et/ou le compte API FusionSolar.",
      de: 'Nichts zu testen: zuerst die Adresse des Wechselrichters und/oder das FusionSolar-API-Konto eintragen.',
      es: 'Nada que probar: indique primero la dirección del inversor y/o la cuenta API de FusionSolar.',
    };
  }
  return Object.fromEntries(Object.entries(lines).map(([lang, list]) => [lang, list.join(' ')]));
}
