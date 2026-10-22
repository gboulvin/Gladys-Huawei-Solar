# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Security

- `brace-expansion`, pulled in by ESLint, raised to 5.0.12 against the
  high-severity denial-of-service advisories (GHSA-mh99-v99m-4gvg and
  related). A development tool only: the published image never shipped it.
- The image is rebuilt on the latest `node:24-alpine` (Node.js and Alpine
  security patches); development tools and CI actions up to date.

## [1.0.0] - 2026-10-14

### Added

- First release of the Huawei Solar integration for Gladys Assistant (5.1.0 or
  later).
- Local connection over Modbus TCP (SDongle, EMMA or the inverter's WLAN
  access point) and cloud connection through the FusionSolar Northbound API,
  with automatic fallback from the preferred one to the other.
- Devices: SUN2000 inverter (production, PV input, today's and lifetime yield,
  temperature, status), power meter (grid power, import / export powers and
  indexes, voltage, current, house consumption) and LUNA2000 battery (level,
  charge / discharge powers and indexes, remaining energy, status, working
  mode).
- Battery working mode selectable from Gladys (local connection).
- Scene triggers: inverter status changed, grid exchange changed (surplus
  export / grid draw), battery level crossed.
- Scene actions: force a battery charge or discharge, stop it, set the battery
  working mode, limit the grid export (zero export or watts), start or shut
  down the inverter, read the installation's live values.
- Dashboard widgets: solar overview and battery control.
- "Test the connection" button in the Configuration screen.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/gboulvin/Gladys-Huawei-Solar/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gboulvin/Gladys-Huawei-Solar/releases/tag/v1.0.0
