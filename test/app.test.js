// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Libre Hardware
// Monitor, through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GladysApiError } from '@gladysassistant/integration-sdk';
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
    request: (...args) => lhm.request(...args),
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
  assert.equal(last(gladys, ONLINE), 1, 'the PC answered (with a refusal): it is on');
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

// --- Review 1 -------------------------------------------------------------------

test('HTTP 429: the pause is never shorter than the reading interval', async () => {
  for (const headers of [{}, { 'retry-after': '1' }, { 'retry-after': '90' }]) {
    const lhm = createFakeLhm();
    lhm.failures.push({ status: 429, headers });
    const ctx = await setup({ lhm, config: { poll_interval: '300' } });
    assert.deepEqual(ctx.timers.delays(), [300_000], JSON.stringify(headers));
    await running.stop();
  }
});

test('a server error without Retry-After is kept in /data: a restart does not read at once', async () => {
  const lhm = createFakeLhm();
  lhm.down = { status: 503 };
  const ctx = await setup({ lhm, config: { poll_interval: '300' } });
  assert.deepEqual(ctx.timers.delays(), [300_000]);
  await running.stop();
  ctx.clock.now += 5_000;
  const again = await setup({ lhm, dataDir: ctx.dataDir, config: { poll_interval: '300' } });
  assert.equal(lhm.requests.length, 1, 'not read again after the restart');
  assert.match(again.gladys.fake.connectionStatus.message.en, /server error \(HTTP 503\)/);
  // Back to normal: the pause is forgotten.
  lhm.down = null;
  await next(again);
  assert.equal(again.gladys.fake.connectionStatus.connected, true);
  const store = JSON.parse(readFileSync(join(ctx.dataDir, STORE_FILE), 'utf8'));
  assert.deepEqual(
    Object.keys(store.meta).filter((k) => k.startsWith('pause')),
    [],
  );
});

test('Gladys reconnects while a reading is in flight: no second reading before the interval', async () => {
  const ctx = await setup();
  const { app, gladys, lhm, timers } = ctx;
  const releases = [];
  lhm.request = async (url) => {
    lhm.requests.push({ url });
    return new Promise((_, reject) => releases.push(() => reject(unreachable())));
  };
  ctx.clock.now += 60_000;
  const [timer] = timers.pending.values();
  timers.pending.delete(timer.id);
  const inFlight = timer.fn(); // the reading leaves, the PC does not answer yet
  await new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 3; i += 1) {
    ctx.clock.now += 1_000;
    await app.stop();
    await app.start(gladys.fake.config);
  }
  assert.equal(lhm.requests.length, 2, 'the first reading and the one in flight only');
  assert.deepEqual(timers.delays(), [57_000], 'the interval counted from the reading in flight');
  assert.equal(gladys.fake.connectionStatus.connected, true, 'the status is published again');
  for (const release of releases) release();
  await inFlight;
  // A later reconnection keeps the wait of that failure.
  ctx.clock.now += 1_000;
  await app.start(gladys.fake.config);
  assert.equal(lhm.requests.length, 2);
});

/** Two CPUs of 180 cores, every value different. */
function bigTree() {
  const make = (id) => ({
    hardwareId: id,
    name: id,
    image: 'cpu',
    sensors: Array.from({ length: 180 }, (_, i) => ({
      id: `${id}/load/${i}`,
      text: `Core #${i}`,
      type: 'Load',
      value: 10 + (i % 50),
    })),
  });
  return lhmTree({ hardware: [make('/cpu-a/0'), make('/cpu-b/0')] });
}

test('state budget: two publications at once never both spend it', async () => {
  const tree = bigTree();
  const data = parseData(tree);
  const ctx = await setup({ lhm: createFakeLhm({ tree }), created: [COMPUTER] });
  const { app, gladys } = ctx;
  const before = gladys.fake.states.length;
  const a = device('cpu-a-0', SENSOR_SETS.ALL, data);
  const b = device('cpu-b-0', SENSOR_SETS.ALL, data);
  gladys.devices = [...gladys.devices, a];
  const first = app.deviceChanged(a);
  gladys.devices = [...gladys.devices, b];
  const second = app.deviceChanged(b);
  await Promise.all([first, second]);
  assert.ok(before + 360 > LIMITS.STATES_PER_MINUTE, 'more values than the budget');
  assert.ok(gladys.fake.states.length <= LIMITS.STATES_PER_MINUTE);
  assert.equal(app.budget.used(), gladys.fake.states.length);
});

test('state budget: a failed batch counts as sent', async () => {
  const tree = bigTree();
  const data = parseData(tree);
  const ctx = await setup({
    lhm: createFakeLhm({ tree }),
    created: [COMPUTER],
    config: { poll_interval: '30' },
  });
  const { app, gladys } = ctx;
  const route = gladys.fake.route.bind(gladys.fake);
  let posts = 0;
  gladys.fake.route = (method, path, body) => {
    if (method === 'POST' && path === '/state') {
      posts += 1;
      if (posts === 3) throw new GladysApiError(503, 'UNAVAILABLE', 'busy');
    }
    return route(method, path, body);
  };
  const start = gladys.fake.states.length;
  const a = device('cpu-a-0', SENSOR_SETS.ALL, data);
  const b = device('cpu-b-0', SENSOR_SETS.ALL, data);
  gladys.devices = [...gladys.devices, a, b];
  await app.deviceChanged(a); // batches of 100: the 1st and 2nd taken, the 3rd fails
  for (const hardware of tree.Children[0].Children) {
    for (const group of hardware.Children) for (const s of group.Children) s.RawValue += 1;
  }
  await next(ctx); // 30 s later: values changed
  assert.ok(
    gladys.fake.states.length - start <= LIMITS.STATES_PER_MINUTE,
    `${gladys.fake.states.length - start} states taken within 30 s`,
  );
});

test('"Online" stays 1 when the PC answers with an error; 0 only without an answer', async () => {
  const lhm = createFakeLhm();
  const ctx = await setup({ lhm });
  lhm.failures.push({ status: 404 });
  await next(ctx);
  assert.equal(last(ctx.gladys, ONLINE), 1);
  assert.equal(badge(ctx.gladys, COMPUTER.external_id), 'local');
  assert.equal(badge(ctx.gladys, device('amdcpu-0').external_id), 'unreachable');
  lhm.failures.push(unreachable());
  await next(ctx);
  assert.equal(last(ctx.gladys, ONLINE), 0);
  // A reconnection during the wait keeps it.
  await ctx.app.start(ctx.gladys.fake.config);
  assert.equal(last(ctx.gladys, ONLINE), 0);
});

test('blocked by a 401: a reconnection still shows the last reading in Discovery', async () => {
  const lhm = createFakeLhm();
  const ctx = await setup({ lhm });
  lhm.credentials = { username: USERNAME, password: PASSWORD };
  await next(ctx);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /asks for a user name/);
  const discoveries = ctx.gladys.fake.bodies('POST', '/discovered_device').length;
  await ctx.app.start(ctx.gladys.fake.config);
  assert.equal(lhm.requests.length, 2, 'not tried again');
  assert.equal(ctx.gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
});

test('the refusal key is a slow salted hash, never the password', async () => {
  const lhm = createFakeLhm({ credentials: { username: USERNAME, password: 'other' } });
  const ctx = await setup({ lhm, config: { username: USERNAME, password: PASSWORD } });
  const store = JSON.parse(readFileSync(join(ctx.dataDir, STORE_FILE), 'utf8'));
  const [key] = Object.values(store.refusals);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, await ctx.app.refusalKey(ctx.app.config));
});

test('behind a reverse proxy: 502 / 503 / 504 mean the PC does not answer; 401 or 500 that it does', async () => {
  for (const [status, online] of [
    [502, 0],
    [503, 0],
    [504, 0],
    [500, 1],
    [401, 1],
  ]) {
    const lhm = createFakeLhm();
    const ctx = await setup({ lhm, config: { url: 'https://lhm.example.org/pc' } });
    assert.equal(lhm.requests[0].url, 'https://lhm.example.org:443/pc/data.json');
    lhm.failures.push({ status });
    await next(ctx);
    assert.equal(last(ctx.gladys, ONLINE), online, `HTTP ${status}`);
    assert.equal(
      badge(ctx.gladys, COMPUTER.external_id),
      online ? 'local' : 'unreachable',
      `HTTP ${status}`,
    );
    assert.equal(badge(ctx.gladys, device('amdcpu-0').external_id), 'unreachable');
    if (status !== 401) {
      // A reconnection during the wait keeps it.
      await ctx.app.start(ctx.gladys.fake.config);
      assert.equal(last(ctx.gladys, ONLINE), online, `HTTP ${status}, reconnection`);
    }
    await running.stop();
  }
});
