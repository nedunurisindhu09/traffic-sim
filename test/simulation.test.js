import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, NETWORKS, TrafficSimulation, runScenario, validateConfig } from '../simulation.js';

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
