# Flow State — Traffic Lab

Flow State is a full-stack, agent-based traffic simulation for exploring how demand, road capacity, and signal control affect queues. A Node.js API runs the model; the browser configures scenarios, animates vehicle agents, and displays live measurements and paired experiments.

## Run locally

Requirements: Node.js 18 or newer. The application has no runtime package dependencies or API keys.

```powershell
node server.js
```

Open <http://127.0.0.1:4173>. Run the automated suite with `npm.cmd test` in PowerShell (or `npm test` on systems where npm is available directly).

## What you can explore

- Four road networks, including a grade-separated flyover.
- Arrival demand from 1–90 vehicles/minute, one to four lanes per direction, and 4–45 seconds per signal phase.
- Individual vehicles that route, move, queue, and wait at signalized junctions.
- Downstream link storage checks that stop a vehicle from entering a full road.
- Fixed-time and spillback-aware adaptive signal control, with a per-signal explanation of the current decision.
- Live active vehicle count, average wait and travel time for completed trips, completed trips per minute, time-averaged queue and congestion, peak queue, and spillback events.
- Matched network scenarios and fixed-versus-adaptive trials. Controller trials use the same seed and verify that both runs receive the same origin/destination arrival trace. The displayed results are measurements, not a promise that adaptive control will perform better.

## Project documentation

- [Architecture](ARCHITECTURE.md): application layers, API routes, session behavior, and deployment shape.
- [Simulation methodology](METHODOLOGY.md): model assumptions, controller rule, metrics, and reproducibility.
- [Demonstration guide](DEMO.md): a short, repeatable walkthrough and screenshot instructions.

## Deployment preparation

The repository includes a Dockerfile and Render Blueprint for a public demo. Review [DEPLOYMENT.md](DEPLOYMENT.md) before using them. The application has not been published or deployed. It uses in-memory sessions and simulation state, which are suitable for a small single-instance demonstration but are not persistent and do not support coordinated multi-instance hosting.

## Scope and limitations

This is an exploratory demonstrator, not a calibrated traffic forecast. Its small synthetic networks and simplified movement, two-axis signal phases, routing, and storage heuristics do not represent a real city or validated traffic engineering control policy. It omits measured traffic data, turning movement counts, protected turns, pedestrians, vehicle classes, incidents, and realistic geometry. Results depend on the chosen network, seed, and model assumptions.
