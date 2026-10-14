// -----------------------------------------------------------------------------
// Device registry.
//
// Unlike fixed hardware, a Huawei installation is discovered: one inverter
// device per SUN2000, plus a power meter and a battery device when present.
// Each kind lives in its own file and exposes the same shape:
//   - type                               : external id namespace
//   - entities(snapshot)                 : the entities of the snapshot
//   - ids(gladys, entity)                : `gladys.externalIds(type, platformId)`
//   - buildDevice(gladys, entity)        : the discovery payload
//   - states(gladys, entity, snapshot)   : the states to publish
//   - onSetValue(gladys, {...})          (optional): run a user command
// -----------------------------------------------------------------------------

import { inverter } from './inverter.js';
import { powerMeter } from './powerMeter.js';
import { battery } from './battery.js';

export const DEVICE_KINDS = [inverter, powerMeter, battery];

/**
 * Discovery payload of every device of the snapshot.
 */
export function buildDiscoveredDevices(gladys, snapshot) {
  if (!snapshot) {
    return [];
  }
  return DEVICE_KINDS.flatMap((kind) =>
    kind.entities(snapshot).map((entity) => kind.buildDevice(gladys, entity)),
  );
}

/**
 * The kind and the entity behind a device external id, in this snapshot.
 * @returns {{ kind: object, entity: object } | null}
 */
export function findDevice(gladys, externalId, snapshot) {
  if (!snapshot) {
    return null;
  }
  for (const kind of DEVICE_KINDS) {
    const entity = kind
      .entities(snapshot)
      .find((candidate) => kind.ids(gladys, candidate).device === externalId);
    if (entity) {
      return { kind, entity };
    }
  }
  return null;
}

/**
 * The states of one device, from the snapshot.
 */
export function statesOfDevice(gladys, externalId, snapshot) {
  const found = findDevice(gladys, externalId, snapshot);
  return found ? found.kind.states(gladys, found.entity, snapshot) : [];
}

/**
 * External id of a feature of the first entity of a kind, e.g. the
 * production power of the first inverter (widgets, scene outputs).
 */
export function firstFeatureId(gladys, snapshot, kind, featureKey) {
  const entity = snapshot ? kind.entities(snapshot)[0] : undefined;
  return entity ? kind.ids(gladys, entity).feature(featureKey) : null;
}

/**
 * Transport badge entries: every device follows the channel of the hub.
 */
export function buildTransportEntries(gladys, snapshot, transport) {
  return buildDiscoveredDevices(gladys, snapshot).map((device) => ({
    external_id: device.external_id,
    ...transport,
  }));
}
