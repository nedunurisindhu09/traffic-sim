import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, NETWORKS, TrafficSimulation, runControllerComparison, runScenario, validateConfig } from '../simulation.js';

function addApproachCar(simulation, id, incoming, outgoing, { queued = true, progress = incoming.length - .01 } = {}) {
  const junction = incoming.b;
  simulation.cars.push({ id, edgeId: incoming.id, from: incoming.a, to: incoming.b, route: [{ edgeId: incoming.id, from: incoming.a, to: incoming.b }, { edgeId: outgoing.id, from: outgoing.a, to: outgoing.b }], leg: 0, progress, lane: 0, queued, waiting: 1, startSeconds: 0, color: '#fff' });
  return simulation.cars.at(-1);
}

test('all scenario graphs include connected roads and the flyover has a distinct crossing', () => {
  for (const network of Object.keys(NETWORKS)) {
    const simulation = new TrafficSimulation({ network });
    assert.ok(simulation.nodes.length >= 5);
    assert.ok(simulation.edges.length >= 4);
    assert.ok(simulation.edges.every(edge => edge.length > 0));
    if (network !== 'flyover') assert.ok(simulation.nodes.some(node => node.signal), `${network} should have at least one signalized intersection`);
  }
  const flyover = new TrafficSimulation({ network: 'flyover' });
  assert.equal(flyover.edges.filter(edge => edge.bridge).length, 1);
  assert.deepEqual(flyover.edges.map(edge => edge.level), [0, 1, 0, 0, 0, 0]);
  assert.equal(flyover.nodes.filter(node => node.x === .5 && node.y === .5).length, 0);
  assert.equal(flyover.nodes.some(node => node.signal), false, 'grade-separated lanes do not share an intersection signal');
});

test('configuration validates arrival rate, lane capacity, signal timing, and seed', () => {
  assert.deepEqual(validateConfig({}), DEFAULTS);
  assert.throws(() => validateConfig({ demand: 0 }), /demand/);
  assert.throws(() => validateConfig({ lanes: 5 }), /lanes/);
  assert.throws(() => validateConfig({ greenSeconds: 3 }), /greenSeconds/);
  assert.throws(() => validateConfig({ network: 'missing' }), /network/);
  assert.throws(() => validateConfig({ controller: 'magic' }), /controller/);
});

test('agents move along actual road links and wider roads assign multiple lanes', () => {
  const narrow = new TrafficSimulation({ lanes: 1, demand: 1 });
  narrow.spawnCar();
  const initial = narrow.cars[0].progress;
  narrow.advance(.5);
  assert.ok(narrow.cars[0].progress > initial);
  const wide = new TrafficSimulation({ lanes: 2, demand: 1 });
  const edge = wide.edges[0];
  wide.cars.push({ id: 1, edgeId: edge.id, from: edge.a, to: edge.b, progress: .001, lane: 0 });
  assert.equal(wide.chooseLane(edge.id, edge.a), 1);
  wide.cars.push({ id: 2, edgeId: edge.id, from: edge.a, to: edge.b, progress: .001, lane: 1 });
  assert.equal(wide.chooseLane(edge.id, edge.a), -1);
});

test('traffic signals alternate green phases and hold traffic from a red approach', () => {
  const simulation = new TrafficSimulation({ network: 'grid', greenSeconds: 6, demand: 1 });
  const junction = simulation.nodes.find(node => node.id === 4 && node.signal);
  assert.ok(junction);
  const incoming = simulation.edges.find(edge => edge.a === 3 && edge.b === 4);
  const outgoing = simulation.edges.find(edge => edge.a === 4 && edge.b === 7);
  assert.equal(simulation.getSignalPhase(junction.id), 'NS');
  assert.equal(simulation.signalAllows(junction.id, incoming), false);
  const car = { id: 77, route: [{ edgeId: incoming.id, from: incoming.a, to: junction.id }, { edgeId: outgoing.id, from: junction.id, to: outgoing.a === junction.id ? outgoing.b : outgoing.a }], leg: 0, edgeId: incoming.id, from: incoming.a, to: junction.id, progress: incoming.length - .002, lane: 0, startSeconds: 0, waiting: 0 };
  simulation.cars.push(car);
  simulation.tick(.05);
  assert.ok(car.waiting > 0, 'vehicle should accrue signal wait while the approach is red');
  for (let index = 0; index < 72; index++) simulation.tick(.05);
  assert.equal(simulation.getSignalPhase(junction.id), 'EW');
  assert.equal(simulation.signalAllows(junction.id, incoming), true);
  simulation.tick(.05);
  simulation.tick(.05);
  simulation.tick(.05);
  assert.equal(car.leg, 1, 'vehicle should enter its next road when the phase turns green');
});

test('junction snapshots report directional downstream storage even before vehicles queue', () => {
  const simulation = new TrafficSimulation({ network: 'grid', controller: 'adaptive' });
  const snapshot = simulation.snapshot();
  assert.ok(snapshot.junctions.length >= 5);
  for (const signal of snapshot.signals) {
    assert.ok(signal.downstreamCapacity > 0);
    assert.ok(signal.downstreamFreeSlots > 0);
    assert.ok(signal.downstreamFreeSlots <= signal.downstreamCapacity);
  }
});

test('scenario run reports coherent travel, wait, throughput and completed-trip metrics', () => {
  const result = runScenario({ network: 'grid', demand: 36, lanes: 2, seed: 7 }, 120);
  assert.ok(result.metrics.completedTrips > 0);
  assert.ok(result.metrics.throughputPerMinute > 0);
  assert.ok(result.metrics.averageTravelMinutes > 0);
  assert.ok(result.metrics.averageWaitMinutes >= 0);
  assert.ok(Math.abs(result.metrics.throughputPerMinute - result.metrics.completedTrips / 2) < 1e-8);
  const repeat = runScenario({ network: 'grid', demand: 36, lanes: 2, seed: 7 }, 120);
  assert.deepEqual(repeat.metrics, result.metrics);

  const simulation = new TrafficSimulation({ network: 'grid', demand: 36, lanes: 2, seed: 7 });
  for (let index = 0; index < 1200; index++) simulation.tick(.1);
  const metrics = simulation.getMetrics();
  assert.equal(metrics.completedTrips, simulation.trips);
  assert.ok(Math.abs(metrics.averageTravelMinutes - simulation.tripSeconds / simulation.trips / 60) < 1e-10);
  assert.ok(Math.abs(metrics.averageWaitMinutes - simulation.tripWaitSeconds / simulation.trips / 60) < 1e-10);
  assert.ok(metrics.roadLoadPercent > 0 && metrics.roadLoadPercent <= 100);
});

test('junction queues are measured and a full downstream road prevents a vehicle release', () => {
  const simulation = new TrafficSimulation({ network: 'grid', lanes: 1, demand: 1, controller: 'fixed' });
  const incoming = simulation.edges.find(edge => edge.a === 3 && edge.b === 4);
  const outgoing = simulation.edges.find(edge => edge.a === 4 && edge.b === 7);
  const capacity = simulation.roadStorage(outgoing.id);
  for (let index = 0; index < capacity; index++) simulation.cars.push({ id: index + 1, edgeId: outgoing.id, from: 4, to: 7, route: [{ edgeId: outgoing.id, from: 4, to: 7 }], leg: 0, progress: .01 + index * .039, lane: 0, queued: false, waiting: 0, startSeconds: 0 });
  const car = addApproachCar(simulation, 100, incoming, outgoing, { queued: false, progress: incoming.length - .001 });
  const storage = simulation.downstreamStatus(outgoing.id, 4);
  assert.equal(storage.freeSlots, 0);
  assert.equal(storage.available, false);
  const signal = simulation.signalControllers.get(4);
  signal.phase = 'EW'; signal.elapsed = 0; signal.greenTarget = 12;
  simulation.tick(.05);
  assert.equal(car.leg, 0, 'agent must remain on its incoming road when the downstream link is full');
  assert.equal(car.queued, true);
  assert.ok(simulation.downstreamBlockedMoves > 0);
  assert.equal(simulation.junctionMetrics.get(4).queueLength, 1);
});

test('adaptive green time extends for a busy approach and contracts when its exit is blocked', () => {
  const open = new TrafficSimulation({ network: 'grid', lanes: 1, greenSeconds: 10, demand: 1, controller: 'adaptive' });
  const incoming = open.edges.find(edge => edge.a === 1 && edge.b === 4);
  const outgoing = open.edges.find(edge => edge.a === 4 && edge.b === 7);
  for (let index = 0; index < 4; index++) addApproachCar(open, index + 1, incoming, outgoing, { progress: incoming.length - .01 - index * .004 });
  open.junctionMetrics = open.measureJunctions();
  open.updateSignalControllers(.05);
  const openController = open.signalControllers.get(4);
  assert.ok(openController.greenTarget > 10);
  assert.match(openController.reason, /approach.*extends/i);

  const blocked = new TrafficSimulation({ network: 'grid', lanes: 1, greenSeconds: 10, demand: 1, controller: 'adaptive' });
  const blockedIncoming = blocked.edges.find(edge => edge.a === 1 && edge.b === 4);
  const blockedOutgoing = blocked.edges.find(edge => edge.a === 4 && edge.b === 7);
  for (let index = 0; index < 4; index++) addApproachCar(blocked, index + 1, blockedIncoming, blockedOutgoing, { progress: blockedIncoming.length - .01 - index * .004 });
  for (let index = 0; index < blocked.roadStorage(blockedOutgoing.id); index++) blocked.cars.push({ id: 20 + index, edgeId: blockedOutgoing.id, from: 4, to: 7, route: [{ edgeId: blockedOutgoing.id, from: 4, to: 7 }], leg: 0, progress: .01 + index * .039, lane: 0, queued: false, waiting: 0, startSeconds: 0 });
  blocked.junctionMetrics = blocked.measureJunctions();
  blocked.updateSignalControllers(.05);
  const blockedController = blocked.signalControllers.get(4);
  assert.ok(blockedController.greenTarget < openController.greenTarget);
  assert.match(blockedController.reason, /downstream storage/i);
  assert.equal(blocked.junctionMetrics.get(4).approaches.NS.downstreamBlockedVehicles, 4);
});

test('a long stopped queue flags spillback at its upstream signal', () => {
  const simulation = new TrafficSimulation({ network: 'grid', lanes: 1, greenSeconds: 10, demand: 1, controller: 'adaptive' });
  const incoming = simulation.edges.find(edge => edge.a === 1 && edge.b === 4);
  const outgoing = simulation.edges.find(edge => edge.a === 4 && edge.b === 7);
  const threshold = Math.ceil(simulation.roadStorage(incoming.id) * .7);
  for (let index = 0; index < threshold; index++) addApproachCar(simulation, index + 1, incoming, outgoing, { progress: incoming.length - .01 - index * .004 });
  simulation.junctionMetrics = simulation.measureJunctions();
  const downstream = simulation.junctionMetrics.get(4), upstream = simulation.junctionMetrics.get(1);
  assert.equal(downstream.queueLength, threshold);
  assert.equal(downstream.spillbackRisk, true);
  assert.equal(upstream.spillbackRisk, true);
  assert.ok(upstream.spillbackAxes.has('NS'));
  simulation.refreshStatistics(.05);
  assert.equal(simulation.spillbackEvents, 1, 'one physical road spillback should count once even though both junctions are flagged');
  simulation.refreshStatistics(.05);
  assert.equal(simulation.spillbackEvents, 1, 'a persistent spillback should not create a new event every tick');
  simulation.updateSignalControllers(.05);
  assert.match(simulation.signalControllers.get(1).reason, /spillback guard/i);
});

test('fixed and adaptive trials receive the same seeded arrival trace without assuming a winner', () => {
  const comparison = runControllerComparison({ network: 'grid', demand: 30, lanes: 2, greenSeconds: 10, seed: 8 }, 60);
  const [fixed, adaptive] = comparison.results;
  assert.equal(comparison.sameDemandTrace, true);
  assert.equal(fixed.config.controller, 'fixed');
  assert.equal(adaptive.config.controller, 'adaptive');
  assert.equal(fixed.metrics.arrivalEvents, 30);
  assert.equal(fixed.metrics.demandSignature, adaptive.metrics.demandSignature);
  assert.equal(fixed.metrics.arrivalEvents, adaptive.metrics.arrivalEvents);
  for (const result of comparison.results) {
    assert.ok(Number.isFinite(result.metrics.throughputPerMinute));
    assert.ok(Number.isFinite(result.metrics.averageQueueLength));
    assert.ok(Number.isFinite(result.metrics.averageRoadLoadPercent));
  }
});
