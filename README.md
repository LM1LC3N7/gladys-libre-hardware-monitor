# gladys-libre-hardware-monitor

[Gladys Assistant](https://gladysassistant.com) external integration for
**Libre Hardware Monitor**: the sensors of a Windows PC (CPU and GPU
temperatures, loads, fans, power, clocks, voltages, memory, disks, network
throughputs), read through the web server of Libre Hardware Monitor. Each
piece of hardware becomes a Gladys device, the PC a device whose "Online"
tells whether it answers. Read only: nothing is ever sent to the PC but
`GET /data.json`. **Unofficial integration, not affiliated with the Libre
Hardware Monitor project. Never tested with a real PC yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (LhmApp)
                 ├─ src/lhm/client.js   GET /data.json, optional Basic authentication
                 ├─ src/lhm/http.js     the only network access (node:http / https)
                 ├─ src/lhm/parse.js    the sensor tree -> plain objects (pure, bounded)
                 ├─ src/lhm/errors.js   error codes, refusal of the credentials
                 ├─ src/budget.js       states per minute
                 ├─ src/store.js        /data: refusal (salted scrypt), 429/5xx pause
                 └─ src/devices.js      hardware and PC devices (pure)
```

- **Reading** (every 30 s to 5 min, 1 min by default): `GET /data.json`,
  10 s deadline, 8 MB cap, no redirect followed. The tree is walked without
  recursion, with caps on depth, nodes, hardware and sensors; only own
  properties are read. Values: `RawValue` numbers (0.9.7+), else the
  formatted value (decimal comma, GB, MB/s, °F, `HH:MM:SS`).
- **Devices**: `hardware:<hardware id>` (one per main hardware, one read-only
  feature per sensor, `<sensor id>`), `computer:pc` (feature `online`). Ids
  are those of librehardwaremonitor-api. Units only those the core lists for
  the category; load, fan, clock... are `unknown` features named with their
  unit. A device published again keeps every feature of the created device.
- **States**: only the created features, only when the rounded value changed,
  250 per minute at most, the values published longest ago first; "Online"
  always goes.
- **Authentication**: optional HTTP Basic (user name and password of the web
  server of Libre Hardware Monitor), in the `Authorization` header only.
  HTTP 401 is final: a salted scrypt hash of the address and credentials is kept in
  `/data`, nothing is sent again until the configuration is saved or "Test
  the connection" is pressed. HTTP 429 pauses the readings (Retry-After,
  1 min to 6 h, kept in `/data`, bounded when read back); other failures
  retry from the reading interval up to 5 min. A reconnection to Gladys
  publishes the status and Discovery again, never reads the PC sooner than
  the interval, and keeps the pause, the refusal and the wait.

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npm run cover                                   # regenerate cover.png
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against the SDK's fake Gladys and a fake Libre Hardware Monitor
(`test/helpers/fakeLhm.js`), plus a loopback http server for the transport.
No test touches a real PC or the Internet.

## Credits

- [librehardwaremonitor-api](https://github.com/Sab44/librehardwaremonitor-api)
  (MIT): how `/data.json` is read, ported to JavaScript (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- [Libre Hardware Monitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
  (MPL-2.0): the program on the PC; none of its code is here.
- [gladys-portainer](https://github.com/LM1LC3N7/gladys-portainer): the
  structure of the app, the state budget and the retry policy.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
