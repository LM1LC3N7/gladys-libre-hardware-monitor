// -----------------------------------------------------------------------------
// The configuration: the address, the optional Basic authentication, defaults.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseCredentials, parseLhmUrl } from '../src/config.js';

test('the address: bare host on 8085, schemes like a browser, a path kept', () => {
  const base = (value) => parseLhmUrl(value).base ?? parseLhmUrl(value).error;
  assert.equal(base('192.168.1.20'), 'http://192.168.1.20:8085');
  assert.equal(base(' 192.168.1.20:8086 '), 'http://192.168.1.20:8086');
  assert.equal(base('PC-Salon.local'), 'http://pc-salon.local:8085');
  assert.equal(base('http://192.168.1.20'), 'http://192.168.1.20:80');
  assert.equal(base('http://192.168.1.20:80'), 'http://192.168.1.20:80');
  assert.equal(base('https://lhm.example.org/pc/'), 'https://lhm.example.org:443/pc');
  assert.equal(base('http://192.168.1.20:8085/data.json'), 'http://192.168.1.20:8085');
  assert.equal(base('[fe80::1]:8085'), 'http://[fe80::1]:8085');
  assert.equal(base(''), 'empty');
  assert.equal(base(undefined), 'empty');
  assert.equal(base('http://user:pass@192.168.1.20'), 'credentials');
  assert.equal(base('ftp://192.168.1.20'), 'invalid');
  assert.equal(base('192.168.1.20:8085/?x=1'), 'invalid');
  assert.equal(base('192.168.1.20:99999'), 'invalid');
  assert.equal(base('http://192.168.1.20/a b'), 'invalid');
});

test('Basic authentication: both or none, a colon refused in the user name', () => {
  assert.deepEqual(parseCredentials('', ''), { credentials: null, error: null });
  assert.deepEqual(parseCredentials(undefined, undefined), { credentials: null, error: null });
  assert.deepEqual(parseCredentials(' admin ', ' pass word '), {
    credentials: { username: 'admin', password: ' pass word ' },
    error: null,
  });
  assert.equal(parseCredentials('admin', '').error, 'incomplete');
  assert.equal(parseCredentials('', 'secret').error, 'incomplete');
  assert.equal(parseCredentials('ad:min', 'secret').error, 'invalid');
  assert.equal(parseCredentials('admin', 'sec\nret').error, 'invalid');
  assert.equal(parseCredentials('admin', 'x'.repeat(2000)).error, 'invalid');
});

test('defaults and choices', () => {
  const config = normalizeConfig({ url: '192.168.1.20' });
  assert.equal(config.sensorSet, DEFAULTS.sensor_set);
  assert.equal(config.intervalMs, 60_000);
  assert.equal(config.credentials, null);
  assert.equal(normalizeConfig({ poll_interval: '30' }).intervalMs, 30_000);
  assert.equal(normalizeConfig({ poll_interval: '1' }).intervalMs, 60_000, 'unknown: default');
  assert.equal(normalizeConfig({ sensor_set: 'all' }).sensorSet, 'all');
  assert.equal(normalizeConfig({ sensor_set: 'x' }).sensorSet, 'essentials');
  assert.equal(normalizeConfig(null).urlError, 'empty');
});
