// -----------------------------------------------------------------------------
// /data.json of Libre Hardware Monitor -> plain objects (pure).
//
// The tree: a root node, the computer (its first child, named after the PC),
// then one node per main hardware (motherboard, CPU, GPU, memory, disks,
// network cards...), whose subtree holds groups ("Temperatures", "Load"...)
// and sub-hardware (the chip of the motherboard) down to the sensors. A
// sensor carries `SensorId` ("/amdcpu/0/temperature/2"), `Type`
// ("Temperature"), `Text` (its name), `Value` (formatted: "55,0 °C") and,
// from Libre Hardware Monitor 0.9.7, `RawValue` (a number).
//
// The reading follows librehardwaremonitor-api (MIT, see
// THIRD_PARTY_NOTICES.md): the ids are the `HardwareId` and `SensorId` paths
// without their first slash, joined by dashes, every other character than
// [A-Za-z0-9_-] dropped; before 0.9.5 (no `HardwareId`), the hardware id is
// the sensor id without its last two parts; the formatted values are read up
// to their first space, a decimal comma becoming a point; `RawValue` gives
// bytes for `Data`, bytes per second for `Throughput`, seconds for `TimeSpan`.
//
// Hostile answers: the tree is walked without recursion, with caps on the
// depth, the nodes, the hardware and the sensors; only own properties are
// read (a "__proto__" key is a plain key of JSON.parse, never followed).
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';

/** The sensor types of Libre Hardware Monitor (ISensor.cs), as `Type` spells them. */
export const SENSOR_TYPES = Object.freeze([
  'Voltage',
  'Current',
  'Power',
  'Clock',
  'Temperature',
  'Load',
  'Frequency',
  'Fan',
  'Flow',
  'Control',
  'Level',
  'Factor',
  'Data',
  'SmallData',
  'Throughput',
  'TimeSpan',
  'Timing',
  'Energy',
  'Noise',
  'Conductivity',
  'Humidity',
]);

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const TIB = 1024 * GIB;
// Maps, not object literals: a unit "__proto__" or "toString" finds nothing.
const DATA_UNITS = new Map([
  ['MB', MIB],
  ['TB', TIB],
]);
const SMALL_DATA_UNITS = new Map([
  ['GB', GIB],
  ['KB', KIB],
]);
const THROUGHPUT_UNITS = new Map([
  ['B/s', 1],
  ['KB/s', KIB],
  ['MB/s', MIB],
  ['GB/s', GIB],
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

/** A name: control characters dropped, trimmed, capped. */
export function cleanText(value, max = LIMITS.NAME_LENGTH) {
  if (typeof value !== 'string') return '';
  return (
    value
      .slice(0, max * 4)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .trim()
  );
}

/** "/amdcpu/0/temperature/2" -> "amdcpu-0-temperature-2" ('' when unusable). */
export function formatId(id) {
  if (typeof id !== 'string' || id.length > 512) return '';
  return id
    .split('/')
    .slice(1)
    .join('-')
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

/** "12,072" or "12.072" -> 12.072; anything else -> null. */
export function parseNumber(text) {
  if (typeof text !== 'string' || text.length > 32) return null;
  const normalized = text.replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** "01:02:03" or "2.01:02:03" (days) -> seconds; anything else -> null. */
export function parseTimeSpan(text) {
  if (typeof text !== 'string') return null;
  const match = /^(?:(\d{1,6})\.)?(\d{1,4}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, days = '0', hours, minutes, seconds] = match;
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * The value of a sensor in its base unit: °C, %, W, V, A, MHz, Hz, RPM, L/h,
 * bytes (Data, SmallData), bytes per second (Throughput), seconds
 * (TimeSpan), ns, mWh, dBA... null when the sensor has none (NaN, "-").
 */
export function sensorValue(node, type) {
  const raw = own(node, 'RawValue');
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // SmallData only exists up to 0.9.6 (formatted); a number would be MB.
    return type === 'SmallData' ? raw * MIB : raw;
  }
  // Libre Hardware Monitor 0.9.6 and older: the formatted value, "<number> <unit>".
  // The formatted RawValue of a throughput is in B/s (more precise than Value).
  let source = own(node, 'Value');
  if (type === 'Throughput' && typeof raw === 'string') source = raw;
  if (typeof source !== 'string' || source.length > 64) return null;
  const [number = '', unit = ''] = source.trim().split(/\s+/);
  if (type === 'TimeSpan') return parseTimeSpan(number);
  const n = parseNumber(number);
  if (n === null) return null;
  switch (type) {
    case 'Temperature':
      // The display may be set to Fahrenheit; Gladys gets Celsius.
      return unit === '°F' ? ((n - 32) * 5) / 9 : n;
    case 'Data':
      return n * (DATA_UNITS.get(unit) ?? GIB);
    case 'SmallData':
      return n * (SMALL_DATA_UNITS.get(unit) ?? MIB);
    case 'Throughput':
      return n * (THROUGHPUT_UNITS.get(unit) ?? 1);
    default:
      return n;
  }
}

/** "images_icon/cpu.png" -> "CPU"; "UNKNOWN" otherwise. */
export function hardwareKind(imageUrl) {
  if (typeof imageUrl !== 'string') return 'UNKNOWN';
  const match = /^images_icon\/([a-z0-9_-]{1,24})\.png$/i.exec(imageUrl);
  if (!match || match[1].toLowerCase() === 'transparent') return 'UNKNOWN';
  return match[1].toUpperCase();
}

function readSensor(node) {
  const type = own(node, 'Type');
  if (typeof type !== 'string' || !SENSOR_TYPES.includes(type)) return null;
  const key = formatId(own(node, 'SensorId'));
  if (!key || key.length > LIMITS.SENSOR_ID_LENGTH) return null;
  return {
    key,
    name: cleanText(own(node, 'Text')) || key,
    type,
    value: sensorValue(node, type),
  };
}

/** Every sensor under one main hardware, in the order of the tree (no recursion). */
function collectSensors(main, counters) {
  const sensors = [];
  const keys = new Set();
  const stack = [[main, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop();
    counters.nodes += 1;
    if (counters.nodes > LIMITS.NODES) break;
    if (!isObject(node)) continue;
    if (own(node, 'SensorId') !== undefined) {
      if (counters.sensors >= LIMITS.SENSORS) continue;
      const sensor = readSensor(node);
      if (sensor && !keys.has(sensor.key)) {
        keys.add(sensor.key);
        sensors.push(sensor);
        counters.sensors += 1;
      }
      continue;
    }
    const children = own(node, 'Children');
    if (!Array.isArray(children) || depth >= LIMITS.DEPTH) continue;
    // Reversed, so the stack pops them in the order of the tree.
    for (let i = Math.min(children.length, LIMITS.NODES) - 1; i >= 0; i -= 1) {
      if (stack.length >= LIMITS.NODES) break;
      stack.push([children[i], depth + 1]);
    }
  }
  return sensors;
}

/**
 * /data.json -> { computer, version, hardware: [{ id, name, kind, sensors:
 * [{ key, name, type, value }] }] }, or null when it is not the tree of
 * Libre Hardware Monitor. Hardware without a sensor is left out.
 */
export function parseData(json) {
  const roots = own(json, 'Children');
  if (!Array.isArray(roots)) return null;
  const computer = roots[0];
  const mains = own(computer, 'Children');
  if (!Array.isArray(mains)) return null;
  const rawVersion = own(json, 'Version');
  const version =
    typeof rawVersion === 'string' && /^\d{1,4}(\.\d{1,6}){1,3}$/.test(rawVersion)
      ? rawVersion
      : null;
  const counters = { nodes: 0, sensors: 0 };
  const hardware = [];
  const ids = new Set();
  for (let i = 0; i < mains.length && i < LIMITS.NODES; i += 1) {
    const main = mains[i];
    if (hardware.length >= LIMITS.HARDWARE || counters.nodes > LIMITS.NODES) break;
    if (!isObject(main)) continue;
    const sensors = collectSensors(main, counters);
    if (sensors.length === 0) continue;
    // Before 0.9.5 there is no HardwareId: the first sensor's id without its last two parts.
    const id =
      formatId(own(main, 'HardwareId')) || sensors[0].key.split('-').slice(0, -2).join('-');
    if (!id || id.length > LIMITS.SENSOR_ID_LENGTH || ids.has(id)) continue;
    ids.add(id);
    hardware.push({
      id,
      name: cleanText(own(main, 'Text')) || id,
      kind: hardwareKind(own(main, 'ImageURL')),
      sensors,
    });
  }
  return {
    computer: cleanText(own(computer, 'Text'), 64) || 'PC',
    version,
    hardware,
  };
}
