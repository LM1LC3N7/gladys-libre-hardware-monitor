// -----------------------------------------------------------------------------
// Gladys devices (pure).
//
//   hardware   `ext:<selector>:hardware:<hardware id>`
//              one per main hardware of the PC (CPU, GPU, motherboard, memory,
//              disk, network card...), one read-only feature per sensor:
//              `...:<hardware id>:<sensor id>` (ids of src/lhm/parse.js,
//              those of librehardwaremonitor-api, stable across restarts)
//   computer   `ext:<selector>:computer:pc`
//              the PC itself: "Online" (1 while Libre Hardware Monitor answers)
//
// Everything is read only: this integration sends no command to the PC.
// Units are only those the core lists for the category
// (DEVICE_FEATURE_UNITS_BY_CATEGORY); a quantity without such a unit (load
// in %, fan in RPM, clock in MHz...) is an `unknown` feature named with its
// unit, like the CPU load of gladys-portainer (TODO.md, "Decisions").
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  COMPUTER_ID,
  COMPUTER_TYPE,
  FEATURES,
  HARDWARE_TYPE,
  LIMITS,
  SENSOR_SETS,
} from './constants.js';

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

const unknown = (unitLabel, extra) => ({
  category: C.UNKNOWN,
  type: T.UNKNOWN.UNKNOWN,
  unitLabel,
  ...extra,
});

/**
 * Libre Hardware Monitor sensor type -> Gladys feature. `suffix`: added to
 * the name unless it already holds it ("CPU Total" -> "CPU Total Load");
 * `unitLabel`: shown in the name when Gladys has no unit for it; `scale`:
 * divides the base value of src/lhm/parse.js; `decimals`: rounding (fewer
 * changes, fewer states); a value outside [min, max] is not published.
 */
export const SENSOR_KINDS = Object.freeze({
  Temperature: {
    // `device-temperature-sensor`: the temperature of a device, kept out of the
    // temperature of the room.
    category: C.DEVICE_TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    suffix: 'Temperature',
    min: -100,
    max: 250,
    decimals: 1,
  },
  Load: unknown('%', { suffix: 'Load', min: 0, max: 100, decimals: 0 }),
  Fan: unknown('RPM', { suffix: 'Speed', min: 0, max: 100_000, decimals: 0 }),
  Power: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    suffix: 'Power',
    min: -100_000,
    max: 100_000,
    decimals: 1,
  },
  Control: unknown('%', { suffix: 'Control', min: 0, max: 100, decimals: 0 }),
  Clock: unknown('MHz', { suffix: 'Clock', min: 0, max: 1_000_000, decimals: 0 }),
  Data: {
    category: C.DATA,
    type: T.DATA.SIZE,
    unit: U.GIGABYTE,
    suffix: 'Data',
    scale: GIB,
    min: 0,
    max: 1_000_000_000,
    decimals: 2,
  },
  SmallData: {
    category: C.DATA,
    type: T.DATA.SIZE,
    unit: U.MEGABYTE,
    suffix: 'Data',
    scale: MIB,
    min: 0,
    max: 1_000_000_000,
    decimals: 0,
  },
  Throughput: {
    category: C.DATARATE,
    type: T.DATARATE.RATE,
    unit: U.KILOBYTES_PER_SECOND,
    suffix: 'Throughput',
    scale: KIB,
    min: 0,
    max: 1_000_000_000,
    decimals: 1,
  },
  Level: unknown('%', { suffix: 'Level', min: 0, max: 100, decimals: 0 }),
  Voltage: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    suffix: 'Voltage',
    min: -1_000,
    max: 1_000,
    decimals: 3,
  },
  Current: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    unit: U.AMPERE,
    suffix: 'Current',
    min: -1_000,
    max: 1_000,
    decimals: 2,
  },
  // A battery capacity, not an energy index: never `energy-sensor` (the core
  // would count it as a consumption).
  Energy: unknown('mWh', { suffix: 'Capacity', min: 0, max: 100_000_000, decimals: 0 }),
  TimeSpan: {
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.SECONDS,
    suffix: 'Time',
    min: 0,
    max: 10_000_000_000,
    decimals: 0,
  },
  Frequency: unknown('Hz', { suffix: 'Frequency', min: 0, max: 1_000_000_000, decimals: 1 }),
  Flow: unknown('L/h', { suffix: 'Flow', min: 0, max: 1_000_000, decimals: 1 }),
  Factor: unknown('', { suffix: 'Factor', min: -1_000_000, max: 1_000_000, decimals: 3 }),
  Timing: unknown('ns', { suffix: 'Timing', min: 0, max: 1_000_000_000, decimals: 3 }),
  Noise: unknown('dBA', { suffix: 'Noise', min: 0, max: 200, decimals: 1 }),
  Conductivity: unknown('µS/cm', {
    suffix: 'Conductivity',
    min: 0,
    max: 1_000_000,
    decimals: 1,
  }),
  // A humidity inside a PC case: kept out of the humidity of the room.
  Humidity: unknown('%', { suffix: 'Humidity', min: 0, max: 100, decimals: 1 }),
});

/** The order of the features of a device (the keys of SENSOR_KINDS). */
const PRIORITY = Object.keys(SENSOR_KINDS);
/** "Essential sensors": what most users want on a dashboard. */
export const ESSENTIAL_TYPES = Object.freeze(['Temperature', 'Load', 'Fan', 'Power']);

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const hardwareIds = (gladys, hardwareId) => gladys.externalIds(HARDWARE_TYPE, hardwareId);
export const computerIds = (gladys) => gladys.externalIds(COMPUTER_TYPE, COMPUTER_ID);

/** "CPU Total" + Load -> "CPU Total Load (%)"; "Package" + Power -> "Package Power". */
export function featureName(sensor) {
  const kind = SENSOR_KINDS[sensor.type];
  let name = sensor.name;
  if (kind.suffix && !name.toLowerCase().includes(kind.suffix.toLowerCase())) {
    name = `${name} ${kind.suffix}`;
  }
  if (kind.unitLabel) name = `${name} (${kind.unitLabel})`;
  return name.slice(0, 120);
}

/** The value Gladys gets for a sensor, or null (none, or outside the bounds). */
export function featureValue(sensor) {
  const kind = SENSOR_KINDS[sensor.type];
  if (!kind || typeof sensor.value !== 'number' || !Number.isFinite(sensor.value)) return null;
  const factor = 10 ** kind.decimals;
  const value = Math.round((sensor.value / (kind.scale ?? 1)) * factor) / factor;
  if (!Number.isFinite(value) || value < kind.min || value > kind.max) return null;
  // -0 and 0 are the same reading.
  return value === 0 ? 0 : value;
}

export function buildSensorFeature(gladys, hardwareId, sensor) {
  const kind = SENSOR_KINDS[sensor.type];
  const feature = {
    name: featureName(sensor),
    external_id: hardwareIds(gladys, hardwareId).feature(sensor.key),
    category: kind.category,
    type: kind.type,
    min: kind.min,
    max: kind.max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
  if (kind.unit) feature.unit = kind.unit;
  return feature;
}

/** The sensors of one hardware offered in Discovery: the set chosen, by priority, capped. */
export function offeredSensors(hardware, sensorSet) {
  const wanted = (sensor) =>
    sensorSet === SENSOR_SETS.ALL ? true : ESSENTIAL_TYPES.includes(sensor.type);
  return hardware.sensors
    .filter((sensor) => SENSOR_KINDS[sensor.type] && wanted(sensor))
    .map((sensor, index) => ({ sensor, index }))
    .sort(
      (a, b) =>
        PRIORITY.indexOf(a.sensor.type) - PRIORITY.indexOf(b.sensor.type) || a.index - b.index,
    )
    .slice(0, LIMITS.FEATURES_PER_DEVICE)
    .map(({ sensor }) => sensor);
}

/**
 * @param {object} gladys
 * @param {string} computer the name of the PC
 * @param {{ id: string, name: string, kind: string, sensors: object[] }} hardware
 * @param {{ sensorSet: string }} options
 */
export function buildHardwareDevice(gladys, computer, hardware, { sensorSet }) {
  return {
    name: `${hardware.name} (${computer})`.slice(0, 150),
    external_id: hardwareIds(gladys, hardware.id).device,
    model: `Libre Hardware Monitor: ${hardware.kind}`,
    should_poll: false,
    features: offeredSensors(hardware, sensorSet).map((sensor) =>
      buildSensorFeature(gladys, hardware.id, sensor),
    ),
  };
}

export function buildComputerDevice(gladys, computer) {
  const ids = computerIds(gladys);
  return {
    name: `${computer} (Libre Hardware Monitor)`.slice(0, 150),
    external_id: ids.device,
    model: 'Libre Hardware Monitor',
    should_poll: false,
    features: [
      {
        name: 'Online',
        external_id: ids.feature(FEATURES.ONLINE),
        // 1 while Libre Hardware Monitor answers: the PC is on. Read only.
        category: C.UNKNOWN,
        type: T.SENSOR.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

const KEPT_FEATURE_KEYS = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];

/**
 * A device published again must never lose a feature the user created
 * (Gladys would mark it changed, and "Update" would drop that history): the
 * features of the created device missing from the new reading (a sensor
 * gone, another sensor set) are kept as they were created.
 */
export function withCreatedFeatures(device, created) {
  if (!created || !Array.isArray(created.features)) return device;
  const present = new Set(device.features.map((f) => f.external_id));
  const kept = [];
  for (const feature of created.features) {
    if (!feature || typeof feature.external_id !== 'string') continue;
    if (present.has(feature.external_id)) continue;
    present.add(feature.external_id);
    const copy = {};
    for (const key of KEPT_FEATURE_KEYS) {
      if (feature[key] !== undefined && feature[key] !== null) copy[key] = feature[key];
    }
    kept.push(copy);
  }
  return kept.length > 0 ? { ...device, features: [...device.features, ...kept] } : device;
}

/**
 * What a device or feature external id of this integration designates:
 * { kind: 'hardware', hardwareId, feature } | { kind: 'computer', feature } | null.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string' || externalId.length > 512) return null;
  const hardwarePrefix = gladys.externalId(`${HARDWARE_TYPE}:`);
  if (externalId.startsWith(hardwarePrefix)) {
    const [hardwareId, feature, ...rest] = externalId.slice(hardwarePrefix.length).split(':');
    if (rest.length > 0 || !SAFE_ID.test(hardwareId ?? '')) return null;
    if (feature !== undefined && !SAFE_ID.test(feature)) return null;
    return { kind: 'hardware', hardwareId, feature: feature ?? null };
  }
  const computerPrefix = computerIds(gladys).device;
  if (externalId === computerPrefix) return { kind: 'computer', feature: null };
  if (externalId === computerIds(gladys).feature(FEATURES.ONLINE)) {
    return { kind: 'computer', feature: FEATURES.ONLINE };
  }
  return null;
}

/**
 * The created devices of this integration (gladys.devices, kept up to date by
 * the SDK): { hardware: Map<hardware id, device>, computer: device | null }.
 */
export function createdDevices(gladys, devices = gladys.devices) {
  const hardware = new Map();
  let computer = null;
  for (const device of Array.isArray(devices) ? devices : []) {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed || parsed.feature !== null) continue;
    if (parsed.kind === 'hardware') hardware.set(parsed.hardwareId, device);
    else computer = device;
  }
  return { hardware, computer };
}

/** The feature external ids of a created device. */
export const featureIdsOf = (device) =>
  new Set(
    (Array.isArray(device?.features) ? device.features : [])
      .map((f) => f?.external_id)
      .filter((id) => typeof id === 'string'),
  );
