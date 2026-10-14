# Huawei Solar for Gladys Assistant

Monitor and control your Huawei solar installation from Gladys: **SUN2000**
inverters, **LUNA2000** batteries and the **DTSU666-H / DDSU666-H** power
meter wired to the inverter.

Two connections are available, alone or together:

| Connection | How                                                           | Refresh             | Commands |
| ---------- | ------------------------------------------------------------- | ------------------- | -------- |
| **Local**  | Modbus TCP through the SDongle, an EMMA, or the inverter WLAN | every 30 s or more  | yes      |
| **Cloud**  | FusionSolar Northbound API                                    | every 5 min at most | no       |

With both, the **Prefer the local connection** toggle picks the preferred one;
if it fails, the other one takes over and the device badge shows an orange
dot.

Requires **Gladys 5.1.0** or later.

## 1. Local connection (recommended)

1. In the **FusionSolar app**, open _Device commissioning_ on your inverter
   (installer login), then _Settings > Communication configuration > Dongle
   parameter settings > Modbus TCP_ and choose **Enable (unrestricted)**.
2. Give the SDongle a fixed IP address in your router.
3. In Gladys, fill in:
   - **Inverter / SDongle address**: the SDongle IP, e.g. `192.168.1.50`;
   - **Modbus port**: `502` (SDongle / EMMA), `6607` (inverter WLAN);
   - **Modbus unit id**: usually `1` (SDongle), `0` (inverter WLAN).
4. Click **Test the connection**.

Good to know:

- the SDongle only accepts a few simultaneous Modbus clients: if another
  home automation system already reads it, keep the refresh interval at 60 s
  or more;
- some commands (export limitation, inverter startup / shutdown) may require
  installer rights on some firmwares: the scene action then answers
  `success: false` with the inverter's message.

## 2. Cloud connection (FusionSolar)

The cloud uses the FusionSolar **Northbound API**, which needs a dedicated API
account: your usual app login does **not** work.

1. Ask your installer to create an API account in FusionSolar
   (_System > Company Management > Northbound Management_), with access to
   your plant.
2. In Gladys, fill in:
   - **FusionSolar server**: the address you use in a browser, e.g.
     `https://eu5.fusionsolar.huawei.com`;
   - **API user name** and **API password (system code)**.
3. Click **Test the connection**.

Huawei limits the number of API calls: the cloud is read every 5 minutes at
most, whatever the refresh interval.

## 3. Create the devices

Open the **Discovery** tab of the integration and create the devices found:

- **Huawei SUN2000…** (inverter): solar production (W), total production
  (kWh), today's production (kWh), PV input power (W), internal temperature,
  status;
- **Huawei power meter**: grid power (W, positive when drawing from the grid,
  negative when exporting), grid import / export power (W) and indexes (kWh),
  house consumption (W), voltage, current;
- **Huawei LUNA2000 battery**: level (%), charge / discharge power (W), total
  charged / discharged (kWh, local), energy remaining (kWh, local), status,
  **working mode** (selectable from Gladys with the local connection:
  maximise self-consumption, time of use, fully fed to grid).

The production and grid indexes feed the Gladys energy monitoring.

## 4. Scenes

**Triggers** (category _Integrations_):

- **Inverter status changed**: production starts, stops, the inverter goes
  into fault… Variables: `status`, `previous_status`, `production_power`.
- **Grid exchange changed**: the house starts **exporting** a surplus,
  **drawing** from the grid, or is **balanced** (dead band set in the
  configuration, 100 W by default). Ideal to start a water heater or a car
  charger on surplus. Variables: `flow`, `previous_flow`, `grid_power`.
- **Battery level crossed**: the battery rises above or falls below a level,
  by steps of 10 %. Variables: `direction`, `level`, `battery_level`.

**Actions** (local connection, except the last one):

- force the battery to **charge** or **discharge** (power, duration), **stop**
  forcing it;
- set the battery **working mode**;
- **limit the grid export**: no limit, zero export, or a limit in watts;
- **start or shut down** the inverter;
- **read the solar installation**: exposes `production_power`,
  `daily_production`, `house_power`, `grid_power`, `battery_level`,
  `battery_power` and `inverter_status` to the following actions.

Each command returns `success` and `message`: use a condition on `success` to
react to a failure.

## 5. Dashboard widgets

- **Solar overview**: live production, house, grid and battery, the day chart,
  inverter status, today's production, grid exchange and connection.
- **Battery control**: battery level, charge and discharge power, working
  mode, and buttons to force a charge or a discharge, stop it or change the
  mode.

## Troubleshooting

- _Cannot connect to …:502_: Modbus TCP is not enabled on the dongle, the IP
  is wrong, or the dongle is busy with another client.
- _illegal data address_: the register does not exist on your model (e.g. no
  battery): the integration ignores it when reading.
- _FusionSolar login refused_: check the server address, the API user name and
  the system code; an ordinary account does not work.
- _rate limit reached_: wait a few minutes, and keep a single integration
  using this API account.
