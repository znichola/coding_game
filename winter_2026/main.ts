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
        board[p.y][p.x] = { content, snakebotId: snake.id };
    }
}

/** Returns true if (x,y) is in-bounds, not a wall, and not occupied by any snake. */
function isTraversable(
    x: number, y: number,
    staticMap: StaticCell[][],
    board: Cell[][]
): boolean {
    if (y < 0 || y >= staticMap.length || x < 0 || x >= staticMap[0].length) return false;
    if (staticMap[y][x] === StaticCell.Wall) return false;
    if (board[y][x].content === CellContent.MySnake) return false;
    if (board[y][x].content === CellContent.OppSnake) return false;
    return true;
}

/** Returns true if (x,y) would provide support to `snakeId` — i.e. it is
 *  out-of-bounds, a wall, or another snake's body. A snake's own body cells
 *  are transparent: a snake cannot rest on itself. */
function isSupportingGround(
    x: number, y: number,
    snakeId: number,
    staticMap: StaticCell[][],
    board: Cell[][]
): boolean {
    if (staticMap[y][x] === StaticCell.Wall) return true;
    const cell = board[y][x];
    if (cell.content === CellContent.MySnake  && cell.snakebotId !== snakeId) return true;
    if (cell.content === CellContent.OppSnake) return true;
    if (cell.content === CellContent.PowerSource) return true;
    return false;
}

// ── Init (runs once) ─────────────────────────────────────────────────────────

const myId: number = parseInt(readline());
const width: number = parseInt(readline());
const height: number = parseInt(readline());

let turnsLeft = 200;

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

    // console.error("BOARD STATE:");
    // for (let y = 0; y < height; y++) {
    //     let line = '';
    //     for (let x = 0; x < width; x++) {
    //         const cell = state.board[y][x];
    //         if (cell.content === CellContent.Empty) line += staticMap[y][x];
    //         else if (cell.content === CellContent.PowerSource) line += 'P';
    //         else if (cell.content === CellContent.MySnake) line += 'M';
    //         else if (cell.content === CellContent.OppSnake) line += 'O';
    //     }
    //     console.error(line);
    // }

    // ── Build active snake set for this turn ──────────────────────────────────
    const activeSnakeIds = new Set(state.mySnakes.keys());

    // ── Build commands ────────────────────────────────────────────────────────
    const commands: Command[] = [];

    for (const id of mySnakeIds) {
        const snake = state.mySnakes.get(id);
        if (!snake) continue;

        commands.push(...algo(state, snake));
    }

    // ── Dispatch commands ──────────────────────────────────────────────────────
    dispatch(commands, mySnakeIds, activeSnakeIds, width, height);

    turnsLeft--;
}

function algo(state: GameState, currentSnake: Snakebot): Command[] {
    const head = currentSnake.body[0];
    const isWalkable = (p: Point) => isTraversable(p.x, p.y, staticMap, state.board);
    const maxDepth = Math.min(turnsLeft, 6);
 
    // Sort candidates by proximity
    const candidates = [...state.powerSources].sort((a, b) =>
        Math.hypot(a.x - head.x, a.y - head.y) - Math.hypot(b.x - head.x, b.y - head.y)
    );
 
    for (const target of candidates) {
        // A* pre-filter: cheap physics-blind reachability check — skip hard dead-ends early
        const quickPath = aStar(head, target, isWalkable);
        if (!quickPath) {
            console.error(`[ALGO] Target (${target.x},${target.y}) not reachable by A*, skipping.`);
            continue;
        }
 
        // Physics-aware A*: accounts for body movement and gravity.
        // Always returns a path — exact if goal reached within budget, partial otherwise.
        const directions = physicsAStar(state, currentSnake, target, staticMap, maxDepth);
        if (directions.length === 0) {
            console.error(`[ALGO] Target (${target.x},${target.y}) not reachable within depth budget, skipping.`);
            continue;
        }
        return [{ kind: 'MOVE', snakebotId: currentSnake.id, direction: directions[0] }];
    }
 
    // No candidates passed the A* pre-filter — fall back to survival
    return avoidDeath(state, currentSnake);
}

// ── A* Pathfinding ────────────────────────────────────────────────────────────

type AStarNode = {
    point: Point;
    g: number;  // cost from start
    h: number;  // heuristic to goal
    f: number;  // g + h
    parent: AStarNode | null;
};

/** Manhattan distance */ 
function heuristic(a: Point, b: Point): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(node: AStarNode): Point[] {
    const path: Point[] = [];
    let current: AStarNode | null = node;
    while (current) { path.unshift(current.point); current = current.parent; }
    return path;
}

/**
 * Physics-blind reachability pre-filter. Returns a path if the goal is
 * reachable on a static board snapshot, or null if clearly blocked.
 * Do not use this for actual move decisions — use bfsPath instead.
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


// ── Physics-Aware A* ──────────────────────────────────────────────────────────
 
type SearchNode = {
    state:  GameState;
    snake:  Snakebot;
    path:   Direction[];  // directions taken to reach this node
    g:      number;       // steps taken so far
    h:      number;       // manhattan distance to goal
};
 
function bodyHash(snake: Snakebot): string {
    return snake.body.map(p => `${p.x},${p.y}`).join(':');
}
 
/**
 * Physics-aware A* over the full snake state-space. At every node it applies
 * advanceSnake + applyGravity so body movement and falling are accounted for.
 *
 * Ordered by f = g + h (A* best-first), so the depth budget is spent on the
 * most promising states rather than exhausting all equidistant ones first.
 *
 * Always returns a path — either to the goal (exact), or to the closest state
 * reached within `maxDepth` (partial). Never returns null; the A* pre-filter
 * in algo() is responsible for ruling out hard unreachability before calling.
 */
function physicsAStar(
    state:     GameState,
    snake:     Snakebot,
    goal:      Point,
    staticMap: StaticCell[][],
    maxDepth:  number,
): Direction[] {
    const DIRS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
    const visited = new Set<string>();
 
    const startH = heuristic(snake.body[0], goal);
    const open: SearchNode[] = [{ state, snake, path: [], g: 0, h: startH }];
    visited.add(bodyHash(snake));
 
    // Tracks the closest state seen so we can return a best partial path
    let best: SearchNode = open[0];
 
    while (open.length > 0) {
        // Pop lowest f = g + h  (simple linear scan — fine for small maxDepth)
        const idx     = open.reduce((bi, _, i) =>
            (open[i].g + open[i].h) < (open[bi].g + open[bi].h) ? i : bi, 0);
        const current = open.splice(idx, 1)[0];
 
        // Keep track of the closest state reached anywhere in the search
        if (current.h < best.h) best = current;
 
        // Goal reached — return immediately
        if (current.h === 0) return current.path;
 
        // Depth budget exhausted for this branch
        if (current.g >= maxDepth) continue;
 
        for (const direction of DIRS) {
            const advResult = advanceSnake(current.state, current.snake, direction, staticMap);
            if (!advResult.ok) continue;
 
            const { state: nextState, snake: nextSnake } =
                applyGravity(advResult.state, advResult.snake, staticMap);
 
            const hash = bodyHash(nextSnake);
            if (visited.has(hash)) continue;
            visited.add(hash);
 
            const nextPath = [...current.path, direction];
            const h        = heuristic(nextSnake.body[0], goal);
 
            open.push({ state: nextState, snake: nextSnake, path: nextPath, g: current.g + 1, h });
        }
    }
 
    // Budget exhausted — return path to closest state reached
    console.error(`[PHYSICS_ASTAR] Depth budget exhausted, returning best partial path (h=${best.h})`);
    return best.path;
}

// ── Board Simulation ──────────────────────────────────────────────────────────

/**
 * Deep clones the game state so simulation never mutates the real state.
 */
function cloneState(state: GameState): GameState {
    const board = state.board.map(row =>
        row.map(cell => ({ ...cell }))
    );
    const cloneSnake = (s: Snakebot): Snakebot => ({
        ...s,
        body: s.body.map(p => ({ ...p })),
    });
    return {
        board,
        powerSources: state.powerSources.map(p => ({ ...p })),
        mySnakes: new Map([...state.mySnakes.entries()].map(([k, v]) => [k, cloneSnake(v)])),
        oppSnakes: new Map([...state.oppSnakes.entries()].map(([k, v]) => [k, cloneSnake(v)])),
    };
}

type AdvanceResult =
    | { ok: true; state: GameState; snake: Snakebot }
    | { ok: false; reason: 'wall' | 'self' | 'opponent' | 'out_of_bounds' };

function advanceSnake(
    state: GameState,
    snake: Snakebot,
    direction: Direction,
    staticMap: StaticCell[][],
): AdvanceResult {
    const head = snake.body[0];
    const deltas: Record<Direction, Point> = {
        UP: { x: 0, y: -1 },
        DOWN: { x: 0, y: 1 },
        LEFT: { x: -1, y: 0 },
        RIGHT: { x: 1, y: 0 },
    };
    const next = { x: head.x + deltas[direction].x, y: head.y + deltas[direction].y };

    if (next.y < 0 || next.y >= staticMap.length || next.x < 0 || next.x >= staticMap[0].length)
        return { ok: false, reason: 'out_of_bounds' };
    if (staticMap[next.y][next.x] === StaticCell.Wall)
        return { ok: false, reason: 'wall' };

    const cell = state.board[next.y][next.x];
    if (cell.content === CellContent.MySnake) return { ok: false, reason: 'self' };
    if (cell.content === CellContent.OppSnake) return { ok: false, reason: 'opponent' };

    const sim = cloneState(state);
    const simSnake = (snake.owner === 'me' ? sim.mySnakes : sim.oppSnakes).get(snake.id)!;

    const tail = simSnake.body[simSnake.body.length - 1];
    sim.board[tail.y][tail.x] = { content: CellContent.Empty, snakebotId: null };

    simSnake.body.unshift(next);
    simSnake.body.pop();

    const psIndex = sim.powerSources.findIndex(ps => ps.x === next.x && ps.y === next.y);
    if (psIndex !== -1) sim.powerSources.splice(psIndex, 1);

    const content = snake.owner === 'me' ? CellContent.MySnake : CellContent.OppSnake;
    sim.board[next.y][next.x] = { content, snakebotId: snake.id };

    return { ok: true, state: sim, snake: simSnake };
}


// ── Gravity ───────────────────────────────────────────────────────────────────

function applyGravity(
    state:     GameState,
    snake:     Snakebot,
    staticMap: StaticCell[][],
): { state: GameState; snake: Snakebot } {
    let sim      = cloneState(state);
    let simSnake = (snake.owner === 'me' ? sim.mySnakes : sim.oppSnakes).get(snake.id)!;
 
    for (let i = 0; i < staticMap.length; i++) {
        const isSupported = simSnake.body.some(p =>
            isSupportingGround(p.x, p.y + 1, simSnake.id, staticMap, sim.board)
        );
        if (isSupported) break;
 
        for (const p of simSnake.body) {
            sim.board[p.y][p.x] = { content: CellContent.Empty, snakebotId: null };
        }
 
        for (const p of simSnake.body) p.y += 1;
 
        for (const p of simSnake.body) {
            const psIndex = sim.powerSources.findIndex(ps => ps.x === p.x && ps.y === p.y);
            if (psIndex !== -1) sim.powerSources.splice(psIndex, 1);
        }
 
        const content = snake.owner === 'me' ? CellContent.MySnake : CellContent.OppSnake;
        for (const p of simSnake.body) {
            sim.board[p.y][p.x] = { content, snakebotId: snake.id };
        }
    }
 
    return { state: sim, snake: simSnake };
}

/**
 * Fallback: tries all 4 directions and returns the first safe move.
 * Returns [] if all moves are fatal — dispatcher will emit WAIT.
 */
function avoidDeath(state: GameState, currentSnake: Snakebot): Command[] {
    const directions: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

    for (const direction of directions) {
        const result = advanceSnake(state, currentSnake, direction, staticMap);
        if (result.ok) return [{ kind: 'MOVE', snakebotId: currentSnake.id, direction }];
    }

    console.error(`[AVOID_DEATH] Snake ${currentSnake.id} has no safe moves — waiting.`);
    return [];
}