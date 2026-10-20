// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys and the external id shapes are
// stored in user devices and scenes: never rename them (test/manifest.test.js
// ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

/** `ext:<selector>:hardware:<hardware id>` (one per main hardware of the PC). */
export const HARDWARE_TYPE = 'hardware';
/** `ext:<selector>:computer:pc` (the PC itself: does it answer?). */
export const COMPUTER_TYPE = 'computer';
export const COMPUTER_ID = 'pc';

export const FEATURES = Object.freeze({
  ONLINE: 'online',
});

/** Seconds between two readings of Libre Hardware Monitor. */
export const POLL_INTERVALS = Object.freeze(['30', '60', '120', '300']);

/** Which sensors the Discovery tab offers. */
export const SENSOR_SETS = Object.freeze({ ESSENTIALS: 'essentials', ALL: 'all' });

/** The port of the web server of Libre Hardware Monitor (Options, Remote Web Server). */
export const DEFAULT_PORT = 8085;

/** Caps: what is read, published and remembered. */
export const LIMITS = Object.freeze({
  /** Main hardware read (devices). */
  HARDWARE: 64,
  /** Sensors read in all. */
  SENSORS: 5_000,
  /** Nodes of the JSON tree walked (the tree is walked without recursion). */
  NODES: 50_000,
  /** Depth of the JSON tree walked. */
  DEPTH: 16,
  /** Features of one device offered in the Discovery tab. */
  FEATURES_PER_DEVICE: 200,
  /** Length of a sensor id kept (longer ones are skipped). */
  SENSOR_ID_LENGTH: 160,
  /** Length of a name kept. */
  NAME_LENGTH: 80,
  /**
   * POST /state admits 300 states per minute per integration: this
   * integration keeps under 250, the oldest values going first.
   */
  STATES_PER_MINUTE: 250,
});

export const TIMEOUTS = Object.freeze({
  /** One reading of /data.json. */
  READ: 10_000,
});

export const INTERVALS = Object.freeze({
  /** Libre Hardware Monitor unreachable: first retry (never under the reading interval). */
  RETRY_MIN_MS: 30_000,
  RETRY_MAX_MS: 5 * 60_000,
  /** HTTP 429: pause of every request, within these bounds (Retry-After if given). */
  BUSY_MIN_MS: 60_000,
  BUSY_MAX_MS: 6 * 3600_000,
});

/** Size cap of /data.json (a large PC answers about 200 KB). */
export const MAX_BYTES = 8 * 1024 * 1024;

/** The persistent store (refusals, pause: see src/store.js). */
export const STORE_FILE = 'libre-hardware-monitor.json';
