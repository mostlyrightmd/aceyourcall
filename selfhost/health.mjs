import { readFileSync } from 'node:fs';
import { request } from 'node:http';
const c = JSON.parse(readFileSync('/config/app.json', 'utf8'));
// Node fetch derives Host from its URL. Use HTTP's explicit Host header so
// the loopback probe also works when the public origin is an HTTPS domain.
for (const [port, path, headers] of [
  [c.CALL_PORT, '/config', { Host: new URL(c.MP_CALL_ORIGIN).host }],
  [c.PORT, '/api/state?summary=1', { Origin: `http://localhost:${c.PORT}` }],
]) {
  await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers, timeout: 3000 }, res => {
      res.resume();
      res.on('end', () => res.statusCode === 200 ? resolve() : reject(Error(`Health probe: HTTP ${res.statusCode}`)));
    });
    req.on('timeout', () => req.destroy(Error('Health probe timed out')));
    req.on('error', reject);
    req.end();
  });
}
