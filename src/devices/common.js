// -----------------------------------------------------------------------------
// Helpers shared by the device kinds.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';

// Every device is polled at this pace; the hub serves the polls from its
// cached snapshot, so the installation is only read at the interval of the
// configuration (and every 5 minutes at most through the cloud).
export const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS;

/**
 * Numeric state entry, or nothing when the value is unknown: a `null` would
 * be refused by Gladys.
 */
export function numericState(externalId, value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? [{ device_feature_external_id: externalId, state: value }]
    : [];
}

export function textState(externalId, text) {
  return typeof text === 'string' && text !== ''
    ? [{ device_feature_external_id: externalId, text }]
    : [];
}
