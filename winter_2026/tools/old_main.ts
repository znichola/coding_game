/**
 * Connect towns with your train tracks and disrupt the opponent's.
 **/

// Debug log: set true to dump every input and decision to STDERR (tags #IN #T #OWN #INST #INKED #ACT #DBG #OUT).
// stdout is reserved for commands; printing anything else there would be an invalid action and lose the game.
const LOG = false;
const logLine = (tag: string, text: string) => { if (LOG) console.error(`#${tag} ${text}`); };
let initDone = false;
const input = (): string => { const l = readline(); if (LOG && !initDone) console.error('#IN ' + l); return l; };
let dbgInfo = '';

const myId: number = parseInt(input()); // 0 or 1
const width: number = parseInt(input()); // map size
const height: number = parseInt(input());
const regionOf: number[] = new Array(width * height).fill(0);
const terrain: number[] = new Array(width * height).fill(0); // 0 (PLAINS), 1 (RIVER), 2 (MOUNTAIN), 3 (POI)
for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
        var inputs: string[] = input().split(' ');
        const regionId: number = parseInt(inputs[0]);
        const type: number = parseInt(inputs[1]);
        terrain[i * width + j] = type;
        regionOf[i * width + j] = regionId;
    }
}
const townCount: number = parseInt(input());
interface Town { id: number; x: number; y: number; wants: number[] }
const towns = new Map<number, Town>();
for (let i = 0; i < townCount; i++) {
    var inputs: string[] = input().split(' ');
    const townId: number = parseInt(inputs[0]);
    const townX: number = parseInt(inputs[1]);
    const townY: number = parseInt(inputs[2]);
    const desiredConnections: string = inputs[3]; // comma-separated town ids e.g. 0,1,2,3
    const wants = (desiredConnections ?? '').split(',').map(Number).filter(n => Number.isInteger(n));
    towns.set(townId, { id: townId, x: townX, y: townY, wants });
}
initDone = true;

// ---------------------------------------------------------------- A*

// Neighbour order = tie-break priority: North, East, South, West (y grows downward).
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Cost of entering cell (x, y). Return Infinity for impassable cells. */
type CostFn = (x: number, y: number) => number;

// Heap entries are packed into one number: (f, then higher g, then insertion order) -> smaller key pops first.
// Costs are integers, so this is exact. Buffers are shared because nothing here is re-entrant.
const HEAP_CAP = 4 * width * height + 8;
const heapKey = new Float64Array(HEAP_CAP);
const heapNode = new Int32Array(HEAP_CAP);

/**
 * Cheapest-cost search from (sx, sy) over a 4-neighbour grid, A* when a goal is given, Dijkstra when gx < 0.
 * Equal-f ties: deeper node (higher g) first, then earliest inserted. Neighbours are inserted N, E, S, W,
 * so north wins, then east, south, west.
 * minCost must be <= the smallest finite value cost() can return (keeps the heuristic admissible).
 */
function search(
    sx: number, sy: number, gx: number, gy: number,
    cost: CostFn, minCost: number = 1,
): { g: Float64Array; parent: Int32Array } {
    const n = width * height;
    const goal = gx < 0 ? -1 : gy * width + gx;
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const h = goal < 0 ? () => 0 : (x: number, y: number) => (Math.abs(x - gx) + Math.abs(y - gy)) * minCost;

    let size = 0, seq = 0;
    const push = (node: number, gv: number, f: number) => {
        const key = (f * 16384 + (16383 - gv)) * 131072 + seq++;
        let i = size++;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heapKey[p] <= key) break;
            heapKey[i] = heapKey[p]; heapNode[i] = heapNode[p]; i = p;
        }
        heapKey[i] = key; heapNode[i] = node;
    };
    const pop = (): number => {
        const top = heapNode[0];
        size--;
        if (size > 0) {
            const key = heapKey[size], node = heapNode[size];
            let i = 0;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= size) break;
                if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c++;
                if (heapKey[c] >= key) break;
                heapKey[i] = heapKey[c]; heapNode[i] = heapNode[c]; i = c;
            }
            heapKey[i] = key; heapNode[i] = node;
        }
        return top;
    };

    const start = sy * width + sx;
    g[start] = 0;
    push(start, 0, h(sx, sy));
    while (size > 0) {
        const cur = pop();
        if (closed[cur]) continue; // stale entry
        closed[cur] = 1;
        if (cur === goal) break;
        const cx = cur % width, cy = (cur / width) | 0;
        for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (closed[ni]) continue;
            const c = cost(nx, ny);
            if (c === Infinity) continue;
            const ng = g[cur] + c;
            if (ng < g[ni]) { // strictly better only: first-inserted (N,E,S,W) keeps ties
                g[ni] = ng;
                parent[ni] = cur;
                push(ni, ng, ng + h(nx, ny));
            }
        }
    }
    return { g, parent };
}

/** Path from the search origin to cell index `to` inclusive as [x, y] pairs, or null if unreached. */
function pathTo(res: { g: Float64Array; parent: Int32Array }, to: number): [number, number][] | null {
    if (res.g[to] === Infinity) return null;
    const path: [number, number][] = [];
    for (let c = to; c !== -1; c = res.parent[c]) path.push([c % width, (c / width) | 0]);
    return path.reverse();
}

/** A* from start to goal inclusive, or null if unreachable. */
function astar(
    sx: number, sy: number, gx: number, gy: number,
    cost: CostFn, minCost: number = 1,
): [number, number][] | null {
    return pathTo(search(sx, sy, gx, gy, cost, minCost), gy * width + gx);
}

// ---------------------------------------------------------------- Command wrapper

/** Collects actions and always prints a valid line (falls back to WAIT). */
class Commands {
    private actions: string[] = [];
    private placed = new Set<number>();

    private inBounds(x: number, y: number) {
        return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
    }
    place(x: number, y: number) {
        if (!this.inBounds(x, y) || this.placed.has(y * width + x)) return this;
        this.placed.add(y * width + x);
        this.actions.push(`PLACE_TRACKS ${x} ${y}`);
        return this;
    }
    autoplace(fx: number, fy: number, tx: number, ty: number) {
        if (this.inBounds(fx, fy) && this.inBounds(tx, ty)) this.actions.push(`AUTOPLACE ${fx} ${fy} ${tx} ${ty}`);
        return this;
    }
    message(text: string) {
        const t = text.replace(/[;\r\n]/g, ' ').trim();
        if (t) this.actions.push(`MESSAGE ${t}`);
        return this;
    }
    disrupt(regionId: number) {
        if (Number.isInteger(regionId) && regionId >= 0) this.actions.push(`DISRUPT ${regionId}`);
        return this;
    }
    wait() { this.actions.push('WAIT'); return this; }
    mark() { return this.actions.length; }
    rollback(n: number) { this.actions.length = n; }

    /** Print the turn's line and reset. Drops WAIT when other actions exist. */
    flush() {
        let out = this.actions.filter(a => a !== 'WAIT');
        if (out.length === 0) out = ['WAIT'];
        logLine('OUT', out.join(';'));
        console.log(out.join(';'));
        this.actions = [];
        this.placed.clear();
    }
}
const cmd = new Commands();

// ---------------------------------------------------------------- Game model

const TERRAIN_COST = [1, 2, 3]; // plains, river, mountain
const PAINT_PER_TURN = 3;
const COMMIT_BONUS = 1.6; // ranking boost for continuing the route we were building last turn
const LIFETIME = 8;  // turns a connection is assumed to survive (inking, foe shortcuts): earlier completion is worth more
const TOTAL_TURNS = 100;
const INK_AT = 4; // instability at which a region is inked out
const N = width * height;

const trackOwner = new Int8Array(N).fill(-1); // -1 none, 0/1 player, 2 neutral
const isInked = new Uint8Array(N); // region inked out: tracks gone, no placing
const instability = new Int8Array(N); // per cell, shared by its region
let turnNo = 0;

const isTown = new Uint8Array(N);
for (const t of towns.values()) isTown[t.y * width + t.x] = 1;

const paintOf = (cell: number) => TERRAIN_COST[terrain[cell]] ?? 1;

/** Desired pair, searched from the town that wants the connection (tie-break direction starts there). */
interface Pair { from: Town; to: Town }
const pairs: Pair[] = [];
const byFrom = new Map<number, Pair[]>();
{
    const seen = new Set<string>();
    for (const t of towns.values()) {
        for (const w of t.wants) {
            const o = towns.get(w);
            const k = t.id < w ? `${t.id}-${w}` : `${w}-${t.id}`;
            if (!o || o === t || seen.has(k)) continue;
            seen.add(k);
            const p = { from: t, to: o };
            pairs.push(p);
            if (!byFrom.has(t.id)) byFrom.set(t.id, []);
            byFrom.get(t.id)!.push(p);
        }
    }
}

// ---------------------------------------------------------------- Scoring model (mirrors the game's rules)

const DX = [0, 1, 0, -1]; // N, E, S, W
const DY = [-1, 0, 1, 0];
const bfsQueue = new Int32Array(N);
const bfsParent = new Int32Array(N);
let rate0 = 0, rate1 = 0; // result of evalRates

/**
 * Points per turn each player would earn from these tracks: for every desired pair the shortest cell path over
 * tracks and towns is active (ties N, E, S, W from the requesting town) and pays 1 to each player per own track on it.
 */
function evalRates(owner: Int8Array): void {
    let s0 = 0, s1 = 0;
    for (const [fromId, list] of byFrom) {
        const from = towns.get(fromId)!;
        const src = from.y * width + from.x;
        bfsParent.fill(-2);
        let qh = 0, qt = 0;
        bfsQueue[qt++] = src;
        bfsParent[src] = -1;
        while (qh < qt) {
            const c = bfsQueue[qh++];
            const cx = c % width, cy = (c / width) | 0;
            for (let d = 0; d < 4; d++) {
                const nx = cx + DX[d], ny = cy + DY[d];
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const ni = ny * width + nx;
                if (bfsParent[ni] !== -2 || (owner[ni] < 0 && !isTown[ni])) continue;
                bfsParent[ni] = c;
                bfsQueue[qt++] = ni;
            }
        }
        for (const p of list) {
            let c = p.to.y * width + p.to.x;
            if (bfsParent[c] === -2) continue;
            while (c !== src) {
                const o = owner[c];
                if (o === 0) s0++; else if (o === 1) s1++;
                c = bfsParent[c];
            }
        }
    }
    rate0 = s0; rate1 = s1;
}
const diffOf = (p: number) => (p === 0 ? rate0 - rate1 : rate1 - rate0);

/** Tracks after both players place simultaneously; a cell both take on the same turn becomes neutral. */
function applyMoves(owner: Int8Array, a: number[], pa: number, b: number[], pb: number): Int8Array {
    const o = owner.slice();
    for (const c of a) o[c] = pa;
    for (const c of b) o[c] = owner[c] < 0 && o[c] === pa ? 2 : pb;
    return o;
}

// ---------------------------------------------------------------- Candidate routes and moves

/** A route worth building: the cells it still lacks and what finishing it is worth to `p` per paint point. */
interface Cand { cells: number[]; paint: number; ratio: number }

/**
 * Cheapest way to complete every desired pair for player p.
 * variant 0: paint cost, any existing track is free to walk. 1: like 0 but never through the foe's tracks.
 * 2: fewest cells (what the game will actually pick as the active path), paint only breaks ties.
 * Regions one hit from inking are avoided; those two hits away cost extra.
 */
function candidatePaths(owner: Int8Array, p: number, variant: number): number[][] {
    const cost: CostFn = (x, y) => {
        const i = y * width + x;
        if (isInked[i] || doomed[i]) return Infinity; // inked, or the foe is about to ink it
        if (isTown[i]) return variant === 2 ? 6 : 0;
        const o = owner[i];
        if (o >= 0) {
            if (variant === 0) return 0;
            if (variant === 1) return o === p || o === 2 ? 0 : Infinity;
            return 6;
        }
        const inst = instability[i];
        if (inst >= INK_AT - 1) return Infinity;
        return (variant === 2 ? 5 + paintOf(i) : paintOf(i)) + (inst === INK_AT - 2 ? 1 : 0);
    };
    const searched = new Map<number, ReturnType<typeof search>>();
    const out: number[][] = [];
    for (const pr of pairs) {
        let res = searched.get(pr.from.id);
        if (!res) searched.set(pr.from.id, res = search(pr.from.x, pr.from.y, -1, -1, cost));
        const to = pr.to.y * width + pr.to.x;
        if (res.g[to] === Infinity) continue;
        const need: number[] = [];
        for (let c = to; c !== -1; c = res.parent[c]) if (owner[c] < 0 && !isTown[c]) need.push(c);
        if (need.length) out.push(need);
    }
    return out;
}

/** Unfinished routes for p, best first by (gain in points per turn once finished) / (paint still needed). */
function genCands(owner: Int8Array, p: number, variants: number[], maxN: number, prefer: Set<number> | null = null): Cand[] {
    const seen = new Set<string>();
    const raw: Cand[] = [];
    for (const v of variants) {
        for (const need of candidatePaths(owner, p, v)) {
            const sig = need.slice().sort((a, b) => a - b).join(',');
            if (seen.has(sig)) continue;
            seen.add(sig);
            let paint = 0;
            for (const c of need) paint += paintOf(c);
            raw.push({ cells: need, paint, ratio: 0 });
        }
    }
    raw.sort((a, b) => a.paint - b.paint);
    evalRates(owner);
    const d0 = diffOf(p);
    const good: Cand[] = [];
    for (const c of raw.slice(0, maxN)) {
        const o = owner.slice();
        for (const x of c.cells) o[x] = p;
        evalRates(o);
        const gain = diffOf(p) - d0;
        if (gain > 0) {
            c.ratio = gain * Math.max(1, LIFETIME - Math.ceil(c.paint / PAINT_PER_TURN)) / c.paint;
            if (prefer && prefer.size > 0) { // stay on the route we started: half or more of its remaining cells are still needed
                let hit = 0;
                for (const x of c.cells) if (prefer.has(x)) hit++;
                if (hit * 2 >= prefer.size) c.ratio *= COMMIT_BONUS;
            }
            good.push(c);
        }
    }
    if (good.length === 0) return raw.slice(0, maxN); // nothing pays yet: build the nearest routes anyway
    return good.sort((a, b) => b.ratio - a.ratio);
}

interface Move { cells: number[]; progress: number; primary: Cand }

function shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Up to k distinct ways to spend one turn's paint: pour it into candidate j first, spill the rest over the
 * other candidates in rank order. Cells are taken in random order so the foe cannot predict (and neutralise) them.
 * progress = value-weighted paint put into routes, a tie-break that rewards moving towards completion.
 */
function buildMoves(cands: Cand[], k: number): Move[] {
    const moves: Move[] = [];
    const seen = new Set<string>();
    for (let j = 0; j < Math.min(k, cands.length); j++) {
        const order = [cands[j], ...cands.filter((_, i) => i !== j)];
        const used = new Set<number>();
        const cells: number[] = [];
        let budget = PAINT_PER_TURN, progress = 0;
        for (const c of order) {
            for (const cell of shuffle(c.cells.slice())) {
                const pc = paintOf(cell);
                if (used.has(cell) || pc > budget) continue;
                used.add(cell);
                cells.push(cell);
                budget -= pc;
                progress += c.ratio * pc;
            }
            if (budget === 0) break;
        }
        const sig = cells.slice().sort((a, b) => a - b).join(',');
        if (cells.length && !seen.has(sig)) { seen.add(sig); moves.push({ cells, progress, primary: cands[j] }); }
    }
    return moves;
}

// ---------------------------------------------------------------- Lookahead: pick this turn's placements

let lastTarget: Set<number> | null = null; // cells still missing on the route we committed to last turn

// Time protection (50 ms per turn). The judge's CPU is slower than a dev machine, so search effort adapts:
// level 0 full search, 1 fewer candidates and no follow-up ply, 2 minimal (no foe model, no lookahead).
// Every stage also checks the clock and bails out early; the turn still prints a valid line.
const SOFT_MS = 16;   // stop optional refinement (follow-up ply, exact disruption values)
const HARD_MS = 26;   // stop the lookahead altogether
const SLOW_MS = 30;   // a turn this slow raises the level for the next turn
let level = 0;
let calmTurns = 0;
let guardHit = false; // set whenever protection cut work short this turn
const elapsed = (t0: number) => Date.now() - t0;
const PROGRESS_W = 0.25;

/**
 * Plan as if regions that are about to be inked already were: doomed ones (the foe is pumping them) and ones one hit
 * from inking. Routes through them then stop counting, so the planner builds the bypass BEFORE the ink lands.
 */
const PREEMPT = false; // tested: no measurable gain yet (see NOTES), so off
function foresight(owner: Int8Array): Int8Array {
    if (!PREEMPT) return owner;
    const o = owner.slice();
    for (let i = 0; i < N; i++) if (o[i] >= 0 && (doomed[i] || instability[i] >= INK_AT - 1)) o[i] = -1;
    return o;
}

/**
 * Both players move at once, so for each of my candidate moves I try the foe's likely replies (their best
 * routes), apply both (clashes go neutral), then let me play my best follow-up move. A move is scored by
 * points/turn after the first turn plus the horizon-weighted points/turn after the follow-up, so finishing a
 * route within two turns is worth far more than leaving it half-built. Result blends the worst and the average reply.
 */
function planPlacements(t0: number) {
    const foe = 1 - myId;
    const owner0 = foresight(trackOwner);
    const remaining = TOTAL_TURNS - turnNo;
    const H = Math.max(1, Math.min(8, remaining - 1));

    const myC = genCands(owner0, myId, level < 2 ? [0, 1, 2] : [0, 2], level === 0 ? 14 : level === 1 ? 8 : 5, lastTarget);
    const foeC = level < 2 && elapsed(t0) < SOFT_MS ? genCands(owner0, foe, [0, 2], level === 0 ? 8 : 4) : [];
    const myMoves = buildMoves(myC, level === 0 ? 4 : 3);
    let foeMoves = buildMoves(foeC, 3);
    if (foeMoves.length === 0) foeMoves = [{ cells: [], progress: 0, primary: null! }];
    if (myMoves.length === 0) return { cells: [] as number[], myC, foeC };

    let best = myMoves[0], bestVal = -Infinity;
    for (const m of myMoves) {
        let worst = Infinity, sum = 0, n = 0;
        for (const f of foeMoves) {
            if (level === 2 || elapsed(t0) > HARD_MS) { guardHit = true; break; }
            const s1 = applyMoves(owner0, m.cells, myId, f.cells, foe);
            evalRates(s1);
            const d1 = diffOf(myId);
            let best2 = d1;
            if (level === 0 && elapsed(t0) < SOFT_MS) {
                const c2 = genCands(s1, myId, [0, 2], 5);
                for (const m2 of buildMoves(c2, 3)) {
                    evalRates(applyMoves(s1, m2.cells, myId, [], foe));
                    best2 = Math.max(best2, diffOf(myId));
                }
            }
            else guardHit = level > 0 || guardHit || elapsed(t0) >= SOFT_MS;
            const val = d1 + H * best2;
            worst = Math.min(worst, val);
            sum += val;
            n++;
        }
        // no reply evaluated (out of time): fall back to the ranking alone
        const total = (n > 0 ? 0.5 * worst + 0.5 * (sum / n) : 0) + PROGRESS_W * H * m.progress;
        if (total > bestVal) { bestVal = total; best = m; }
    }
    if (LOG) {
        const top = (cs: Cand[]) => cs.slice(0, 3).map(c => `${c.cells.length}c/${c.paint}p/r${c.ratio.toFixed(1)}`).join(' ');
        dbgInfo += `myC=${myC.length}[${top(myC)}] foeC=${foeC.length}[${top(foeC)}] place=${best.cells.map(c => (c % width) + ',' + ((c / width) | 0)).join(' ')} `;
    }
    const placed = new Set(best.cells);
    lastTarget = new Set(best.primary.cells.filter(c => !placed.has(c)));
    return { cells: best.cells, myC, foeC };
}

// ---------------------------------------------------------------- Disruption (inking)

const POT_W = 0.3;    // weight of routes not built yet, relative to tracks already on active paths
const MY_ROUTE_W = 2; // routes I still want to build count double against inking their region
const FOE_SUNK_W = 1; // bonus per paint point of foe tracks an inking would wash away
const SUNK_W = 2;     // penalty per paint point of my tracks that inking would wash away
const STICKY = 0.6;   // keep the current target unless another is this much better

const regionHasTown = new Set<number>();
for (let i = 0; i < N; i++) if (isTown[i]) regionHasTown.add(regionOf[i]);
const regionCells = new Map<number, number[]>();
for (let i = 0; i < N; i++) {
    if (!regionCells.has(regionOf[i])) regionCells.set(regionOf[i], []);
    regionCells.get(regionOf[i])!.push(i);
}

let disruptTarget: number | null = null; // region we keep pushing towards INK_AT
let lastHit = -1;                        // region I disrupted last turn (to tell my hits from the foe's)
const prevInst = new Map<number, number>();
const foeStreak = new Map<number, number>(); // consecutive turns the foe has hit a region
const FOE_STREAK_DOOM = 2;                  // this many foe hits in a row: assume they will finish it
const doomed = new Uint8Array(N);           // per cell: its region is being inked by the foe

/** Called once per turn after parsing: works out which regions the foe is pumping (instability rose and it was not me). */
function trackFoeHits() {
    for (const [r, cells] of regionCells) {
        const v = instability[cells[0]];
        const rise = v - (prevInst.get(r) ?? 0);
        const foeHits = rise - (r === lastHit ? 1 : 0);
        // cumulative, not consecutive: instability never decays, and the foe skips a turn now and then (real log: 0,3,4,5)
        if (foeHits > 0) foeStreak.set(r, (foeStreak.get(r) ?? 0) + foeHits);
        prevInst.set(r, v);
        const dead = (foeStreak.get(r) ?? 0) >= FOE_STREAK_DOOM && v < INK_AT;
        for (const c of cells) doomed[c] = dead ? 1 : 0;
    }
}

/**
 * One DISRUPT per turn. A region's value is how much inking it improves (my points/turn - foe's), measured by
 * re-running the scoring model without its tracks, plus a smaller term for the routes each side still wants to
 * build through it. Inking needs INK_AT hits, so the value is divided by hits still missing, and we stay on a target.
 */
function planDisrupt(after: Int8Array, myC: Cand[], foeC: Cand[], t0: number) {
    evalRates(after);
    const base = diffOf(myId);
    const pot = new Map<number, number>();
    const addPot = (cs: Cand[], w: number) => {
        for (const c of cs) for (const cell of c.cells) pot.set(regionOf[cell], (pot.get(regionOf[cell]) ?? 0) + w * c.ratio * paintOf(cell));
    };
    addPot(foeC, 1);
    addPot(myC, -MY_ROUTE_W);
    const myWorth = myC.length ? Math.max(1, myC[0].ratio) : 1; // value of a paint point I already sank into a route

    let best = -1, bestVal = -Infinity;
    const values = new Map<number, number>();
    const foeRegions = new Set<number>(); // regions holding foe tracks
    for (const [r, cells] of regionCells) {
        if (regionHasTown.has(r) || isInked[cells[0]]) continue;
        let exact = 0;
        if (level < 2 && elapsed(t0) < SOFT_MS + 6 && cells.some(c => after[c] >= 0)) {
            const wiped = after.slice();
            for (const c of cells) wiped[c] = -1;
            evalRates(wiped);
            exact = diffOf(myId) - base;
        }
        // My own tracks here may not score yet (route unfinished) but are paint I would throw away.
        let sunk = 0, foeSunk = 0;
        for (const c of cells) {
            if (after[c] === myId) sunk += paintOf(c);
            else if (after[c] === 1 - myId) foeSunk += paintOf(c);
        }
        // Foe tracks washed away are worth something even before they score (paint they wasted).
        const v = (exact + POT_W * (pot.get(r) ?? 0) + FOE_SUNK_W * foeSunk - SUNK_W * myWorth * sunk) / (INK_AT - instability[cells[0]]);
        if (sunk > 0 && v <= 0) continue; // never wash away my own tracks unless it clearly pays
        if (foeSunk > 0) foeRegions.add(r);
        values.set(r, v);
        if (v > bestVal || (v === bestVal && instability[cells[0]] > instability[regionCells.get(best)![0]])) { best = r; bestVal = v; }
    }
    if (best < 0) return;
    // Inking foe tracks always beats inking an empty region: restrict to those when any exist.
    if (foeRegions.size > 0 && !foeRegions.has(best)) {
        best = -1; bestVal = -Infinity;
        for (const r of foeRegions) {
            const v = values.get(r)!;
            if (v > bestVal) { best = r; bestVal = v; }
        }
    }
    const t = disruptTarget;
    const tv = t === null || (foeRegions.size > 0 && !foeRegions.has(t)) ? undefined : values.get(t);
    if (tv !== undefined && tv >= bestVal - (1 - STICKY) * Math.abs(bestVal)) best = t!;
    disruptTarget = best;
    if (LOG) dbgInfo += `disrupt=${best} v=${(values.get(best) ?? 0).toFixed(1)} foeRegions=${foeRegions.size} `;
    lastHit = best;
    cmd.disrupt(best);
}

/**
 * The first turn may take 1000 ms but later ones only 50 ms, and cold code is several times slower.
 * Replay this turn's planning a number of times, discarding the results, so the JIT has compiled the hot paths.
 */
function warmUp(t0: number) {
    const saved = { lastTarget, disruptTarget, lastHit, level };
    const mark = cmd.mark();
    const start = Date.now();
    for (let i = 0; i < 60 && Date.now() - start < 300 && Date.now() - t0 < 450; i++) {
        const t = Date.now();
        const plan = planPlacements(t);
        planDisrupt(applyMoves(trackOwner, plan.cells, myId, [], 1 - myId), plan.myC, plan.foeC, t);
        cmd.rollback(mark);
    }
    lastTarget = saved.lastTarget; disruptTarget = saved.disruptTarget; lastHit = saved.lastHit; level = saved.level;
    guardHit = false;
    dbgInfo = '';
}

// game loop
while (true) {
    const myScore: number = parseInt(input());
    const foeScore: number = parseInt(input());
    const t0 = Date.now();
    turnNo++;
    const actLog: string[] = [];
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            var inputs: string[] = input().split(' ');
            const tracksOwner: number = parseInt(inputs[0]);
            const inst: number = parseInt(inputs[1]); // region inked (destroyed) when this >= 3.
            const inked: boolean = inputs[2] !== '0'; // true if region is destroyed.
            const partOfActiveConnections: string = inputs[3]; // if this cell is part of one or more railway connections, this will be town ids (separated by -) in a list separated by commas. e.g. 0-1,1-2,1-3. "x" otherwise.
            const idx = i * width + j;
            trackOwner[idx] = tracksOwner;
            instability[idx] = inst;
            isInked[idx] = inked ? 1 : 0;
            if (LOG && partOfActiveConnections !== 'x') actLog.push(`${idx}=${partOfActiveConnections}`);
        }
    }
    if (LOG) {
        evalRates(trackOwner); // points/turn the current tracks pay: compare with the next turn's score change
        let own = '';
        for (let i = 0; i < N; i++) own += trackOwner[i] < 0 ? '.' : trackOwner[i];
        const inst: string[] = [], ink: number[] = [], seenR = new Set<number>();
        for (let i = 0; i < N; i++) {
            const r = regionOf[i];
            if (seenR.has(r)) continue;
            seenR.add(r);
            if (instability[i] > 0) inst.push(`${r}:${instability[i]}`);
            if (isInked[i]) ink.push(r);
        }
        logLine('T', `${turnNo} me=${myScore} foe=${foeScore} pred=${rate0}/${rate1} id=${myId}`);
        logLine('OWN', own);
        logLine('INST', inst.join(',') || '-');
        logLine('INKED', ink.join(',') || '-');
        logLine('ACT', actLog.join(';') || '-');
        dbgInfo = '';
    }
    trackFoeHits();
    lastHit = -1; // set again by planDisrupt if I disrupt this turn
    const plan = planPlacements(t0);
    for (const c of plan.cells) cmd.place(c % width, (c / width) | 0);
    planDisrupt(applyMoves(trackOwner, plan.cells, myId, [], 1 - myId), plan.myC, plan.foeC, t0);

    if (turnNo === 1) warmUp(t0); // stays well inside the 1000 ms first-turn limit even on a slow judge

    // adapt effort to how long this turn really took, and say so when protection was active
    const took = elapsed(t0);
    if (turnNo === 1) { /* first turn has a 1000 ms limit and a cold JIT: do not react to it */ }
    else if (took >= SLOW_MS) { level = Math.min(2, level + (took > 40 ? 2 : 1)); calmTurns = 0; guardHit = true; }
    else if (took < SOFT_MS && ++calmTurns >= 5 && level > 0) { level--; calmTurns = 0; }
    if (turnNo > 1 && (guardHit || level > 0)) cmd.message(`time guard lvl ${level} ${took}ms`);
    guardHit = false;
    if (LOG) logLine('DBG', `lvl=${level} took=${took}ms ${dbgInfo}`);

    // Write an action using console.log()
    // To debug: console.error('Debug messages...');


    // AUTOPLACE x1 y1 x2 y2 | PLACE_TRACKS x y | DISRUPT regionId | MESSAGE text
    cmd.flush(); // prints WAIT if nothing was queued
}

