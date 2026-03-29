const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const BASE = 'http://127.0.0.1:3100';

let server;

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/state`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: '3100' },
    stdio: 'ignore'
  });
  await waitForServer();
});

test.after(() => {
  if (server && !server.killed) server.kill('SIGTERM');
});

test('state endpoint returns tick and civ list', async () => {
  const res = await fetch(`${BASE}/state`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(typeof json.tick, 'number');
  assert.ok(Array.isArray(json.civs));
  assert.ok(json.civs.length >= 4);
});

test('message:send validates required fields', async () => {
  const res = await fetch(`${BASE}/message:send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'CivA' })
  });
  assert.equal(res.status, 400);
});

test('reset endpoint returns tick=0', async () => {
  const res = await fetch(`${BASE}/control/reset`, { method: 'POST' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.tick, 0);
});
