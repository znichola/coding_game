/**
 * Connect towns with your train tracks and disrupt the opponent's.
 **/

const myId: number = parseInt(readline()); // 0 or 1
const width: number = parseInt(readline()); // map size
const height: number = parseInt(readline());
const regionOf: number[] = new Array(width * height).fill(0);
const terrain: number[] = new Array(width * height).fill(0); // 0 (PLAINS), 1 (RIVER), 2 (MOUNTAIN), 3 (POI)
for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
        var inputs: string[] = readline().split(' ');
        const regionId: number = parseInt(inputs[0]);
        const type: number = parseInt(inputs[1]);
        terrain[i * width + j] = type;
        regionOf[i * width + j] = regionId;
    }
}
const townCount: number = parseInt(readline());
interface Town { id: number; x: number; y: number; wants: number[] }
const towns = new Map<number, Town>();
for (let i = 0; i < townCount; i++) {
    var inputs: string[] = readline().split(' ');
    const townId: number = parseInt(inputs[0]);
    const townX: number = parseInt(inputs[1]);
    const townY: number = parseInt(inputs[2]);
    const desiredConnections: string = inputs[3]; // comma-separated town ids e.g. 0,1,2,3
    const wants = (desiredConnections ?? '').split(',').map(Number).filter(n => Number.isInteger(n));
    towns.set(townId, { id: townId, x: townX, y: townY, wants });
}

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

    /** Print the turn's line and reset. Drops WAIT when other actions exist. */
    flush() {
        let out = this.actions.filter(a => a !== 'WAIT');
        if (out.length === 0) out = ['WAIT'];
        console.log(out.join(';'));
        this.actions = [];
        this.placed.clear();
    }
}
const cmd = new Commands();

// ---------------------------------------------------------------- Town linking

const TERRAIN_COST = [1, 2, 3, 1]; // plains, river, mountain, POI (POI cost is an assumption)
const PAINT_PER_TURN = 3;

const trackOwner: number[] = new Array(width * height).fill(-1); // -1 none, 0/1 player, 2 neutral
const isInked: boolean[] = new Array(width * height).fill(false); // region inked out: tracks gone, no placing
const instability: number[] = new Array(width * height).fill(0); // per cell, shared by its region
let hasTracks = false;
const connected = new Set<string>();
const townCells = new Set<number>();
for (const t of towns.values()) townCells.add(t.y * width + t.x);

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// every desired pair, deduplicated
const pairs: [Town, Town][] = [];
{
    const seen = new Set<string>();
    for (const t of towns.values()) {
        for (const w of t.wants) {
            const o = towns.get(w);
            const k = pairKey(t.id, w);
            if (!o || o === t || seen.has(k)) continue;
            seen.add(k);
            pairs.push([t, o]);
        }
    }
}

let target: string | null = null; // route we are committed to across turns

/** Paint cost of a cell this turn. `mine` = cells I plan to place this turn. Owned, foe and neutral tracks all behave the same. */
function makeCost(mine: Set<number>): CostFn {
    return (x, y) => {
        const i = y * width + x;
        if (isInked[i]) return Infinity;
        if (townCells.has(i) || mine.has(i) || trackOwner[i] >= 0) return 0; // any track (mine, foe's, neutral) is free to use
        return TERRAIN_COST[terrain[i]] ?? 1;
    };
}

interface Route { key: string; path: [number, number][]; total: number }

/** Cheapest route for every desired pair: one full search per town instead of one per pair. */
function computeRoutes(cost: CostFn): Route[] {
    const searched = new Map<number, ReturnType<typeof search>>();
    const routes: Route[] = [];
    for (const [a, b] of pairs) {
        let res = searched.get(a.id);
        if (!res) searched.set(a.id, res = search(a.x, a.y, -1, -1, cost));
        const path = pathTo(res, b.y * width + b.x);
        if (path) routes.push({ key: pairKey(a.id, b.id), path, total: res.g[b.y * width + b.x] });
    }
    return routes;
}

/** Choose the route to work on: keep the committed one, else the cheapest remaining. */
function pickRoute(skip: Set<string>, routes: Route[]): Route | null {
    let best: Route | null = null;
    for (const r of routes) {
        if (skip.has(r.key)) continue;
        if (r.key === target) return r;
        if (!best || r.total < best.total) best = r;
    }
    return best;
}

/** Queue PLACE_TRACKS so that as many paint points as possible go into finishing routes. */
function planTurn(budget: number): { mine: Set<number>; routes: Route[] } {
    const skip = new Set(connected); // already connected, or already worked on this turn
    const mine = new Set<number>();
    let routes = computeRoutes(makeCost(mine));
    for (const r of routes) if (r.total === 0) skip.add(r.key); // a free path already exists
    let nextTarget: string | null = null;
    for (let guard = 0; guard <= pairs.length && budget > 0; guard++) {
        const cost = makeCost(mine);
        const r = pickRoute(skip, routes);
        if (!r) break;
        skip.add(r.key);
        // Random order: if the foe lays the same cell on the same turn it goes neutral, so avoid predictability.
        const need = r.path.filter(([x, y]) => cost(x, y) > 0);
        for (let i = need.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [need[i], need[j]] = [need[j], need[i]];
        }
        let complete = true;
        const before = mine.size;
        for (const [x, y] of need) {
            const c = cost(x, y);
            if (c <= budget) {
                cmd.place(x, y);
                mine.add(y * width + x);
                budget -= c;
            } else complete = false;
        }
        // stay committed to the first route we could not finish; leftover paint spills onto the next route
        if (!complete && nextTarget === null) nextTarget = r.key;
        if (mine.size !== before) { // costs changed: refresh routes and drop any that became free
            routes = computeRoutes(makeCost(mine));
            for (const rt of routes) if (rt.total === 0) skip.add(rt.key);
        }
    }
    target = nextTarget;
    return { mine, routes };
}

// ---------------------------------------------------------------- Disruption (inking)

const INK_AT = 4; // instability at which a region is inked out
const FOE_W = 1;      // foe-owned track on a route: inking it hurts the foe
const MINE_W = 1;     // my track on a route: inking it hurts me
const POT_W = 0.3;    // unbuilt cell on a likely route: potential for either player
const PLAN_W = 0.6;   // unbuilt cell on the route I am building: I need it
const STICKY = 0.6;   // keep the current target unless another is this much better

const regionHasTown = new Set<number>();
for (const i of townCells) regionHasTown.add(regionOf[i]);
const regionCell = new Map<number, number>(); // any cell of the region, to read its state
for (let i = 0; i < regionOf.length; i++) if (!regionCell.has(regionOf[i])) regionCell.set(regionOf[i], i);

let disruptTarget: number | null = null; // region we keep pushing towards INK_AT

/**
 * Score each region by how much inking it costs the foe relative to me, using the cheapest route of every
 * desired town pair as a stand-in for where points come from, then queue one DISRUPT.
 * Inking needs INK_AT hits, so the score is divided by the hits still missing and we stay on a target.
 */
function planDisrupt(mine: Set<number>, routes: Route[]) {
    const score = new Map<number, number>();
    const add = (r: number, v: number) => score.set(r, (score.get(r) ?? 0) + v);
    for (const { key, path } of routes) {
        const mineRoute = key === target;
        for (const [x, y] of path) {
            const i = y * width + x;
            const r = regionOf[i];
            if (mine.has(i) || trackOwner[i] === myId) add(r, -MINE_W);
            else if (trackOwner[i] === 1 - myId) add(r, FOE_W);
            else if (trackOwner[i] < 0) add(r, mineRoute ? -PLAN_W : POT_W); // neutral (2) counts for nobody
        }
    }

    let best = -1, bestVal = -Infinity;
    const value = (r: number) => (score.get(r) ?? 0) / (INK_AT - instability[regionCell.get(r)!]);
    for (const [r, i] of regionCell) {
        if (regionHasTown.has(r) || isInked[i]) continue;
        const v = value(r);
        // ties (e.g. all zero) go to the region closest to inking
        if (v > bestVal || (v === bestVal && instability[i] > instability[regionCell.get(best)!])) { best = r; bestVal = v; }
    }
    if (best < 0) return;

    const t = disruptTarget;
    if (t !== null && !regionHasTown.has(t) && !isInked[regionCell.get(t)!] && value(t) >= bestVal - (1 - STICKY) * Math.abs(bestVal)) best = t;
    disruptTarget = best;
    cmd.disrupt(best);
}

// game loop
while (true) {
    const myScore: number = parseInt(readline());
    const foeScore: number = parseInt(readline());
    connected.clear();
    hasTracks = false;
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            var inputs: string[] = readline().split(' ');
            const tracksOwner: number = parseInt(inputs[0]);
            const inst: number = parseInt(inputs[1]); // region inked (destroyed) when this >= 3.
            const inked: boolean = inputs[2] !== '0'; // true if region is destroyed.
            const partOfActiveConnections: string = inputs[3]; // if this cell is part of one or more railway connections, this will be town ids (separated by -) in a list separated by commas. e.g. 0-1,1-2,1-3. "x" otherwise.
            const idx = i * width + j;
            trackOwner[idx] = tracksOwner;
            if (tracksOwner >= 0) hasTracks = true;
            instability[idx] = inst;
            isInked[idx] = inked;
            if (partOfActiveConnections !== 'x') {
                for (const c of partOfActiveConnections.split(',')) {
                    const [a, b] = c.split('-').map(Number);
                    connected.add(pairKey(a, b));
                }
            }
        }
    }
    const plan = planTurn(PAINT_PER_TURN);
    planDisrupt(plan.mine, plan.routes);

    // Write an action using console.log()
    // To debug: console.error('Debug messages...');


    // AUTOPLACE x1 y1 x2 y2 | PLACE_TRACKS x y | DISRUPT regionId | MESSAGE text
    cmd.flush(); // prints WAIT if nothing was queued
}

