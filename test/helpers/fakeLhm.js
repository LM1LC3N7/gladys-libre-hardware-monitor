// -----------------------------------------------------------------------------
// A fake Libre Hardware Monitor: /data.json trees shaped like those of the
// real web server (0.9.7: numbers in RawValue; 0.9.6 and older: formatted
// strings, a decimal comma like a German or French Windows), and a fake HTTP
// transport that answers them. Built by hand from the format the reference
// library reads (see THIRD_PARTY_NOTICES.md); no network.
// -----------------------------------------------------------------------------

import { CODES, LhmError } from '../../src/lhm/errors.js';

export const USERNAME = 'gladys';
export const PASSWORD = 'S3cret-pass word!';

const UNITS = {
  Temperature: '°C',
  Load: '%',
  Fan: 'RPM',
  Control: '%',
  Power: 'W',
  Voltage: 'V',
  Current: 'A',
  Clock: 'MHz',
  Level: '%',
  Energy: 'mWh',
  Timing: 'ns',
};

const comma = (n) => String(n).replace('.', ',');

/** The formatted value Libre Hardware Monitor shows for a base value. */
function formatted(type, value) {
  if (value === null) return '-';
  if (type === 'Data') return `${comma((value / 1024 ** 3).toFixed(1))} GB`;
  if (type === 'Throughput') return `${comma((value / 1024 ** 2).toFixed(1))} MB/s`;
  if (type === 'TimeSpan') {
    const h = String(Math.floor(value / 3600)).padStart(2, '0');
    const m = String(Math.floor((value % 3600) / 60)).padStart(2, '0');
    const s = String(value % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  return `${comma(value)}${UNITS[type] ? ` ${UNITS[type]}` : ''}`;
}

let nextId = 0;

/** One sensor node; `legacy`: 0.9.6 (formatted RawValue strings). */
export function sensorNode({ id, text, type, value }, { legacy = false } = {}) {
  const node = {
    id: ++nextId,
    Text: text,
    Min: formatted(type, value),
    Value: formatted(type, value),
    Max: formatted(type, value),
    SensorId: id,
    Type: type,
    ImageURL: 'images/transparent.png',
    Children: [],
  };
  if (legacy) {
    const raw = type === 'Throughput' && value !== null ? `${comma(value)} B/s` : node.Value;
    Object.assign(node, { RawMin: raw, RawValue: raw, RawMax: raw });
  } else {
    Object.assign(node, { RawMin: value, RawValue: value ?? 'NaN', RawMax: value });
  }
  return node;
}

const group = (text, children) => ({
  id: ++nextId,
  Text: text,
  Min: '',
  Value: '',
  Max: '',
  ImageURL: 'images_icon/chip.png',
  Children: children,
});

/** The hardware of the default PC: [HardwareId, name, image, sensors]. */
export function defaultHardware() {
  return [
    {
      hardwareId: '/motherboard',
      name: 'MSI MAG B650M MORTAR WIFI (MS-7D76)',
      image: 'mainboard',
      chips: [
        {
          hardwareId: '/lpc/nct6687d/0',
          name: 'Nuvoton NCT6687D',
          sensors: [
            { id: '/lpc/nct6687d/0/voltage/0', text: '+12V', type: 'Voltage', value: 12.0720005 },
            { id: '/lpc/nct6687d/0/temperature/0', text: 'CPU', type: 'Temperature', value: 55 },
            { id: '/lpc/nct6687d/0/fan/0', text: 'CPU Fan', type: 'Fan', value: 1008 },
            { id: '/lpc/nct6687d/0/control/0', text: 'CPU Fan', type: 'Control', value: 53 },
          ],
        },
      ],
      sensors: [],
    },
    {
      hardwareId: '/amdcpu/0',
      name: 'AMD Ryzen 7 7800X3D',
      image: 'cpu',
      sensors: [
        { id: '/amdcpu/0/clock/1', text: 'Cores (Average)', type: 'Clock', value: 4463 },
        {
          id: '/amdcpu/0/temperature/2',
          text: 'Core (Tctl/Tdie)',
          type: 'Temperature',
          value: 61.375,
        },
        { id: '/amdcpu/0/load/0', text: 'CPU Total', type: 'Load', value: 8.98999977 },
        { id: '/amdcpu/0/power/0', text: 'Package', type: 'Power', value: 41.4203568 },
      ],
    },
    {
      hardwareId: '/ram',
      name: 'Total Memory',
      image: 'ram',
      sensors: [
        { id: '/ram/load/0', text: 'Memory', type: 'Load', value: 41.2 },
        { id: '/ram/data/0', text: 'Memory Used', type: 'Data', value: 22139445200 },
      ],
    },
    {
      hardwareId: '/nic/%7B5ACFABDA-3D67-4BAB-A5E3-3F07779470A7%7D',
      name: 'Ethernet',
      image: 'nic',
      sensors: [
        {
          id: '/nic/%7B5ACFABDA-3D67-4BAB-A5E3-3F07779470A7%7D/throughput/7',
          text: 'Download Speed',
          type: 'Throughput',
          value: 793600,
        },
      ],
    },
    // Hardware without a sensor: left out.
    { hardwareId: '/battery/0', name: 'Battery', image: 'battery', sensors: [] },
  ];
}

/**
 * A /data.json tree. `legacy`: 0.9.6 (no Version, formatted raw values);
 * `noHardwareId`: before 0.9.5.
 */
export function lhmTree({
  computer = 'GAMING',
  version = '0.9.7',
  hardware = defaultHardware(),
  legacy = false,
  noHardwareId = false,
} = {}) {
  const options = { legacy };
  const mains = hardware.map((h) => {
    const node = {
      id: ++nextId,
      Text: h.name,
      Min: '',
      Value: '',
      Max: '',
      ImageURL: `images_icon/${h.image}.png`,
      Children: [
        ...(h.chips ?? []).map((chip) => ({
          ...group(chip.name, [
            group(
              'Sensors',
              chip.sensors.map((s) => sensorNode(s, options)),
            ),
          ]),
          ...(noHardwareId ? {} : { HardwareId: chip.hardwareId }),
        })),
        ...(h.sensors.length > 0
          ? [
              group(
                'Sensors',
                h.sensors.map((s) => sensorNode(s, options)),
              ),
            ]
          : []),
      ],
    };
    if (!noHardwareId) node.HardwareId = h.hardwareId;
    return node;
  });
  const root = {
    id: 0,
    Text: 'Sensor',
    Min: 'Min',
    Value: 'Value',
    Max: 'Max',
    ImageURL: '',
    Children: [
      {
        id: ++nextId,
        Text: computer,
        Min: '',
        Value: '',
        Max: '',
        ImageURL: 'images_icon/computer.png',
        Children: mains,
      },
    ],
  };
  if (!legacy && version) root.Version = version;
  return root;
}

/** Set the value of a sensor (by its SensorId) in a tree built by lhmTree(). */
export function setValue(tree, sensorId, value) {
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.SensorId === sensorId) {
      Object.assign(node, { RawValue: value, Value: formatted(node.Type, value) });
      return;
    }
    stack.push(...(node.Children ?? []));
  }
  throw new Error(`No sensor ${sensorId}`);
}

/**
 * The fake transport. `down`: every request fails with it (an LhmError, or
 * { status, headers }); `failures`: the next requests fail, once each.
 */
export function createFakeLhm({ tree = lhmTree(), credentials = null } = {}) {
  const lhm = {
    tree,
    credentials,
    requests: [],
    failures: [],
    down: null,
    async request(url, options) {
      lhm.requests.push({ url, headers: { ...options.headers }, options });
      const failure = lhm.failures.shift() ?? lhm.down;
      if (failure instanceof Error) throw failure;
      if (failure) {
        return {
          status: failure.status,
          headers: failure.headers ?? {},
          body: Buffer.from(failure.body ?? ''),
        };
      }
      if (lhm.credentials) {
        const expected = `Basic ${Buffer.from(
          `${lhm.credentials.username}:${lhm.credentials.password}`,
        ).toString('base64')}`;
        if (options.headers?.authorization !== expected) {
          return { status: 401, headers: { 'www-authenticate': 'Basic' }, body: Buffer.alloc(0) };
        }
      }
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(lhm.tree)) };
    },
  };
  return lhm;
}

export const unreachable = () => new LhmError(CODES.UNREACHABLE, 'ECONNREFUSED');
