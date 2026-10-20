// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, POLL_INTERVALS, SENSOR_SETS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  sensor_set: SENSOR_SETS.ESSENTIALS,
  poll_interval: '60',
});

/** An address with a scheme and no port: the port of the scheme (a reverse proxy). */
export const SCHEME_PORTS = Object.freeze({ 'http:': 80, 'https:': 443 });

const text = (value) => (typeof value === 'string' ? value.trim() : '');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The address of Libre Hardware Monitor: a bare `host[:port]` is read as
 * http on port 8085 (its own); `http://...` / `https://...` without a port
 * take 80 / 443, like a browser (a reverse proxy). A path is kept (reverse
 * proxy), a trailing `/data.json` dropped. Credentials, a query and a
 * fragment are refused (an address ends up in logs).
 *   -> { base, origin, protocol, hostname, port } or { error: 'empty' | 'invalid' | 'credentials' }
 */
export function parseLhmUrl(value) {
  const raw = text(value);
  if (!raw) return { error: 'empty' };
  if (/\s/.test(raw)) return { error: 'invalid' };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const full = hasScheme ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(full);
  } catch {
    return { error: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'invalid' };
  if (url.username || url.password) return { error: 'credentials' };
  if (url.search || url.hash || !url.hostname) return { error: 'invalid' };
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/data\.json$/i, '')
    .replace(/\/+$/, '');
  if (path && !/^(\/[A-Za-z0-9._~%-]+)+$/.test(path)) return { error: 'invalid' };
  // `http://host:80` loses its port in URL (the default of the scheme): read
  // a typed port from the text itself.
  const typedPort = /^[a-z][a-z0-9+.-]*:\/\/(?:\[[^\]]*\]|[^/:?#]*):(\d+)/i.exec(full);
  let port = DEFAULT_PORT;
  if (typedPort) port = Number(typedPort[1]);
  else if (hasScheme) port = SCHEME_PORTS[url.protocol];
  if (!(port > 0 && port < 65536)) return { error: 'invalid' };
  const hostname = url.hostname.toLowerCase();
  const origin = `${url.protocol}//${hostname}:${port}`;
  return { base: `${origin}${path}`, origin, protocol: url.protocol, hostname, port };
}

/**
 * Basic authentication: both fields or none. The user name is trimmed (a
 * colon ends it in Basic authentication: refused); the password is kept as
 * typed (spaces are allowed), control characters refused.
 *   -> { credentials: { username, password } | null, error: null | 'incomplete' | 'invalid' }
 */
export function parseCredentials(rawUsername, rawPassword) {
  const username = text(rawUsername);
  const password = typeof rawPassword === 'string' ? rawPassword : '';
  if (!username && !password) return { credentials: null, error: null };
  if (!username || !password) return { credentials: null, error: 'incomplete' };
  if (username.includes(':') || CONTROL.test(username) || CONTROL.test(password)) {
    return { credentials: null, error: 'invalid' };
  }
  if (username.length > 256 || password.length > 1024) {
    return { credentials: null, error: 'invalid' };
  }
  return { credentials: { username, password }, error: null };
}

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const lhm = parseLhmUrl(raw.url);
  const pick = (key, list) => (list.includes(String(raw[key])) ? String(raw[key]) : DEFAULTS[key]);
  const { credentials, error: credentialsError } = parseCredentials(raw.username, raw.password);
  return {
    lhm: lhm.error ? null : lhm,
    urlError: lhm.error ?? null,
    credentials,
    credentialsError,
    sensorSet: pick('sensor_set', Object.values(SENSOR_SETS)),
    intervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
  };
}
