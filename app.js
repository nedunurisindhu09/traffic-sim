(() => {
  const canvas = document.querySelector('#city');
  const ctx = canvas.getContext('2d');
  const $ = (selector) => document.querySelector(selector);
  const state = { config: null, snapshot: null, networks: new Map(), running: false, speed: 1, loopToken: 0, busy: false };
  const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
  const api = async (path, data) => {
    const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  };
  const selectedConfig = () => ({ network: $('#network').value, demand: Number($('#demand').value), lanes: Number($('#road-width').value), greenSeconds: Number($('#signal-green').value), controller: $('#controller').value, seed: 2026 });
  const setStatus = (label, active = false) => { $('#status').textContent = label; $('#status-dot').classList.toggle('running', active); };
  const updateMetrics = (metrics, signals = []) => {
    $('#cars').textContent = metrics.activeVehicles;
    $('#queue').textContent = metrics.averageQueueLength.toFixed(1);
    $('#queue-detail').textContent = `vehicles / junction · peak ${metrics.peakQueueLength}`;
    $('#wait').textContent = metrics.averageWaitMinutes === null ? '—' : metrics.averageWaitMinutes.toFixed(2);
    $('#travel').textContent = metrics.averageTravelMinutes === null ? '—' : metrics.averageTravelMinutes.toFixed(2);
    $('#flow').textContent = metrics.throughputPerMinute.toFixed(1);
    $('#load').textContent = `${metrics.roadLoadPercent}%`;
    const adaptive = state.config?.controller === 'adaptive';
    $('#controller-mode-label').textContent = adaptive ? 'ADAPTIVE · SPILLBACK AWARE' : 'FIXED-TIME BASELINE';
    const prioritySignal = signals.find(signal => signal.spillbackRisk) || signals.find(signal => signal.downstreamBlockedVehicles > 0) || signals[0];
    $('#controller-explanation').textContent = prioritySignal?.explanation || 'No signalized junctions in this grade-separated layout.';
    const list = $('#signal-decisions');
    list.replaceChildren(...signals.map(signal => { const item = document.createElement('li'); item.textContent = `Junction ${signal.nodeId + 1} · ${signal.phase} green, ${Math.ceil(signal.remainingSeconds)}s left · queue ${signal.queueLength} · downstream free slots ${signal.downstreamFreeSlots} (${signal.downstreamBlockedVehicles} blocked) · ${signal.explanation}`; return item; }));
    const minutes = Math.floor(metrics.simulatedSeconds / 60), seconds = Math.floor(metrics.simulatedSeconds % 60);
    $('#clock').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };
  const fitCanvas = () => {
    const box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(box.width * dpr) || canvas.height !== Math.round(box.height * dpr)) { canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const point = (node, width, height) => ({ x: node.x * width, y: node.y * height });
  function draw() {
    if (!state.snapshot) return;
    fitCanvas();
    const width = canvas.clientWidth, height = canvas.clientHeight, view = state.snapshot, laneCount = state.config?.lanes || 1;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#111d29'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#1c2936'; ctx.lineWidth = 1;
    for (let x = 18; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 18; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    const paintRoad = (edge, bridge = false) => {
      const a = point(view.nodes[edge.a], width, height), b = point(view.nodes[edge.b], width, height);
      ctx.lineCap = 'round'; ctx.strokeStyle = '#0b131c'; ctx.lineWidth = laneCount * 12 + 14;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = bridge ? '#426a91' : '#3a4856'; ctx.lineWidth = laneCount * 10 + 8;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = bridge ? '#70a9e8' : '#687786'; ctx.lineWidth = 1.3; ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      const length = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
      ctx.strokeStyle = bridge ? '#89b8e7' : '#8d99a4'; ctx.lineWidth = 1;
      for (let lane = 1; lane < laneCount; lane++) {
        const offset = (lane - laneCount / 2) * 6, x1 = a.x + nx * offset, y1 = a.y + ny * offset, x2 = b.x + nx * offset, y2 = b.y + ny * offset;
        ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      }
      return { a, b, nx, ny, length };
    };
    for (const edge of view.edges.filter(edge => !edge.bridge)) paintRoad(edge);
    for (const edge of view.edges.filter(edge => edge.bridge)) paintRoad(edge, true);
    const signalMap = new Map(view.signals.map(signal => [signal.nodeId, signal]));
    for (const node of view.nodes) {
      const p = point(node, width, height), signal = signalMap.get(node.id);
      ctx.beginPath(); ctx.arc(p.x, p.y, node.signal ? 6 : 4.5, 0, Math.PI * 2); ctx.fillStyle = node.signal ? '#dfe8ed' : '#a7e4c2'; ctx.fill();
      if (signal) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.strokeStyle = signal.spillbackRisk ? '#ffac77' : '#a7e4c244'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = signal.phase === 'NS' ? '#a7e4c2' : '#ed7181'; ctx.beginPath(); ctx.arc(p.x + 13, p.y - 11, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = signal.phase === 'EW' ? '#a7e4c2' : '#ed7181'; ctx.beginPath(); ctx.arc(p.x + 21, p.y - 11, 3, 0, Math.PI * 2); ctx.fill();
        ctx.font = '8px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#c1ccd5';
        ctx.fillText(`${signal.phase} ${Math.ceil(signal.remainingSeconds)}s Q${signal.queueLength}`, p.x + 27, p.y - 8);
      }
    }
    for (const car of view.cars) {
      const edge = view.edges[car.edgeId], a = point(view.nodes[car.from], width, height), b = point(view.nodes[car.to], width, height);
      const length = Math.hypot(b.x - a.x, b.y - a.y), t = Math.max(0, Math.min(1, car.progress / Math.hypot(view.nodes[edge.a].x - view.nodes[edge.b].x, view.nodes[edge.a].y - view.nodes[edge.b].y)));
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length, direction = car.from === edge.a ? -1 : 1;
      const offset = direction * (car.lane + .5) * 5.3, x = a.x + (b.x - a.x) * t + nx * offset, y = a.y + (b.y - a.y) * t + ny * offset;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x)); ctx.shadowColor = car.color; ctx.shadowBlur = 8; ctx.fillStyle = car.color;
      ctx.beginPath(); ctx.roundRect(-6, -3.2, 12, 6.4, 2); ctx.fill(); ctx.restore();
    }
    updateMetrics(view.metrics, view.signals);
  }
  async function resetSimulation() {
    state.running = false; state.loopToken++;
    $('#play').innerHTML = '<span class="play-icon">▶</span> Start simulation'; setStatus('READY');
    state.config = selectedConfig();
    state.snapshot = await api('/api/simulation/reset', state.config);
    const compareSelect = $('#compare-network');
    if (compareSelect.value === state.config.network) compareSelect.value = [...compareSelect.options].find(option => option.value !== state.config.network)?.value || state.config.network;
    $('#map-title').textContent = state.networks.get(state.config.network) || state.config.network;
    $('#current-scenario').textContent = $('#map-title').textContent;
    draw();
  }
  async function runLoop(token) {
    while (state.running && token === state.loopToken) {
      try {
        state.snapshot = await api('/api/simulation/step', { seconds: .08 * state.speed });
        draw();
      } catch (error) { state.running = false; setStatus('ERROR'); $('#comparison-results').textContent = error.message; break; }
      await delay(50);
    }
  }
  async function compareScenarios() {
    const button = $('#compare'); button.disabled = true; button.textContent = 'Running…';
    $('#comparison-results').textContent = 'Simulating matched scenarios…';
    try {
      const first = selectedConfig(), second = { ...first, network: $('#compare-network').value };
      if (first.network === second.network) throw new Error('Choose a different network for Scenario B.');
      const comparison = await api('/api/simulation/compare', { first, second, duration: Number($('#compare-duration').value) });
      const [a, b] = comparison.results, titleA = state.networks.get(a.config.network) || a.config.network, titleB = state.networks.get(b.config.network) || b.config.network;
      const delta = (key, invert = false) => {
        const one = a.metrics[key], two = b.metrics[key];
        if (one == null || two == null) return '—';
        if (!one) return two ? 'new result' : 'no change';
        const percent = ((two - one) / one) * 100;
        if (invert) return `${Math.abs(percent).toFixed(0)}% ${percent > 0 ? 'more' : percent < 0 ? 'less' : 'same'}`;
        return `${percent >= 0 ? '+' : ''}${percent.toFixed(0)}%`;
      };
      $('#comparison-results').innerHTML = `<div class="result-card"><span>A · ${titleA}</span><strong>${a.metrics.throughputPerMinute.toFixed(1)} <small>trips/min</small></strong><small>wait ${a.metrics.averageWaitMinutes?.toFixed(2) ?? '—'} min · queue ${a.metrics.averageQueueLength.toFixed(1)} · congestion ${a.metrics.averageRoadLoadPercent}%</small></div><div class="result-card"><span>B · ${titleB}</span><strong>${b.metrics.throughputPerMinute.toFixed(1)} <small>trips/min</small></strong><small>wait ${b.metrics.averageWaitMinutes?.toFixed(2) ?? '—'} min · queue ${b.metrics.averageQueueLength.toFixed(1)} · congestion ${b.metrics.averageRoadLoadPercent}%</small></div><div class="result-delta"><span>B vs A</span><strong>${delta('throughputPerMinute')}</strong><small>throughput · ${delta('averageWaitMinutes', true)} average wait · ${delta('averageQueueLength', true)} queue</small></div>`;
    } catch (error) { $('#comparison-results').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Run comparison'; }
  }
  async function compareControllers() {
    const button = $('#compare-control'); button.disabled = true; button.textContent = 'Running matched trials…';
    $('#controller-results').textContent = 'Running fixed-time and adaptive simulations with the same arrival trace…';
    try {
      const comparison = await api('/api/simulation/compare-control', { config: selectedConfig(), duration: Number($('#controller-duration').value) });
      const [fixed, adaptive] = comparison.results, f = fixed.metrics, a = adaptive.metrics;
      const diff = (fixedValue, adaptiveValue, unit, decimals = 1, lowerBetter = true) => {
        const difference = adaptiveValue - fixedValue;
        const favorableDirection = lowerBetter ? difference < 0 : difference > 0;
        const direction = difference === 0 ? 'unchanged' : `${Math.abs(difference).toFixed(decimals)} ${unit} ${favorableDirection ? 'lower' : 'higher'}`;
        return direction;
      };
      const throughputPercent = f.throughputPerMinute ? (a.throughputPerMinute - f.throughputPerMinute) / f.throughputPerMinute * 100 : null;
      const throughputChange = throughputPercent === null ? 'no fixed-time trips' : `${throughputPercent >= 0 ? '+' : ''}${throughputPercent.toFixed(2)}%`;
      const waitChange = f.averageWaitMinutes == null || a.averageWaitMinutes == null ? 'not available' : diff(f.averageWaitMinutes, a.averageWaitMinutes, 'min', 2);
      const queueChange = diff(f.averageQueueLength, a.averageQueueLength, 'vehicles / junction', 2);
      const congestionChange = diff(f.averageRoadLoadPercent, a.averageRoadLoadPercent, 'percentage points');
      const card = (label, metrics) => `<div class="result-card"><span>${label}</span><strong>${metrics.throughputPerMinute.toFixed(1)} <small>trips/min</small></strong><small>wait ${metrics.averageWaitMinutes?.toFixed(2) ?? '—'} min · queue ${metrics.averageQueueLength.toFixed(1)} (peak ${metrics.peakQueueLength}) · congestion ${metrics.averageRoadLoadPercent}% · spillback events ${metrics.spillbackEvents}</small></div>`;
      $('#controller-results').innerHTML = `${card('A · FIXED-TIME', f)}${card('B · ADAPTIVE SPILLBACK-AWARE', a)}<div class="result-delta"><span>ADAPTIVE VS FIXED</span><strong>${throughputChange} throughput</strong><small>wait ${waitChange} · queue ${queueChange} · congestion ${congestionChange}<br>Matched demand trace: ${f.arrivalEvents} arrivals · seed ${comparison.config.seed}</small></div>`;
    } catch (error) { $('#controller-results').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Run controller comparison'; }
  }
  $('#demand').addEventListener('input', event => { $('#demand-value').textContent = event.target.value; });
  $('#road-width').addEventListener('input', event => { const value = Number(event.target.value); $('#width-value').textContent = `${value} ${value === 1 ? 'lane' : 'lanes'}`; });
  $('#signal-green').addEventListener('input', event => { $('#signal-value').textContent = `${event.target.value} sec`; });
  $('#demand').addEventListener('change', () => { resetSimulation().catch(showError); });
  $('#road-width').addEventListener('change', () => { resetSimulation().catch(showError); });
  $('#signal-green').addEventListener('change', () => { resetSimulation().catch(showError); });
  $('#network').addEventListener('change', () => { resetSimulation().catch(showError); });
  $('#controller').addEventListener('change', () => { resetSimulation().catch(showError); });
  $('#play').addEventListener('click', () => {
    if (state.busy) return;
    state.running = !state.running; state.loopToken++;
    $('#play').innerHTML = state.running ? '<span class="play-icon">Ⅱ</span> Pause simulation' : '<span class="play-icon">▶</span> Start simulation';
    setStatus(state.running ? 'RUNNING' : 'PAUSED', state.running);
    if (state.running) runLoop(state.loopToken);
  });
  $('#reset').addEventListener('click', () => { resetSimulation().catch(showError); });
  document.querySelectorAll('.segmented button').forEach(button => button.addEventListener('click', () => {
    state.speed = Number(button.dataset.speed); document.querySelectorAll('.segmented button').forEach(item => item.classList.toggle('selected', item === button));
  }));
  $('#compare').addEventListener('click', compareScenarios);
  $('#compare-control').addEventListener('click', compareControllers);
  const dialog = $('#about'); $('#help-button').addEventListener('click', () => dialog.showModal()); $('.dialog-close').addEventListener('click', () => dialog.close());
  window.addEventListener('resize', draw);
  function showError(error) { setStatus('ERROR'); $('#comparison-results').textContent = error.message; }
  async function start() {
    try {
      const config = await api('/api/config');
      state.networks = new Map(config.networks.map(network => [network.id, network.title]));
      $('#network').value = config.defaults.network; $('#demand').value = config.defaults.demand; $('#road-width').value = config.defaults.lanes; $('#signal-green').value = config.defaults.greenSeconds; $('#controller').value = config.defaults.controller;
      $('#demand-value').textContent = config.defaults.demand; $('#width-value').textContent = `${config.defaults.lanes} lanes`; $('#signal-value').textContent = `${config.defaults.greenSeconds} sec`;
      await resetSimulation(); requestAnimationFrame(function render() { draw(); requestAnimationFrame(render); });
    } catch (error) { showError(error); $('#map-title').textContent = 'Server unavailable'; }
  }
  start();
})();
