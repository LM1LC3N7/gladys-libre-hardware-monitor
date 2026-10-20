// -----------------------------------------------------------------------------
// LhmApp: the integration. One PC, its Libre Hardware Monitor web server.
//
//   start(config)  (re)connects: /data.json read, Discovery published, loop
//                  started
//   loop           every `poll_interval` s: /data.json -> the states of the
//                  created features (within 250 states per minute, the oldest
//                  values first), "Online" of the PC, the transport badges;
//                  while the PC does not answer: "Online" 0, retries from the
//                  reading interval up to 5 min (HTTP 429: a pause of 1 min to
//                  6 h, Retry-After honoured, kept in /data)
//
// Read only: nothing is ever sent to the PC but GET /data.json. The loop is
// one chain of timers: halt() bumps an epoch, and a run of an older epoch
// (still in flight when the configuration changed) never schedules itself
// again. A user name / password refused (HTTP 401) is final: the loop stops,
// the status says what to fix; nothing is sent again until the configuration
// is saved or "Test the connection" is pressed. A reconnection to Gladys
// (`connected`) publishes the status and Discovery again, keeps the pause,
// the refusal and the wait of a failed reading, and never reads the PC
// sooner than the interval.
// -----------------------------------------------------------------------------

import { scrypt } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '@gladysassistant/integration-sdk';
import { Budget } from './budget.js';
import { normalizeConfig } from './config.js';
import { FEATURES, INTERVALS, LIMITS, STORE_FILE } from './constants.js';
import {
  buildComputerDevice,
  buildHardwareDevice,
  computerIds,
  createdDevices,
  featureIdsOf,
  featureValue,
  hardwareIds,
  parseExternalId,
  withCreatedFeatures,
} from './devices.js';
import { T } from './i18n.js';
import { Store } from './store.js';
import { LhmClient } from './lhm/client.js';
import { CODES, isAuthRefused } from './lhm/errors.js';
import { httpRequest } from './lhm/http.js';

/** The "Test the connection" button waits 30 s: answer before. */
const TEST_BUDGET_MS = 25_000;
/** Entries per publishTransports call (the SDK refuses more). */
export const TRANSPORTS_PER_CALL = 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const scryptAsync = promisify(scrypt);
/** scrypt cost of the refusal key: 16 MB, about 50 ms, once per start. */
const SCRYPT = Object.freeze({ N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
/** No answer at all: the PC is off (or unreachable). Anything else: it answered. */
const NO_ANSWER = new Set([CODES.UNREACHABLE, CODES.TIMEOUT]);

export class LhmApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake PC)
   * @param {string} [options.dataDir] the writable volume
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'libre-hardware-monitor' }),
    request = httpRequest,
    dataDir = process.env.DATA_DIR ?? '/data',
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.store = new Store({ filePath: join(dataDir, STORE_FILE), logger });
    this.budget = new Budget({ perMinute: LIMITS.STATES_PER_MINUTE, now });
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.client = null;
    this.generation = 0;
    this.epoch = 0;
    this.handles = new Set();
    this.queue = Promise.resolve();
    /**
     * Kept across a reconnection to Gladys (reset()), for the same address
     * and credentials (in memory only):
     *   retry     the wait after a failed reading (not a 429: that pause is in
     *             the store): { identity, nextReadAt, retryDelay, message }
     *   lastRead  the last reading: { identity, at, data }, so a reconnection
     *             never reads the PC sooner than the interval
     */
    this.retry = null;
    this.lastRead = null;
    /**
     * The last reading SENT (answered or not): { identity, at }. A
     * reconnection to Gladys while it is in flight, or just after, waits for
     * the interval from it.
     */
    this.lastAttempt = null;
    /** The last status sent ({ connected, message }), sent again by a deferred start. */
    this.statusValue = null;
    /** Feature external id -> { value, at }: the last sensor values Gladys accepted. */
    this.published = new Map();
    /** publishStates() calls run one after the other (the budget is computed inside). */
    this.statesQueue = Promise.resolve();
    this.reset();
  }

  reset() {
    // Gladys keeps the status and the Discovery list in memory only: after a
    // restart of the core (a new `connected`), both are published again.
    this.lastStatus = null;
    /** The sensor values of `reading` are current. */
    this.online = false;
    /** The PC answered the last request (even with an error): "Online". */
    this.pcAnswers = false;
    /** Online or not is known (a reading succeeded or failed since the start). */
    this.stateKnown = false;
    this.blocked = false;
    this.pausedUntil = 0;
    this.retryDelay = this.minRetry();
    /** The last parsed reading: { computer, version, hardware }. */
    this.reading = null;
    this.discoveredKey = null;
    this.transports = new Map();
  }

  /** Never read again faster than the interval, even after a failure. */
  minRetry() {
    return Math.max(INTERVALS.RETRY_MIN_MS, this.config.intervalMs);
  }

  maxRetry() {
    return Math.max(INTERVALS.RETRY_MAX_MS, this.config.intervalMs);
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Run `task` after every start / restart already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * (Re)start with a configuration. Calls are serialized. `force`: the user
   * asked (button, saved configuration): refused credentials are tried, a
   * pause or a wait is lifted, the PC is read now.
   */
  start(rawConfig, { force = false } = {}) {
    return this.enqueue(() => this.run(rawConfig, { force }));
  }

  /**
   * The values a refusal is about: a slow, salted hash (scrypt, the salt of
   * /data), never the password. The file holds the salt too: scrypt makes a
   * guess of the password from a copy of /data costly, not impossible
   * (TODO.md, "Decisions").
   */
  async refusalKey(config) {
    const key = await scryptAsync(
      JSON.stringify([
        config.lhm.base,
        config.credentials?.username ?? null,
        config.credentials?.password ?? null,
      ]),
      await this.store.salt(),
      32,
      SCRYPT,
    );
    return key.toString('hex');
  }

  async stop() {
    this.generation += 1;
    this.halt();
    this.dropClient();
  }

  /** Clear every timer; the runs still in flight will not schedule again. */
  halt() {
    this.epoch += 1;
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
  }

  dropClient() {
    this.client?.close();
    this.client = null;
  }

  async run(rawConfig, { force = false } = {}) {
    this.halt();
    this.dropClient();
    const generation = ++this.generation;
    this.rawConfig = rawConfig ?? {};
    const config = normalizeConfig(rawConfig);
    this.config = config;
    this.reset();
    await this.store.load();

    if (config.urlError) {
      const message = { empty: T.status.urlEmpty, credentials: T.status.urlCredentials }[
        config.urlError
      ];
      await this.setStatus(false, message ?? T.status.urlInvalid);
      return;
    }
    if (config.credentialsError) {
      await this.setStatus(
        false,
        config.credentialsError === 'incomplete'
          ? T.status.credentialsIncomplete
          : T.status.credentialsInvalid,
      );
      return;
    }
    const identity = this.identity();
    const { retry, lastRead, lastAttempt } = this;
    // While waiting, Discovery still shows the last reading of this PC
    // (Gladys forgot it when it restarted); nothing is marked online.
    const showLastReading = async () => {
      if (lastRead?.identity !== identity) return;
      this.reading = lastRead.data;
      await this.publishDiscovered();
    };
    // Credentials refused with these very values are not tried again alone.
    const base = config.lhm.base;
    const refused = this.store.get('refusals', base);
    if (refused && refused === (await this.refusalKey(config)) && !force) {
      this.blocked = true;
      this.logger.warn('Credentials refused earlier: not tried again');
      await showLastReading();
      await this.setStatus(false, this.authMessage());
      return;
    }
    if (refused) await this.store.set('refusals', base, null);
    this.client = new LhmClient({
      lhm: config.lhm,
      credentials: config.credentials,
      request: this.request,
    });
    this.logger.info(
      `Using Libre Hardware Monitor at ${config.lhm.origin}${config.credentials ? ' (Basic authentication)' : ''}`,
    );
    // An HTTP 429 or 5xx pause outlives a restart and a reconnection to
    // Gladys (bounded, even when the file says more); only the user lifts it.
    const stored = Number(this.store.get('meta', this.pauseKey())) || 0;
    const pausedUntil = Math.min(stored, this.now() + INTERVALS.BUSY_MAX_MS);
    const reason = Number(this.store.get('meta', this.pauseReasonKey())) || 429;
    if (force && stored) await this.clearPause();
    if (!force && this.now() < pausedUntil) {
      this.pausedUntil = pausedUntil;
      const delay = pausedUntil - this.now();
      await showLastReading();
      await this.setStatus(
        false,
        reason === 429 ? T.status.busy(delay) : T.status.serverError(reason, delay),
      );
      this.schedule(delay, () => this.connect(generation));
      return;
    }
    // A reconnection to Gladys keeps the wait of a failed reading, and its
    // growing delay; only the user skips it.
    if (!force && retry?.identity === identity && this.now() < retry.nextReadAt) {
      this.retryDelay = retry.retryDelay;
      this.pcAnswers = retry.pcAnswers;
      this.stateKnown = true;
      await showLastReading();
      await this.publishStates();
      await this.publishTransports();
      await this.setStatus(false, retry.message);
      this.schedule(retry.nextReadAt - this.now(), () => this.connect(generation));
      return;
    }
    this.retry = null;
    // A reading younger than the interval is used again (a reconnection to
    // Gladys does not read the PC sooner).
    if (!force && lastRead?.identity === identity && this.now() - lastRead.at < config.intervalMs) {
      await this.apply(lastRead.data, { publish: true });
      this.scheduleLoop(lastRead.at + config.intervalMs - this.now(), generation);
      return;
    }
    // A reading was sent less than an interval ago (still in flight when
    // Gladys reconnected, its result dropped): the next one waits for the
    // interval; what was known is shown again meanwhile.
    if (
      !force &&
      lastAttempt?.identity === identity &&
      this.now() - lastAttempt.at < config.intervalMs
    ) {
      await showLastReading();
      if (this.statusValue) {
        await this.setStatus(this.statusValue.connected, this.statusValue.message);
      }
      this.schedule(lastAttempt.at + config.intervalMs - this.now(), () =>
        this.connect(generation),
      );
      return;
    }
    await this.connect(generation);
  }

  /** What a wait is about: the address and the credentials (kept in memory only). */
  identity() {
    return JSON.stringify([
      this.config.lhm?.base,
      this.config.credentials?.username ?? null,
      this.config.credentials?.password ?? null,
    ]);
  }

  pauseKey() {
    return `pausedUntil|${this.config.lhm?.base}`;
  }

  pauseReasonKey() {
    return `pauseReason|${this.config.lhm?.base}`;
  }

  async clearPause() {
    if (this.store.get('meta', this.pauseKey()) !== null) {
      await this.store.set('meta', this.pauseKey(), null);
    }
    if (this.store.get('meta', this.pauseReasonKey()) !== null) {
      await this.store.set('meta', this.pauseReasonKey(), null);
    }
  }

  authMessage() {
    return this.config.credentials ? T.status.authRefused : T.status.authRequired;
  }

  schedule(delay, task) {
    const handle = this.timers.setTimeout(
      async () => {
        this.handles.delete(handle);
        try {
          await task();
        } catch (err) {
          this.logger.error('Loop failed', err);
        }
      },
      Math.max(0, delay),
    );
    this.handles.add(handle);
    return handle;
  }

  /** Schedule the next reading of the current epoch. */
  scheduleLoop(delay, generation) {
    const epoch = this.epoch;
    this.schedule(delay, () => this.poll(generation, epoch));
  }

  /** May a loop of this generation and epoch go on? */
  current(generation, epoch) {
    return generation === this.generation && epoch === this.epoch && !this.blocked;
  }

  /** First reading (Discovery published), then the loop. Never throws. */
  async connect(generation) {
    if (!this.client || generation !== this.generation) return;
    await this.poll(generation, this.epoch, { publish: true });
  }

  /** One reading; schedules the next one, or the retry. Never throws. */
  async poll(generation, epoch, { publish = false } = {}) {
    if (!this.current(generation, epoch) || !this.client) return;
    const client = this.client;
    const identity = this.identity();
    this.lastAttempt = { identity, at: this.now() };
    let data;
    try {
      data = await client.data();
    } catch (err) {
      if (this.current(generation, epoch) && client === this.client) {
        await this.failed(err, generation);
      } else if (identity === this.identity() && !isAuthRefused(err) && !this.retry) {
        // Gladys reconnected meanwhile (same PC, same credentials): the
        // failure still delays the next reading of a later reconnection.
        const delay = this.retryDelay;
        this.retry = {
          identity,
          nextReadAt: this.now() + delay,
          retryDelay: Math.min(delay * 2, this.maxRetry()),
          pcAnswers: !NO_ANSWER.has(err?.code),
          message: this.errorMessage(err, delay),
        };
      }
      return;
    }
    if (identity === this.identity()) this.lastRead = { identity, at: this.now(), data };
    if (!this.current(generation, epoch) || client !== this.client) return;
    await this.apply(data, { publish });
    if (this.current(generation, epoch)) this.scheduleLoop(this.config.intervalMs, generation);
  }

  /** A reading succeeded: Discovery (when asked or changed), states, badges, status. */
  async apply(data, { publish }) {
    const wasOnline = this.online;
    this.reading = data;
    this.online = true;
    this.pcAnswers = true;
    this.stateKnown = true;
    this.retryDelay = this.minRetry();
    this.retry = null;
    this.pausedUntil = 0;
    await this.clearPause();
    if (!wasOnline) {
      this.logger.info(
        `Libre Hardware Monitor answers: ${data.hardware.length} hardware, ${sensorCount(data)} sensor(s)`,
      );
    }
    const key = JSON.stringify([
      this.config.sensorSet,
      data.computer,
      data.hardware.map((h) => [h.id, h.name, h.sensors.map((s) => [s.key, s.type, s.name])]),
    ]);
    if (publish || key !== this.discoveredKey) await this.publishDiscovered();
    this.discoveredKey = key;
    await this.publishStates();
    await this.publishTransports();
    await this.setStatus(true, this.okMessage());
  }

  /** A reading failed: final refusal, or retry with a growing delay. */
  async failed(err, generation) {
    if (generation !== this.generation) return;
    const wasOnline = this.online;
    this.online = false;
    // "Online" is 0 only when nothing answered: a refusal, an error page or
    // an unexpected answer come from a PC that is on.
    this.pcAnswers = !NO_ANSWER.has(err?.code);
    this.stateKnown = true;
    this.halt();
    await this.publishStates();
    await this.publishTransports();
    if (isAuthRefused(err)) {
      this.blocked = true;
      await this.store.set('refusals', this.config.lhm.base, await this.refusalKey(this.config));
      this.logger.warn(
        'Libre Hardware Monitor refused the reading (HTTP 401): not retried until the configuration changes',
      );
      await this.setStatus(false, this.authMessage());
      return;
    }
    let delay;
    if (err.status === 429) {
      // Too many requests: a bounded pause, never shorter than the interval,
      // kept in /data.
      const min = Math.max(INTERVALS.BUSY_MIN_MS, this.minRetry());
      delay = clamp(err.retryAfterMs ?? min, min, INTERVALS.BUSY_MAX_MS);
      this.pausedUntil = this.now() + delay;
    } else {
      delay = this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetry());
      if (err.status >= 500) {
        // A server error: the wait is kept in /data too (a restart of the
        // container does not read again at once).
        if (err.retryAfterMs) delay = clamp(err.retryAfterMs, delay, INTERVALS.BUSY_MAX_MS);
        this.pausedUntil = this.now() + delay;
      }
    }
    if (this.pausedUntil > this.now()) {
      await this.store.set('meta', this.pauseKey(), String(this.pausedUntil));
      await this.store.set('meta', this.pauseReasonKey(), String(err.status));
    }
    if (wasOnline || delay === this.minRetry()) {
      this.logger.warn(`Libre Hardware Monitor fails: ${err.message}`);
    }
    const message = this.errorMessage(err, delay);
    this.retry = {
      identity: this.identity(),
      nextReadAt: this.now() + delay,
      retryDelay: this.retryDelay,
      pcAnswers: this.pcAnswers,
      message,
    };
    await this.setStatus(false, message);
    this.schedule(delay, () => this.connect(generation));
  }

  errorMessage(err, delay) {
    if (err.code === CODES.TLS_UNTRUSTED) return T.status.tlsUntrusted(delay);
    if (err.status === 429) return T.status.busy(delay);
    if (err.status >= 500) return T.status.serverError(err.status, delay);
    if (err.status === 403) return T.status.forbidden(delay);
    if (err.code === CODES.BAD_ANSWER || err.code === CODES.HTTP || err.code === CODES.TOO_LARGE) {
      return T.status.notLhm(delay);
    }
    return T.status.unreachable(err, delay);
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    this.statusValue = { connected, message };
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${err.message}`);
    });
  }

  okMessage() {
    const { computer, version, hardware } = this.reading;
    if (hardware.length === 0) return T.status.noSensor({ computer });
    return T.status.ok({
      computer,
      version,
      hardware: hardware.length,
      sensors: sensorCount(this.reading),
    });
  }

  // --- Discovery -----------------------------------------------------------------

  /** Never throws: a refusal of Gladys is not a failure of the PC. */
  async publishDiscovered() {
    const reading = this.reading;
    if (!reading) return;
    const created = createdDevices(this.gladys);
    const devices = [buildComputerDevice(this.gladys, reading.computer)];
    for (const hardware of reading.hardware) {
      const device = withCreatedFeatures(
        buildHardwareDevice(this.gladys, reading.computer, hardware, {
          sensorSet: this.config.sensorSet,
        }),
        created.hardware.get(hardware.id),
      );
      if (device.features.length > 0) devices.push(device);
    }
    await this.gladys.publishDiscoveredDevices(devices).catch((err) => {
      this.logger.warn(`Discovery not published: ${err.message}`);
    });
  }

  /** Discovery (scan button): the last reading, never a reading sooner than the interval. */
  async publishDiscovery() {
    await this.publishDiscovered();
  }

  // --- States ------------------------------------------------------------------------

  /**
   * "Online" of the PC (created, once known) always goes; the sensor values
   * of the created features that changed go within what is left of the
   * minute budget, the values published longest ago (or never) first: a big
   * PC read every 30 s gets all its values, in turn. The calls run one
   * after the other, each computing its room once the previous one is
   * counted (a reading and a device created at once never both spend it).
   */
  publishStates() {
    const run = this.statesQueue.then(() => this.publishStatesNow());
    this.statesQueue = run.catch(() => {});
    return run;
  }

  async publishStatesNow() {
    const created = createdDevices(this.gladys);
    const must = [];
    const onlineId = computerIds(this.gladys).feature(FEATURES.ONLINE);
    if (this.stateKnown && created.computer && featureIdsOf(created.computer).has(onlineId)) {
      must.push({ device_feature_external_id: onlineId, state: this.pcAnswers ? 1 : 0 });
    }
    const candidates = [];
    if (this.online && this.reading) {
      for (const hardware of this.reading.hardware) {
        const device = created.hardware.get(hardware.id);
        if (!device) continue;
        const featureIds = featureIdsOf(device);
        const ids = hardwareIds(this.gladys, hardware.id);
        for (const sensor of hardware.sensors) {
          const id = ids.feature(sensor.key);
          if (!featureIds.has(id)) continue;
          const value = featureValue(sensor);
          if (value === null) continue;
          const previous = this.published.get(id);
          if (previous?.value === value) continue;
          candidates.push({ id, value, at: previous?.at ?? 0 });
        }
      }
    }
    // Stable sort: never published first, then the oldest.
    candidates.sort((a, b) => a.at - b.at);
    const room = Math.max(0, this.budget.remaining() - must.length);
    const picked = candidates.slice(0, room);
    if (candidates.length > picked.length) {
      this.logger.debug(`${candidates.length - picked.length} value(s) held back (state budget)`);
    }
    const states = [
      ...must,
      ...picked.map(({ id, value }) => ({ device_feature_external_id: id, state: value })),
    ];
    if (states.length === 0) return;
    try {
      const result = await this.gladys.publishChangedStates(states);
      this.budget.record(result?.count ?? states.length);
      const at = this.now();
      for (const { id, value } of picked) this.published.set(id, { value, at });
    } catch (err) {
      // Some batches of 100 may have been taken before the failure: counted
      // as all sent (the budget errs on the safe side).
      this.budget.record(states.length);
      this.logger.warn(`States not published: ${err.message}`);
    }
  }

  async publishTransports() {
    const created = createdDevices(this.gladys);
    const present = new Set(
      this.online && this.reading ? this.reading.hardware.map((h) => h.id) : [],
    );
    const entries = [];
    if (created.computer && this.stateKnown) {
      entries.push({
        external_id: created.computer.external_id,
        transport: this.pcAnswers ? 'local' : 'unreachable',
      });
    }
    for (const [hardwareId, device] of created.hardware) {
      if (!this.stateKnown) continue;
      entries.push({
        external_id: device.external_id,
        transport: present.has(hardwareId) ? 'local' : 'unreachable',
      });
    }
    const changed = entries.filter((e) => this.transports.get(e.external_id) !== e.transport);
    for (let start = 0; start < changed.length; start += TRANSPORTS_PER_CALL) {
      const batch = changed.slice(start, start + TRANSPORTS_PER_CALL);
      for (const entry of batch) this.transports.set(entry.external_id, entry.transport);
      await this.gladys.publishTransports(batch).catch((err) => {
        for (const entry of batch) this.transports.delete(entry.external_id);
        this.logger.debug(`Transports not published: ${err.message}`);
      });
    }
  }

  // --- Devices created / updated / deleted in Gladys ---------------------------------

  /** The SDK forgot the values of this device: so does the budget order; sent again now. */
  async deviceChanged(device) {
    if (!parseExternalId(this.gladys, device?.external_id)) return;
    for (const id of featureIdsOf(device)) this.published.delete(id);
    // Also the features the device had before an update.
    const prefix = `${device.external_id}:`;
    for (const id of [...this.published.keys()]) {
      if (id.startsWith(prefix)) this.published.delete(id);
    }
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
  }

  deviceDeleted(device) {
    this.transports.delete(device?.external_id);
  }

  // --- Configuration button --------------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /** Reads the PC now (refused credentials and a pause included: the user asked), within 25 s. */
  async testConnection() {
    await this.within(
      this.start(this.rawConfig, { force: true }),
      TEST_BUDGET_MS,
      T.errors.testTooLong,
    );
    if (!this.online || !this.reading) {
      const message = this.lastStatus ? JSON.parse(this.lastStatus)[1] : null;
      throw new Error(message?.en ?? T.errors.notConnected);
    }
    return T.test.ok({
      computer: this.reading.computer,
      hardware: this.reading.hardware.length,
      sensors: sensorCount(this.reading),
    });
  }
}

function sensorCount(reading) {
  return reading.hardware.reduce((sum, h) => sum + h.sensors.length, 0);
}
