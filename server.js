import { createReadStream } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, LIMITS, NETWORKS, TrafficSimulation, runControllerComparison, runScenario, validateConfig } from './simulation.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 20_000) throw new RangeError('request body is too large');
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new SyntaxError('request body must be valid JSON'); }
}

export function createServer() {
  let simulation = new TrafficSimulation();
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { status: 'ok', service: 'flow-state-traffic-lab' });
      if (request.method === 'GET' && url.pathname === '/api/config') {
        return sendJson(response, 200, { defaults: DEFAULTS, limits: LIMITS, networks: Object.entries(NETWORKS).map(([id, network]) => ({ id, title: network.title, nodes: network.nodes.length, roads: network.edges.length })) });
      }
      if (request.method === 'GET' && url.pathname === '/api/simulation/state') return sendJson(response, 200, simulation.snapshot());
      if (request.method === 'POST' && url.pathname === '/api/simulation/reset') {
        simulation = new TrafficSimulation(await readJson(request));
        return sendJson(response, 200, simulation.snapshot());
      }
      if (request.method === 'POST' && url.pathname === '/api/simulation/step') {
        const body = await readJson(request);
        return sendJson(response, 200, simulation.advance(body.seconds));
      }
      if (request.method === 'POST' && url.pathname === '/api/simulation/compare') {
        const body = await readJson(request), duration = body.duration ?? 180;
        if (!Number.isFinite(duration) || duration < LIMITS.compareDuration[0] || duration > LIMITS.compareDuration[1]) throw new RangeError(`duration must be between ${LIMITS.compareDuration[0]} and ${LIMITS.compareDuration[1]} seconds`);
        const first = validateConfig(body.first || {}), second = validateConfig(body.second || {});
        if (first.demand !== second.demand || first.seed !== second.seed) throw new RangeError('compared scenarios must use the same demand and seed');
        const results = [runScenario(first, duration), runScenario(second, duration)];
        return sendJson(response, 200, { duration, results });
      }
      if (request.method === 'POST' && url.pathname === '/api/simulation/compare-control') {
        const body = await readJson(request);
        return sendJson(response, 200, runControllerComparison(body.config || {}, body.duration ?? 180));
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(response, 400, { error: 'invalid URL path' }); }
      if (pathname === '/') pathname = '/index.html';
      const file = resolve(ROOT, `.${pathname}`);
      if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) return sendJson(response, 403, { error: 'forbidden' });
      const contentType = MIME[extname(file).toLowerCase()];
      if (!contentType) return sendJson(response, 404, { error: 'not found' });
      response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
      if (request.method === 'HEAD') return response.end();
      createReadStream(file).on('error', () => { if (!response.headersSent) sendJson(response, 404, { error: 'not found' }); else response.destroy(); }).pipe(response);
    } catch (error) {
      const status = error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError ? 400 : 500;
      sendJson(response, status, { error: error.message || 'internal server error' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => process.stdout.write(`Flow State listening at http://127.0.0.1:${port}\n`));
}
