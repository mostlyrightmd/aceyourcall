import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { webhookRelay } from '../selfhost/webhook-relay.mjs';

test('self-host relay exposes only bounded webhooks and preserves authentication', async () => {
  let received;
  const app = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    received = { path: req.url, host: req.headers.host, auth: req.headers.authorization, body };
    res.writeHead(401); res.end('invalid signature');
  });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const relay = webhookRelay({ CALL_PORT: app.address().port, MP_CALL_ORIGIN: 'https://practice.example.test' });
  await new Promise(r => relay.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${relay.address().port}`;
  try {
    assert.equal((await fetch(url + '/config')).status, 404);
    assert.equal((await fetch(url + '/rtc-events')).status, 404);
    assert.equal(received, undefined);
    assert.equal((await fetch(url + '/rtc-events', { method: 'POST', body: 'x'.repeat(100001) })).status, 413);
    assert.equal(received, undefined);
    assert.equal((await fetch(url + '/rtc-events', { method: 'POST', headers: { Authorization: 'test-signature' }, body: '{}' })).status, 401);
    assert.deepEqual(received, { path: '/rtc-events', host: 'practice.example.test', auth: 'test-signature', body: '{}' });
  } finally {
    relay.closeAllConnections(); app.closeAllConnections();
    await Promise.all([new Promise(r => relay.close(r)), new Promise(r => app.close(r))]);
  }
});
