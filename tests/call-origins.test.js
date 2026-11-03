import test from 'node:test';
import assert from 'node:assert/strict';
import { requestOrigin } from '../src/call-origins.js';
test('explicit legacy hosts resolve to their own origin; arbitrary hosts are rejected', () => {
  const canonical = 'https://aceyourcall.com';
  const aliases = 'https://practice.mostlyright.md,https://www.aceyourcall.com';
  const resolve = host => requestOrigin({headers:{host}}, canonical, aliases);
  assert.equal(resolve('aceyourcall.com'), canonical);
  assert.equal(resolve('practice.mostlyright.md'), 'https://practice.mostlyright.md');
  assert.equal(resolve('www.aceyourcall.com'), 'https://www.aceyourcall.com');
  assert.equal(resolve('evil.test'), null);
  assert.equal(resolve('aceyourcall.com.evil.test'), null);
});
