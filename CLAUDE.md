# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

**Huawei Solar**, a Gladys Assistant **external integration**: a Node.js
service (Node 22+, ESM, no build step) that runs in its own sandboxed Docker
container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
(`GladysAssistant/integration-template-js`).

It reads Huawei SUN2000 inverters, their power meter and LUNA2000 battery:

- **locally** over Modbus TCP (own minimal client, `src/modbus/client.js`),
  through the SDongle (port 502), an EMMA, or the inverter WLAN (port 6607);
- through the **cloud**, with the FusionSolar Northbound API
  (`src/huawei/cloud.js`), rate-limited: never more than every 5 minutes.

Both channels produce the same normalized **snapshot** (format documented at
the top of `src/hub.js`); everything downstream (devices, triggers, widgets)
only knows the snapshot. Commands (battery, export limit, inverter on/off)
are local only.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/hub.test.js              # one file
node --test --test-name-pattern "battery" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                     connects; all handlers are in src/app.js
src/app.js                   SDK wiring (discovery, poll, set value, actions, scenes, widgets, lifecycle)
src/hub.js                   channel choice + fallback, snapshot cache, listeners, transport badge
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/modbus/client.js         Modbus TCP client (FC 03, 06, 16), sequential requests
src/huawei/local.js          register map, decoding, local snapshot, commands
src/huawei/cloud.js          FusionSolar Northbound client, cloud snapshot
src/huawei/status.js         status / mode vocabularies + their 4-language labels
src/devices/<kind>.js        inverter, powerMeter, battery: buildDevice, states, onSetValue
src/devices/index.js         registry + dispatch helpers
src/triggers.js              scene events from two consecutive snapshots
src/scenes.js                scene action handlers (manifest `scene_actions`)
src/widgets.js               dashboard widgets (manifest `widgets`)
src/actions.js               Configuration screen buttons (manifest `actions`)
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (en + fr mandatory)
test/                        node --test, fake Gladys of the SDK, loopback Modbus server, fake fetch
```

## Rules

- **External ids are forever.** Devices are keyed on the inverter serial
  number (`gladys.externalIds(type, sn)`); the meter and the battery reuse the
  serial number of their inverter, in BOTH drivers, so switching between
  local and cloud never creates new devices. Feature keys (`INVERTER_FEATURE`,
  `METER_FEATURE`, `BATTERY_FEATURE`), manifest keys (`config_schema`,
  `actions`, `scene_triggers`, `scene_actions`, `widgets`) and the option
  values scenes store (statuses, flows, modes, levels) are never renamed.
- **Sign conventions.** Grid power is positive when drawing from the grid
  (Huawei reports the opposite: the drivers flip it). Battery power is
  positive when charging.
- **Never publish `null`.** Unknown values are left out (`numericState`,
  `textState` in `src/devices/common.js`).
- **Rate limits.** FusionSolar: the hub never reads the cloud more than every
  `CLOUD_MIN_INTERVAL_S` (300 s), the device list is cached 6 h. Gladys: states
  go through `publishChangedStates`; scene events fire on transitions only.
- **The container rootfs is read-only.** Write only under `/data`. Never log
  tokens, passwords, the system code or the XSRF token.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Four languages.** Every user-facing text is `{ en, fr, de, es }`: manifest
  texts (`test/manifest.test.js` enforces it), action messages, connection
  statuses, widget contents, status labels (`src/huawei/status.js`), and the
  docs `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync.
  Device and feature names, and `supported_options` labels, are plain English
  strings (Gladys does not translate them).
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language; widget labels 3 to 30. `scene_triggers`, `scene_actions` and
  `widgets` require `gladys_version` `>=5.1.0`. Change the manifest and the
  code together: the tests tie handlers, options and defaults to it.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the Modbus test server listens on
  127.0.0.1, FusionSolar is a fake `fetch`).
