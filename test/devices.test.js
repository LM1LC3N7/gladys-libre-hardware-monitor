// -----------------------------------------------------------------------------
// The Gladys devices: names, values, the sensor sets, the units of the core,
// and the features of created devices that are never lost.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LIMITS, SENSOR_SETS } from '../src/constants.js';
import {
  SENSOR_KINDS,
  buildComputerDevice,
  buildHardwareDevice,
  createdDevices,
  featureName,
  featureValue,
  parseExternalId,
  withCreatedFeatures,
} from '../src/devices.js';
import { SENSOR_TYPES, parseData } from '../src/lhm/parse.js';
import { lhmTree } from './helpers/fakeLhm.js';

const gladys = createFakeGladys({ selector: 'libre-hardware-monitor' });
const data = parseData(lhmTree());
const cpu = data.hardware[1];

test('names: the type is added once, the unit Gladys lacks is shown', () => {
  const name = (text, type) => featureName({ name: text, type });
  assert.equal(name('CPU Total', 'Load'), 'CPU Total Load (%)');
  assert.equal(name('CPU Fan', 'Fan'), 'CPU Fan Speed (RPM)');
  assert.equal(name('Package', 'Power'), 'Package Power');
  assert.equal(name('Core Power', 'Power'), 'Core Power', 'never "Core Power Power"');
  assert.equal(name('Core (Tctl/Tdie)', 'Temperature'), 'Core (Tctl/Tdie) Temperature');
  assert.equal(name('Cores (Average)', 'Clock'), 'Cores (Average) Clock (MHz)');
  assert.equal(name('Data Read', 'Data'), 'Data Read');
});

test('values: rounded, scaled to the unit of Gladys, bounded, never NaN', () => {
  const value = (type, v) => featureValue({ type, value: v });
  assert.equal(value('Temperature', 61.375), 61.4);
  assert.equal(value('Load', 8.98999977), 9);
  assert.equal(value('Power', 41.4203568), 41.4);
  assert.equal(value('Data', 22139445200), 20.62, 'bytes -> GB');
  assert.equal(value('SmallData', 733 * 1024 ** 2), 733, 'bytes -> MB');
  assert.equal(value('Throughput', 793600), 775, 'B/s -> KB/s');
  assert.equal(value('Temperature', 255.5), null, 'a missing probe reads 255: not published');
  assert.equal(value('Load', -1), null);
  assert.equal(value('Load', null), null);
  assert.equal(value('Load', Number.NaN), null);
  assert.equal(value('Unknown', 1), null);
  assert.ok(Object.is(value('Power', -0.01), 0), 'never -0');
});

test('every type of Libre Hardware Monitor has a feature', () => {
  assert.deepEqual(Object.keys(SENSOR_KINDS).sort(), [...SENSOR_TYPES].sort());
});

test('units: only those the core lists for the category (server/utils/constants.js)', () => {
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the core, for the categories used here.
  const U = DEVICE_FEATURE_UNITS;
  const C = DEVICE_FEATURE_CATEGORIES;
  const allowed = {
    [C.DEVICE_TEMPERATURE_SENSOR]: [U.CELSIUS, U.FAHRENHEIT],
    [C.ENERGY_SENSOR]: [
      U.MILLI_AMPERE,
      U.AMPERE,
      U.MILLI_VOLT,
      U.VOLT,
      U.WATT,
      U.KILOWATT,
      U.WATT_HOUR,
      U.KILOWATT_HOUR,
      U.MEGAWATT_HOUR,
      U.KILOVOLT_AMPERE,
      U.VOLT_AMPERE,
      U.VOLT_AMPERE_REACTIVE,
      U.EURO,
      U.DOLLAR,
    ],
    [C.DATA]: [
      U.BIT,
      U.KILOBIT,
      U.MEGABIT,
      U.GIGABIT,
      U.BYTE,
      U.KILOBYTE,
      U.MEGABYTE,
      U.GIGABYTE,
      U.TERABYTE,
    ],
    [C.DATARATE]: [
      U.BITS_PER_SECOND,
      U.KILOBITS_PER_SECOND,
      U.MEGABITS_PER_SECOND,
      U.GIGABITS_PER_SECOND,
      U.BYTES_PER_SECOND,
      U.KILOBYTES_PER_SECOND,
      U.MEGABYTES_PER_SECOND,
      U.GIGABYTES_PER_SECOND,
    ],
    [C.DURATION]: [
      U.MICROSECONDS,
      U.MILLISECONDS,
      U.SECONDS,
      U.MINUTES,
      U.HOURS,
      U.DAYS,
      U.WEEKS,
      U.MONTHS,
      U.YEARS,
    ],
  };
  const types = Object.values(DEVICE_FEATURE_TYPES).flatMap((t) => Object.values(t));
  for (const [type, kind] of Object.entries(SENSOR_KINDS)) {
    assert.ok(Object.values(C).includes(kind.category), type);
    assert.ok(types.includes(kind.type), type);
    if (kind.unit === undefined) {
      assert.ok(kind.unitLabel !== undefined, `${type}: no unit, the name says it`);
      continue;
    }
    assert.ok(allowed[kind.category]?.includes(kind.unit), `${type}: ${kind.unit}`);
  }
  // Never an energy index: the core would count it as a consumption.
  for (const kind of Object.values(SENSOR_KINDS)) {
    assert.ok(
      ![
        DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
        DEVICE_FEATURE_TYPES.ENERGY_SENSOR.INDEX,
      ].includes(kind.type),
    );
  }
});

test('read only, everywhere: no switch, no command', () => {
  const devices = [
    buildComputerDevice(gladys, 'GAMING'),
    ...data.hardware.map((h) =>
      buildHardwareDevice(gladys, data.computer, h, { sensorSet: SENSOR_SETS.ALL }),
    ),
  ];
  for (const feature of devices.flatMap((d) => d.features)) {
    assert.equal(feature.read_only, true, feature.name);
    assert.notEqual(feature.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
    assert.notEqual(feature.category, DEVICE_FEATURE_CATEGORIES.BUTTON);
  }
});

test('sensor sets: essentials by priority, all, capped per device', () => {
  const essentials = buildHardwareDevice(gladys, 'GAMING', cpu, {
    sensorSet: SENSOR_SETS.ESSENTIALS,
  });
  assert.equal(essentials.name, 'AMD Ryzen 7 7800X3D (GAMING)');
  assert.equal(essentials.external_id, 'ext:libre-hardware-monitor:hardware:amdcpu-0');
  assert.equal(essentials.model, 'Libre Hardware Monitor: CPU');
  assert.deepEqual(
    essentials.features.map((f) => f.external_id.split(':').at(-1)),
    ['amdcpu-0-temperature-2', 'amdcpu-0-load-0', 'amdcpu-0-power-0'],
    'temperatures, loads, fans, power; no clock',
  );
  const all = buildHardwareDevice(gladys, 'GAMING', cpu, { sensorSet: SENSOR_SETS.ALL });
  assert.equal(all.features.length, 4);
  const big = {
    ...cpu,
    sensors: Array.from({ length: LIMITS.FEATURES_PER_DEVICE + 30 }, (_, i) => ({
      key: `x-${i}`,
      name: `Core #${i}`,
      type: 'Load',
      value: 1,
    })),
  };
  assert.equal(
    buildHardwareDevice(gladys, 'GAMING', big, { sensorSet: SENSOR_SETS.ALL }).features.length,
    LIMITS.FEATURES_PER_DEVICE,
  );
});

test('a device published again keeps every feature of the created device', () => {
  const created = buildHardwareDevice(gladys, 'GAMING', cpu, { sensorSet: SENSOR_SETS.ALL });
  created.features[0].name = 'Renamed by the user';
  const now = buildHardwareDevice(gladys, 'GAMING', cpu, { sensorSet: SENSOR_SETS.ESSENTIALS });
  const merged = withCreatedFeatures(now, { ...created, features: [...created.features, null] });
  const ids = (d) => d.features.map((f) => f.external_id).sort();
  assert.deepEqual(ids(merged), ids(created));
  assert.equal(withCreatedFeatures(now, undefined), now);
});

test('external ids: parsed back, foreign ones refused', () => {
  const ids = gladys.externalIds('hardware', 'amdcpu-0');
  assert.deepEqual(parseExternalId(gladys, ids.device), {
    kind: 'hardware',
    hardwareId: 'amdcpu-0',
    feature: null,
  });
  assert.deepEqual(parseExternalId(gladys, ids.feature('amdcpu-0-load-0')), {
    kind: 'hardware',
    hardwareId: 'amdcpu-0',
    feature: 'amdcpu-0-load-0',
  });
  const computer = buildComputerDevice(gladys, 'GAMING');
  assert.deepEqual(parseExternalId(gladys, computer.external_id), {
    kind: 'computer',
    feature: null,
  });
  assert.deepEqual(parseExternalId(gladys, computer.features[0].external_id), {
    kind: 'computer',
    feature: 'online',
  });
  for (const id of [
    'ext:other:hardware:x',
    `${ids.device}:a:b`,
    'ext:libre-hardware-monitor:hardware:a b',
    'ext:libre-hardware-monitor:computer:other',
    null,
  ]) {
    assert.equal(parseExternalId(gladys, id), null, String(id));
  }
  const { hardware, computer: found } = createdDevices(gladys, [
    computer,
    buildHardwareDevice(gladys, 'GAMING', cpu, { sensorSet: SENSOR_SETS.ALL }),
    { external_id: 'ext:other:hardware:x' },
    null,
  ]);
  assert.deepEqual([...hardware.keys()], ['amdcpu-0']);
  assert.equal(found, computer);
});
