import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

test('HTTP API serves the app, validates scenario setup, advances vehicles and compares scenarios', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = path => fetch(`${base}${path}`);
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const page = await get('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Compare scenarios/);
  assert.match(html, /Fixed-time vs adaptive/);
  assert.match(html, /id="controller"/);
  assert.match(html, /id="demand" type="range" min="1" max="90"/);
  const configResponse = await get('/api/config');
  assert.equal(configResponse.status, 200);
  assert.equal((await configResponse.json()).networks.length, 4);

  const reset = await post('/api/simulation/reset', { network: 'grid', demand: 90, lanes: 3, greenSeconds: 8, seed: 4 });
  assert.equal(reset.status, 200);
  let state = await reset.json();
  assert.equal(state.config.lanes, 3);
  assert.ok(state.signals.length >= 1);
  const stepped = await post('/api/simulation/step', { seconds: 1 });
  assert.equal(stepped.status, 200);
  state = await stepped.json();
  assert.ok(state.cars.length > 0);
  assert.ok(state.metrics.simulatedSeconds >= 1);

  const invalid = await post('/api/simulation/reset', { network: 'not-a-city' });
  assert.equal(invalid.status, 400);
  const compared = await post('/api/simulation/compare', { first: { network: 'grid', demand: 40, seed: 9 }, second: { network: 'flyover', demand: 40, seed: 9 }, duration: 60 });
  assert.equal(compared.status, 200);
  const comparison = await compared.json();
  assert.equal(comparison.results.length, 2);
  assert.equal(comparison.results[0].metrics.simulatedSeconds, 60);
  assert.equal(comparison.results[0].config.network, 'grid');
  assert.equal(comparison.results[1].config.network, 'flyover');

  const controllerComparisonResponse = await post('/api/simulation/compare-control', { config: { network: 'grid', demand: 30, lanes: 2, greenSeconds: 8, seed: 5 }, duration: 60 });
  assert.equal(controllerComparisonResponse.status, 200);
  const controllerComparison = await controllerComparisonResponse.json();
  assert.equal(controllerComparison.sameDemandTrace, true);
  assert.equal(controllerComparison.results[0].config.controller, 'fixed');
  assert.equal(controllerComparison.results[1].config.controller, 'adaptive');
  assert.equal(controllerComparison.results[0].metrics.arrivalEvents, 30);
  assert.equal(controllerComparison.results[0].metrics.demandSignature, controllerComparison.results[1].metrics.demandSignature);
});
