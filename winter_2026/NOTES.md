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
