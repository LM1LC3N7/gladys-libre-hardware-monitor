# TODO — Libre Hardware Monitor v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own: the claim is in /t/10385 (lot 10).

## Status

- [x] **Milestone 1 — core** (2026-10-20): `GET /data.json` of the web
      server of Libre Hardware Monitor, optional HTTP Basic authentication,
      10 s deadline, 8 MB cap, no redirect; the tree parsed without
      recursion, bounded (depth 16, 50,000 nodes, 64 hardware, 5,000
      sensors), own properties only; 0.9.7 raw values and the formatted
      values of older versions (decimal comma, GB / MB / MB/s, °F,
      `HH:MM:SS`), hardware id from the first sensor before 0.9.5; one
      device per main hardware, one read-only feature per sensor (ids of
      librehardwaremonitor-api), one device for the PC (`online`); sensor
      sets "essentials" / "all", 200 features per device, created features
      never lost; states of the created features only, rounded, changes
      only, 250 per minute with the oldest values first; 401 final and
      remembered (salted HMAC in `/data`), 429 pause kept in `/data` and
      bounded when read back, retries from the reading interval to 5 min;
      reconnection to Gladys: status and Discovery again, no reading sooner
      than the interval; "Test the connection"; docs en/fr; cover. Tested
      with unit tests against the SDK's fake Gladys, a fake Libre Hardware
      Monitor and a loopback http server. **Never tested with a real PC.**
      No Docker on this PC: no e2e test in a container. The store validator
      was not run by the developing agent (it cannot run it).

## Next

- [ ] Test with a real PC: Libre Hardware Monitor 0.9.7+ and an older one
      (0.9.4 or 0.9.6), with and without authentication, a German or French
      Windows (decimal comma), the display in Fahrenheit.
- [ ] Check that `RawValue` of a temperature stays in °C when the display is
      in Fahrenheit (read from the source of Libre Hardware Monitor, not seen
      on a PC), and the unit of a numeric `RawValue` of `SmallData` (assumed
      MB, never seen: `SmallData` only exists up to 0.9.6, formatted).
- [ ] Several PCs in one integration (a list of addresses). The external ids
      of the first PC must stay those of v1 (`hardware:<id>`, `computer:pc`).
- [ ] Maybe: a scene trigger "temperature above a threshold for N minutes"
      (the core already triggers on a feature above a value).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag; the first Release (patch) gives 0.1.1.
- **Read only.** Recent versions of Libre Hardware Monitor may accept fan
  control settings through their web server; this integration never sends
  any (the cooling of a PC is not a remote toy). No `onSetValue`, no button, no switch: nothing a voice
  assistant or "turn everything off" can reach.
- **External ids**: `hardware:<HardwareId formatted>` and
  `...:<SensorId formatted>`, the ids of librehardwaremonitor-api (and so of
  the Home Assistant integration). They do not depend on the address of the
  PC (a new IP keeps the devices) nor on its name. One PC per integration in
  v1: the PC device is `computer:pc`.
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY` of the core.
  Temperature: `device-temperature-sensor` / `decimal` / °C (kept out of the
  temperature of the room). Power, voltage, current: `energy-sensor` / power,
  voltage, current (never `energy` nor `index`: the core would count a
  consumption). Data: `data` / `size` in GB (`Data`, GiB like the display of
  Libre Hardware Monitor) or MB (`SmallData`). Throughput: `datarate` /
  `rate` in KB/s. Time span: `duration` / `integer` / seconds. Everything
  else (load %, fan RPM, control %, clock MHz, level %, frequency, flow,
  factor, timing, noise, conductivity, humidity, battery capacity in mWh) is
  `unknown` / `unknown` without a unit, the unit in the name, like the CPU
  load of gladys-portainer. Humidity is not `humidity-sensor` (a PC case is
  not the room). Battery capacity (`Energy`, mWh) is not an energy index.
- **"Online"** of the PC: `unknown` / `binary`, read only, published once
  known (a reading succeeded or failed), never at a configuration error.
- **Rounding** (fewer changes, fewer states): 0.1 °C, 1 %, 1 RPM, 1 MHz,
  0.1 W, 0.001 V, 0.01 A, 0.01 GB, 1 MB, 0.1 KB/s. A value outside the
  bounds of its feature (255 °C of a missing probe) is not published.
- **State budget**: 250 per minute (Gladys: 300). "Online" always goes; the
  sensor values that changed are sorted by the time of their last
  publication (never first) and cut to what is left: a big PC gets every
  value in turn, never a starved one.
- **Sensor sets**: "essentials" (Temperature, Load, Fan, Power) by default,
  "all" for every type. The set only shapes Discovery: the features of a
  created device are always kept in Discovery and always get their values.
- **No reading faster than the interval**: the retry after a failure starts
  at the interval (30 s at least), doubles up to 5 min (or the interval when
  longer); a reconnection to Gladys reuses a reading younger than the
  interval; the scan button publishes the last reading. Only the user
  (saved configuration, "Test the connection") reads at once.
- **401** (with or without credentials) is final: a salted HMAC of the
  address and credentials in `/data`, never the password; nothing is sent
  again with the same values until the user acts. **429**: pause of 1 min to
  6 h (Retry-After), kept in `/data`, read back bounded to 6 h.
- **http only by default** (the web server of Libre Hardware Monitor has no
  https); https accepted for a reverse proxy, with a certificate from a known
  authority only (no pinning: not worth it for a read-only LAN sensor feed).
  The manifest and the docs say that the password crosses the network in
  clear. A redirect is never followed (it would carry the Authorization
  header).
- **No scene trigger** in v1: the core already triggers scenes on a feature
  value (temperature above a threshold) and on "Online".
- **gladys_version >= 5.1.0**, like gladys-portainer.
