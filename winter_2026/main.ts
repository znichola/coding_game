import { readline } from "./support";

// ── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };

const enum StaticCell {
    Free = '.',
    Wall = '#',
}

const enum CellContent {
    Empty = 0,
    PowerSource = 1,
    MySnake = 2,
    OppSnake = 3,
}

type Cell = {
    content: CellContent;
    snakebotId: number | null;
};

type Snakebot = {
    id: number;
    owner: "me" | "opp";
    body: Point[];   // body[0] = head
};

type GameState = {
    /** Dynamic per-turn occupancy — board[y][x] */
    board: Cell[][];
    mySnakes: Map<number, Snakebot>;
    oppSnakes: Map<number, Snakebot>;
    powerSources: Point[];
};


// ── Command Types ─────────────────────────────────────────────────────────────

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

const DIRECTIONS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

const DELTAS: Record<Direction, Point> = {
    UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 }, LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 },
};

type MoveCommand = { kind: 'MOVE'; snakebotId: number; direction: Direction };
type MarkCommand = { kind: 'MARK'; x: number; y: number };
type WaitCommand = { kind: 'WAIT' };

type Command = MoveCommand | MarkCommand | WaitCommand;

// ── Validation ────────────────────────────────────────────────────────────────

function validateCommand(
    cmd: Command,
    mySnakeIds: number[],
    activeSnakeIds: Set<number>,
    width: number,
    height: number,
): boolean {
    if (cmd.kind === 'MOVE' && (!mySnakeIds.includes(cmd.snakebotId) || !activeSnakeIds.has(cmd.snakebotId))) { console.error(`[DISPATCH] Illegal MOVE: snakebot ${cmd.snakebotId} is not yours or not alive.`); return false; }
    if (cmd.kind === 'MARK' && (cmd.x < 0 || cmd.x >= width || cmd.y < 0 || cmd.y >= height)) { console.error(`[DISPATCH] Illegal MARK: (${cmd.x},${cmd.y}) is out of bounds.`); return false; }
    return true;
}

// ── Serialisation ─────────────────────────────────────────────────────────────

function serializeCommand(cmd: Command): string {
    switch (cmd.kind) {
        case 'MOVE': return `${cmd.snakebotId} ${cmd.direction}`;
        case 'MARK': return `MARK ${cmd.x} ${cmd.y}`;
        case 'WAIT': return 'WAIT';
    }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

function dispatch(
    commands: Command[],
    mySnakeIds: number[],
    activeSnakeIds: Set<number>,
    width: number,
    height: number,
): void {
    // console.error("DISPATCHING COMMANDS:");
    // console.error(commands);
    const actions = commands.filter(cmd => validateCommand(cmd, mySnakeIds, activeSnakeIds, width, height))
        .filter(cmd => cmd.kind !== 'WAIT');
    console.log((actions.length > 0 ? actions : [{ kind: 'WAIT' } as WaitCommand]).map(serializeCommand).join(';'));
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBoard(width: number, height: number): Cell[][] {
    return Array.from({ length: height }, () =>
        Array.from({ length: width }, () => ({ content: CellContent.Empty, snakebotId: null }))
    );
}

/** "0,1:1,1:2,1" → [{x:0,y:1}, {x:1,y:1}, {x:2,y:1}] */
function parseBody(body: string): Point[] {
    return body.split(':').map(segment => {
        const [x, y] = segment.split(',').map(Number);
        return { x, y };
    });
}

function stampSnake(board: Cell[][], snake: Snakebot): void {
    const content = snake.owner === "me" ? CellContent.MySnake : CellContent.OppSnake;
    for (const p of snake.body) {
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue;
        board[p.y][p.x] = { content, snakebotId: snake.id };
    }
}

function logState(state: GameState): void {
    console.error("BOARD STATE:");
    for (let y = 0; y < height; y++) {
        let line = '';
        for (let x = 0; x < width; x++) {
            const cell = state.board[y][x];
            if (cell.content === CellContent.Empty) line += staticMap[y][x];
            else if (cell.content === CellContent.PowerSource) line += 'P';
            else if (cell.content === CellContent.MySnake) line += 'M';
            else if (cell.content === CellContent.OppSnake) line += 'O';
        }
        console.error(line);
    }
}

/** Returns true if (x,y) not a wall, and not occupied by any snake. 
 * A snake can go out of bounds. */
function isTraversable(
    x: number, y: number,
    board: Cell[][]
): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return true;  // outside map = empty & free
    if (staticMap[y][x] === StaticCell.Wall) return false;
    if (board[y][x].content === CellContent.MySnake) return false;
    if (board[y][x].content === CellContent.OppSnake) return false;
    return true;
}

/** Return true if the tile can support a snake. */
function isSupported(
    x: number, y: number,
    board: Cell[][],
    ignoredSnakeIds: number[],
): boolean {
    if (board[y][x].snakebotId && ignoredSnakeIds.includes(board[y][x].snakebotId)) return false;
    return true;
}

// ── Init (runs once) ─────────────────────────────────────────────────────────

const myId: number = parseInt(readline());
const width: number = parseInt(readline());
const height: number = parseInt(readline());

/** Static map — walls never change, load once. staticMap[y][x] */
const staticMap: StaticCell[][] = [];
for (let y = 0; y < height; y++) {
    staticMap.push(readline().split('') as StaticCell[]);
}

const snakebotsPerPlayer: number = parseInt(readline());

const mySnakeIds: number[] = [];
const oppSnakeIds: number[] = [];
for (let i = 0; i < snakebotsPerPlayer; i++) mySnakeIds.push(parseInt(readline()));
for (let i = 0; i < snakebotsPerPlayer; i++) oppSnakeIds.push(parseInt(readline()));

// ── Game loop ────────────────────────────────────────────────────────────────

let turnsLeft = 200;

while (true) {
    const state: GameState = {
        board: makeBoard(width, height),
        mySnakes: new Map(),
        oppSnakes: new Map(),
        powerSources: [],
    };

    // Power sources
    const powerSourceCount: number = parseInt(readline());
    for (let i = 0; i < powerSourceCount; i++) {
        const [x, y] = readline().split(' ').map(Number);
        state.powerSources.push({ x, y });
        state.board[y][x] = { content: CellContent.PowerSource, snakebotId: null };
    }

    // Snakes
    const snakebotCount: number = parseInt(readline());
    for (let i = 0; i < snakebotCount; i++) {
        const parts = readline().split(' ');
        const id = parseInt(parts[0]);
        const body = parseBody(parts[1]);
        const owner = mySnakeIds.includes(id) ? "me" : "opp";
        const snake: Snakebot = { id, owner, body };

        if (owner === "me") state.mySnakes.set(id, snake);
        else state.oppSnakes.set(id, snake);

        stampSnake(state.board, snake);
    }

    // logState(state);

    // ── Build active snake set for this turn ──────────────────────────────────
    const activeSnakeIds = new Set(state.mySnakes.keys());

    // ── Build commands ────────────────────────────────────────────────────────
    const commands: Command[] = [];

    for (const id of mySnakeIds) {
        const snake = state.mySnakes.get(id);
        if (!snake) continue;




    // ── STEP 1 VERIFICATION ───────────────────────────────────────────────────────
    // Pick one of your snakes and log the before/after for phaseMove + phaseEat.
    // Compare against what the game viewer shows.

    if (id == 2) {
        const testDir: Direction = 'UP'; // change to whatever direction you're sending

        const afterMove = applyJointAction([snake], new Map([[snake.id, testDir]]), state.powerSources, staticMap);
        console.error("After join action", afterMove);
    }
    // ─────────────────────────────────────────────────────────────────────────────





        commands.push(...algo(state, snake));
    }








    // ── Dispatch commands ──────────────────────────────────────────────────────
    dispatch(commands, mySnakeIds, activeSnakeIds, width, height);
    turnsLeft--;
}

function algo(state: GameState, currentSnake: Snakebot): Command[] {
    const head = currentSnake.body[0];

    const closest = state.powerSources.reduce<Point | null>((best, ps) => {
        if (!best) return ps;
        return Math.hypot(ps.x - head.x, ps.y - head.y) < Math.hypot(best.x - head.x, best.y - head.y) ? ps : best;
    }, null);

    if (!closest) return [];

    const isWalkable = (p: Point) => isTraversable(p.x, p.y, state.board);

    const res = aStar(head, closest, isWalkable);

    if (!res || res?.length <= 0) return [];

    const dx = res[0].x - head.x;
    const dy = res[0].y - head.y;
    const direction: Direction =
        dx === 1 ? 'RIGHT' :
            dx === -1 ? 'LEFT' :
                dy === 1 ? 'DOWN' : 'UP';

    return [{ kind: 'MOVE', snakebotId: currentSnake.id, direction }];
}

// ── A* Pathfinding ────────────────────────────────────────────────────────────

function heuristic(a: Point, b: Point): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); // Manhattan distance
}

function reconstructPath(node: AStarNode): Point[] {
    const path: Point[] = [];
    let current: AStarNode | null = node;
    while (current) { path.unshift(current.point); current = current.parent; }
    return path;
}

type AStarNode = {
    point: Point;
    // body: Point[];
    g: number;  // cost from start
    h: number;  // heuristic to goal
    f: number;  // g + h
    parent: AStarNode | null;
};

/**
 * Returns the full path from `start` to `goal` (inclusive), or null if unreachable.
 * Treats walls and occupied cells as impassable via the provided `isWalkable` predicate.
 */
function aStar(
    start: Point,
    goal: Point,
    isWalkable: (p: Point) => boolean,
): Point[] | null {
    const NEIGHBOURS = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    const key = (p: Point) => `${p.x},${p.y}`;
    const open = new Map<string, AStarNode>();
    const closed = new Set<string>();

    const startNode: AStarNode = { point: start, g: 0, h: heuristic(start, goal), f: 0, parent: null };
    startNode.f = startNode.g + startNode.h;
    open.set(key(start), startNode);

    while (open.size > 0) {
        // Pick lowest-f node from open set
        let current = [...open.values()].reduce((a, b) => a.f < b.f ? a : b);

        if (current.point.x === goal.x && current.point.y === goal.y)
            return reconstructPath(current);

        open.delete(key(current.point));
        closed.add(key(current.point));

        for (const delta of NEIGHBOURS) {
            const neighbour: Point = { x: current.point.x + delta.x, y: current.point.y + delta.y };
            const nKey = key(neighbour);

            if (closed.has(nKey)) continue;
            if (!isWalkable(neighbour)) continue;

            const g = current.g + 1;
            const existing = open.get(nKey);

            if (!existing || g < existing.g) {
                const node: AStarNode = { point: neighbour, g, h: heuristic(neighbour, goal), f: 0, parent: current };
                node.f = node.g + node.h;
                open.set(nKey, node);
            }
        }
    }

    return null; // no path found
}


// ── Joint Action ──────────────────────────────────────────────────────────────

type JointActionResult = {
    survivors:       Snakebot[];
    eatenSources:    Point[];
    remainingSources: Point[];
    deadSnakeIds:    Set<number>;
};

/**
 * Composes all four phases in order.
 * Returns survivors, eaten sources, remaining sources, and all dead snake ids.
 */
/**
 * Composes all four phases in order.
 * Returns survivors, eaten sources, remaining sources, and all dead snake ids.
 *
 * When called with a single snake, logs the state after each phase.
 */
function applyJointAction(
    snakes: Snakebot[],
    directions: Map<number, Direction>,
    sources: Point[],
    staticMap: StaticCell[][],
): JointActionResult {
    const logId = snakes.length === 1 ? snakes[0].id : null;
 
    const logSnake = (phase: string, snake: Snakebot | undefined) => {
        if (!snake) return;
        console.error(`[AJA id=${snake.id}] ${phase}: head=(${snake.body[0].x},${snake.body[0].y}) tail=(${snake.body[snake.body.length - 1].x},${snake.body[snake.body.length - 1].y}) len=${snake.body.length}`);
    };
 
    if (logId !== null) {
        const s = snakes[0];
        console.error(`[AJA id=${s.id}] INPUT: dir=${directions.get(s.id)} head=(${s.body[0].x},${s.body[0].y}) len=${s.body.length} sources=[${sources.map(p => `(${p.x},${p.y})`).join(', ')}]`);
    }
 
    const afterMove = phaseMove(snakes, directions);
    if (logId !== null) logSnake('phaseMove', afterMove.find(s => s.id === logId));
 
    const afterEat = phaseEat(afterMove, sources);
    if (logId !== null) {
        logSnake('phaseEat', afterEat.snakes.find(s => s.id === logId));
        console.error(`[AJA id=${logId}] phaseEat: ate=${afterEat.eatenSources.length > 0} remainingSources=${afterEat.remainingSources.length}`);
    }
 
    const afterCollide = phaseCollide(afterEat.snakes, staticMap);
    if (logId !== null) {
        const s = afterCollide.survivors.find(s => s.id === logId);
        if (s) logSnake('phaseCollide', s);
        else console.error(`[AJA id=${logId}] phaseCollide: DEAD — deadIds=[${[...afterCollide.deadIds]}]`);
    }
 
    const afterGravity = phaseGravity(afterCollide.survivors, afterEat.remainingSources, staticMap);
    if (logId !== null) {
        const s = afterGravity.survivors.find(s => s.id === logId);
        if (s) logSnake('phaseGravity', s);
        else console.error(`[AJA id=${logId}] phaseGravity: DEAD — deadIds=[${[...afterGravity.deadIds]}]`);
    }

    afterCollide.deadIds.forEach((v) => afterGravity.deadIds.add(v));
    return {
        survivors:        afterGravity.survivors,
        eatenSources:     afterEat.eatenSources,
        remainingSources: afterEat.remainingSources,
        deadSnakeIds:     afterGravity.deadIds,
    };
}



// ── Phase 1: Move ─────────────────────────────────────────────────────────────

/**
 * Advances every snake's head by one step in its given direction.
 * The rest of the body shifts forward (each segment takes the position of the one ahead).
 * The tail is NOT removed — body is temporarily one longer than normal.
 * No collision or gravity logic here.
 */
function phaseMove(
    snakes: Snakebot[],
    directions: Map<number, Direction>,
): Snakebot[] {
    return snakes.map(snake => {
        const direction = directions.get(snake.id) ?? inferFacing(snake.body);
        const delta = DELTAS[direction];
        const newHead: Point = {
            x: snake.body[0].x + delta.x,
            y: snake.body[0].y + delta.y,
        };

        return {
            ...snake,
            body: [newHead, ...snake.body],
        };
    });
}

// ── Phase 2: Eat ──────────────────────────────────────────────────────────────

/**
 * For each snake, checks if its head is on a power source.
 *   - Ate:         tail stays → snake is permanently one longer
 *   - Did not eat: tail removed → snake returns to original length
 *
 * Multiple heads on the same source: all eat it.
 * Eaten sources are removed from the returned remainingSources.
 */
function phaseEat(
    movedSnakes: Snakebot[],
    sources: Point[],
): {
    snakes: Snakebot[];
    eatenSources: Point[];
    remainingSources: Point[];
} {
    const eatenSources: Point[] = [];

    const snakes = movedSnakes.map(snake => {
        const head = snake.body[0];
        const ate = sources.some(s => s.x === head.x && s.y === head.y);

        if (ate) {
            const alreadyTracked = eatenSources.some(s => s.x === head.x && s.y === head.y);
            if (!alreadyTracked) {
                eatenSources.push(head);
            }
            return snake; // tail stays, body is already the right length
        }

        return {
            ...snake,
            body: snake.body.slice(0, -1), // remove tail
        };
    });

    const remainingSources = sources.filter(
        s => !eatenSources.some(e => e.x === s.x && e.y === s.y)
    );

    return { snakes, eatenSources, remainingSources };
}

// ── Phase 3: Collide ──────────────────────────────────────────────────────────

/**
 * Collide all heads, and shorten tail
 */
function phaseCollide(
    snakes: Snakebot[],
    staticMap: StaticCell[][],
): { survivors: Snakebot[]; shortenedIds: Set<number>; deadIds: Set<number> } {
    const EMPTY = -2;
    const FILLED = -1;
    const board: number[][] = staticMap.map(row => row.map(cell => (cell === StaticCell.Wall ? FILLED : EMPTY)));

    const shortenedIdSet = new Set<number>();
    const deadIdSet = new Set<number>();

    // Stamp all snake bodies (excluding heads) as -2
    for (const snake of snakes) {
        for (let i = 1; i < snake.body.length; i++) {
            const {x, y} = snake.body[i];
            board[y][x] = FILLED;
        }
    }

    // Stamp heads as their snake id (>= 0)
    for (const snake of snakes) {
        const {x, y} = snake.body[0];
        const cell = board[y][x];

        if (cell === EMPTY) {
            board[y][x] = snake.id;
        } else if (cell === FILLED) {
            shortenedIdSet.add(snake.id);
        } else {
            shortenedIdSet.add(cell);
            shortenedIdSet.add(snake.id);
        }
    }

    // Shorten, then kill any that drop below 3
    const survivors: Snakebot[] = [];
    for (const snake of snakes) {
        if (shortenedIdSet.has(snake.id)) {
            const shortened = { ...snake, body: snake.body.slice(1) };
            if (shortened.body.length < 3) {
                deadIdSet.add(snake.id);
                continue;
            }
            survivors.push(shortened);
        } else {
            survivors.push(snake);
        }
    }

    return {
        survivors,
        shortenedIds: shortenedIdSet,
        deadIds: deadIdSet,
    };
}

// ── Phase 4: Gravity ──────────────────────────────────────────────────────────

/**
 * All surviving snakes fall simultaneously until supported.
 * Solid during this phase: static walls + remaining (uneaten) sources + settled snake bodies.
 * Two snakes falling simultaneously cannot support each other — only already-settled
 * bodies count as solid. A snake that falls entirely off the bottom is removed.
 */
function phaseGravity(
    snakes: Snakebot[],
    remainingSources: Point[],
    staticMap: StaticCell[][],
): { survivors: Snakebot[]; deadIds: Set<number> } {

    // Pre-encode sources and static walls into a single flat lookup
    // Using a typed array bitmask (solid=1, source=2) avoids string allocation entirely
    const solid = new Uint8Array(width * height);

    for (const s of remainingSources) {
        if (s.x >= 0 && s.x < width && s.y >= 0 && s.y < height)
            solid[s.y * width + s.x] |= 1;
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (staticMap[y][x] === StaticCell.Wall)
                solid[y * width + x] |= 1;
        }
    }

    // Track each snake's state with indices to avoid repeated object allocation
    // settled[i] = true means snake i has landed; dead means it fell off the bottom
    const n = snakes.length;
    const yOffset = new Int32Array(n);     // how many rows each snake has fallen
    const isSettled = new Uint8Array(n);
    const isDead    = new Uint8Array(n);

    let unsettledCount = n;

    // Incrementally maintained cell set for settled snakes only
    // Written directly into `solid` to avoid a second lookup structure
    const markSettled = (idx: number) => {
        isSettled[idx] = 1;
        unsettledCount--;
        const snake = snakes[idx];
        const dy = yOffset[idx];
        for (const p of snake.body) {
            const ny = p.y + dy;
            const nx = p.x;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height)
                solid[ny * width + nx] |= 1;
        }
    };

    const isSupported = (idx: number): boolean => {
        const snake = snakes[idx];
        const dy = yOffset[idx];
        for (const p of snake.body) {
            const nx = p.x;
            const below = p.y + dy + 1;
            if (nx < 0 || nx >= width) continue;
            if (below >= height) return true;  // resting on the floor
            if (solid[below * width + nx]) return true;
        }
        return false;
    };

    while (unsettledCount > 0) {
        // Settle phase: drain all snakes now supported (chain reactions included)
        let anySettled = true;
        while (anySettled) {
            anySettled = false;
            for (let i = 0; i < n; i++) {
                if (isSettled[i] || isDead[i]) continue;
                if (isSupported(i)) {
                    markSettled(i);
                    anySettled = true;
                }
            }
        }

        if (unsettledCount === 0) break;

        // Drop phase: shift all still-falling snakes down one row
        for (let i = 0; i < n; i++) {
            if (isSettled[i] || isDead[i]) continue;
            yOffset[i]++;

            // If every segment is now off the bottom, kill the snake
            const snake = snakes[i];
            const dy = yOffset[i];
            if (snake.body.every(p => p.y + dy >= height)) {
                isDead[i] = 1;
                unsettledCount--;
            }
        }
    }

    // Materialise results — only one allocation pass at the very end
    const survivors: Snakebot[] = [];
    const deadIds = new Set<number>();

    for (let i = 0; i < n; i++) {
        if (isDead[i]) {
            deadIds.add(snakes[i].id);
        } else {
            const dy = yOffset[i];
            survivors.push(
                dy === 0
                    ? snakes[i]   // no copy needed if snake never moved
                    : {
                        ...snakes[i],
                        body: snakes[i].body.map(p => ({ ...p, y: p.y + dy })),
                    }
            );
        }
    }

    return { survivors, deadIds };
}


// --------------------------------------------------------------------
// HELPERS


// When parsing a snake, infer facing from head → previous head (body[0] → body[1])
function inferFacing(body: Point[]): Direction {
    if (body.length < 2) return 'UP'; // default for length-1 snake
    const dx = body[0].x - body[1].x;
    const dy = body[0].y - body[1].y;
    if (dx === 1)  return 'RIGHT';
    if (dx === -1) return 'LEFT';
    if (dy === 1)  return 'DOWN';
    return 'UP';
}