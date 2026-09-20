# Winter 2026 CodinGame: train tracks (context notes)

Single-file TypeScript bot: `main.ts`. CodinGame needs one file, so everything lives there.

## Goal
Connect towns with tracks and disrupt the opponent's. Only connected towns score, per connecting track.

## Input (see starter code in main.ts)
- Init: `myId`, `width`, `height`, then per cell `regionId type` (0 PLAINS, 1 RIVER, 2 MOUNTAIN, 3 POI), then towns `id x y desiredConnections(comma list)`.
- Per turn: `myScore`, `foeScore`, then per cell `tracksOwner instability inked partOfActiveConnections`.
  - `tracksOwner` is -1 when empty (confirmed by user).
  - A region is inked (destroyed) when instability >= 3.
  - `partOfActiveConnections` is `x` or comma list of `a-b` town id pairs.

## Output
At least one action per turn, separated by `;`:
- `PLACE_TRACKS x y` place a track on a free cell.
- `AUTOPLACE fromX fromY toX toY` cheapest path in paint points; does nothing if a path already exists; replaced by generated actions.
- `WAIT`
- (starter comment also lists `DISRUPT regionId` and `MESSAGE text`; not in the pasted spec)

## Rules known
- Paint cost: plains 1, river 2, mountain 3. Budget is 3 paint points per turn.
- Y grows downward; north = y-1.
- Path tie-break priority: N, E, S, W.

## Code layout in main.ts
- `astar(...)`: grid A*, heap ordered (f, higher g, insertion order); neighbours expanded N,E,S,W.
- `Commands` / `cmd`: validated action queue; `flush()` prints or falls back to `WAIT`.
- `planTurn(budget)`: picks the cheapest unconnected desired pair (sticky `target`), places path cells that fit the budget, continues to the next route if paint remains.

## Assumptions still unverified
- Town cells assumed to already hold tracks (or be free).
- Regions/instability not modelled (unused this league).

## Official docs (this league, pasted by user)
Init: `myId`; `width`; `height`; `height*width` lines `regionId type` (type 0-2); `townCount`; then `townId townX townY desiredConnections` (comma list, or `x` if none).
Turn: `myScore`, `foeScore`, then per cell `trackOwner instability inked partOfActiveConnections`.
- trackOwner: -1 none, 0 player 0, 1 player 1, 2 neutral track.
- instability and inked: unused in this league. partOfActiveConnections: not useful this league (list of `a-b` pairs or `x`).
Output: one line, at least one action and AT MOST ONE `AUTOPLACE`. Actions: `PLACE_TRACKS x y`, `AUTOPLACE fx fy tx ty`, `MESSAGE text`, `WAIT`. No DISRUPT this league.
Constraints: 50 ms per turn (1000 ms first turn); 21<=width<=30; 14<=height<=20; 4<=townCount<=12.

## Confirmed by user
- Owned, enemy and neutral tracks are equivalent for scoring and movement: all cost 0 and are passable.
- If both players place on the same cell on the same turn it becomes neutral and nobody scores it, so `planTurn` shuffles which cells it places.

## Open questions
- Town cells: assumed to already hold tracks (or be free).
- partOfActiveConnections is "not useful" this league, but the code uses it to detect connected pairs; verify it still gets populated.

## Disruption / inking (advanced league rules, pasted by user)
- 1 disruption point per turn (not retained). `DISRUPT regionId` (or `DISRUPT x y`) adds 1 instability to a region.
- Instability reaches 4 -> region inked out: tracks washed away, no future placement, active connections through it severed.
- Cannot disrupt an already inked region, nor a region containing a town.
- Actions: `PLACE_TRACKS x y`, `AUTOPLACE ...`, `DISRUPT regionId|x y`, `WAIT`. `instability`/`inked` inputs are now meaningful.

## Implementation (main.ts)
- `search()` is one A*/Dijkstra core (packed-number heap, N,E,S,W tie-break); `astar()` wraps it. `computeRoutes()` runs one full search per town (not per pair) because the 50 ms limit was exceeded (176 ms) with one A* per pair.
- `planTurn` returns `{mine, routes}`; `planDisrupt` reuses them. It scores non-town, non-inked regions from the cheapest route of every desired pair: +1 foe tracks, -1 my tracks, +0.3 unbuilt cells, -0.6 unbuilt cells of my target route; divided by hits still missing to reach 4; sticky `disruptTarget`; ties go to the most unstable region; always issues a DISRUPT if any region is eligible.
- Simulated (30x20, 12 towns, all pairs wanted): worst turn ~21 ms (first, JIT), later turns ~1 ms.
- Not modelled: penalty for placing in a region near 4 instability (foe can ink it), foe knowledge of where foe's towns/start are.

## Full rules: scoring facts that drive strategy (from final statement)
- Points are scored every turn for 100 turns: for each ACTIVE connection, each player gets 1 point per track THEY OWN on its path. Foe/neutral tracks give me nothing (but are free to walk through).
- Active connection = SHORTEST path by cell count (not paint cost) over all tracks+towns, ties N,E,S,W from the requesting (wanting) town. A shorter foe path replaces mine.
- A track shared by several connections scores once per connection. Desired connections are unilateral (a wants b); pair scored once.
- No path = 0 points: incomplete routes are worthless until finished. Order: PLACE_TRACKS, then DISRUPT, then scoring (inked regions lose tracks before scoring).
- Win: most points after 100 turns, or leading when all desired connections become impossible.
- The final statement has NO POI; type is 0-2 (starter code still mentions 3).

## Improvement ideas (analysis, not yet implemented)
1. Local simulator with exact rules (active-connection BFS, scoring, ordering) + baseline opponent, to measure changes.
2. Value = my owned tracks on active paths minus foe's (per turn x remaining turns). Currently a route through foe tracks costs 0 and is treated as "done" though it scores me ~0: bug vs rules.
3. Schedule routes by Smith's rule: (points/turn gained) / (paint still needed). Plains cells ROI 1, river 0.5, mountain 0.33; trunk cells shared by k connections score k.
4. Build a shared trunk/tree; evaluate candidates by simulating the real connection computation on tracks union, not by the cheapest-paint path.
5. Orient pair search from the requesting town (tie-break direction).
6. Disruption: use partOfActiveConnections (now meaningful) for exact foe-vs-mine value per region; chokepoints; piggyback on regions the foe is pumping; avoid building in regions at instability >= 2-3; endgame: if leading, cut connections to make them impossible.
7. Randomise contested cells (already done) but prefer cells the foe is unlikely to take.

## Rewrite: value-based planner with lookahead (implemented)
- `evalRates` mirrors the game's scoring (BFS shortest path per requester, N,E,S,W, 1 point per OWN track per active connection). Everything is scored as (my points/turn - foe's).
- `genCands`: unfinished routes for a player from 3 variants (paint cost / avoiding foe tracks / fewest cells). Each is scored by simulating its completion: ratio = gain * (LIFETIME - turns to finish) / paint. `COMMIT_BONUS` keeps last turn's route to stop dithering.
- `planPlacements`: my 4 candidate moves x foe's 3 likely replies (simultaneous, same-cell clash = neutral), then my best follow-up; value = d1 + H*d2, blended 50/50 worst/mean over replies, plus a small progress term. Time-guarded (TIME_BUDGET_MS).
- `planDisrupt`: exact value = points/turn change from wiping the region's tracks (+ weighted unbuilt-route potential), divided by hits missing; sticky target.
- Region-risk: cells in regions at instability 3 are avoided, at 2 cost +1.
- Test tooling lived in the session scratchpad (referee with exact rules, worker threads, old-vs-new bots); not in the repo. Results, 12 games each, my own random maps (region density unknown): LIFETIME 8 beat the previous bot 8-4 on both densities; 15: about even; 30: lost; 5: mixed.
- Region density of the real maps is unknown; inking dominates my simulated games (nearly the whole map inked by turn ~40), so early scoring is valued highly.

- Self-inking fix: planDisrupt never picks a region holding my own tracks (incl. this turn placements) unless the exact value is positive after a sunk-paint penalty (SUNK_W); regions on my unbuilt routes count double against (MY_ROUTE_W). Simulated: tracks washed by own hits fell from ~10-20/game to ~0-4.

## Time protection and inking preference (added after a real timeout)
- Levels 0/1/2 (SOFT_MS 16, HARD_MS 26, SLOW_MS 30): every stage checks the clock, a slow turn raises the level next turn, 5 calm turns lower it. When active, a `MESSAGE time guard lvl N Xms` is added to the output. Tested with tiny budgets: still valid output, 2-5 ms/turn, and level 2 alone still matched/beat the old bot in my sim.
- planDisrupt now prefers regions holding foe tracks (FOE_SUNK_W bonus) and, when any exist, never picks an empty region.
- Real-judge CPU speed is unknown; if it still times out, lower SOFT_MS/HARD_MS or start at level 1.
