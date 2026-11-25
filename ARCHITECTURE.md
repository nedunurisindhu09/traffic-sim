# Architecture

## Runtime layout

```text
Browser (index.html, app.js, styles.css)
    │ same-origin JSON requests
    ▼
Node HTTP server (server.js)
    ├── static asset delivery
    ├── short-lived, cookie-keyed in-memory browser sessions
    └── simulation.js (authoritative model and comparison runs)
```

The browser renders a canvas view and controls inputs. It does not simulate vehicle physics locally: it sends reset and step requests and paints the returned state. The server owns each session's configuration and simulation. Network and scenario comparison requests run separately from the current live simulation and return results without replacing that live run.

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Liveness check for the web process. |
| `GET /api/config` | Defaults, input limits, and available network summaries; creates a browser session cookie. |
| `GET /api/simulation/state` | Current session snapshot. |
| `POST /api/simulation/reset` | Validate configuration and start a new run for this session. |
| `POST /api/simulation/step` | Advance this session by at most one simulated second. |
| `POST /api/simulation/compare` | Run two matched network scenarios (60–600 simulated seconds). |
| `POST /api/simulation/compare-control` | Run fixed and adaptive controllers on a matched demand trace (60–600 seconds). |

JSON request bodies are limited to 20 KB. Browser write requests with an `Origin` header must match the request host. Cookies are `HttpOnly` and `SameSite=Strict`, and are marked `Secure` when the proxy reports HTTPS. Each session is held in memory for up to two hours, with a 256-session ceiling and a four-comparison-per-minute limit.

## State and hosting

There is no database or external service. Simulation state and session metadata disappear on process restart. Run one server instance per public demo: requests from one cookie must reach the same process. Multiple uncoordinated instances would give a visitor inconsistent state. The Docker image runs as the unprivileged Node user and binds to `0.0.0.0`, taking its listening port from `PORT`.

The single-process design, bounded request size, comparison limit, and session cap suit a small educational demo. They are not a substitute for an abuse-resistant, horizontally scaled service. A larger deployment should add shared session storage, a job queue for CPU-heavy comparisons, stronger rate limits, operational telemetry, and a production security review.
