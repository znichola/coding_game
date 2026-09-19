/**
 * Connect towns with your train tracks and disrupt the opponent's.
 **/

const myId: number = parseInt(readline()); // 0 or 1
const width: number = parseInt(readline()); // map size
const height: number = parseInt(readline());
const terrain: number[] = new Array(width * height).fill(0); // 0 (PLAINS), 1 (RIVER), 2 (MOUNTAIN), 3 (POI)
for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
        var inputs: string[] = readline().split(' ');
        const regionId: number = parseInt(inputs[0]);
        const type: number = parseInt(inputs[1]);
        terrain[i * width + j] = type;
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

/**
 * Grid A* (4-neighbour). Returns the path from start to goal inclusive as [x, y] pairs,
 * or null if unreachable.
 * Equal-f ties: deeper node (higher g) first, then earliest inserted. Neighbours are
 * inserted N, E, S, W, so north wins, then east, south, west.
 * minCost must be <= the smallest finite value cost() can return (keeps the heuristic admissible).
 */
function astar(
    sx: number, sy: number, gx: number, gy: number,
    cost: CostFn, minCost: number = 1,
): [number, number][] | null {
    const n = width * height;
    const start = sy * width + sx;
    const goal = gy * width + gx;
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const h = (x: number, y: number) => (Math.abs(x - gx) + Math.abs(y - gy)) * minCost;

    // binary min-heap on (f, -g, seq)
    const hn: number[] = [], hf: number[] = [], hg: number[] = [], hs: number[] = [];
    let seq = 0;
    const less = (a: number, b: number) =>
        hf[a] !== hf[b] ? hf[a] < hf[b] : hg[a] !== hg[b] ? hg[a] > hg[b] : hs[a] < hs[b];
    const swap = (a: number, b: number) => {
        [hn[a], hn[b]] = [hn[b], hn[a]]; [hf[a], hf[b]] = [hf[b], hf[a]];
        [hg[a], hg[b]] = [hg[b], hg[a]]; [hs[a], hs[b]] = [hs[b], hs[a]];
    };
    const push = (node: number, gv: number, f: number) => {
        hn.push(node); hf.push(f); hg.push(gv); hs.push(seq++);
        let i = hn.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (!less(i, p)) break;
            swap(i, p); i = p;
        }
    };
    const pop = (): number => {
        const top = hn[0];
        const last = hn.length - 1;
        swap(0, last);
        hn.pop(); hf.pop(); hg.pop(); hs.pop();
        let i = 0;
        for (;;) {
            const l = 2 * i + 1, r = l + 1;
            let m = i;
            if (l < last && less(l, m)) m = l;
            if (r < last && less(r, m)) m = r;
            if (m === i) break;
            swap(i, m); i = m;
        }
        return top;
    };

    g[start] = 0;
    push(start, 0, h(sx, sy));
    while (hn.length) {
        const cur = pop();
        if (closed[cur]) continue; // stale entry
        closed[cur] = 1;
        if (cur === goal) {
            const path: [number, number][] = [];
            for (let c = cur; c !== -1; c = parent[c]) path.push([c % width, (c / width) | 0]);
            return path.reverse();
        }
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
    return null;
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
const NEUTRAL = 2; // neutral track: assumed usable for free (unverified)

const trackOwner: number[] = new Array(width * height).fill(-1); // -1 none, 0/1 player, 2 neutral
const isInked: boolean[] = new Array(width * height).fill(false);
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

/** Paint cost of a cell this turn. `mine` = cells I own or plan to place this turn. */
function makeCost(mine: Set<number>): CostFn {
    return (x, y) => {
        const i = y * width + x;
        if (townCells.has(i) || mine.has(i) || trackOwner[i] === myId || trackOwner[i] === NEUTRAL) return 0;
        if (trackOwner[i] >= 0) return Infinity; // opponent's track
        return TERRAIN_COST[terrain[i]] ?? 1;
    };
}

/** Choose the route to work on: keep the committed one, else the cheapest remaining. */
function pickRoute(done: Set<string>, mine: Set<number>, cost: CostFn) {
    const route = ([a, b]: [Town, Town]) => {
        const path = astar(a.x, a.y, b.x, b.y, cost, mine.size || trackOwner.includes(myId) ? 0 : 1);
        if (!path) return null;
        return { key: pairKey(a.id, b.id), path, total: path.reduce((s, [x, y]) => s + cost(x, y), 0) };
    };
    let best: ReturnType<typeof route> = null;
    for (const p of pairs) {
        const k = pairKey(p[0].id, p[1].id);
        if (done.has(k)) continue;
        if (k === target) {
            const r = route(p);
            if (r) return r;
        }
        const r = route(p);
        if (r && (!best || r.total < best.total)) best = r;
    }
    return best;
}

/** Queue PLACE_TRACKS so that as many paint points as possible go into finishing routes. */
function planTurn(budget: number) {
    const done = new Set(connected);
    const mine = new Set<number>();
    for (let guard = 0; guard <= pairs.length && budget > 0; guard++) {
        const cost = makeCost(mine);
        const r = pickRoute(done, mine, cost);
        if (!r) break;
        let complete = true;
        let placed = 0;
        for (const [x, y] of r.path) { // path order first, then leftovers that still fit
            const c = cost(x, y);
            if (c === 0) continue;
            if (c <= budget) {
                cmd.place(x, y);
                mine.add(y * width + x);
                budget -= c;
                placed++;
            } else complete = false;
        }
        if (complete) { done.add(r.key); target = null; }
        else { target = r.key; break; } // out of budget for this route
        if (placed === 0 && !complete) break;
    }
}

// game loop
while (true) {
    const myScore: number = parseInt(readline());
    const foeScore: number = parseInt(readline());
    connected.clear();
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            var inputs: string[] = readline().split(' ');
            const tracksOwner: number = parseInt(inputs[0]);
            const instability: number = parseInt(inputs[1]); // region inked (destroyed) when this >= 3.
            const inked: boolean = inputs[2] !== '0'; // true if region is destroyed.
            const partOfActiveConnections: string = inputs[3]; // if this cell is part of one or more railway connections, this will be town ids (separated by -) in a list separated by commas. e.g. 0-1,1-2,1-3. "x" otherwise.
            const idx = i * width + j;
            trackOwner[idx] = tracksOwner;
            isInked[idx] = inked;
            if (partOfActiveConnections !== 'x') {
                for (const c of partOfActiveConnections.split(',')) {
                    const [a, b] = c.split('-').map(Number);
                    connected.add(pairKey(a, b));
                }
            }
        }
    }
    planTurn(PAINT_PER_TURN);

    // Write an action using console.log()
    // To debug: console.error('Debug messages...');


    // AUTOPLACE x1 y1 x2 y2 | PLACE_TRACKS x y | DISRUPT regionId | MESSAGE text
    cmd.flush(); // prints WAIT if nothing was queued
}

