// -----------------------------------------------------------------------------
// The transport and the client against loopback servers (no other network):
// size caps, deadline, no redirect followed, the Basic header, the errors.
// -----------------------------------------------------------------------------

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { LhmClient, retryAfterMs } from '../src/lhm/client.js';
import { CODES, isAuthRefused } from '../src/lhm/errors.js';
import { httpRequest } from '../src/lhm/http.js';
import { PASSWORD, USERNAME, lhmTree } from './helpers/fakeLhm.js';

let server;
let base;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization });
    switch (req.url) {
      case '/data.json': {
        const expected = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
        if (req.headers.authorization && req.headers.authorization !== expected) {
          res.writeHead(401, { 'www-authenticate': 'Basic' }).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`\uFEFF${JSON.stringify(lhmTree())}`);
        return;
      }
      case '/big/data.json':
        res.writeHead(200, { 'content-length': String(20 * 1024 * 1024) });
        res.write('x');
        return; // never ends: the announced size is refused first
      case '/stream/data.json':
        res.writeHead(200);
        // Chunked, no announced size: refused once the cap is crossed.
        for (let i = 0; i < 9; i += 1) res.write(Buffer.alloc(1024 * 1024, 32));
        res.end();
        return;
      case '/slow/data.json':
        return; // never answers
      case '/redirect/data.json':
        res.writeHead(302, { location: 'http://203.0.113.1/steal' }).end();
        return;
      case '/busy/data.json':
        res.writeHead(429, { 'retry-after': '120' }).end();
        return;
      case '/html/data.json':
        res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
        return;
      case '/other/data.json':
        res.writeHead(200).end('{"hello":"world"}');
        return;
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

const client = (path = '', credentials = null) =>
  new LhmClient({ lhm: { base: `${base}${path}` }, credentials });

test('reads /data.json (a BOM tolerated), without an Authorization header by default', async () => {
  const data = await client().data();
  assert.equal(data.computer, 'GAMING');
  assert.equal(data.hardware.length, 4);
  assert.equal(seen.at(-1).authorization, undefined);
});

test('Basic authentication: the header, and a refusal', async () => {
  await client('', { username: USERNAME, password: PASSWORD }).data();
  assert.equal(
    seen.at(-1).authorization,
    `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`,
  );
  const err = await client('', { username: USERNAME, password: 'wrong' })
    .data()
    .catch((e) => e);
  assert.equal(err.code, CODES.HTTP);
  assert.equal(err.status, 401);
  assert.ok(isAuthRefused(err));
  assert.ok(!JSON.stringify({ ...err, message: err.message }).includes('wrong'));
});

test('size caps: announced, then received', async () => {
  const announced = await httpRequest(`${base}/big/data.json`, {
    timeout: 5000,
    maxBytes: 8 * 1024 * 1024,
  }).catch((e) => e);
  assert.equal(announced.code, CODES.TOO_LARGE);
  const streamed = await httpRequest(`${base}/stream/data.json`, {
    timeout: 5000,
    maxBytes: 8 * 1024 * 1024,
  }).catch((e) => e);
  assert.equal(streamed.code, CODES.TOO_LARGE);
});

test('a deadline for the whole exchange', async () => {
  const err = await httpRequest(`${base}/slow/data.json`, { timeout: 200, maxBytes: 1024 }).catch(
    (e) => e,
  );
  assert.equal(err.code, CODES.TIMEOUT);
});

test('a redirect is not followed (it would carry the Authorization header)', async () => {
  const before = seen.length;
  const err = await client('/redirect', { username: USERNAME, password: PASSWORD })
    .data()
    .catch((e) => e);
  assert.equal(err.code, CODES.HTTP);
  assert.equal(err.status, 302);
  assert.equal(seen.length, before + 1, 'one request only');
});

test('429 with Retry-After; not JSON; not the tree; 404', async () => {
  const busy = await client('/busy')
    .data()
    .catch((e) => e);
  assert.equal(busy.status, 429);
  assert.equal(busy.retryAfterMs, 120_000);
  assert.equal(
    (
      await client('/html')
        .data()
        .catch((e) => e)
    ).code,
    CODES.BAD_ANSWER,
  );
  assert.equal(
    (
      await client('/other')
        .data()
        .catch((e) => e)
    ).code,
    CODES.BAD_ANSWER,
  );
  const missing = await client('/missing')
    .data()
    .catch((e) => e);
  assert.equal(missing.status, 404);
  assert.equal(isAuthRefused(missing), false);
});

test('no connection: unreachable, with the code only', async () => {
  const closed = net.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));
  const err = await new LhmClient({ lhm: { base: `http://127.0.0.1:${port}` } })
    .data()
    .catch((e) => e);
  assert.equal(err.code, CODES.UNREACHABLE);
  assert.equal(err.message, 'ECONNREFUSED');
});

test('a closed client sends nothing', async () => {
  const c = client();
  c.close();
  const before = seen.length;
  assert.equal((await c.data().catch((e) => e)).code, CODES.CLOSED);
  assert.equal(seen.length, before);
});

test('Retry-After: seconds only', () => {
  assert.equal(retryAfterMs('30'), 30_000);
  assert.equal(retryAfterMs(['5']), 5_000);
  assert.equal(retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT'), null);
  assert.equal(retryAfterMs('-1'), null);
  assert.equal(retryAfterMs(undefined), null);
});
