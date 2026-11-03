import { createServer, request } from 'node:http';
// LiveKit's bridge cannot reach host loopback. Expose only the signed webhook
// endpoint on the Docker bridge gateway, never the app or operator API.
export function webhookRelay(config) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/rtc-events') {
      res.writeHead(404); res.end(); return;
    }
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 100000) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const upstream = request({ hostname: '127.0.0.1', port: config.CALL_PORT,
        path: '/rtc-events', method: 'POST', timeout: 5000,
        headers: { Host: new URL(config.MP_CALL_ORIGIN).host,
          'Content-Type': 'application/webhook+json', 'Content-Length': body.length,
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
      }, response => { res.writeHead(response.statusCode); response.pipe(res); });
      upstream.on('timeout', () => upstream.destroy(Error('Webhook timeout')));
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      upstream.end(body);
    } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
