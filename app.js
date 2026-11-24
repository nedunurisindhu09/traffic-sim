(() => {
  const canvas = document.querySelector('#city');
  const ctx = canvas.getContext('2d');
  const $ = (selector) => document.querySelector(selector);
  const settings = { demand: 24, lanes: 2, speed: 1, running: false, network: 'grid' };
  const model = { nodes: [], edges: [], cars: [], seconds: 0, trips: 0, tripSeconds: 0, spawnCarry: 0, nextCarId: 0, nodeFreeAt: new Map() };
  const palettes = ['#ffad78', '#a7e4c2', '#8dbaf1', '#e5a2d0', '#f4d77d'];
  const configs = {
    grid: { title: 'Downtown grid', nodes: [[.17,.25],[.50,.25],[.83,.25],[.17,.50],[.50,.50],[.83,.50],[.17,.75],[.50,.75],[.83,.75]], edges: [[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[3,6],[1,4],[4,7],[2,5],[5,8]] },
    cross: { title: 'Four-way junction', nodes: [[.50,.17],[.50,.50],[.50,.83],[.17,.50],[.83,.50]], edges: [[0,1],[1,2],[3,1],[1,4]] },
    flyover: { title: 'Crossing flyover', nodes: [[.17,.50],[.42,.50],[.58,.50],[.83,.50],[.50,.17],[.50,.42],[.50,.58],[.50,.83]], edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7]], bridge: [1,2] },
    arterial: { title: 'Wide arterial', nodes: [[.12,.50],[.34,.50],[.56,.50],[.78,.50],[.34,.24],[.34,.76],[.78,.24],[.78,.76]], edges: [[0,1],[1,2],[2,3],[1,4],[1,5],[3,6],[3,7]] }
  };

  function buildNetwork(name) {
    const config = configs[name];
    model.nodes = config.nodes.map(([x,y],id) => ({ id,x,y }));
    model.edges = config.edges.map(([a,b],id) => ({ id,a,b,length: distance(model.nodes[a],model.nodes[b]), bridge: Boolean(config.bridge && config.bridge[0] === a && config.bridge[1] === b) }));
    model.cars = []; model.seconds = 0; model.trips = 0; model.tripSeconds = 0; model.spawnCarry = 0; model.nodeFreeAt.clear();
    $('#map-title').textContent = config.title;
    updateMetrics(); draw();
  }
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  function shortestRoute(start, end) {
    const dist = model.nodes.map(() => Infinity), previous = Array(model.nodes.length).fill(null), visited = new Set();
    dist[start] = 0;
    while (visited.size < model.nodes.length) {
      let current = -1;
      for (let i=0;i<dist.length;i++) if (!visited.has(i) && (current < 0 || dist[i] < dist[current])) current = i;
      if (current < 0 || dist[current] === Infinity || current === end) break;
      visited.add(current);
      for (const edge of model.edges) {
        const next = edge.a === current ? edge.b : edge.b === current ? edge.a : -1;
        if (next < 0) continue;
        const density = model.cars.filter(car => car.edgeId === edge.id).length;
        const cost = edge.length * (1 + density * .018 / settings.lanes);
        if (dist[current] + cost < dist[next]) { dist[next] = dist[current] + cost; previous[next] = { node: current, edge: edge.id }; }
      }
    }
    if (!previous[end]) return null;
    const path=[]; let node=end;
    while (node !== start) { const item=previous[node]; if (!item) return null; path.unshift({edgeId:item.edge, from:item.node, to:node}); node=item.node; }
    return path;
  }
  function spawnCar() {
    if (model.nodes.length < 2 || model.cars.length >= 280) return;
    const start = Math.floor(Math.random()*model.nodes.length);
    let end = Math.floor(Math.random()*model.nodes.length);
    for (let tries=0;end===start && tries<8;tries++) end=Math.floor(Math.random()*model.nodes.length);
    if (end===start) return;
    const route=shortestRoute(start,end); if (!route?.length) return;
    model.cars.push({ id:model.nextCarId++, startTime:model.seconds, from:start, to:end, route, leg:0, progress:0, color:palettes[Math.floor(Math.random()*palettes.length)] });
  }
  function edgeAt(car) { return model.edges[car.route[car.leg].edgeId]; }
  function canEnter(car, nextLeg) {
    const node = car.route[car.leg].to;
    if ((model.nodeFreeAt.get(node) || 0) > model.seconds) return false;
    const nextEdgeId = car.route[nextLeg].edgeId;
    const occupied = model.cars.some(other => other !== car && other.route[other.leg]?.edgeId === nextEdgeId && other.route[other.leg].from === node && other.progress < .035);
    return !occupied;
  }
  function update(dt) {
    const simDt=dt*settings.speed;
    model.seconds += simDt;
    model.spawnCarry += simDt*settings.demand/60;
    while (model.spawnCarry >= 1) { spawnCar(); model.spawnCarry -= 1; }
    for (const car of [...model.cars]) {
      if (!car.route[car.leg]) continue;
      const leg=car.route[car.leg], edge=edgeAt(car);
      const congestion=model.cars.filter(other => other!==car && other.route[other.leg]?.edgeId===edge.id && other.route[other.leg].from===leg.from && other.progress>car.progress && other.progress-car.progress<.065).length;
      const speed=.105/(1 + congestion*2.3);
      car.progress += simDt*speed;
      if (car.progress >= edge.length) {
        if (car.leg === car.route.length-1) {
          model.trips++; model.tripSeconds += model.seconds-car.startTime;
          model.cars.splice(model.cars.indexOf(car),1); continue;
        }
        if (!canEnter(car,car.leg+1)) { car.progress=edge.length-.002; continue; }
        model.nodeFreeAt.set(leg.to,model.seconds+.48);
        car.leg++; car.progress=0;
      }
    }
  }
  function updateMetrics() {
    $('#cars').textContent=model.cars.length;
    $('#travel').textContent=model.trips ? (model.tripSeconds/model.trips).toFixed(1) : '—';
    $('#flow').textContent=model.trips;
    const capacity=Math.max(1,model.edges.length*settings.lanes*3);
    $('#load').textContent=`${Math.min(100,Math.round(model.cars.length/capacity*100))}%`;
    const minutes=Math.floor(model.seconds/60), seconds=Math.floor(model.seconds%60);
    $('#clock').textContent=`${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
  function sizeCanvas() {
    const box=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    if (canvas.width !== Math.round(box.width*dpr) || canvas.height !== Math.round(box.height*dpr)) { canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function point(node,w,h) { return {x: node.x*w, y: node.y*h}; }
  function draw() {
    sizeCanvas(); const w=canvas.clientWidth,h=canvas.clientHeight;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#111d29';ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#1c2936';ctx.lineWidth=1;
    for(let x=18;x<w;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=18;y<h;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    for(const edge of model.edges){
      const a=point(model.nodes[edge.a],w,h),b=point(model.nodes[edge.b],w,h), lanes=settings.lanes;
      if(edge.bridge){ctx.strokeStyle='#0b131c';ctx.lineWidth=lanes*12+15;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      ctx.strokeStyle=edge.bridge?'#426a91':'#3a4856';ctx.lineWidth=lanes*6+7;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      ctx.strokeStyle=edge.bridge?'#70a9e8':'#687786';ctx.lineWidth=1.2;ctx.setLineDash([5,7]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    }
    // Draw an overpass deck after the crossing road so its elevation reads clearly.
    const bridge=model.edges.find(edge=>edge.bridge);
    if(bridge){const a=point(model.nodes[bridge.a],w,h),b=point(model.nodes[bridge.b],w,h);ctx.strokeStyle='#111d29';ctx.lineWidth=settings.lanes*6+13;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.strokeStyle='#426a91';ctx.lineWidth=settings.lanes*6+6;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.strokeStyle='#70a9e8';ctx.lineWidth=1.2;ctx.setLineDash([5,7]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);}
    for(const node of model.nodes){const p=point(node,w,h);ctx.beginPath();ctx.arc(p.x,p.y,5.2,0,Math.PI*2);ctx.fillStyle='#a7e4c2';ctx.fill();ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.strokeStyle='#a7e4c244';ctx.lineWidth=1;ctx.stroke();}
    for(const car of model.cars){
      const leg=car.route[car.leg], edge=edgeAt(car);if(!leg||!edge)continue;
      const from=point(model.nodes[leg.from],w,h),to=point(model.nodes[leg.to],w,h),t=Math.max(0,Math.min(1,car.progress/edge.length));
      const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t,angle=Math.atan2(to.y-from.y,to.x-from.x);
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.shadowColor=car.color;ctx.shadowBlur=9;ctx.fillStyle=car.color;ctx.beginPath();ctx.roundRect(-6,-3.4,12,6.8,2);ctx.fill();ctx.restore();
    }
  }
  let prior=performance.now(), accumulator=0, uiTime=0;
  function frame(now){const dt=Math.min(.05,(now-prior)/1000);prior=now;accumulator+=dt;uiTime+=dt;if(settings.running)update(dt);draw();if(uiTime>.2){updateMetrics();uiTime=0;}requestAnimationFrame(frame);}
  $('#demand').addEventListener('input',event=>{settings.demand=Number(event.target.value);$('#demand-value').textContent=settings.demand;});
  $('#road-width').addEventListener('input',event=>{settings.lanes=Number(event.target.value);$('#width-value').textContent=`${settings.lanes} ${settings.lanes===1?'lane':'lanes'}`;});
  $('#network').addEventListener('change',event=>{settings.network=event.target.value;buildNetwork(settings.network);});
  $('#play').addEventListener('click',()=>{settings.running=!settings.running;$('#play').innerHTML=settings.running?'<span class="play-icon">Ⅱ</span> Pause simulation':'<span class="play-icon">▶</span> Start simulation';$('#status').textContent=settings.running?'RUNNING':'PAUSED';$('#status-dot').classList.toggle('running',settings.running);});
  $('#reset').addEventListener('click',()=>{settings.running=false;$('#play').innerHTML='<span class="play-icon">▶</span> Start simulation';$('#status').textContent='READY';$('#status-dot').classList.remove('running');buildNetwork(settings.network);});
  document.querySelectorAll('.segmented button').forEach(button=>button.addEventListener('click',()=>{settings.speed=Number(button.dataset.speed);document.querySelectorAll('.segmented button').forEach(other=>other.classList.toggle('selected',other===button));}));
  const dialog=$('#about');$('#help-button').addEventListener('click',()=>dialog.showModal());$('.dialog-close').addEventListener('click',()=>dialog.close());
  window.addEventListener('resize',draw);
  buildNetwork(settings.network);requestAnimationFrame(frame);
})();
