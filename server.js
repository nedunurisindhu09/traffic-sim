import { createReadStream } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, LIMITS, NETWORKS, TrafficSimulation, runControllerComparison, runScenario, validateConfig } from './simulation.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const COMPARISON_WINDOW_MS = 60 * 1000;
const MAX_COMPARISONS_PER_WINDOW = 4;

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
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
  const sessions = new Map();
  const sessionCookie = 'flow_state_session';
  const sessionLifetime = 2 * 60 * 60 * 1000;
  const maxSessions = 256;
  const getSession = (request, response) => {
    const cookie = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${sessionCookie}=`));
    const now = Date.now();
    for (const [id, session] of sessions) if (now - session.lastSeen > sessionLifetime) sessions.delete(id);
    let id = cookie?.slice(sessionCookie.length + 1), session = sessions.get(id);
    if (!session) {
      if (sessions.size >= maxSessions) {
        const oldest = [...sessions].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
        if (oldest) sessions.delete(oldest[0]);
      }
      id = randomUUID(); session = { simulation: new TrafficSimulation(), lastSeen: now, comparisons: [] }; sessions.set(id, session);
      const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      response.setHeader('set-cookie', `${sessionCookie}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetime / 1000}${secure}`);
    }
    session.lastSeen = now;
    return session;
  };
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { status: 'ok', service: 'flow-state-traffic-lab' });
      if (request.method === 'GET' && url.pathname === '/api/config') {
        getSession(request, response);
        return sendJson(response, 200, { defaults: DEFAULTS, limits: LIMITS, networks: Object.entries(NETWORKS).map(([id, network]) => ({ id, title: network.title, nodes: network.nodes.length, roads: network.edges.length })) });
      }
      if (url.pathname.startsWith('/api/simulation/')) {
        const session = getSession(request, response);
        if (request.method === 'POST' && request.headers.origin) {
          let origin;
          try { origin = new URL(request.headers.origin); } catch { return sendJson(response, 403, { error: 'request origin not allowed' }); }
          const host = request.headers.host;
          if (origin.host !== host || !['http:', 'https:'].includes(origin.protocol)) return sendJson(response, 403, { error: 'request origin not allowed' });
        }
        if (request.method === 'GET' && url.pathname === '/api/simulation/state') return sendJson(response, 200, session.simulation.snapshot());
        if (request.method === 'POST' && url.pathname === '/api/simulation/reset') {
          session.simulation = new TrafficSimulation(await readJson(request));
          return sendJson(response, 200, session.simulation.snapshot());
        }
        if (request.method === 'POST' && url.pathname === '/api/simulation/step') {
          const body = await readJson(request);
          return sendJson(response, 200, session.simulation.advance(body.seconds));
        }
        if (request.method === 'POST' && url.pathname === '/api/simulation/compare') {
          if (!allowComparison(session)) return sendJson(response, 429, { error: 'comparison limit reached; try again in a minute' });
          const body = await readJson(request), duration = body.duration ?? 180;
          if (!Number.isFinite(duration) || duration < LIMITS.compareDuration[0] || duration > LIMITS.compareDuration[1]) throw new RangeError(`duration must be between ${LIMITS.compareDuration[0]} and ${LIMITS.compareDuration[1]} seconds`);
          const first = validateConfig(body.first || {}), second = validateConfig(body.second || {});
          if (first.demand !== second.demand || first.seed !== second.seed) throw new RangeError('compared scenarios must use the same demand and seed');
          const results = [runScenario(first, duration), runScenario(second, duration)];
          return sendJson(response, 200, { duration, results });
        }
        if (request.method === 'POST' && url.pathname === '/api/simulation/compare-control') {
          if (!allowComparison(session)) return sendJson(response, 429, { error: 'comparison limit reached; try again in a minute' });
          const body = await readJson(request);
          return sendJson(response, 200, runControllerComparison(body.config || {}, body.duration ?? 180));
        }
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

function allowComparison(session) {
  const now = Date.now();
  session.comparisons = session.comparisons.filter(time => now - time < COMPARISON_WINDOW_MS);
  if (session.comparisons.length >= MAX_COMPARISONS_PER_WINDOW) return false;
  session.comparisons.push(now);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  createServer().listen(port, host, () => process.stdout.write(`Flow State listening at http://${host}:${port}\n`));
}
