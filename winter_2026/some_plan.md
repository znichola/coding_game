# Snakebot AI — Implementation Plan

## Context

This document describes the architecture for a new AI engine for a snakebot game. The existing code has a working game loop, input parsing, board representation, and a basic A* that ignores gravity. The goal is to replace the `algo` function and its helpers with the system described below.

The AI re-plans every turn. There is no path commitment across turns. Each turn, the engine picks the best first move for all snakes simultaneously and dispatches it.

---

## Game Rules (critical for simulation correctness)

### Turn order — four strict phases, in this order

1. **Move** — all snake heads advance simultaneously, bodies follow, tails stay
2. **Eat** — heads on power sources grow (tail stays); heads not on a source lose their tail
3. **Collide** — heads on walls or body segments lose their head (or die if < 3 parts); head-on-head = both lose a head
4. **Gravity** — all surviving snakes fall simultaneously until supported

### Solidity rules

- Walls are always solid
- Power sources are solid **until eaten**
- Snake body segments are solid (own and opponent)
- A snake that falls entirely off the bottom of the map is removed

### Eating edge cases

- Two heads landing on the same power source: **both eat it**, both grow
- A power source that is eaten is **no longer solid** during the gravity phase

### Out of bounds

- A head can move out of bounds — this is legal and not a collision
- A snake that falls off the bottom of the map is removed

---

## Architecture Overview

```
buildOccupancyMap
        │
getCandidateMoves (per snake, static-wall prune only)
        │
enumerateJointCandidates (cartesian product)
        │
applyJointAction (four phases, per combination)
        │
scoreJointCandidate (per surviving combination)
        │
pick best → Map<snakeId, Direction> → dispatch
```

---

## Primitives

### 1. `buildOccupancyMap`

```typescript
type OccupancyMap = {
    occupancy: number[][];   // occupancy[y][x] = probability [0,1] cell is blocked
};

function buildOccupancyMap(
    oppSnakes: Map<number, Snakebot>,
    maxDepth: number,            // typically 8
    staticMap: StaticCell[][],
): OccupancyMap
```

Built once per turn from opponent snake positions. The snake body is a queue — segments vacate in a known, deterministic order from the tail. The model at lookahead depth `d`:

- **Tail segments** `body[length-1]` down to `body[length-d]`: probability **0.0** — definitely vacated, the snake has moved away
- **Remaining body segments** `body[length-d-1]` down to `body[1]`: probability **1.0** — definitely still occupied, the body hasn't passed through yet
- **Head future positions**: BFS from current head to depth `d`, distribute probability **1.0 evenly** across all reachable frontier cells. Optionally bias toward cells closer to the nearest power source (greedy opponent assumption).

A body segment at index `i` from the tail vacates after exactly `i+1` turns (assuming no eating). This is deterministic — no decay needed. The only genuine uncertainty is the head fan.

Used during scoring to penalise moves that walk into certain or likely opponent positions.

---

### 2. `getCandidateMoves`

```typescript
type CandidateMove = {
    snakeId:   number;
    direction: Direction;
};

function getCandidateMoves(
    snake: Snakebot,
    allSnakes: Snakebot[],   // own snake + teammates + opponents
    staticMap: StaticCell[][],
    board: Cell[][],
): CandidateMove[]
```

Prunes a direction `D` if the new head position `P` is **guaranteed to be occupied during phase 3**, regardless of what any snake does this turn:

- `P` is a **static wall** — always fatal
- `P` is **any snake's non-tail segment** (`body[0..length-2]`) — own, teammate, or opponent — these segments are always present during phase 3 because only the tail vacates

**Do not prune** if `P` is:
- Any snake's **tail** (`body[length-1]`) — the tail vacates if that snake doesn't eat, but you cannot know that yet; leave it to `applyJointAction`
- **Out of bounds** — legal move
- A **power source** — eating, not a collision

This is the maximum safe pruning before joint resolution. Since an average snake has 4+ segments, this typically eliminates most or all clearly suicidal directions cheaply. Returns 1–4 candidates per snake.

---

### 3. `applyJointAction` — four phases

```typescript
function applyJointAction(
    snakes: Snakebot[],
    directions: Map<number, Direction>,
    board: Cell[][],
    sources: Point[],
    staticMap: StaticCell[][],
): JointActionResult

type JointActionResult = {
    survivors:       Snakebot[];
    eatenSources:    Point[];
    remainingSources: Point[];
    deadSnakeIds:    number[];
};
```

#### Phase 1 — `phaseMove`

```typescript
function phaseMove(
    snakes: Snakebot[],
    directions: Map<number, Direction>,
): Snakebot[]
```

- For each snake: `body = [newHead, ...currentBody]`
- New head = head + direction delta
- Tail segment is **not removed** — body is temporarily one longer
- No collision or gravity logic here

#### Phase 2 — `phaseEat`

```typescript
function phaseEat(
    movedSnakes: Snakebot[],
    sources: Point[],
): { snakes: Snakebot[]; eatenSources: Point[]; remainingSources: Point[] }
```

- For each snake: check if `head` matches any source position
  - **Ate**: tail stays, snake is now permanently one longer
  - **Did not eat**: `body = body.slice(0, -1)`, back to original length
- Multiple heads on same source: all eat it
- Eaten sources are removed from `remainingSources`

#### Phase 3 — `phaseCollide`

```typescript
function phaseCollide(
    snakes: Snakebot[],
    staticMap: StaticCell[][],
): { survivors: Snakebot[]; deadIds: number[] }
```

Build the full joint board from all post-eat snake positions first, then evaluate every head simultaneously against it:

- Head on static wall → lose head; if body length < 3 after, remove snake
- Head on any body segment → lose head; if body length < 3 after, remove snake
- Head on another head → both lose their heads; remove either if too short
- Head out of bounds → no collision, snake survives with head off-map

#### Phase 4 — `phaseGravity`

```typescript
function phaseGravity(
    snakes: Snakebot[],
    remainingSources: Point[],
    staticMap: StaticCell[][],
): { survivors: Snakebot[]; deadIds: number[] }
```

- All surviving snakes fall simultaneously
- Solid during this phase: static walls + remaining (uneaten) sources + other snake bodies
- Eaten sources are gone and provide no support
- Iterative: drop all snakes one row at a time until every snake is supported or off-map
- Two snakes cannot support each other — the snake already lower is solid for the one falling onto it
- Snake that falls entirely off the bottom of the map is removed

---

### 4. `enumerateJointCandidates`

```typescript
type JointCandidate = {
    moves:           CandidateMove[];    // one per snake
    result:          JointActionResult;  // output of applyJointAction
};

function enumerateJointCandidates(
    perSnakeCandidates: CandidateMove[][],
    snakes: Snakebot[],
    board: Cell[][],
    sources: Point[],
    staticMap: StaticCell[][],
): JointCandidate[]
```

Cartesian product of each snake's candidate moves. For each combination, calls `applyJointAction` and stores the result. Combinations where **any of your own snakes die** are filtered out — unless all combinations result in death, in which case keep all (pick least-bad).

Combination count: `4^N` worst case, `~2^N` typical after static-wall pruning.

| Snakes | Worst case | Typical |
|--------|-----------|---------|
| 2      | 16        | 4       |
| 3      | 64        | 8       |
| 4      | 256       | 16      |

---

### 5. `scoreJointCandidate`

```typescript
function scoreJointCandidate(
    candidate: JointCandidate,
    sources: Point[],
    occupancy: OccupancyMap,
    staticMap: StaticCell[][],
): number
```

Weighted sum of these signals, evaluated on `candidate.result`:

| Signal | Description | Weight |
|--------|-------------|--------|
| `sourcesReachable` | For each surviving snake: can it still reach any source? Binary per snake, summed | High |
| `tempoSum` | Sum of `1 / manhattan(head, nearestSource)` per snake | Medium |
| `spaceSum` | Sum of flood-fill reachable cells per snake head (avoids corridors) | Medium |
| `occupancyPenalty` | Sum of `occupancy[head.y][head.x]` per snake after settling | Low |
| `deathPenalty` | Penalty per snake killed this turn | Very high negative |

`sourcesReachable` is the dominant term. A combination that leaves one of your snakes with no path to any source scores very poorly, even if the other snakes are well-placed.

---

### 6. `selectTarget`

```typescript
function selectTarget(
    snake: Snakebot,
    sources: Point[],
    staticMap: StaticCell[][],
    board: Cell[][],
): Point | null
```

Picks the best source for a given snake before search. Uses a shallow depth-limited BFS (not full A*) per candidate source to estimate actual turn cost accounting for rough gravity, rather than raw Manhattan distance. Returns the source with the lowest estimated turn cost.

Used only inside `scoreJointCandidate` for the `tempoSum` and `sourcesReachable` signals — target assignment is implicit through scoring, not hardcoded per snake.

---

### 7. `floodFillScore`

```typescript
function floodFillScore(
    head: Point,
    staticMap: StaticCell[][],
    board: Cell[][],
    maxDepth: number,   // typically 10–15
): number
```

BFS from head, counting reachable non-wall cells within `maxDepth` steps. Used as the `spaceSum` component of scoring. Penalises moves that funnel a snake into a dead end.

---

## Full Turn Entry Point

```typescript
function coordinateMoves(
    snakes: Snakebot[],
    staticMap: StaticCell[][],
    board: Cell[][],
    sources: Point[],
    oppSnakes: Map<number, Snakebot>,
): Map<number, Direction> {

    // 1. Build opponent uncertainty model
    const occupancy = buildOccupancyMap(oppSnakes, 8, staticMap);

    // 2. Get candidate first moves per snake (prune static walls + definite body collisions)
    const allSnakes = [...snakes, ...oppSnakes.values()];
    const perSnakeCandidates = snakes.map(s => getCandidateMoves(s, allSnakes, staticMap, board));

    // 3. Enumerate all joint combinations, run all four phases per combo
    const jointCandidates = enumerateJointCandidates(
        perSnakeCandidates, snakes, board, sources, staticMap
    );

    // 4. Score each surviving combination
    const scored = jointCandidates.map(c => ({
        candidate: c,
        score: scoreJointCandidate(c, sources, occupancy, staticMap),
    }));

    // 5. Pick best combination
    const best = scored.reduce((a, b) => a.score > b.score ? a : b);

    // 6. Return one Direction per snake
    return new Map(best.candidate.moves.map(m => [m.snakeId, m.direction]));
}
```

---

## Key Invariants to Maintain

- **Phase order is strict** — move, eat, collide, gravity. Never interleave.
- **Phases are simultaneous** — never evaluate snakes sequentially within a phase.
- **Eaten sources are immediately non-solid** — gravity phase must use `remainingSources`, not the original source list.
- **`getCandidateMoves` prunes only what is guaranteed** — static walls and non-tail body segments of all snakes. Tails are left to `applyJointAction` because tail vacating depends on eating, which isn't known yet.
- **Re-plan every turn** — no path is stored across turns. The board state passed in each turn is authoritative.