// -----------------------------------------------------------------------------
// The only network access of the integration: one GET to Libre Hardware
// Monitor on node:http / node:https. A deadline for the whole exchange, a size
// cap on the body (announced and received), no redirect followed (a redirect
// would carry the Authorization header elsewhere). Resolves
// { status, headers, body } for any status; rejects an LhmError for the
// transport failures. https (Libre Hardware Monitor behind a reverse proxy)
// checks the certificate like a browser: no exception.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { CODES, LhmError } from './errors.js';

const TLS_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
]);

export function transportError(err) {
  const code = String(err?.code ?? '');
  if (TLS_ERRORS.has(code)) {
    return new LhmError(CODES.TLS_UNTRUSTED, `Certificate refused (${code})`);
  }
  // Something answered, but not in HTTP / TLS (a wrong port or scheme).
  if (code.startsWith('HPE_') || code === 'EPROTO' || code.startsWith('ERR_SSL_')) {
    return new LhmError(CODES.BAD_ANSWER, `Not the expected protocol (${code})`);
  }
  // Only the code: a Node message may quote a header (never the password, but
  // nothing of a request goes to the logs).
  return new LhmError(CODES.UNREACHABLE, code || 'Connection failed');
}

/**
 * @param {string} url absolute http(s) URL
 * @param {object} options
 * @param {Record<string, string>} [options.headers]
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} options.maxBytes body size cap
 */
export function httpRequest(url, { headers = {}, timeout, maxBytes } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let settled = false;
    let req = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () => finish(new LhmError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`)),
      timeout,
    );

    try {
      req = lib.request(
        target,
        {
          method: 'GET',
          headers: { accept: 'application/json', ...headers },
          agent: false,
          ...(lib === https ? { rejectUnauthorized: true } : {}),
        },
        (res) => {
          const announced = Number(res.headers['content-length']);
          if (Number.isFinite(announced) && announced > maxBytes) {
            finish(new LhmError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
            return;
          }
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              finish(new LhmError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            finish(null, {
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on('error', (err) => finish(transportError(err)));
        },
      );
      req.on('error', (err) => finish(transportError(err)));
      req.end();
    } catch (err) {
      // lib.request throws synchronously on a header it refuses: a failure, never a crash.
      finish(transportError(err));
    }
  });
}
