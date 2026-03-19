
type Line = number[]
type Board = Line[]

const depth: number = parseInt(readline());

const board = (() => {
    let board : number[][] = [];

    for (let i = 0; i < 3; i++) {
        var line : Line = []; 
        var inputs: string[] = readline().split(' ');
        for (let j = 0; j < 3; j++) {
            line.push(parseInt(inputs[j]));
        }
        board.push(line);
    }
    return board;
})();


// doAmove :: Board -> Board

// check if depth is reached
// if yes, undo last move, if possible
// do a move
// check if there are more moves possible
// if not record state
// undo last move
// repeat

const doMove = (board: Board) : Board => {
    
    return ; 
}


console.error("Board", board);
console.error("Depth", depth);

console.log('0');


