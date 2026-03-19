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

const DIRECTIONS = new Set<Direction>(['UP', 'DOWN', 'LEFT', 'RIGHT']);

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

    // Sort candidates by proximity, simulate each, pick the closest reachable one
    const candidates = [...state.powerSources].sort((a, b) =>
        Math.hypot(a.x - head.x, a.y - head.y) - Math.hypot(b.x - head.x, b.y - head.y)
    );

    for (const target of candidates) {
        const result = simulatePath(state, currentSnake, target, staticMap);
        if (!result) {
            console.error(`[ALGO] Target (${target.x},${target.y}) is unreachable or fatal, skipping.`);
            continue;
        }

        // Target is viable — compute first step toward it
        const isWalkable = (p: Point) => isTraversable(p.x, p.y, staticMap, state.board);
        const path = aStar(head, target, isWalkable);
        if (!path || path.length < 2) continue;

        const next = path[1];
        const dx = next.x - head.x;
        const dy = next.y - head.y;
        const direction: Direction =
            dx === 1 ? 'RIGHT' :
                dx === -1 ? 'LEFT' :
                    dy === 1 ? 'DOWN' : 'UP';

        return [{ kind: 'MOVE', snakebotId: currentSnake.id, direction }];
    }
    return avoidDeath(state, currentSnake);
    // return []; // all targets fatal — dispatcher will emit WAIT
}
// ── A* Pathfinding ────────────────────────────────────────────────────────────

type AStarNode = {
    point: Point;
    g: number;  // cost from start
    h: number;  // heuristic to goal
    f: number;  // g + h
    parent: AStarNode | null;
};


function heuristic(a: Point, b: Point): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); // Manhattan distance
}

function reconstructPath(node: AStarNode): Point[] {
    const path: Point[] = [];
    let current: AStarNode | null = node;
    while (current) { path.unshift(current.point); current = current.parent; }
    return path;
}

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


// ── State-Space BFS ───────────────────────────────────────────────────────────

type SearchNode = {
    state: GameState;
    snake: Snakebot;
    path: Direction[];  // directions taken to reach this node
};

function bodyHash(snake: Snakebot): string {
    return snake.body.map(p => `${p.x},${p.y}`).join(':');
}

/**
 * BFS over the full snake state-space, applying gravity after every move.
 * Returns the sequence of directions to reach `goal`, or null if unreachable.
 * Replaces aStar for path planning — accounts for body movement and gravity.
 */
function bfsPath(
    state: GameState,
    snake: Snakebot,
    goal: Point,
    staticMap: StaticCell[][],
    maxDepth: number,
): Direction[] | null {
    const visited = new Set<string>();
    const queue: SearchNode[] = [{ state, snake, path: [] }];
    visited.add(bodyHash(snake));

    while (queue.length > 0) {
        const { state: curState, snake: curSnake, path } = queue.shift()!;

        if (path.length >= maxDepth) continue;

        for (const direction of DIRECTIONS) {
            const advResult = advanceSnake(curState, curSnake, direction, staticMap);
            if (!advResult.ok) continue;

            const { state: nextState, snake: nextSnake } = applyGravity(advResult.state, advResult.snake, staticMap);
            const nextPath = [...path, direction];
            const head = nextSnake.body[0];

            if (head.x === goal.x && head.y === goal.y) return nextPath;

            const hash = bodyHash(nextSnake);
            if (visited.has(hash)) continue;
            visited.add(hash);

            queue.push({ state: nextState, snake: nextSnake, path: nextPath });
        }
    }

    return null;
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

/**
 * Advances a single snake one step in `direction` within a cloned state.
 * Returns the new state + updated snake on success, or a failure reason.
 */
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

    // Validate move
    if (next.y < 0 || next.y >= staticMap.length || next.x < 0 || next.x >= staticMap[0].length)
        return { ok: false, reason: 'out_of_bounds' };
    if (staticMap[next.y][next.x] === StaticCell.Wall)
        return { ok: false, reason: 'wall' };

    const cell = state.board[next.y][next.x];
    if (cell.content === CellContent.MySnake) return { ok: false, reason: 'self' };
    if (cell.content === CellContent.OppSnake) return { ok: false, reason: 'opponent' };

    // Clone and mutate
    const sim = cloneState(state);
    const simSnake = (snake.owner === 'me' ? sim.mySnakes : sim.oppSnakes).get(snake.id)!;

    // Erase tail from board before moving (snake slides forward)
    const tail = simSnake.body[simSnake.body.length - 1];
    sim.board[tail.y][tail.x] = { content: CellContent.Empty, snakebotId: null };

    // Grow into new head
    simSnake.body.unshift(next);
    simSnake.body.pop();

    // Check if we collected a power source
    const psIndex = sim.powerSources.findIndex(ps => ps.x === next.x && ps.y === next.y);
    if (psIndex !== -1) sim.powerSources.splice(psIndex, 1);

    // Stamp new head onto board
    const content = snake.owner === 'me' ? CellContent.MySnake : CellContent.OppSnake;
    sim.board[next.y][next.x] = { content, snakebotId: snake.id };

    return { ok: true, state: sim, snake: simSnake };
}


// ── Gravity ───────────────────────────────────────────────────────────────────

/**
 * Drops the snake down row by row until any segment has a non-walkable cell
 * directly below it. Mutates the passed-in state clone and snake in place —
 * call this only on already-cloned data.
 */
function applyGravity(
    state: GameState,
    snake: Snakebot,
    staticMap: StaticCell[][],
): { state: GameState; snake: Snakebot } {
    let sim = cloneState(state);
    let simSnake = (snake.owner === 'me' ? sim.mySnakes : sim.oppSnakes).get(snake.id)!;
    const isWalkable = (p: Point) => isTraversable(p.x, p.y, staticMap, sim.board);

    for (let i = 0; i < staticMap.length; i++) {
        const isSupported = simSnake.body.some(p => !isWalkable({ x: p.x, y: p.y + 1 }));
        if (isSupported) break;

        // Erase current positions
        for (const p of simSnake.body) {
            sim.board[p.y][p.x] = { content: CellContent.Empty, snakebotId: null };
        }

        // Drop every segment one row
        for (const p of simSnake.body) p.y += 1;

        // Collect any power sources landed on
        for (const p of simSnake.body) {
            const psIndex = sim.powerSources.findIndex(ps => ps.x === p.x && ps.y === p.y);
            if (psIndex !== -1) sim.powerSources.splice(psIndex, 1);
        }

        // Re-stamp
        const content = snake.owner === 'me' ? CellContent.MySnake : CellContent.OppSnake;
        for (const p of simSnake.body) {
            sim.board[p.y][p.x] = { content, snakebotId: snake.id };
        }
    }

    return { state: sim, snake: simSnake };
}


/**
 * Simulates the full path from current position to `goal` step by step,
 * re-running A* after each move so the path adapts to the evolving board.
 * Returns the number of steps taken, or null if the goal is unreachable / fatal.
 */
function simulatePath(
    state: GameState,
    snake: Snakebot,
    goal: Point,
    staticMap: StaticCell[][],
): { steps: number; finalState: GameState } | null {
    let sim = state;
    let simSnake = snake;
    let steps = 0;
    const maxSteps = turnsLeft / 2 > 10 ? turnsLeft / 2 : turnsLeft;

    while (steps < maxSteps) {
        const head = simSnake.body[0];
        if (head.x === goal.x && head.y === goal.y) return { steps, finalState: sim };

        const isWalkable = (p: Point) => isTraversable(p.x, p.y, staticMap, sim.board);
        const path = aStar(head, goal, isWalkable);
        if (!path || path.length < 2) return null; // blocked or unreachable

        const next = path[1];
        const dx = next.x - head.x;
        const dy = next.y - head.y;
        const direction: Direction =
            dx === 1 ? 'RIGHT' :
                dx === -1 ? 'LEFT' :
                    dy === 1 ? 'DOWN' : 'UP';

        const advanceResult = advanceSnake(sim, simSnake, direction, staticMap);
        if (!advanceResult.ok) return null;

        const gravityResult = applyGravity(advanceResult.state, advanceResult.snake, staticMap);

        sim = gravityResult.state;
        simSnake = gravityResult.snake;
        steps++;
    }

    return null; // exceeded step budget
}

/**
 * If no good move is found, do something that avoids death.
 * Tries all 4 directions and returns the first safe one.
 * Returns [] if all moves lead to death — dispatcher will emit WAIT.
 */
function avoidDeath(state: GameState, currentSnake: Snakebot): Command[] {
    for (const direction of DIRECTIONS) {
        const result = advanceSnake(state, currentSnake, direction, staticMap);
        if (result.ok) return [{ kind: 'MOVE', snakebotId: currentSnake.id, direction }];
    }

    console.error(`[AVOID_DEATH] Snake ${currentSnake.id} has no safe moves — waiting.`);
    return [];
}