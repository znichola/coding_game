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

const DIRECTIONS = new Set<string>(['UP', 'DOWN', 'LEFT', 'RIGHT']);

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
    console.error("DISPATCHING COMMANDS:");
    console.error(commands);
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

    logState(state);

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
}

function algo(state: GameState, currentSnake: Snakebot): Command[] {
    const head = currentSnake.body[0];

    const closest = state.powerSources.reduce<Point | null>((best, ps) => {
        if (!best) return ps;
        return Math.hypot(ps.x - head.x, ps.y - head.y) < Math.hypot(best.x - head.x, best.y - head.y) ? ps : best;
    }, null);

    if (!closest) return [];

    const isWalkable = (p: Point) => isTraversable(p.x, p.y, staticMap, state.board);
    const path = aStar(head, closest, isWalkable);

    if (!path || path.length < 2) return [];

    // path[0] is current head, path[1] is next step
    const next = path[1];
    const dx = next.x - head.x;
    const dy = next.y - head.y;
    const direction: Direction =
        dx === 1 ? 'RIGHT' :
            dx === -1 ? 'LEFT' :
                dy === 1 ? 'DOWN' : 'UP';

    return [{ kind: 'MOVE', snakebotId: currentSnake.id, direction }];
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