// -----------------------------------------------------------------------------
// The web server of Libre Hardware Monitor (Options, Remote Web Server):
//   GET /data.json   the whole sensor tree, read only
// With HTTP Basic authentication when the user set it in Libre Hardware
// Monitor: the user name and password go in the Authorization header only
// (never in a URL, never in a log, never in /data).
// -----------------------------------------------------------------------------

import { MAX_BYTES, TIMEOUTS } from '../constants.js';
import { CODES, LhmError } from './errors.js';
import { httpRequest } from './http.js';
import { parseData } from './parse.js';

/** Seconds of a Retry-After header (delta form only), in ms, or null. */
export function retryAfterMs(value) {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || !/^\d{1,9}$/.test(text.trim())) return null;
  return Number(text.trim()) * 1000;
}

export class LhmClient {
  /**
   * @param {object} options
   * @param {{ base: string }} options.lhm the address (config.js)
   * @param {{ username: string, password: string } | null} [options.credentials]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake)
   */
  constructor({ lhm, credentials = null, request = httpRequest }) {
    this.url = `${lhm.base}/data.json`;
    this.request = request;
    this.closed = false;
    // Built once: the header holds the password, it is never logged.
    this.headers = credentials
      ? {
          authorization: `Basic ${Buffer.from(
            `${credentials.username}:${credentials.password}`,
            'utf8',
          ).toString('base64')}`,
        }
      : {};
  }

  close() {
    this.closed = true;
  }

  /** The sensor tree, parsed (src/lhm/parse.js). Rejects an LhmError. */
  async data() {
    if (this.closed) throw new LhmError(CODES.CLOSED, 'Client closed');
    const response = await this.request(this.url, {
      headers: this.headers,
      timeout: TIMEOUTS.READ,
      maxBytes: MAX_BYTES,
    });
    if (response.status < 200 || response.status > 299) {
      throw new LhmError(CODES.HTTP, `HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs: retryAfterMs(response.headers?.['retry-after']),
      });
    }
    let json;
    try {
      json = JSON.parse(response.body.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new LhmError(CODES.BAD_ANSWER, 'Not JSON');
    }
    const parsed = parseData(json);
    if (!parsed)
      throw new LhmError(CODES.BAD_ANSWER, 'Not the sensor tree of Libre Hardware Monitor');
    return parsed;
  }
}
