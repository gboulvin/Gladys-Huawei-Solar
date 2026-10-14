// -----------------------------------------------------------------------------
// Scene triggers (SDK v0.14+, Gladys 5.1+).
//
// Every new snapshot of the hub is compared with the previous one, and each
// TRANSITION fires one scene event (never one per poll: 300 events/minute per
// integration). The keys, filters and variables are declared in the manifest
// `scene_triggers` field; test/scenes.test.js keeps both in sync.
//
// `data` is flat, primitives only, and only carries declared keys. `device` is
// the device external_id, the value a `"source": "devices"` filter stores;
// the filters compared by equality (status, flow, direction, level) are the
// option values of the manifest, as strings.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { gridFlowOf } from './huawei/status.js';
import { inverter } from './devices/inverter.js';
import { powerMeter } from './devices/powerMeter.js';
import { battery } from './devices/battery.js';

const logger = createLogger({ name: 'triggers' });

// Trigger keys: stored by scenes, never rename one.
export const TRIGGER = {
  INVERTER_STATUS_CHANGED: 'inverter_status_changed',
  GRID_FLOW_CHANGED: 'grid_flow_changed',
  BATTERY_LEVEL_CROSSED: 'battery_level_crossed',
};

export const SCENE_TRIGGER_KEYS = Object.values(TRIGGER);

// The levels a battery_level_crossed event can report (manifest options).
export const BATTERY_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const byKey = (list, keyOf) => new Map(list.map((item) => [keyOf(item), item]));

/**
 * The scene events between two snapshots.
 * @returns {{ key: string, data: object }[]}
 */
export function computeSceneEvents(gladys, snapshot, previous, config) {
  if (!previous) {
    return [];
  }
  const events = [];

  const previousInverters = byKey(previous.inverters, (inv) => inv.sn);
  for (const inv of snapshot.inverters) {
    const before = previousInverters.get(inv.sn);
    if (before && before.status !== inv.status) {
      events.push({
        key: TRIGGER.INVERTER_STATUS_CHANGED,
        data: {
          device: inverter.ids(gladys, inv).device,
          status: inv.status,
          previous_status: before.status,
          production_power: inv.activePower ?? 0,
        },
      });
    }
  }

  const previousMeters = byKey(previous.meters, (meter) => meter.id);
  for (const meter of snapshot.meters) {
    const before = previousMeters.get(meter.id);
    if (!before || typeof meter.power !== 'number' || typeof before.power !== 'number') {
      continue;
    }
    const flow = gridFlowOf(meter.power, config.grid_threshold);
    const flowBefore = gridFlowOf(before.power, config.grid_threshold);
    if (flow !== flowBefore) {
      events.push({
        key: TRIGGER.GRID_FLOW_CHANGED,
        data: {
          device: powerMeter.ids(gladys, meter).device,
          flow,
          previous_flow: flowBefore,
          grid_power: meter.power,
        },
      });
    }
  }

  const previousBatteries = byKey(previous.batteries, (bat) => bat.id);
  for (const bat of snapshot.batteries) {
    const before = previousBatteries.get(bat.id);
    if (!before || typeof bat.soc !== 'number' || typeof before.soc !== 'number') {
      continue;
    }
    for (const level of BATTERY_LEVELS) {
      const rising = before.soc < level && bat.soc >= level;
      const falling = before.soc >= level && bat.soc < level;
      if (rising || falling) {
        events.push({
          key: TRIGGER.BATTERY_LEVEL_CROSSED,
          data: {
            device: battery.ids(gladys, bat).device,
            direction: rising ? 'rising' : 'falling',
            level: String(level),
            battery_level: bat.soc,
          },
        });
      }
    }
  }

  return events;
}

/**
 * Hub listener: publish the scene events of every new snapshot.
 */
export function createTriggerListener(gladys, getConfig) {
  return async (snapshot, previous) => {
    for (const { key, data } of computeSceneEvents(gladys, snapshot, previous, getConfig())) {
      logger.info(`Scene event ${key}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.error(`publishSceneEvent ${key} failed`, err);
      }
    }
  };
}
