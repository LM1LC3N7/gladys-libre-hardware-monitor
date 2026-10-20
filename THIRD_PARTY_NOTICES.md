# Third-party notices

This integration ports to JavaScript the way the project below reads the web
server of Libre Hardware Monitor: `GET /data.json` with optional HTTP Basic
authentication, the computer as the first child of the root, one device per
main hardware, the hardware and sensor ids made of the `HardwareId` and
`SensorId` paths without their first slash, joined by dashes, every other
character than `[A-Za-z0-9_-]` dropped (the hardware id taken from the first
sensor before Libre Hardware Monitor 0.9.5), the formatted values read up to
their first space with a decimal comma made a point, the `RawValue` numbers
of 0.9.7 (bytes for `Data`, bytes per second for `Throughput`, seconds for
`TimeSpan`), the `HH:MM:SS` time spans, the sensor names completed with their
type ("Speed" for a fan, "Capacity" for an energy) and the list of sensor
types. Nothing of it is installed at runtime: it is Python, this integration
is JavaScript (`src/lhm/client.js`, `src/lhm/parse.js`, `src/devices.js`).
The test data of `test/helpers/fakeLhm.js` are written by hand in the format
of its test fixtures; no fixture is copied.

## librehardwaremonitor-api

<https://github.com/Sab44/librehardwaremonitor-api> (read at commit
`95ddf8e`, version 1.12.1 of 2026-10-09), the library the Home Assistant
integration of Libre Hardware Monitor uses.

```
The MIT License (MIT)

Copyright (c) 2025 Sab44

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Libre Hardware Monitor

<https://github.com/LibreHardwareMonitor/LibreHardwareMonitor> (Mozilla Public
License 2.0) is the program that runs on the PC; this integration only reads
the JSON its web server serves, and contains none of its code. The names of
the sensor types mirror its `SensorType` enumeration.

## LM1LC3N7/gladys-portainer

The structure of the app, the handler wiring, the state budget, the store of
`/data` and the retry and pause policy follow this integration of the same
author, under the Apache License 2.0 of this repository.
