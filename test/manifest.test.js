// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, POLL_INTERVALS, SENSOR_SETS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

test('the store basics; version 0.1.0 set by hand everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(pkg.version, '0.1.0');
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(
    manifest.docker_image,
    `ghcr.io/lm1lc3n7/gladys-libre-hardware-monitor:${manifest.version}`,
  );
  assert.equal(pkg.name, 'gladys-libre-hardware-monitor');
  assert.equal(lock.name, 'gladys-libre-hardware-monitor');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.cover_image, /LM1LC3N7\/gladys-libre-hardware-monitor\/main\/cover\.png$/);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
  assert.match(read('docs/en.md'), /never been tested with a real PC/i);
  assert.match(read('docs/fr.md'), /jamais été testée avec un vrai PC/i);
  assert.match(read('README.md'), /Never tested with a real PC/i);
});

test('the license and the notices ship in the image', () => {
  assert.match(read('LICENSE'), /Apache License[\s\S]*Version 2\.0/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /librehardwaremonitor-api[\s\S]*MIT License/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /Copyright \(c\) 2025 Sab44/);
  assert.match(dockerfile, /COPY[^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code; the password is a secret, never "encrypted"', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.poll_interval.options.map((o) => o.value),
    POLL_INTERVALS,
  );
  assert.deepEqual(
    fields.sensor_set.options.map((o) => o.value).sort(),
    Object.values(SENSOR_SETS).sort(),
  );
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'url',
    'auth_section',
    'username',
    'password',
    'sensors_section',
    'sensor_set',
    'poll_interval',
  ]);
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.password.required, false);
  assert.equal(fields.username.required, false);
  assert.match(
    fields.password.description.en,
    /Kept by Gladys in its database, never shown again, sent only to Libre Hardware Monitor/,
  );
  assert.match(
    fields.password.description.fr,
    /Gardé par Gladys dans sa base, jamais réaffiché, envoyé seulement à Libre Hardware Monitor/,
  );
  assert.match(fields.auth_section.description.en, /in clear/, 'the risk of http is said');
  assert.match(fields.auth_section.description.fr, /en clair/);
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffr[ée]|encrypted/i, `${file}: a secret is not encrypted`);
  }
});

test('sections store nothing; links https', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `${section.key}: ${text.length} characters`);
    }
  }
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  // Read only: no command, no scene action, no trigger, no widget.
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
  assert.ok(!handlers.includes('onSetValue('));
  for (const handler of ['onScanRequest(', 'onConfigUpdated(', 'onDeviceCreated(']) {
    assert.ok(handlers.includes(handler), handler);
  }
});

test('placeholders are multi-language objects', () => {
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
    assert.ok(field.placeholder.en && field.placeholder.fr, field.key);
  }
});
