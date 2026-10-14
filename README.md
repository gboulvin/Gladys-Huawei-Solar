# Huawei Solar — Gladys Assistant integration

External integration for [Gladys Assistant](https://gladysassistant.com)
supporting the **Huawei Solar** range: **SUN2000** inverters, **LUNA2000**
batteries and the **DTSU666-H / DDSU666-H** power meter, over the **local**
network (Modbus TCP) and/or the **FusionSolar cloud** (Northbound API).

- 🇬🇧 User guide: [docs/en.md](docs/en.md)
- 🇫🇷 Guide utilisateur : [docs/fr.md](docs/fr.md)
- 🇩🇪 Benutzerhandbuch: [docs/de.md](docs/de.md)
- 🇪🇸 Guía de usuario: [docs/es.md](docs/es.md)

Requires **Gladys 5.1.0** or later.

## Features

| Surface              | What                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Connections**      | `local` (Modbus TCP: SDongle, EMMA, inverter WLAN) and `cloud` (FusionSolar Northbound), with the standard "Prefer the local connection" toggle and fallback |
| **Inverter**         | solar production, total and today's production, PV input power, internal temperature, status                                                                 |
| **Power meter**      | grid power (+ import / − export), import / export powers and indexes, house consumption, voltage, current                                                    |
| **LUNA2000 battery** | level, charge / discharge powers and indexes, energy remaining, status, working mode (selectable)                                                            |
| **Scene triggers**   | `inverter_status_changed`, `grid_flow_changed` (surplus export / grid draw), `battery_level_crossed` (10 % steps)                                            |
| **Scene actions**    | force battery charge / discharge, stop forcing, battery working mode, grid export limit (zero export / watts), inverter start / shutdown, read live data     |
| **Widgets**          | `solar_overview` (live tiles, day chart, status) and `battery_control` (level, power, mode, buttons)                                                         |
| **Languages**        | English, French, German, Spanish                                                                                                                             |

Commands go through the local Modbus connection only; the cloud is read-only
and read every 5 minutes at most (FusionSolar rate limits).

## Installation

In Gladys: **Integrations → Install an integration**, search for _Huawei
Solar_. Then follow the [user guide](docs/en.md) to enable Modbus TCP on the
SDongle and/or get a FusionSolar Northbound API account.

## How it works

```
             ┌───────────── local: Modbus TCP (SDongle :502 / WLAN :6607)
SolarHub ────┤                                         ┐
 (src/hub.js)└───────────── cloud: FusionSolar Northbound API (≥ 5 min)
      │   one normalized snapshot, cached for the refresh interval
      ├── devices (inverter, power meter, battery) ← Gladys polls
      ├── scene triggers (transitions between two snapshots)
      ├── widgets (live tiles bound to the features + computed status)
      └── transport badge (local / cloud / degraded / unreachable)
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the project rules.

## Development

```bash
npm install
npm test               # node --test (loopback Modbus server, fake FusionSolar, fake Gladys)
npm run lint           # ESLint
npm run format:check   # Prettier
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="huawei-solar" \
LOG_LEVEL=debug \
npm start
```

Check the store admission rules locally:

```bash
npx github:GladysAssistant/integration-store .
```

## Release

1. Describe the changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`: the
   workflow bumps `package.json` and the manifest, rolls the changelog, tags,
   builds the multi-arch image to `ghcr.io/gboulvin/gladys-huawei-solar` and
   publishes the GitHub Release.

The repository carries the `gladys-assistant-integration` GitHub topic, which
is how the Gladys integration store finds it.

## Credits

Register map from Huawei's _SUN2000 MODBUS Interface Definitions_; thanks to
the [huawei-solar-lib](https://github.com/wlcrs/huawei-solar-lib) community
for documenting the Huawei quirks. Not affiliated with Huawei.

## License

Apache-2.0
