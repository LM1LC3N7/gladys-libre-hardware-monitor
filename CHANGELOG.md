# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-libre-hardware-monitor/commits/main
