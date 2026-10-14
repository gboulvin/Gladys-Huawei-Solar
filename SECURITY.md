# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- the connection used (local Modbus, FusionSolar cloud, or both) and the
  hardware (inverter, dongle, battery models);
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords, serial numbers and
  addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes —
including how it stores and sends the FusionSolar API credentials, and the
Modbus commands it can send to the inverter and the battery.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Huawei's devices, firmware and FusionSolar services. Note that Modbus TCP has
no authentication: anyone on the local network can read and write the
inverter once it is enabled on the dongle. Keep the inverter on a trusted
network (or a dedicated VLAN) and prefer the "Enable (restricted)" Modbus
setting when your SDongle firmware offers it.
