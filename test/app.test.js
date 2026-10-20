// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Libre Hardware
// Monitor, through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LhmApp } from '../src/app.js';
import { ACTIONS, INTERVALS, LIMITS, SENSOR_SETS, STORE_FILE } from '../src/constants.js';
import { buildComputerDevice, buildHardwareDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { parseData } from '../src/lhm/parse.js';
import {
  PASSWORD,
  USERNAME,
  createFakeLhm,
  defaultHardware,
  lhmTree,
  setValue,
  unreachable,
} from './helpers/fakeLhm.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-20T08:00:00Z');
const SELECTOR = 'libre-hardware-monitor';
const ids = createFakeGladys({ selector: SELECTOR });
const DATA = parseData(lhmTree());
const hardware = (id, data = DATA) => data.hardware.find((h) => h.id === id);
const device = (id, sensorSet = SENSOR_SETS.ALL, data = DATA) =>
  buildHardwareDevice(ids, data.computer, hardware(id, data), { sensorSet });
const COMPUTER = buildComputerDevice(ids, 'GAMING');
const ONLINE = COMPUTER.features[0].external_id;
const fid = (hardwareId, key) => ids.externalIds('hardware', hardwareId).feature(key);
const BASE_CONFIG = { url: '192.168.1.20' };

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({
  config = {},
  created = [COMPUTER, device('amdcpu-0'), device('motherboard')],
  lhm,
  dataDir,
} = {}) {
  const clock = { now: T0 };
  lhm ??= createFakeLhm();
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: created,
  });
  const timers = createFakeTimers();
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  dataDir ??= mkdtempSync(join(tmpdir(), 'lhm-app-'));
  const app = new LhmApp({
    gladys,
    logger,
    request: lhm.request,
    dataDir,
    now: () => clock.now,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  return { gladys, lhm, timers, clock, logs, app, dataDir };
}

/** Let the clock reach the next timer, and run it. */
async function next(ctx) {
  const delay = Math.min(...ctx.timers.delays());
  ctx.clock.now += delay;
  await ctx.timers.run((ms) => ms === delay);
  return delay;
}

const last = (gladys, id) => gladys.fake.lastState(id);
const badge = (gladys, externalId) =>
  gladys.fake.transports.filter((t) => t.device_external_id === externalId).at(-1)?.transport;

test('start: Discovery, states of the created features, badges, status', async () => {
  const { gladys, lhm, timers } = await setup();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Libre Hardware Monitor 0.9.7 answers: GAMING, 4 pieces of hardware, 11 sensors.',
      fr: 'Libre Hardware Monitor 0.9.7 répond : GAMING, 4 matériels, 11 capteurs.',
    },
  });
  assert.deepEqual(
    lhm.requests.map((r) => r.url),
    ['http://192.168.1.20:8085/data.json'],
  );
  assert.deepEqual(lhm.requests[0].headers, {}, 'no Authorization header without credentials');
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name, d.features.length]),
    [
      [`ext:${SELECTOR}:computer:pc`, 'GAMING (Libre Hardware Monitor)', 1],
      [`ext:${SELECTOR}:hardware:motherboard`, 'MSI MAG B650M MORTAR WIFI (MS-7D76) (GAMING)', 4],
      [`ext:${SELECTOR}:hardware:amdcpu-0`, 'AMD Ryzen 7 7800X3D (GAMING)', 4],
      [`ext:${SELECTOR}:hardware:ram`, 'Total Memory (GAMING)', 1],
    ],
    'essentials, plus the features of the created devices; the NIC has no essential sensor',
  );
  assert.equal(last(gladys, ONLINE), 1);
  assert.equal(last(gladys, fid('amdcpu-0', 'amdcpu-0-temperature-2')), 61.4);
  assert.equal(last(gladys, fid('amdcpu-0', 'amdcpu-0-load-0')), 9);
  assert.equal(last(gladys, fid('amdcpu-0', 'amdcpu-0-clock-1')), 4463);
  assert.equal(last(gladys, fid('motherboard', 'lpc-nct6687d-0-voltage-0')), 12.072);
  assert.equal(last(gladys, fid('ram', 'ram-load-0')), undefined, 'not created: nothing');
  assert.equal(badge(gladys, COMPUTER.external_id), 'local');
  assert.equal(badge(gladys, device('amdcpu-0').external_id), 'local');
  assert.deepEqual(timers.delays(), [60_000]);
});

test('the loop: changed values only, at the interval', async () => {
  const ctx = await setup({ config: { poll_interval: '30' } });
  const { gladys, lhm } = ctx;
  const count = gladys.fake.states.length;
  setValue(lhm.tree, '/amdcpu/0/temperature/2', 70.04);
  assert.equal(await next(ctx), 30_000);
  assert.equal(lhm.requests.length, 2);
  assert.equal(last(gladys, fid('amdcpu-0', 'amdcpu-0-temperature-2')), 70);
  assert.equal(gladys.fake.states.length, count + 1, 'only the value that changed');
  setValue(lhm.tree, '/amdcpu/0/temperature/2', 70.02);
  await next(ctx);
  assert.equal(gladys.fake.states.length, count + 1, 'the same value once rounded: nothing');
});

test('the PC does not answer: Online 0, badges, retries from the interval to 5 min, then back', async () => {
  const ctx = await setup();
  const { gladys, lhm, timers } = ctx;
  lhm.down = unreachable();
  await next(ctx);
  assert.equal(last(gladys, ONLINE), 0);
  assert.equal(badge(gladys, COMPUTER.external_id), 'unreachable');
  assert.equal(badge(gladys, device('amdcpu-0').external_id), 'unreachable');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer.*no connection.*1 min/);
  assert.deepEqual(timers.delays(), [60_000], 'never sooner than the interval');
  assert.equal(await next(ctx), 60_000);
  assert.equal(await next(ctx), 120_000);
  assert.equal(await next(ctx), 240_000);
  assert.equal(await next(ctx), INTERVALS.RETRY_MAX_MS);
  assert.deepEqual(timers.delays(), [INTERVALS.RETRY_MAX_MS]);
  lhm.down = null;
  await next(ctx);
  assert.equal(last(gladys, ONLINE), 1);
  assert.equal(badge(gladys, COMPUTER.external_id), 'local');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(timers.delays(), [60_000]);
});

test('a reconnection to Gladys keeps the wait of a failed reading', async () => {
  const ctx = await setup();
  const { app, gladys, lhm, timers } = ctx;
  lhm.down = unreachable();
  await next(ctx);
  await next(ctx); // 2 failures: the next wait is 2 min
  const requests = lhm.requests.length;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  ctx.clock.now += 10_000;
  await app.start(gladys.fake.config);
  assert.equal(lhm.requests.length, requests, 'not read again sooner');
  assert.deepEqual(timers.delays(), [110_000]);
  assert.equal(last(gladys, ONLINE), 0);
  assert.equal(
    gladys.fake.bodies('POST', '/discovered_device').length,
    discoveries + 1,
    'Discovery published again from the last reading',
  );
  assert.equal(badge(gladys, COMPUTER.external_id), 'unreachable');
});

test('a reconnection to Gladys: status and Discovery again, the PC not read sooner', async () => {
  const ctx = await setup();
  const { app, gladys, lhm, timers } = ctx;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  const statuses = gladys.fake.connectionStatuses.length;
  ctx.clock.now += 20_000;
  await app.start(gladys.fake.config);
  assert.equal(lhm.requests.length, 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.deepEqual(timers.delays(), [40_000]);
  await next(ctx);
  assert.equal(lhm.requests.length, 2);
});

test('the scan button publishes Discovery without reading the PC', async () => {
  const { gladys, lhm } = await setup();
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(lhm.requests.length, 1);
});

test('a sensor gone, or another sensor set: the created features stay in Discovery', async () => {
  const hardwareList = defaultHardware();
  const lhm = createFakeLhm({ tree: lhmTree({ hardware: hardwareList }) });
  const ctx = await setup({ lhm });
  hardwareList[1].sensors = hardwareList[1].sensors.filter((s) => s.type !== 'Clock');
  lhm.tree = lhmTree({ hardware: hardwareList });
  const discoveries = ctx.gladys.fake.bodies('POST', '/discovered_device').length;
  await next(ctx);
  assert.equal(
    ctx.gladys.fake.bodies('POST', '/discovered_device').length,
    discoveries + 1,
    'the change is published',
  );
  const cpu = ctx.gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(':amdcpu-0'));
  assert.ok(cpu.features.some((f) => f.external_id === fid('amdcpu-0', 'amdcpu-0-clock-1')));
});

test('a device created later gets its values at once, without reading the PC', async () => {
  const { gladys, lhm } = await setup({ created: [] });
  assert.equal(gladys.fake.states.length, 0);
  assert.deepEqual(gladys.fake.transports, []);
  const ram = gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(':ram'));
  await gladys.fake.deviceCreated(ram);
  await gladys.fake.deviceCreated(COMPUTER);
  assert.equal(last(gladys, fid('ram', 'ram-load-0')), 41);
  assert.equal(last(gladys, ONLINE), 1);
  assert.equal(badge(gladys, ram.external_id), 'local');
  assert.equal(lhm.requests.length, 1);
});

test('250 states per minute at most: the oldest values first, all of them in turn', async () => {
  // Two CPUs of 150 cores (a device offers 200 features at most).
  const big = [0, 1].map((n) => ({
    hardwareId: `/big/${n}`,
    name: `Big CPU #${n}`,
    image: 'cpu',
    sensors: Array.from({ length: 150 }, (_, i) => ({
      id: `/big/${n}/load/${i}`,
      text: `Core #${i}`,
      type: 'Load',
      value: 10,
    })),
  }));
  const tree = lhmTree({ hardware: big });
  const data = parseData(tree);
  const ctx = await setup({
    lhm: createFakeLhm({ tree }),
    config: { poll_interval: '30' },
    created: [
      COMPUTER,
      device('big-0', SENSOR_SETS.ALL, data),
      device('big-1', SENSOR_SETS.ALL, data),
    ],
  });
  const { gladys } = ctx;
  assert.equal(gladys.fake.states.length, LIMITS.STATES_PER_MINUTE);
  await next(ctx); // +30 s: the minute is used
  assert.equal(gladys.fake.states.length, LIMITS.STATES_PER_MINUTE);
  await next(ctx); // +60 s: the rest
  assert.equal(gladys.fake.states.length, 301);
  const published = new Set(gladys.fake.states.map((s) => s.device_feature_external_id));
  assert.equal(published.size, 301, 'every sensor, and Online');
});

test('authentication asked (401) without credentials: final until the configuration is saved', async () => {
  const lhm = createFakeLhm({ credentials: { username: USERNAME, password: PASSWORD } });
  const ctx = await setup({ lhm });
  const { app, gladys, timers } = ctx;
  assert.match(gladys.fake.connectionStatus.message.en, /asks for a user name and a password/);
  assert.deepEqual(timers.delays(), [], 'never retried alone');
  assert.equal(last(gladys, ONLINE), 0);
  await app.start(gladys.fake.config); // a reconnection to Gladys
  assert.equal(lhm.requests.length, 1, 'not tried again');
  await gladys.fake.configUpdated({ ...BASE_CONFIG, username: USERNAME, password: PASSWORD });
  assert.equal(lhm.requests.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(last(gladys, ONLINE), 1);
});

test('a refused password: never retried alone, even after a restart; never written anywhere', async () => {
  const lhm = createFakeLhm({ credentials: { username: USERNAME, password: 'other' } });
  const ctx = await setup({ lhm, config: { username: USERNAME, password: PASSWORD } });
  const { gladys, dataDir, logs } = ctx;
  assert.match(gladys.fake.connectionStatus.message.en, /refused the user name or the password/);
  await running.stop();
  // The container restarts: the refusal is in /data.
  const again = await setup({ lhm, dataDir, config: { username: USERNAME, password: PASSWORD } });
  assert.equal(lhm.requests.length, 1, 'not tried again');
  assert.match(again.gladys.fake.connectionStatus.message.en, /refused/);
  // "Test the connection" tries again (the user asked).
  const ack = await again.gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, false);
  assert.equal(lhm.requests.length, 2);
  // The password is nowhere: logs, /data, what Gladys received.
  const store = readFileSync(join(dataDir, STORE_FILE), 'utf8');
  for (const text of [
    store,
    logs.join('\n'),
    again.logs.join('\n'),
    JSON.stringify(gladys.fake.requests),
    JSON.stringify(again.gladys.fake.requests),
  ]) {
    assert.ok(!text.includes(PASSWORD), 'password leaked');
    assert.ok(!text.includes(Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')));
  }
});

test('HTTP 429: a bounded pause kept in /data, lifted only by the user', async () => {
  const lhm = createFakeLhm();
  lhm.failures.push({ status: 429, headers: { 'retry-after': '600' } });
  const ctx = await setup({ lhm });
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /slow down.*10 min/);
  assert.deepEqual(ctx.timers.delays(), [600_000]);
  await running.stop();
  ctx.clock.now += 60_000;
  const again = await setup({ lhm, dataDir: ctx.dataDir });
  assert.equal(lhm.requests.length, 1, 'paused after a restart too');
  assert.match(again.gladys.fake.connectionStatus.message.en, /slow down/);
  const ack = await again.gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.message, {
    en: 'Connected: GAMING, 4 pieces of hardware, 11 sensors.',
    fr: 'Connecté : GAMING, 4 matériels, 11 capteurs.',
  });
  assert.equal(lhm.requests.length, 2);
});

test('a pause read from /data is bounded', async () => {
  const lhm = createFakeLhm();
  lhm.failures.push({ status: 429, headers: { 'retry-after': '99999999' } });
  const ctx = await setup({ lhm });
  assert.deepEqual(ctx.timers.delays(), [INTERVALS.BUSY_MAX_MS]);
});

test('not Libre Hardware Monitor, a server error: said, retried', async () => {
  const lhm = createFakeLhm();
  lhm.failures.push({ status: 404 });
  const ctx = await setup({ lhm });
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /does not answer like the web server/);
  lhm.failures.push({ status: 200, body: '{"a":1}' });
  await next(ctx);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /does not answer like the web server/);
  lhm.failures.push({ status: 503 });
  await next(ctx);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /server error \(HTTP 503\)/);
});

test('configuration errors: said, nothing read', async () => {
  for (const [config, pattern] of [
    [{ url: '' }, /Type the address/],
    [{ url: 'http://a:b@pc' }, /Remove the user name and password/],
    [{ url: 'ftp://pc' }, /not valid/],
    [{ username: USERNAME }, /both the user name and the password/],
    [{ username: 'a:b', password: 'x' }, /may not hold a colon/],
  ]) {
    const lhm = createFakeLhm();
    const { gladys } = await setup({ lhm, config });
    assert.match(gladys.fake.connectionStatus.message.en, pattern);
    assert.equal(lhm.requests.length, 0);
    assert.deepEqual(gladys.fake.transports, [], 'unknown: no badge');
    await running.stop();
  }
});

test('no sensor shown: said', async () => {
  const lhm = createFakeLhm({ tree: lhmTree({ hardware: [] }) });
  const { gladys } = await setup({ lhm });
  assert.match(gladys.fake.connectionStatus.message.en, /run it as administrator/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('read only: a command on a feature is refused by the SDK, nothing is sent to the PC', async () => {
  const { gladys, lhm } = await setup();
  const cpu = device('amdcpu-0');
  const ack = await gladys.fake.setValue(cpu, cpu.features[0], 1);
  assert.notEqual(ack?.success, true);
  assert.equal(lhm.requests.length, 1);
});
