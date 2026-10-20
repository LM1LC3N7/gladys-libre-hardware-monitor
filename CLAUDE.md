# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It reads the sensors of a Windows PC from the web server of Libre Hardware
Monitor (`GET /data.json`), read only.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "budget"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # regenerate cover.png (plain Node)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers the handlers)
src/handlers.js                   every SDK handler, wired to the app (shared with the tests)
src/app.js                        LhmApp: lifecycle, reading loop, states, badges, status
src/lhm/client.js                 GET /data.json, optional Basic authentication
src/lhm/http.js                   the only network access (node:http / https, caps, no redirect)
src/lhm/parse.js                  the sensor tree -> plain objects (pure, bounded, no recursion)
src/lhm/errors.js                 LhmError, refusal of the credentials (401)
src/budget.js                     the states-per-minute window (300/min limit of Gladys)
src/store.js                      /data: refusal (salted HMAC), 429 pause (never the password)
src/devices.js                    the Gladys devices, units, external ids (pure)
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js, src/i18n.js     keys, limits, timings; runtime texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: SDK fake Gladys, fake Libre Hardware Monitor, loopback server
scripts/cover.mjs                 generates cover.png (plain Node)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

Rules of this integration (TODO.md, "Decisions"): read only (no
`onSetValue`, no button, no switch); only the units the core lists for the
category, the rest `unknown` with the unit in the name; never an energy
`index`/`energy` feature; a device published again keeps every created
feature; states only for created features, changes only, 250 per minute,
oldest first; never a reading faster than the interval (retries, a
reconnection to Gladys, the scan button); a 401 is final and remembered by a
salted HMAC, never the password; a 429 pause is kept in `/data` and bounded.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device, never a label. Here: the `HardwareId` and
  `SensorId` of Libre Hardware Monitor, formatted like librehardwaremonitor-api.
  Gladys keys devices, their history, scenes and dashboards on them: changing
  one creates a new device and orphans the old one. The same goes for every
  key users store: manifest `config_schema`, `actions`, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log the user name, the password or the
  Authorization header.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set by hand once, before the first release).
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together. A secret field is described as kept by Gladys in its database and
  never shown again, never as encrypted (it is not).
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
