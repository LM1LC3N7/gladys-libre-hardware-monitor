# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-20

### Added

- First version: the sensors of a Windows PC read through the web server of
  Libre Hardware Monitor (`/data.json`), read only. One Gladys device per
  piece of hardware (CPU, GPU, motherboard, memory, disks, network cards...)
  with one feature per sensor, and one device for the PC whose "Online" tells
  whether it answers.
- Sensors offered in Discovery: the essential ones (temperatures, loads,
  fans, power) or all of them; a device published again keeps every feature
  already created.
- Reading every 30 s, 1 min (default), 2 or 5 min; only the changed values of
  the created features are sent, 250 per minute at most, the oldest first.
- Optional HTTP Basic authentication of the web server; a refused password
  is never tried again without a user action, and is never written to the
  logs nor to `/data`.
- Libre Hardware Monitor 0.9.7 and later (raw values) as well as older
  versions (formatted values, decimal comma, Fahrenheit display).
- "Test the connection" button.
- "Online" of the PC is 0 only when nothing answers (no connection, timeout,
  or 502 / 503 / 504 from a reverse proxy whose PC is off); an answer in error
  (a refused password, another program on the port, a 500) keeps it at 1.
- An HTTP 429 or a server error pauses the readings for at least the reading
  interval, also across a restart of the integration; a reconnection to
  Gladys never reads the PC again before the interval, even while a reading
  is in flight.
- The 250 states per minute hold when several publications start at once or
  when Gladys refuses part of them.

### Security

- A refused password is remembered as a slow salted hash (scrypt), never the
  password itself.

[Unreleased]: https://github.com/LM1LC3N7/gladys-libre-hardware-monitor/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-libre-hardware-monitor/releases/tag/v0.1.1
