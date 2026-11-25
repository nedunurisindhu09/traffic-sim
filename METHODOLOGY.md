# Simulation methodology

## Network and agents

Each scenario is a small graph. Nodes are junctions and edges are bidirectional links with normalized lengths. A vehicle is an agent with an origin, destination, route, current link, direction, lane, progress, wait accumulator, and start time. Vehicles choose a shortest route with a live link-occupancy cost. Each simulation step advances up to 0.05 seconds for interactive runs and up to 0.1 seconds for batch experiments. Vehicles have a fixed nominal speed and maintain a minimum following gap; they queue when movement is prevented by another vehicle, a red signal, junction occupancy, or a blocked exit.

The configured lane count applies in each direction. Approximate link storage is `max(1, floor(link length / 0.038) × lanes)` vehicles. Before crossing a junction, an agent needs available downstream storage and an available entry lane. A full link therefore holds the vehicle on its current link and records a blocked move; the model does not push a vehicle into occupied storage. The flyover uses a distinct graph level and has no shared at-grade junction at its crossing.

## Signal control

Signalized nodes have two alternating axis phases, north/south and east/west. The fixed controller holds each phase for the configured base green duration. Both controller types still obey the downstream-space entry gate.

The adaptive controller measures vehicles and queued vehicles on each approach, downstream blocked movements, free downstream storage, and spillback on connected links. It forms a phase pressure from `1.5 × queued + 0.35 × non-queued approaching vehicles`; the target green starts at the configured base duration and shifts by `0.8 × (active pressure − opposing pressure)`. The target is bounded between 40% of base (at least two seconds) and twice base (up to 60 seconds). Blocked downstream movements and the free-capacity ratio reduce green toward the minimum. A spillback flag on the phase's exit sets it to the minimum. Once the minimum phase duration has elapsed, an empty active phase can switch early if opposing demand exists. The interface reports the observed measurements and the selected rule in plain language.

Spillback is flagged when stopped, queued agents occupy at least 70% of a link's estimated storage. The connected downstream junction and the upstream junction of that link are marked; the upstream controller can then reduce service toward the filling link. A spillback event count increases once when a link enters that state, not on every tick it remains full.

## Comparison design

Network comparison holds demand and seed constant while changing network. Controller comparison holds network, demand, lane count, signal base timing, and seed constant while changing only controller. The seeded generator generates arrival times and origin/destination pairs. Each run updates a rolling hash of those exogenous arrival events; the comparison rejects output unless event count and hash match. Thus controllers receive the same arrival trace even though the routes, waits, and completed trips can diverge. This is one paired trial per configuration, not a statistical study across replications.

## Measures

- **Average wait**: accumulated stopped/waiting seconds for completed trips divided by completed trips, converted to minutes. Active unfinished trips are not in this mean.
- **Average travel time**: elapsed seconds for completed trips divided by completed trips, converted to minutes.
- **Throughput**: completed trips divided by elapsed simulated minutes.
- **Average queue length**: queue-vehicle-seconds observed at signalized junctions, divided by elapsed seconds and signal count. The snapshot's current queue is also available separately.
- **Peak queue**: maximum total queued agents across signalized junctions at any measured step.
- **Average congestion**: time-averaged active vehicles divided by estimated total road storage, capped at 100% for the live road-load measure.
- **Spillback events**: count of transitions into a flagged spillback state, by link.

Metrics can be `null` for trip averages before any trip completes. Congestion is a model occupancy ratio, not a field traffic measurement or a travel-time index.

## Reproducibility and limits

Runs use an unsigned 32-bit seed and deterministic generator. Identical input, duration, and code version produce repeatable runs. For research reporting, record application commit, all input settings, duration, and seed; run multiple seeds and report distributions before drawing comparative conclusions. This prototype has no calibration against observed traffic, no uncertainty model, and simplified routing and signal rules. Its results demonstrate the implemented assumptions only.
