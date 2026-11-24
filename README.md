# Flow State — Traffic Lab

An interactive, agent-based traffic simulation for exploring how road layout, road capacity, and arrival demand shape movement through a small city.

## Run it

Open `index.html` in a modern browser. The application is dependency-free and runs locally; it does not need a server or API key.

## Explore

- Choose a downtown grid, four-way junction, crossing flyover, or arterial network.
- Change vehicle arrivals per minute and road capacity from one to four lanes.
- Start, pause, reset, or run the model at up to four times its base speed.
- Watch live vehicle counts, completed trips, average travel time, and network load.

## Model notes

Each vehicle is an agent with an origin, destination, and a shortest-path route. Route cost increases with observed traffic. Vehicles slow down behind nearby cars, use wider-road spacing capacity, and wait for an available junction slot before turning. The flyover’s crossing links are visually separated, so the two road streams do not share a junction there.

This is a compact exploratory model, not a calibrated traffic forecast. Demand is sampled stochastically and agents choose shortest routes; the model does not represent pedestrians, signal phase plans, vehicle classes, or measured city data.
