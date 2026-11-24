export const NETWORKS = {
  grid: { title: 'Downtown grid', nodes: [[.16,.22],[.50,.22],[.84,.22],[.16,.50],[.50,.50],[.84,.50],[.16,.78],[.50,.78],[.84,.78]], edges: [[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[3,6],[1,4],[4,7],[2,5],[5,8]] },
  cross: { title: 'Signalized cross', nodes: [[.50,.14],[.50,.50],[.50,.86],[.14,.50],[.86,.50]], edges: [[0,1],[1,2],[3,1],[1,4]] },
  flyover: { title: 'Crossing flyover', nodes: [[.13,.50],[.42,.50],[.58,.50],[.87,.50],[.50,.13],[.50,.42],[.50,.58],[.50,.87]], edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7]], bridges: [[1,2]] },
  arterial: { title: 'Wide arterial', nodes: [[.10,.50],[.32,.50],[.55,.50],[.78,.50],[.32,.20],[.32,.80],[.78,.20],[.78,.80]], edges: [[0,1],[1,2],[2,3],[1,4],[1,5],[3,6],[3,7]] }
};

export const DEFAULTS = { network: 'grid', demand: 24, lanes: 2, greenSeconds: 12, seed: 2026 };
export const LIMITS = { demand: [1, 90], lanes: [1, 4], greenSeconds: [4, 45], compareDuration: [60, 600] };

const COLORS = ['#ffad78', '#a7e4c2', '#8dbaf1', '#e5a2d0', '#f4d77d'];
const LENGTH = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function validateConfig(input = {}) {
  const config = { ...DEFAULTS, ...input };
  if (!Object.hasOwn(NETWORKS, config.network)) throw new RangeError('network must be grid, cross, flyover, or arterial');
  for (const [key, [minimum, maximum]] of Object.entries({ demand: LIMITS.demand, lanes: LIMITS.lanes, greenSeconds: LIMITS.greenSeconds })) {
    if (!Number.isFinite(config[key]) || config[key] < minimum || config[key] > maximum) throw new RangeError(`${key} must be between ${minimum} and ${maximum}`);
    config[key] = Math.round(config[key]);
  }
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xFFFFFFFF) throw new RangeError('seed must be an unsigned 32-bit integer');
  return config;
}

export class TrafficSimulation {
  constructor(input = {}) {
    this.config = validateConfig(input);
    const source = NETWORKS[this.config.network];
    this.nodes = source.nodes.map(([x, y], id) => ({ id, x, y, signal: null }));
    this.edges = source.edges.map(([a, b], id) => {
      const bridge = Boolean(source.bridges?.some(([x, y]) => x === a && y === b || x === b && y === a));
      return { id, a, b, length: LENGTH(this.nodes[a], this.nodes[b]), level: bridge ? 1 : 0, bridge };
    });
    this.adjacency = this.nodes.map(() => []);
    for (const edge of this.edges) { this.adjacency[edge.a].push(edge.id); this.adjacency[edge.b].push(edge.id); }
    let signalIndex = 0;
    for (const node of this.nodes) if (this.adjacency[node.id].length >= 3) {
      node.signal = { greenSeconds: this.config.greenSeconds, offset: signalIndex++ * this.config.greenSeconds / Math.max(1, this.adjacency.filter(ids => ids.length >= 3).length) };
    }
    this.random = seededRandom(this.config.seed);
    this.seconds = 0; this.trips = 0; this.tripSeconds = 0; this.tripWaitSeconds = 0;
    this.spawnCarry = 0; this.nextId = 1; this.cars = []; this.nodeFreeAt = new Map();
  }

  getEdgeFor(car) { return this.edges[car.route[car.leg].edgeId]; }

  getSignalPhase(nodeId) {
    const signal = this.nodes[nodeId]?.signal;
    if (!signal) return 'none';
    const phase = (this.seconds + signal.offset) % (signal.greenSeconds * 2);
    return phase < signal.greenSeconds ? 'NS' : 'EW';
  }

  edgeAxis(edge, from) {
    const a = this.nodes[from], b = this.nodes[edge.a === from ? edge.b : edge.a];
    return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? 'EW' : 'NS';
  }

  shortestRoute(start, destination) {
    const distance = this.nodes.map(() => Infinity), previous = Array(this.nodes.length).fill(null), visited = new Set();
    distance[start] = 0;
    while (visited.size < this.nodes.length) {
      let current = -1;
      for (let i = 0; i < distance.length; i++) if (!visited.has(i) && (current < 0 || distance[i] < distance[current])) current = i;
      if (current < 0 || distance[current] === Infinity || current === destination) break;
      visited.add(current);
      for (const edgeId of this.adjacency[current]) {
        const edge = this.edges[edgeId], next = edge.a === current ? edge.b : edge.a;
        const traffic = this.cars.filter(car => car.edgeId === edgeId).length;
        const cost = edge.length * (1 + traffic * .02 / this.config.lanes);
        if (distance[current] + cost < distance[next]) { distance[next] = distance[current] + cost; previous[next] = { node: current, edgeId }; }
      }
    }
    if (start === destination || !previous[destination]) return null;
    const route = []; let node = destination;
    while (node !== start) { const step = previous[node]; if (!step) return null; route.unshift({ edgeId: step.edgeId, from: step.node, to: node }); node = step.node; }
    return route;
  }

  spawnCar() {
    if (this.cars.length >= 500) return;
    const start = Math.floor(this.random() * this.nodes.length);
    let destination = Math.floor(this.random() * (this.nodes.length - 1));
    if (destination >= start) destination++;
    const route = this.shortestRoute(start, destination);
    if (!route?.length) return;
    const firstEdge = route[0].edgeId, firstFrom = route[0].from;
    const counts = Array(this.config.lanes).fill(0);
    for (const car of this.cars) if (car.edgeId === firstEdge && car.from === firstFrom && car.progress < .055) counts[car.lane]++;
    const lane = counts.indexOf(Math.min(...counts));
    this.cars.push({ id: this.nextId++, start, destination, route, leg: 0, edgeId: firstEdge, from: firstFrom, to: route[0].to, progress: 0, lane, color: COLORS[Math.floor(this.random() * COLORS.length)], startSeconds: this.seconds, waiting: 0 });
  }

  signalAllows(nodeId, incomingEdge) {
    if (!this.nodes[nodeId].signal) return true;
    // A green phase serves traffic entering from that approach, including its turns.
    return this.edgeAxis(incomingEdge, nodeId) === this.getSignalPhase(nodeId);
  }

  chooseLane(edgeId, from) {
    const counts = Array(this.config.lanes).fill(0);
    for (const car of this.cars) if (car.edgeId === edgeId && car.from === from && car.progress < .055) counts[car.lane]++;
    const lane = counts.indexOf(Math.min(...counts));
    return counts[lane] === 0 ? lane : -1;
  }

  tick(dt) {
    this.seconds += dt;
    this.spawnCarry += dt * this.config.demand / 60;
    while (this.spawnCarry >= 1) { this.spawnCar(); this.spawnCarry -= 1; }
    const ordered = [...this.cars].sort((a, b) => a.edgeId - b.edgeId || a.from - b.from || a.lane - b.lane || b.progress - a.progress);
    for (const car of ordered) {
      const edge = this.getEdgeFor(car), leg = car.route[car.leg];
      const ahead = this.cars.filter(other => other !== car && other.edgeId === car.edgeId && other.from === car.from && other.lane === car.lane && other.progress > car.progress).reduce((nearest, other) => Math.min(nearest, other.progress), Infinity);
      const headway = .038;
      let speed = .14;
      if (ahead < Infinity) speed = Math.min(speed, Math.max(0, (ahead - car.progress - headway) / dt));
      const atEnd = car.progress + speed * dt >= edge.length;
      let canExit = true;
      if (atEnd && car.leg < car.route.length - 1) {
        const nextLeg = car.route[car.leg + 1], nextEdge = this.edges[nextLeg.edgeId];
        canExit = this.signalAllows(leg.to, edge) && (this.nodeFreeAt.get(leg.to) || 0) <= this.seconds;
        if (canExit && this.chooseLane(nextLeg.edgeId, leg.to) < 0) canExit = false;
      }
      if (atEnd && !canExit) { car.progress = Math.max(car.progress, edge.length - .018); car.waiting += dt; continue; }
      const movement = Math.min(speed * dt, edge.length - car.progress);
      car.progress += movement;
      if (movement < .002) car.waiting += dt;
      if (car.progress >= edge.length - 1e-9) {
        if (car.leg === car.route.length - 1) {
          this.trips++; this.tripSeconds += this.seconds - car.startSeconds; this.tripWaitSeconds += car.waiting;
          this.cars.splice(this.cars.indexOf(car), 1);
          continue;
        }
        const nextLeg = car.route[car.leg + 1];
        this.nodeFreeAt.set(leg.to, this.seconds + .22);
        car.leg++; car.edgeId = nextLeg.edgeId; car.from = nextLeg.from; car.to = nextLeg.to; car.progress = 0;
        car.lane = Math.max(0, this.chooseLane(nextLeg.edgeId, nextLeg.from));
      }
    }
  }

  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1) throw new RangeError('step duration must be greater than 0 and at most 1 second');
    const target = this.seconds + seconds;
    while (this.seconds + 1e-9 < target) this.tick(Math.min(.05, target - this.seconds));
    return this.snapshot();
  }

  getMetrics() {
    const capacity = this.edges.reduce((sum, edge) => sum + Math.max(1, Math.floor(edge.length / .038) * this.config.lanes * 2), 0);
    const load = Math.min(100, this.cars.length / capacity * 100);
    return { activeVehicles: this.cars.length, completedTrips: this.trips, averageTravelMinutes: this.trips ? this.tripSeconds / this.trips / 60 : null, averageWaitMinutes: this.trips ? this.tripWaitSeconds / this.trips / 60 : null, throughputPerMinute: this.seconds ? this.trips / (this.seconds / 60) : 0, roadLoadPercent: Number(load.toFixed(1)), simulatedSeconds: Number(this.seconds.toFixed(2)) };
  }

  snapshot() {
    const cars = this.cars.map(car => ({ id: car.id, edgeId: car.edgeId, from: car.from, to: car.to, progress: car.progress, lane: car.lane, color: car.color }));
    const signals = this.nodes.filter(node => node.signal).map(node => { const cycle = node.signal.greenSeconds * 2; const phaseTime = (this.seconds + node.signal.offset) % cycle; return { nodeId: node.id, phase: phaseTime < node.signal.greenSeconds ? 'NS' : 'EW', remainingSeconds: Number((phaseTime < node.signal.greenSeconds ? node.signal.greenSeconds - phaseTime : cycle - phaseTime).toFixed(1)), greenSeconds: node.signal.greenSeconds }; });
    return { config: this.config, nodes: this.nodes.map(({ id, x, y, signal }) => ({ id, x, y, signal: Boolean(signal) })), edges: this.edges.map(({ id, a, b, level, bridge }) => ({ id, a, b, level, bridge })), cars, signals, metrics: this.getMetrics() };
  }
}

export function runScenario(input = {}, duration = 180) {
  if (!Number.isFinite(duration) || duration < LIMITS.compareDuration[0] || duration > LIMITS.compareDuration[1]) throw new RangeError(`duration must be between ${LIMITS.compareDuration[0]} and ${LIMITS.compareDuration[1]} seconds`);
  const simulation = new TrafficSimulation(input);
  while (simulation.seconds < duration - 1e-9) simulation.tick(Math.min(.1, duration - simulation.seconds));
  return { config: simulation.config, metrics: simulation.getMetrics() };
}
