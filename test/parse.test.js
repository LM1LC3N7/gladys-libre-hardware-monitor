// -----------------------------------------------------------------------------
// /data.json -> plain objects: the current format, the older ones, and
// hostile answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../src/constants.js';
import {
  cleanText,
  formatId,
  hardwareKind,
  parseData,
  parseNumber,
  parseTimeSpan,
  sensorValue,
} from '../src/lhm/parse.js';
import { lhmTree } from './helpers/fakeLhm.js';

const byKey = (hardware) => Object.fromEntries(hardware.sensors.map((s) => [s.key, s]));

test('0.9.7: computer, version, hardware ids and kinds, raw values', () => {
  const data = parseData(lhmTree());
  assert.equal(data.computer, 'GAMING');
  assert.equal(data.version, '0.9.7');
  assert.deepEqual(
    data.hardware.map((h) => [h.id, h.name, h.kind]),
    [
      ['motherboard', 'MSI MAG B650M MORTAR WIFI (MS-7D76)', 'MAINBOARD'],
      ['amdcpu-0', 'AMD Ryzen 7 7800X3D', 'CPU'],
      ['ram', 'Total Memory', 'RAM'],
      ['nic-7B5ACFABDA-3D67-4BAB-A5E3-3F07779470A77D', 'Ethernet', 'NIC'],
    ],
    'the battery without a sensor is left out; the braces of the NIC id dropped',
  );
  const board = byKey(data.hardware[0]);
  assert.deepEqual(Object.keys(board), [
    'lpc-nct6687d-0-voltage-0',
    'lpc-nct6687d-0-temperature-0',
    'lpc-nct6687d-0-fan-0',
    'lpc-nct6687d-0-control-0',
  ]);
  assert.equal(board['lpc-nct6687d-0-voltage-0'].value, 12.0720005);
  assert.equal(board['lpc-nct6687d-0-fan-0'].name, 'CPU Fan');
  const cpu = byKey(data.hardware[1]);
  assert.equal(cpu['amdcpu-0-temperature-2'].value, 61.375);
  assert.equal(cpu['amdcpu-0-load-0'].type, 'Load');
  assert.equal(byKey(data.hardware[2])['ram-data-0'].value, 22139445200, 'bytes');
});

test('0.9.6: formatted values, decimal comma, GB and MB/s in base units', () => {
  const data = parseData(lhmTree({ legacy: true }));
  assert.equal(data.version, null);
  const cpu = byKey(data.hardware[1]);
  assert.equal(cpu['amdcpu-0-temperature-2'].value, 61.375);
  assert.equal(cpu['amdcpu-0-power-0'].value, 41.4203568);
  const used = byKey(data.hardware[2])['ram-data-0'].value;
  assert.equal(used, 20.6 * 1024 ** 3, '"20,6 GB" (rounded by the display)');
  const nic = data.hardware[3].sensors[0];
  assert.equal(nic.value, 793600, 'the B/s of the formatted RawValue');
});

test('before 0.9.5: no HardwareId, the id comes from the first sensor', () => {
  const data = parseData(lhmTree({ legacy: true, noHardwareId: true }));
  assert.deepEqual(
    data.hardware.map((h) => h.id),
    ['lpc-nct6687d-0', 'amdcpu-0', 'ram', 'nic-7B5ACFABDA-3D67-4BAB-A5E3-3F07779470A77D'],
  );
});

test('sensorValue: units of the formatted values', () => {
  const v = (type, Value, RawValue) => sensorValue({ Value, RawValue }, type);
  assert.equal(v('Temperature', '131,0 °F'), 55, 'Fahrenheit display -> Celsius');
  assert.equal(v('Temperature', '55,0 °C', 55.5), 55.5, 'RawValue first');
  assert.equal(v('Temperature', 'NaN'), null);
  assert.equal(v('Temperature', '-'), null);
  assert.equal(v('Temperature', '55 °C', Number.NaN), null);
  assert.equal(v('SmallData', '733,0 MB'), 733 * 1024 ** 2);
  assert.equal(v('Data', '1,5 TB'), 1.5 * 1024 ** 4);
  assert.equal(v('Throughput', '1,5 KB/s'), 1536);
  assert.equal(v('TimeSpan', '01:02:03'), 3723);
  assert.equal(v('TimeSpan', '2.01:02:03'), 2 * 86400 + 3723);
  assert.equal(v('TimeSpan', '', 3723), 3723);
  for (const unit of ['__proto__', 'constructor', 'toString']) {
    assert.equal(v('Data', `1 ${unit}`), 1024 ** 3, `Data, ${unit}`);
    assert.equal(v('SmallData', `1 ${unit}`), 1024 ** 2, `SmallData, ${unit}`);
    assert.equal(v('Throughput', `1 ${unit}`), 1, `Throughput, ${unit}`);
  }
  assert.equal(v('Load', 'x'.repeat(100)), null);
  assert.equal(v('Load', { toString: () => '1' }), null);
});

test('helpers: ids, numbers, kinds, names', () => {
  assert.equal(formatId('/amdcpu/0/temperature/2'), 'amdcpu-0-temperature-2');
  assert.equal(formatId('/a/b:c/<script>'), 'a-bc-script');
  assert.equal(formatId(42), '');
  assert.equal(formatId('/'.repeat(600)), '');
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber('1e3'), null);
  assert.equal(parseNumber('Infinity'), null);
  assert.equal(parseNumber('0x10'), null);
  assert.equal(parseTimeSpan('1:2:3'), null);
  assert.equal(hardwareKind('images_icon/nvidia.png'), 'NVIDIA');
  assert.equal(hardwareKind('images/transparent.png'), 'UNKNOWN');
  assert.equal(hardwareKind('../../etc/passwd'), 'UNKNOWN');
  assert.equal(cleanText('  a\u0000b\nc  '), 'a b c');
  assert.equal(cleanText('x'.repeat(500)).length, LIMITS.NAME_LENGTH);
});

test('not the tree of Libre Hardware Monitor: null', () => {
  for (const json of [
    null,
    42,
    'x',
    [],
    {},
    { Children: {} },
    { Children: [] },
    { Children: [{}] },
  ]) {
    assert.equal(parseData(json), null, JSON.stringify(json));
  }
  const empty = parseData({ Children: [{ Text: 'PC', Children: [] }] });
  assert.deepEqual(empty, { computer: 'PC', version: null, hardware: [] });
});

test('hostile answers: unknown types, odd ids, duplicates, prototype keys', () => {
  const tree = JSON.parse(
    JSON.stringify({
      Version: '1.0.0; DROP',
      Children: [
        {
          Text: 'PC',
          Children: [
            {
              Text: 'CPU',
              HardwareId: '/cpu/0',
              ImageURL: 'images_icon/cpu.png',
              Children: [
                { SensorId: '/cpu/0/load/0', Type: 'Load', Text: 'A', RawValue: 1, Children: [] },
                { SensorId: '/cpu/0/load/0', Type: 'Load', Text: 'dup', RawValue: 2 },
                { SensorId: '/cpu/0/x/0', Type: 'Telepathy', Text: 'B', RawValue: 3 },
                { SensorId: `/cpu/${'x'.repeat(200)}`, Type: 'Load', RawValue: 4 },
                { SensorId: 5, Type: 'Load', RawValue: 5 },
                'not a node',
                null,
              ],
            },
          ],
        },
      ],
    }).replace('"Text":"CPU"', '"__proto__":{"polluted":true},"Text":"CPU"'),
  );
  const data = parseData(tree);
  assert.equal(data.version, null);
  assert.deepEqual(
    data.hardware[0].sensors.map((s) => [s.key, s.name, s.value]),
    [['cpu-0-load-0', 'A', 1]],
  );
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('hostile answers: depth, width and counts are capped, without recursion', () => {
  // A chain far deeper than the cap: walked without a stack overflow.
  let deep = { SensorId: '/d/0/load/0', Type: 'Load', RawValue: 1 };
  for (let i = 0; i < 100_000; i += 1) deep = { Children: [deep] };
  const deepTree = { Children: [{ Text: 'PC', Children: [{ HardwareId: '/d/0', ...deep }] }] };
  assert.deepEqual(parseData(deepTree).hardware, [], 'the sensor below the depth cap is not read');

  // Too many sensors: the cap holds.
  const wide = Array.from({ length: LIMITS.SENSORS + 50 }, (_, i) => ({
    SensorId: `/w/0/load/${i}`,
    Type: 'Load',
    RawValue: i,
  }));
  const wideTree = {
    Children: [{ Text: 'PC', Children: [{ HardwareId: '/w/0', Children: wide }] }],
  };
  assert.equal(parseData(wideTree).hardware[0].sensors.length, LIMITS.SENSORS);

  // Too much hardware: the cap holds.
  const many = Array.from({ length: LIMITS.HARDWARE + 10 }, (_, i) => ({
    HardwareId: `/h/${i}`,
    Children: [{ SensorId: `/h/${i}/load/0`, Type: 'Load', RawValue: 1 }],
  }));
  assert.equal(
    parseData({ Children: [{ Text: 'PC', Children: many }] }).hardware.length,
    LIMITS.HARDWARE,
  );
});
