# Demonstration guide

## Five-minute walkthrough

1. Start the local app with `node server.js` and open <http://127.0.0.1:4173>.
2. Select **Downtown grid**, **Adaptive · spillback-aware**, 36 arrivals/minute, one lane, and a 10-second phase. Start the simulation and let it run for about a minute. Point out moving vehicle agents, signal phases, queues, and the live metrics.
3. Open **Junction-by-junction decisions**. Explain the reported queue, free downstream slots, and green-time decision. Switch between adaptive and fixed-time control to show the baseline.
4. Under **Fixed-time vs adaptive**, run a 2-minute paired trial. Read out both measured result cards and the matched seed/arrival count. Describe the displayed changes as this run's measurements, not a general performance claim.
5. Select **Crossing flyover** and reset to show that the crossing uses separate levels. Optionally run the network comparison.

## Capturing a screenshot

For a clean public screenshot, use a fresh browser profile and a desktop viewport. Set the network, demand, and controller first; start the run long enough to populate the map and metrics; run the controller comparison once; then pause the live run before capturing. Keep the address bar out of the frame if it contains local details. Review the image for personal information before adding it to a public repository. This guide is included instead of committing a screenshot tied to a particular machine or browser state.

## Suggested narration

“This is a deterministic, small-network agent simulation. The adaptive controller observes approach queues and downstream storage, shortens service toward blocked exits, and guards against spillback. Both policies are run from the same seed and exogenous arrivals. These numbers describe this model and this trial; they are not calibrated predictions.”
