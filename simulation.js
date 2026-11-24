export const NETWORKS = {
  grid: { title: 'Downtown grid', nodes: [[.16,.22],[.50,.22],[.84,.22],[.16,.50],[.50,.50],[.84,.50],[.16,.78],[.50,.78],[.84,.78]], edges: [[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[3,6],[1,4],[4,7],[2,5],[5,8]] },
  cross: { title: 'Signalized cross', nodes: [[.50,.14],[.50,.50],[.50,.86],[.14,.50],[.86,.50]], edges: [[0,1],[1,2],[3,1],[1,4]] },
  flyover: { title: 'Crossing flyover', nodes: [[.13,.50],[.42,.50],[.58,.50],[.87,.50],[.50,.13],[.50,.42],[.50,.58],[.50,.87]], edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7]], bridges: [[1,2]] },
  arterial: { title: 'Wide arterial', nodes: [[.10,.50],[.32,.50],[.55,.50],[.78,.50],[.32,.20],[.32,.80],[.78,.20],[.78,.80]], edges: [[0,1],[1,2],[2,3],[1,4],[1,5],[3,6],[3,7]] }
};

export const DEFAULTS = { network: 'grid', demand: 24, lanes: 2, greenSeconds: 12, controller: 'adaptive', seed: 2026 };
export const LIMITS = { demand: [1, 90], lanes: [1, 4], greenSeconds: [4, 45], compareDuration: [60, 600] };

const COLORS = ['#ffad78', '#a7e4c2', '#8dbaf1', '#e5a2d0', '#f4d77d'];
const LENGTH = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const VEHICLE_SPACING = .038;
const SPILLBACK_RATIO = .7;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
  if (!['fixed', 'adaptive'].includes(config.controller)) throw new RangeError('controller must be fixed or adaptive');
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
    this.arrivalEvents = 0; this.admittedArrivals = 0; this.rejectedArrivals = 0; this.demandSignature = 2166136261;
    this.downstreamBlockedMoves = 0; this.spillbackEvents = 0; this.activeSpillbackLinks = new Set();
    this.queueVehicleSeconds = 0; this.roadLoadArea = 0; this.peakQueueLength = 0;
    this.signalControllers = new Map();
    for (const node of this.nodes) if (node.signal) {
      const cycle = node.signal.greenSeconds * 2, phaseTime = node.signal.offset % cycle;
      const phase = phaseTime < node.signal.greenSeconds ? 'NS' : 'EW';
      this.signalControllers.set(node.id, { phase, elapsed: phase === 'NS' ? phaseTime : phaseTime - node.signal.greenSeconds, greenTarget: this.config.greenSeconds, reason: 'Waiting for first traffic observation.' });
    }
    this.junctionMetrics = this.measureJunctions();
  }

  getEdgeFor(car) { return this.edges[car.route[car.leg].edgeId]; }

  getSignalPhase(nodeId) {
    return this.signalControllers.get(nodeId)?.phase || 'none';
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
    const start = Math.floor(this.random() * this.nodes.length);
    let destination = Math.floor(this.random() * (this.nodes.length - 1));
    if (destination >= start) destination++;
    const color = COLORS[Math.floor(this.random() * COLORS.length)];
    this.arrivalEvents++;
    for (const character of `${this.arrivalEvents}:${this.seconds.toFixed(2)}:${start}:${destination}`) this.demandSignature = Math.imul(this.demandSignature ^ character.charCodeAt(0), 16777619) >>> 0;
    if (this.cars.length >= 500) { this.rejectedArrivals++; return; }
    const route = this.shortestRoute(start, destination);
    if (!route?.length) { this.rejectedArrivals++; return; }
    const firstEdge = route[0].edgeId, firstFrom = route[0].from;
    const counts = Array(this.config.lanes).fill(0);
    for (const car of this.cars) if (car.edgeId === firstEdge && car.from === firstFrom && car.progress < .055) counts[car.lane]++;
    const lane = counts.indexOf(Math.min(...counts));
    this.admittedArrivals++;
    this.cars.push({ id: this.nextId++, start, destination, route, leg: 0, edgeId: firstEdge, from: firstFrom, to: route[0].to, progress: 0, lane, color, startSeconds: this.seconds, waiting: 0, queued: false });
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

  roadStorage(edgeId) {
    return Math.max(1, Math.floor(this.edges[edgeId].length / VEHICLE_SPACING) * this.config.lanes);
  }

  downstreamStatus(edgeId, from) {
    let occupied = 0;
    for (const car of this.cars) if (car.edgeId === edgeId && car.from === from) occupied++;
    const capacity = this.roadStorage(edgeId), freeSlots = Math.max(0, capacity - occupied);
    const entryLaneAvailable = Array.from({ length: this.config.lanes }, (_, lane) => lane).some(lane => !this.cars.some(car => car.edgeId === edgeId && car.from === from && car.lane === lane && car.progress < .055));
    return { capacity, occupied, freeSlots, utilization: occupied / capacity, available: freeSlots > 0 && entryLaneAvailable };
  }

  measureJunctions() {
    const measured = new Map();
    for (const [nodeId] of this.signalControllers) measured.set(nodeId, {
      nodeId, queueLength: 0, spillbackRisk: false, spillbackRoads: new Set(), spillbackAxes: new Set(),
      approaches: { NS: { vehicleCount: 0, queueLength: 0, downstreamBlockedVehicles: 0, downstreamFreeSlots: 0, downstreamCapacity: 0 }, EW: { vehicleCount: 0, queueLength: 0, downstreamBlockedVehicles: 0, downstreamFreeSlots: 0, downstreamCapacity: 0 } },
      outbound: { NS: { freeSlots: 0, capacity: 0, blockedRoads: 0 }, EW: { freeSlots: 0, capacity: 0, blockedRoads: 0 } }
    });
    for (const car of this.cars) {
      const state = measured.get(car.to);
      if (!state) continue;
      const approachAxis = this.edgeAxis(this.edges[car.edgeId], car.from), approach = state.approaches[approachAxis];
      approach.vehicleCount++;
      if (car.queued) approach.queueLength++;
      if (car.leg < car.route.length - 1) {
        const next = car.route[car.leg + 1], downstream = this.downstreamStatus(next.edgeId, next.from);
        approach.downstreamCapacity += downstream.capacity;
        approach.downstreamFreeSlots += downstream.freeSlots;
        if (!downstream.available) approach.downstreamBlockedVehicles++;
      }
      if (car.queued) {
        const incomingCapacity = this.roadStorage(car.edgeId);
        const queuedOnRoad = this.cars.filter(other => other.edgeId === car.edgeId && other.from === car.from && other.queued).length;
        if (queuedOnRoad / incomingCapacity >= SPILLBACK_RATIO) {
          const incoming = this.edges[car.edgeId], upstreamNode = car.from;
          state.spillbackRisk = true; state.spillbackRoads.add(car.edgeId);
          const upstreamState = measured.get(upstreamNode);
          if (upstreamState) { upstreamState.spillbackRisk = true; upstreamState.spillbackRoads.add(car.edgeId); upstreamState.spillbackAxes.add(this.edgeAxis(incoming, upstreamNode)); }
        }
      }
    }
    for (const state of measured.values()) {
      state.queueLength = state.approaches.NS.queueLength + state.approaches.EW.queueLength;
      for (const edgeId of this.adjacency[state.nodeId]) {
        const edge = this.edges[edgeId], axis = this.edgeAxis(edge, state.nodeId), downstream = this.downstreamStatus(edgeId, state.nodeId);
        state.outbound[axis].capacity += downstream.capacity;
        state.outbound[axis].freeSlots += downstream.freeSlots;
        if (!downstream.available) state.outbound[axis].blockedRoads++;
      }
    }
    return measured;
  }

  updateSignalControllers(dt) {
    for (const [nodeId, controller] of this.signalControllers) {
      const state = this.junctionMetrics.get(nodeId), base = this.config.greenSeconds;
      controller.elapsed += dt;
      if (this.config.controller === 'fixed') {
        controller.greenTarget = base;
        controller.reason = `Fixed-time plan: ${controller.phase} has a ${base}s green. Downstream capacity checks remain active.`;
        if (controller.elapsed >= base) { controller.phase = controller.phase === 'NS' ? 'EW' : 'NS'; controller.elapsed -= base; }
        continue;
      }
      const active = state.approaches[controller.phase], otherAxis = controller.phase === 'NS' ? 'EW' : 'NS', opposing = state.approaches[otherAxis];
      const minimum = Math.max(2, base * .4), maximum = Math.min(60, base * 2);
      const activePressure = active.queueLength * 1.5 + Math.max(0, active.vehicleCount - active.queueLength) * .35;
      const opposingPressure = opposing.queueLength * 1.5 + Math.max(0, opposing.vehicleCount - opposing.queueLength) * .35;
      let target = clamp(base + (activePressure - opposingPressure) * .8, minimum, maximum);
      const blockedRatio = active.vehicleCount ? active.downstreamBlockedVehicles / active.vehicleCount : 0;
      const exit = state.outbound[controller.phase], freeRatio = exit.capacity ? exit.freeSlots / exit.capacity : 1;
      if (blockedRatio > 0) target = minimum + (target - minimum) * (1 - Math.min(1, blockedRatio));
      if (active.queueLength > 0 && active.vehicleCount > 0) target = minimum + (target - minimum) * clamp(freeRatio, 0, 1);
      if (state.spillbackAxes.has(controller.phase)) target = minimum;
      controller.greenTarget = Number(clamp(target, minimum, maximum).toFixed(1));
      if (state.spillbackAxes.has(controller.phase)) controller.reason = `Spillback guard: a downstream queue is filling the ${controller.phase} exit; green is capped at ${controller.greenTarget.toFixed(1)}s.`;
      else if (blockedRatio > 0) controller.reason = `Downstream storage is blocking ${Math.round(blockedRatio * 100)}% of ${controller.phase} movements; green target is ${controller.greenTarget.toFixed(1)}s.`;
      else if (blockedRatio > 0 || (active.queueLength > 0 && freeRatio < .2)) controller.reason = `Downstream storage has ${exit.freeSlots}/${exit.capacity} free ${controller.phase} slots; green target is ${controller.greenTarget.toFixed(1)}s.`;
      else if (activePressure > opposingPressure) controller.reason = `${controller.phase} approach has ${active.vehicleCount} ${active.vehicleCount === 1 ? 'vehicle' : 'vehicles'} (${active.queueLength} queued), vs ${otherAxis} ${opposing.vehicleCount} (${opposing.queueLength} queued); green extends to ${controller.greenTarget.toFixed(1)}s.`;
      else if (activePressure < opposingPressure) controller.reason = `${otherAxis} has more demand (${opposing.vehicleCount} ${opposing.vehicleCount === 1 ? 'vehicle' : 'vehicles'}, ${opposing.queueLength} queued); ${controller.phase} green is shortened to ${controller.greenTarget.toFixed(1)}s.`;
      else controller.reason = `Balanced demand; ${controller.phase} green targets ${controller.greenTarget.toFixed(1)}s.`;
      const emptyPhase = controller.elapsed >= minimum && active.vehicleCount === 0 && opposing.vehicleCount > 0;
      if (controller.elapsed >= controller.greenTarget || emptyPhase) {
        const previousPhase = controller.phase;
        controller.phase = otherAxis; controller.elapsed = 0;
        if (emptyPhase && controller.greenTarget > minimum) controller.reason = `No ${previousPhase} arrivals; switched early to serve ${otherAxis} demand.`;
      }
    }
  }

  refreshStatistics(dt) {
    this.junctionMetrics = this.measureJunctions();
    const queueTotal = [...this.junctionMetrics.values()].reduce((sum, state) => sum + state.queueLength, 0);
    this.queueVehicleSeconds += queueTotal * dt;
    this.peakQueueLength = Math.max(this.peakQueueLength, ...[...this.junctionMetrics.values()].map(state => state.queueLength), 0);
    const roadLoad = this.currentRoadLoadPercent();
    this.roadLoadArea += roadLoad * dt;
    const currentSpillbackLinks = new Set();
    for (const state of this.junctionMetrics.values()) for (const edgeId of state.spillbackRoads) currentSpillbackLinks.add(String(edgeId));
    for (const link of currentSpillbackLinks) if (!this.activeSpillbackLinks.has(link)) this.spillbackEvents++;
    this.activeSpillbackLinks = currentSpillbackLinks;
  }

  tick(dt) {
    this.seconds += dt;
    this.spawnCarry += dt * this.config.demand / 60;
    while (this.spawnCarry + 1e-9 >= 1) { this.spawnCar(); this.spawnCarry -= 1; }
    this.updateSignalControllers(dt);
    for (const car of this.cars) car.queued = false;
    const ordered = [...this.cars].sort((a, b) => a.edgeId - b.edgeId || a.from - b.from || a.lane - b.lane || b.progress - a.progress);
    for (const car of ordered) {
      const edge = this.getEdgeFor(car), leg = car.route[car.leg];
      const ahead = this.cars.filter(other => other !== car && other.edgeId === car.edgeId && other.from === car.from && other.lane === car.lane && other.progress > car.progress).reduce((nearest, other) => Math.min(nearest, other.progress), Infinity);
      const headway = .038;
      let speed = .14;
      if (ahead < Infinity) speed = Math.min(speed, Math.max(0, (ahead - car.progress - headway) / dt));
      if (speed < .035) car.queued = true;
      const atEnd = car.progress + speed * dt >= edge.length;
      let canExit = true;
      let downstreamBlocked = false;
      if (atEnd && car.leg < car.route.length - 1) {
        const nextLeg = car.route[car.leg + 1], nextEdge = this.edges[nextLeg.edgeId];
        canExit = this.signalAllows(leg.to, edge) && (this.nodeFreeAt.get(leg.to) || 0) <= this.seconds;
        const downstream = this.downstreamStatus(nextLeg.edgeId, leg.to);
        if (!downstream.available) { canExit = false; downstreamBlocked = true; }
        if (downstreamBlocked && this.signalAllows(leg.to, edge)) this.downstreamBlockedMoves++;
      }
      if (atEnd && !canExit) { car.progress = Math.max(car.progress, edge.length - .018); car.waiting += dt; car.queued = true; continue; }
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
    this.refreshStatistics(dt);
  }

  currentRoadLoadPercent() {
    const capacity = this.edges.reduce((sum, edge) => sum + this.roadStorage(edge.id) * 2, 0);
    return Math.min(100, this.cars.length / capacity * 100);
  }

  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1) throw new RangeError('step duration must be greater than 0 and at most 1 second');
    const target = this.seconds + seconds;
    while (this.seconds + 1e-9 < target) this.tick(Math.min(.05, target - this.seconds));
    return this.snapshot();
  }

  getMetrics() {
    const signalCount = Math.max(1, this.signalControllers.size), queueVehicles = [...this.junctionMetrics.values()].reduce((sum, state) => sum + state.queueLength, 0);
    const roadLoad = this.currentRoadLoadPercent();
    return { activeVehicles: this.cars.length, completedTrips: this.trips, averageTravelMinutes: this.trips ? this.tripSeconds / this.trips / 60 : null, averageWaitMinutes: this.trips ? this.tripWaitSeconds / this.trips / 60 : null, throughputPerMinute: this.seconds ? this.trips / (this.seconds / 60) : 0, roadLoadPercent: Number(roadLoad.toFixed(1)), averageRoadLoadPercent: Number((this.seconds ? this.roadLoadArea / this.seconds : roadLoad).toFixed(1)), queueVehicles, averageQueueLength: Number((this.seconds ? this.queueVehicleSeconds / this.seconds / signalCount : queueVehicles / signalCount).toFixed(2)), peakQueueLength: this.peakQueueLength, spillbackEvents: this.spillbackEvents, activeSpillbackLinks: this.activeSpillbackLinks.size, downstreamBlockedMoves: this.downstreamBlockedMoves, arrivalEvents: this.arrivalEvents, admittedArrivals: this.admittedArrivals, rejectedArrivals: this.rejectedArrivals, demandSignature: this.demandSignature.toString(16).padStart(8, '0'), simulatedSeconds: Number(this.seconds.toFixed(2)) };
  }

  snapshot() {
    const cars = this.cars.map(car => ({ id: car.id, edgeId: car.edgeId, from: car.from, to: car.to, progress: car.progress, lane: car.lane, color: car.color }));
    const signals = this.nodes.filter(node => node.signal).map(node => {
      const controller = this.signalControllers.get(node.id), junction = this.junctionMetrics.get(node.id), approach = junction.approaches[controller.phase];
      const exit = junction.outbound[controller.phase];
      return { nodeId: node.id, phase: controller.phase, remainingSeconds: Number(Math.max(0, controller.greenTarget - controller.elapsed).toFixed(1)), greenSeconds: node.signal.greenSeconds, targetGreenSeconds: controller.greenTarget, queueLength: junction.queueLength, downstreamBlockedVehicles: approach.downstreamBlockedVehicles, downstreamFreeSlots: exit.freeSlots, downstreamCapacity: exit.capacity, downstreamBlockedRoads: exit.blockedRoads, spillbackRisk: junction.spillbackRisk, explanation: controller.reason };
    });
    const junctions = [...this.junctionMetrics.values()].map(state => ({ nodeId: state.nodeId, queueLength: state.queueLength, spillbackRisk: state.spillbackRisk, spillbackRoads: [...state.spillbackRoads], approaches: state.approaches, outbound: state.outbound }));
    return { config: this.config, nodes: this.nodes.map(({ id, x, y, signal }) => ({ id, x, y, signal: Boolean(signal) })), edges: this.edges.map(({ id, a, b, level, bridge }) => ({ id, a, b, level, bridge })), cars, signals, junctions, metrics: this.getMetrics() };
  }
}

export function runScenario(input = {}, duration = 180) {
  if (!Number.isFinite(duration) || duration < LIMITS.compareDuration[0] || duration > LIMITS.compareDuration[1]) throw new RangeError(`duration must be between ${LIMITS.compareDuration[0]} and ${LIMITS.compareDuration[1]} seconds`);
  const simulation = new TrafficSimulation(input);
  while (simulation.seconds < duration - 1e-9) simulation.tick(Math.min(.1, duration - simulation.seconds));
  return { config: simulation.config, metrics: simulation.getMetrics() };
}

export function runControllerComparison(input = {}, duration = 180) {
  const base = validateConfig(input);
  const fixed = runScenario({ ...base, controller: 'fixed' }, duration);
  const adaptive = runScenario({ ...base, controller: 'adaptive' }, duration);
  const sameDemandTrace = fixed.metrics.arrivalEvents === adaptive.metrics.arrivalEvents && fixed.metrics.demandSignature === adaptive.metrics.demandSignature;
  if (!sameDemandTrace) throw new Error('controller comparison demand traces diverged');
  const { controller, ...comparisonConfig } = base;
  return { duration, config: comparisonConfig, sameDemandTrace, results: [fixed, adaptive] };
}
