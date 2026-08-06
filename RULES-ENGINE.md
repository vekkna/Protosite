# Rules engine

`rules-engine.js` is the authoritative, UI-independent game model. It has no DOM, storage, networking, timers, or ambient randomness. The browser adapter in `app.js` renders its state, translates pointer/button input into actions, presents events, and lets the host distribute private player projections.

## Core API

- `createGame(config)` creates a seeded standard 12-unit draft from complete supplied profiles.
- `createScenario(config)` creates a seeded already-deployed state for tests, tools, and future AI work.
- `getLegalActions(state, playerId)` lists structured choices without changing state.
- `validateAction(state, action)` previews one action, including on a private player projection.
- `applyAction(state, action)` returns a new state and visible events; it never mutates its input.
- `advanceForced(state)` performs exactly one no-choice transition so the UI can animate it.
- `projectState(state, playerId)` hides secret bids, every terrain tile below the face-up top tile, and RNG state. The public top tile is preserved so both local and remote players can consider it when choosing a unit. A projection is explicitly non-authoritative and cannot be reduced with `applyAction`.

Every action carries `expectedRevision`. The host is the only network authority, rejects stale actions, and sends the resulting Player 2 projection. Network bids use SHA-256 commit–reveal so neither player can change a bid after learning the other one.

For an AI, clone an authoritative state, enumerate `getLegalActions`, fill in positional parameters for move/deploy/terrain actions, validate candidates, then branch with `applyAction`. A seed makes engine-owned selection, terrain order, and combat rolls reproducible.

## Deliberate interpretations

The supplied document leaves a few physical-component details unavailable to software:

- Terrain uses the whole rectangular tile because no printed-feature masks or tile-face artwork is available to the engine.
- During the draft, terrain may overlap undeployed unit cards in the pool, including the chosen unit it must touch; only already-deployed units block its placement.
- A hill tile's centre is used as its crest when two units occupy the same hill.
- `Defensible` has no mechanical effect because the rulebook names the trait but never defines its modifier.
- Battlefield edges are impassable, and a zero-distance Move still counts as choosing the Move action.

These choices live in `state.rules`, so a later rules clarification or richer terrain asset can replace them without coupling the model to the UI.

## Verification

Run:

```sh
node rules-engine.test.js
```

The suite covers setup, terrain, deployment, bids, command windows, automatic choices, movement/contact, pivots, slowing and impassable terrain, firing lanes, deterministic combat, elevation, wounds, victory, cleanup, revisions, idempotency, and projection privacy.
