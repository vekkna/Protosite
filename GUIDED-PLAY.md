Guided play experiment
======================

Branch: `codex/rules-guided-play`.

New battles use a 12-unit alternating draft: choose a unit, place/discard the top
terrain tile, then confirm a legal deployment. The next-step panel controls bids,
turns, activation, movement, pivots, attacks and rallying. Units retain their
command marker until cleanup. Seven strain routs a unit; routing half the enemy's
starting army ends the game immediately.

Select units to inspect them. During battle, use the panel's measured movement
segments and pivot angles. Finish Move before taking post-move pivots. A forward
move automatically stops at enemy contact and offers a free Strike when legal.
Combat lists legal targets and records the dice, modifiers, critical dice and
strain in the battle log. Measurements remain available at all times.

Without a connected peer, the same device controls both players; set bids
privately and hand over the device. With a peer connected, only the acting player
can act. Board snapshots omit both unrevealed bid values; a dedicated reveal
exchange starts the round. Undo is available locally and disabled in connected
games. Guided state and in-progress activation allowances are saved with the board.

Conventions and precision
-------------------------

- The provided rules are included in `game-rules.html`, replacing the external
  rulebook iframe source.
- Artwork has no machine-readable feature boundaries. The visible outlined
  circular tile is the feature for this experiment; its collision outline is a
  64-sided polygon. Printed transparent margins are not interpreted separately.
- Movement uses continuous swept polygon collisions. Pivot clearance uses a
  conservative envelope at half-degree intervals, so exceptionally tight legal
  pivots may be refused rather than passing through an obstruction.
- The current terrain-type distribution is retained and randomly sampled down
  to 12 tiles; the supplied rules do not specify the faces of all physical tiles.
- Older saved battles have no routing history. When importing one, the surviving
  units become its starting army, with an explanatory notice. Start a new battle
  to use the full draft and victory accounting from the beginning.
- Ranged stats in the existing sheet use `dice/range` (for example `3*/18`);
  separate Shoot and Range columns are also supported.

Validation
----------

Run `node --test tests/*.test.js` for existing regressions and geometry/combat
tests. Run `node tests/guided-browser.cjs` with Playwright available on NODE_PATH
and Edge installed for a self-hosted browser walkthrough: full draft, terrain and
deployment validation, hidden bids, movement limits, activation, passing,
cleanup, reload, two-page message exchange, ownership, routing and victory.
The two-page test exercises the app protocol without relying on the external
PeerJS signalling service.
