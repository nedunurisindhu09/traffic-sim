# Flow State — Traffic Lab

Flow State is a full-stack, agent-based traffic simulator. A small Node.js API runs the authoritative traffic model; the browser configures experiments and renders live vehicles, roads, junction signals, and analytics.

## Requirements and run

- Node.js 18 or newer (built-in `fetch`, HTTP, and test runner APIs are used).
- No third-party packages or API keys are required.

From the project directory:

```powershell
node server.js
```

Open <http://127.0.0.1:4173>. To use a different port, set `PORT` before starting the server. On Windows PowerShell, run the test suite with:

```powershell
npm.cmd test
```

## Features

- Four configurable networks: downtown grid, signalized cross, crossing flyover, and wide arterial.
- Vehicles spawn at a configurable arrival rate (1–90 per simulated minute), choose shortest routes with a live congestion cost, and move as individual agents along road links.
- One to four lanes in each direction change vehicle capacity and lane assignment.
- Junctions with three or more connected roads receive alternating north/south and east/west green phases. Green duration is configurable from 4–45 simulated seconds. Red approaches queue and accumulate waiting time.
- The flyover crosses the other road at a separate graph level. Vehicles can cross visually, but the two streams do not share an intersection.
- Live average wait and travel time per completed trip, completed trips per simulated minute, active vehicles, road load, and signal phases.
- Matched-seed scenario comparison holds demand, lane count, signal timing, and seed constant while changing the road network. Comparison duration is configurable from 1–10 minutes.

## Model and limitations

The simulation uses a fixed-step, microscopic agent model with shortest-path routing, per-lane following distance, junction occupancy, and fixed-time signal phases. Scenario comparison uses a seeded random generator for repeatability. Average wait and travel time are computed over completed trips; throughput is completed trips divided by elapsed simulated minutes. Road load is active vehicles divided by estimated lane-length capacity.

This is a demonstrator, not a calibrated traffic forecast. It does not model turning movement counts, protected turn phases, pedestrians, vehicle classes, real road geometry, adaptive signals, or measured traffic data. The process keeps one in-memory simulation shared by connected browsers and is intended for local demonstration, not public multi-user deployment.
