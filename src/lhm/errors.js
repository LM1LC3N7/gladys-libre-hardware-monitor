// -----------------------------------------------------------------------------
// LhmError: every failure of a request to Libre Hardware Monitor, with a code
// the app maps to a status, a retry policy or a message. Messages never carry
// the user name nor the password.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  TIMEOUT: 'timeout', // no answer in time
  TLS_UNTRUSTED: 'tls_untrusted', // certificate refused (https behind a proxy)
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  BAD_ANSWER: 'bad_answer', // not the JSON of Libre Hardware Monitor
  TOO_LARGE: 'too_large', // answer above the size cap
  CLOSED: 'closed', // the client was replaced (new configuration)
});

export class LhmError extends Error {
  constructor(code, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'LhmError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The web server asks for a user name and password, or refused them (HTTP
 * 401). Final: never retried without a user action (the configuration saved,
 * "Test the connection").
 */
export const isAuthRefused = (err) => err?.code === CODES.HTTP && err.status === 401;
