const logsEl = document.getElementById('logs');
const causalEl = document.getElementById('causal');
const statusEl = document.getElementById('status');
const map = document.getElementById('map');
const ctx = map.getContext('2d');
const transitEl = document.getElementById('transitList');
const jumpInfo = document.getElementById('jumpInfo');

let latestSnapshot = null;
let eventCache = [];

function addLog(event) {
  const li = document.createElement('li');
  li.className = `tag-${event.severity || 'info'}`;
  li.textContent = `[T${event.tick}] ${event.type} ${JSON.stringify(event.data)}`;
  logsEl.prepend(li);
}

function addCausal(event) {
  if (!['strike', 'alert', 'intercept'].includes(event.type)) return;
  const li = document.createElement('li');
  if (event.type === 'strike') {
    const d = event.data;
    li.textContent = `T${event.tick} ${d.from} 对 ${d.to} 开火：threat=${d.threat}, conf=${d.confidence}, exp=${d.exposure}`;
  } else if (event.type === 'alert') {
    li.textContent = `T${event.tick} 告警：${event.data.detail}`;
  } else {
    li.textContent = `T${event.tick} 截获：${event.data.watcher} 监听 ${event.data.from}->${event.data.to}`;
  }
  causalEl.prepend(li);
}

function drawMap(snapshot) {
  ctx.clearRect(0, 0, map.width, map.height);
  ctx.strokeStyle = '#1f4f2f';
  for (let x = 20; x < map.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, map.height);
    ctx.stroke();
  }
  for (let y = 20; y < map.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(map.width, y);
    ctx.stroke();
  }

  for (const civ of snapshot.civs) {
    ctx.fillStyle = civ.alive ? '#84f2a3' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(civ.x, civ.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b9ffbf';
    ctx.fillText(`${civ.id} E:${civ.exposure.toFixed(2)} I:${civ.intel.toFixed(2)}`, civ.x + 10, civ.y - 10);
  }

  ctx.strokeStyle = '#ffd95e';
  for (const msg of snapshot.inTransit) {
    const from = snapshot.civs.find((c) => c.id === msg.from);
    const to = snapshot.civs.find((c) => c.id === msg.to);
    if (!from || !to) continue;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

function renderTransit(snapshot) {
  transitEl.innerHTML = '';
  for (const msg of snapshot.inTransit) {
    const li = document.createElement('li');
    const flag = msg.flags.isSpoofed ? 'SPOOF' : msg.flags.isReplay ? 'REPLAY' : 'OK';
    li.textContent = `${msg.from} -> ${msg.to}, 到达T${msg.tickArrive}, ${flag}`;
    transitEl.appendChild(li);
  }
}

function onSnapshot(snapshot) {
  latestSnapshot = snapshot;
  statusEl.textContent = `Tick ${snapshot.tick}/${snapshot.maxTicks}`;
  drawMap(snapshot);
  renderTransit(snapshot);
}

function connect() {
  const es = new EventSource('/stream/events');
  es.addEventListener('event', (ev) => {
    const data = JSON.parse(ev.data);
    eventCache.push(data);
    addLog(data);
    addCausal(data);
  });
  es.addEventListener('snapshot', (ev) => onSnapshot(JSON.parse(ev.data)));
  es.addEventListener('done', (ev) => {
    const data = JSON.parse(ev.data);
    addLog({ tick: latestSnapshot?.tick || 0, type: 'done', severity: 'critical', data });
  });
}

async function start() {
  await fetch('/control/start', { method: 'POST' });
}

async function reset() {
  await fetch('/control/reset', { method: 'POST' });
  eventCache = [];
  logsEl.innerHTML = '';
  causalEl.innerHTML = '';
  jumpInfo.textContent = '已重置并重新开始。';
}

document.getElementById('startBtn').addEventListener('click', start);
document.getElementById('resetBtn').addEventListener('click', reset);
document.querySelectorAll('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = Number(btn.dataset.jump);
    const found = eventCache.filter((e) => e.tick === target);
    jumpInfo.textContent = found.length
      ? `T${target} 有 ${found.length} 条事件，可在左侧日志查看。`
      : `T${target} 暂无关键事件。`;
  });
});

connect();
