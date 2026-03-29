const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SCRIPT_PATH = path.join(ROOT, 'demo', 'script.json');

function loadScript() {
  return JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf-8'));
}

let script = loadScript();

function createInitialState(inputScript) {
  return {
    tick: 0,
    maxTicks: inputScript.ticks,
    running: false,
    civs: inputScript.civs.map((c) => ({
      ...c,
      alive: true,
      exposure: 0.1,
      intel: 0.2,
      energy: 1
    })),
    events: [],
    inTransit: []
  };
}

let state = createInitialState(script);
const sseClients = new Set();
let timer = null;

function sendSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function findCiv(id) {
  return state.civs.find((c) => c.id === id);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function logEvent(event) {
  state.events.push(event);
  sendSSE('event', event);
}

function calcArrivalTick(fromId, toId) {
  const from = findCiv(fromId);
  const to = findCiv(toId);
  if (!from || !to) return state.tick + 1;
  const d = distance(from, to);
  const ticks = Math.max(1, Math.ceil(d / 160));
  return state.tick + ticks;
}

function queueMessage({ from, to, type, payload = {}, meta = {} }) {
  const fromCiv = findCiv(from);
  const toCiv = findCiv(to);
  if (!fromCiv || !toCiv) {
    throw new Error('from/to civ does not exist');
  }

  const message = {
    messageId: randomUUID(),
    contextId: 'demo-session-1',
    from,
    to,
    type,
    payload,
    meta: {
      sigValid: meta.sigValid ?? true,
      isReplay: meta.isReplay ?? false,
      isSpoofed: meta.isSpoofed ?? false,
      sourceTrust: meta.sourceTrust ?? 0.8
    },
    tickCreated: state.tick,
    tickArrive: calcArrivalTick(from, to)
  };
  state.inTransit.push(message);
  logEvent({ tick: state.tick, type: 'message_sent', severity: 'info', data: message });
  return message;
}

function applyScriptedEvent(item) {
  if (item.type === 'spoof_message') {
    queueMessage({
      from: item.from,
      to: item.to,
      type: 'diplomacy',
      payload: item.payload,
      meta: {
        sigValid: item.payload.sigValid,
        isSpoofed: item.payload.isSpoofed,
        sourceTrust: item.payload.sourceTrust
      }
    });
    logEvent({
      tick: state.tick,
      type: 'alert',
      severity: 'warning',
      data: {
        title: 'Signature mismatch detected',
        detail: `${item.from} -> ${item.to} ceasefire message looks spoofed.`
      }
    });
    return;
  }

  if (item.type === 'intercept') {
    logEvent({
      tick: state.tick,
      type: 'intercept',
      severity: 'warning',
      data: {
        watcher: item.watcher,
        from: item.from,
        to: item.to,
        confidence: item.payload.confidence
      }
    });
    const watcher = findCiv(item.watcher);
    if (watcher) watcher.intel = Math.min(1, watcher.intel + 0.15);
    return;
  }

  if (item.type === 'strike') {
    const target = findCiv(item.to);
    const attacker = findCiv(item.from);
    if (target && target.alive) target.alive = false;
    if (attacker) attacker.exposure = Math.min(1, attacker.exposure + 0.2);
    logEvent({
      tick: state.tick,
      type: 'strike',
      severity: 'critical',
      data: {
        from: item.from,
        to: item.to,
        reason: item.payload.reason,
        threat: item.payload.threat,
        confidence: item.payload.confidence,
        exposure: item.payload.exposure
      }
    });
  }
}

function deliverDueMessages() {
  const pending = [];
  for (const msg of state.inTransit) {
    if (msg.tickArrive <= state.tick) {
      logEvent({ tick: state.tick, type: 'message_delivered', severity: 'info', data: msg });
      const receiver = findCiv(msg.to);
      if (receiver) {
        receiver.exposure = Math.min(1, receiver.exposure + 0.05);
        receiver.intel = Math.min(1, receiver.intel + (msg.meta.isSpoofed ? 0.02 : 0.08));
      }
    } else {
      pending.push(msg);
    }
  }
  state.inTransit = pending;
}

function judge() {
  const alive = state.civs.filter((c) => c.alive);
  if (alive.length <= 1) {
    return { terminal: true, reason: 'LAST_SURVIVOR', winners: alive.map((c) => c.id) };
  }
  if (state.tick >= state.maxTicks) {
    return { terminal: true, reason: 'MAX_TICKS', winners: alive.map((c) => c.id) };
  }
  return { terminal: false, reason: '', winners: [] };
}

function emitSnapshot() {
  sendSSE('snapshot', {
    tick: state.tick,
    maxTicks: state.maxTicks,
    civs: state.civs,
    inTransit: state.inTransit.map((m) => ({
      messageId: m.messageId,
      from: m.from,
      to: m.to,
      tickArrive: m.tickArrive,
      flags: m.meta
    }))
  });
}

function stopSimulation() {
  state.running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function step() {
  state.tick += 1;
  logEvent({ tick: state.tick, type: 'tick_start', severity: 'info', data: { tick: state.tick } });

  for (const ev of script.events.filter((e) => e.tick === state.tick)) {
    applyScriptedEvent(ev);
  }

  deliverDueMessages();
  emitSnapshot();

  const result = judge();
  if (result.terminal) {
    stopSimulation();
    logEvent({ tick: state.tick, type: 'match_end', severity: 'critical', data: result });
    sendSSE('done', result);
  }
}

function startSimulation() {
  if (state.running) return;
  state.running = true;
  timer = setInterval(() => {
    if (!state.running) return;
    step();
  }, script.tickMs || 1000);
}

function resetSimulation() {
  stopSimulation();
  script = loadScript();
  state = createInitialState(script);
  logEvent({ tick: state.tick, type: 'reset', severity: 'info', data: { ok: true } });
  emitSnapshot();
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function safeJoinPublic(urlPath) {
  const normalized = path.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(ROOT, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  return filePath;
}

function serveFile(filePath, res) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/stream/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('event: ready\ndata: {"ok":true}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/state') {
    return json(res, 200, {
      tick: state.tick,
      maxTicks: state.maxTicks,
      running: state.running,
      civs: state.civs,
      inTransit: state.inTransit,
      eventCount: state.events.length
    });
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    return json(res, 200, { events: state.events.slice(-200) });
  }

  if (req.method === 'POST' && url.pathname === '/message:send') {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString('utf-8')));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        if (!parsed.from || !parsed.to || !parsed.type) {
          return json(res, 400, { ok: false, error: 'from/to/type are required' });
        }
        const msg = queueMessage(parsed);
        return json(res, 200, { ok: true, message: msg });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/control/start') {
    startSimulation();
    return json(res, 200, { ok: true, running: state.running });
  }

  if (req.method === 'POST' && url.pathname === '/control/reset') {
    resetSimulation();
    return json(res, 200, { ok: true, running: state.running, tick: state.tick });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    serveFile(path.join(PUBLIC_DIR, 'index.html'), res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    const filePath = safeJoinPublic(url.pathname);
    if (!filePath) return json(res, 400, { ok: false, error: 'invalid path' });
    serveFile(filePath, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`dark-a2a demo server running on http://localhost:${PORT}`);
  startSimulation();
});
