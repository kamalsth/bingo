// ─── Types ────────────────────────────────────────────────────────────────────

interface BingoRange {
    min: number;
    max: number;
}

interface Cell {
    row: number;
    col: number;
    val: number;
}

interface Player {
    id: string;
    name: string;
}

// Socket.io client is loaded via CDN script tag — declare the minimal shape we need
declare const io: () => SocketClient;

interface SocketClient {
    id: string;
    emit(event: string, data?: unknown): void;
    on(event: 'roomFull', cb: () => void): void;
    on(event: 'roomUpdated', cb: (data: { players: Player[]; gameStarted: boolean; hostId: string }) => void): void;
    on(event: 'gameStarted', cb: (data: { maxNumber: number }) => void): void;
    on(event: 'numberDrawn', cb: (data: { drawnNumber: number; letter: string }) => void): void;
    on(event: 'drawError', cb: (data: { message: string }) => void): void;
    on(event: 'gameOver', cb: (data: { winnerName: string }) => void): void;
    on(event: 'playerLeft', cb: (data: { playerName: string }) => void): void;
    on(event: 'turnChanged', cb: (data: { currentPlayerId: string; currentPlayerName: string }) => void): void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRanges(max: number): BingoRange[] {
    const size = Math.ceil(max / 5);
    return [
        { min: 1,              max: size },
        { min: size + 1,       max: size * 2 },
        { min: size * 2 + 1,   max: size * 3 },
        { min: size * 3 + 1,   max: size * 4 },
        { min: size * 4 + 1,   max: max },
    ];
}

function getEl<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id) as T | null;
    if (!el) throw new Error(`Element #${id} not found`);
    return el;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const socket: SocketClient = io();

document.addEventListener('DOMContentLoaded', () => {
    // ── Lobby refs ────────────────────────────────────────────────────────────
    const lobby            = getEl<HTMLDivElement>('lobby');
    const gameUI           = getEl<HTMLElement>('game-ui');
    const playerNameInput  = getEl<HTMLInputElement>('player-name');
    const roomIdInput      = getEl<HTMLInputElement>('room-id');
    const maxNumberInput   = getEl<HTMLInputElement>('max-number');
    const joinBtn          = getEl<HTMLButtonElement>('join-btn');
    const lobbyMessage     = getEl<HTMLParagraphElement>('lobby-message');

    // ── Game refs ─────────────────────────────────────────────────────────────
    const roomStatus          = getEl<HTMLParagraphElement>('room-status');
    const playerNamesEl       = getEl<HTMLParagraphElement>('player-names');
    const winnerNameDisplay   = getEl<HTMLHeadingElement>('winner-name-display');
    const boardElement        = getEl<HTMLDivElement>('bingo-board');
    const currentDrawElement  = getEl<HTMLHeadingElement>('current-draw');
    const calledNumbersEl     = getEl<HTMLDivElement>('called-numbers');
    const winMessage          = getEl<HTMLDivElement>('win-message');
    const drawError           = getEl<HTMLParagraphElement>('draw-error');
    const restartBtn          = getEl<HTMLButtonElement>('restart-btn');

    // ── State ─────────────────────────────────────────────────────────────────
    const BINGO_LETTERS: readonly string[] = ['B', 'I', 'N', 'G', 'O'];
    let RANGES: BingoRange[] = [];
    let maxNumber = 25;
    let board: number[][] = [];
    let calledNumbers = new Set<number>();
    let gameOver = false;
    let currentRoom: string | null = null;
    let isHost = false;
    let isMyTurn = false;

    // ── Join ──────────────────────────────────────────────────────────────────
    joinBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        const roomId     = roomIdInput.value.trim();
        const parsedMax  = parseInt(maxNumberInput.value, 10);

        if (!playerName || !roomId) {
            lobbyMessage.textContent = 'Please enter both name and room ID.';
            return;
        }
        if (isNaN(parsedMax) || parsedMax < 25) {
            lobbyMessage.textContent = 'Max number must be at least 25.';
            return;
        }

        // Hide lobby immediately — don't wait for server roundtrip
        lobby.classList.add('force-hidden');
        gameUI.classList.remove('force-hidden');
        gameUI.style.display = 'grid';
        playerNamesEl.textContent = playerName;
        roomStatus.textContent = 'Waiting for opponent to join...';

        socket.emit('joinRoom', { roomId, playerName, maxNumber: parsedMax });
        currentRoom = roomId;
    });

    // ── Restart ───────────────────────────────────────────────────────────────
    restartBtn.addEventListener('click', () => {
        if (currentRoom) {
            socket.emit('restartGame', { roomId: currentRoom });
        }
    });

    // ── Socket events ─────────────────────────────────────────────────────────
    socket.on('roomFull', () => {
        // Restore lobby so user can try a different room
        gameUI.classList.add('force-hidden');
        lobby.classList.remove('force-hidden');
        lobbyMessage.textContent = 'Room is full! Try a different one.';
    });

    socket.on('roomUpdated', ({ players, gameStarted: _started, hostId }) => {
        isHost = socket.id === hostId;
        const me = players.find(p => p.id === socket.id);
        playerNamesEl.textContent = me?.name ?? playerNameInput.value.trim();

        if (players.length === 1) {
            roomStatus.textContent = 'Waiting for opponent to join...';
        }
    });

    socket.on('gameStarted', ({ maxNumber: serverMax }) => {
        maxNumber = serverMax;
        RANGES = buildRanges(maxNumber);
        initGame();
    });

    socket.on('turnChanged', ({ currentPlayerId, currentPlayerName }) => {
        isMyTurn = socket.id === currentPlayerId;
        drawError.textContent = '';
        if (isMyTurn) {
            roomStatus.textContent = 'Your turn to draw! Click an uncalled number on your board.';
        } else {
            roomStatus.textContent = `Waiting for ${currentPlayerName} to draw...`;
        }
    });

    socket.on('drawError', ({ message }) => {
        drawError.textContent = message;
    });

    socket.on('numberDrawn', ({ drawnNumber, letter }) => {
        handleNumberDrawn(drawnNumber, letter);
    });

    socket.on('gameOver', ({ winnerName }) => {
        gameOver = true;
        winnerNameDisplay.textContent = `${winnerName} WON!`;
        winMessage.classList.remove('hidden');
    });

    socket.on('playerLeft', ({ playerName }) => {
        gameOver = true;
        roomStatus.textContent = `${playerName} disconnected. Game over.`;
    });

    // ── Board logic ───────────────────────────────────────────────────────────
    function initGame(): void {
        gameOver = false;
        calledNumbers.clear();
        boardElement.innerHTML = '';
        calledNumbersEl.innerHTML = '';
        currentDrawElement.textContent = '--';
        currentDrawElement.classList.remove('animate');
        winMessage.classList.add('hidden');

        createBoard();
        renderBoard();
    }

    function getColumnNumbers(colIndex: number): number[] {
        const { min, max } = RANGES[colIndex];
        const available: number[] = Array.from({ length: max - min + 1 }, (_, i) => min + i);
        const nums: number[] = [];
        for (let i = 0; i < 5; i++) {
            const ri = Math.floor(Math.random() * available.length);
            nums.push(available.splice(ri, 1)[0]);
        }
        return nums;
    }

    function createBoard(): void {
        board = [];
        for (let i = 0; i < 5; i++) {
            board.push(getColumnNumbers(i));
        }
    }

    function renderBoard(): void {
        // Headers
        BINGO_LETTERS.forEach((_, idx) => {
            const h = document.createElement('div');
            h.classList.add('board-header');
            h.id = `header-${idx}`;
            h.textContent = BINGO_LETTERS[idx];
            boardElement.appendChild(h);
        });

        // Cells (row-major order)
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
                const val = board[col][row];
                const cell = document.createElement('div');
                cell.classList.add('bingo-cell');
                cell.textContent = String(val);
                cell.dataset['row'] = String(row);
                cell.dataset['col'] = String(col);
                cell.dataset['val'] = String(val);
                cell.addEventListener('click', () => handleCellClick(cell, row, col));
                boardElement.appendChild(cell);
            }
        }
    }

    function handleCellClick(cellEl: HTMLDivElement, _row: number, _col: number): void {
        if (gameOver) return;
        const val = parseInt(cellEl.dataset['val'] ?? '0', 10);
        
        if (calledNumbers.has(val)) {
            if (!cellEl.classList.contains('marked')) {
                cellEl.classList.add('marked');
                checkForWin();
            }
        } else {
            if (isMyTurn) {
                drawError.textContent = '';
                
                // Optimistically mark the cell so the user doesn't have to click it again
                cellEl.classList.add('marked');
                checkForWin();
                
                socket.emit('drawNumber', { roomId: currentRoom!, number: val });
            } else {
                drawError.textContent = "It's not your turn!";
            }
        }
    }

    function handleNumberDrawn(drawnNumber: number, letter: string): void {
        if (gameOver) return;
        calledNumbers.add(drawnNumber);

        currentDrawElement.textContent = String(drawnNumber);
        currentDrawElement.classList.remove('animate');
        void currentDrawElement.offsetWidth; // trigger reflow
        currentDrawElement.classList.add('animate');

        const ball = document.createElement('div');
        ball.classList.add('history-ball');
        ball.textContent = String(drawnNumber);
        calledNumbersEl.insertBefore(ball, calledNumbersEl.firstChild);
    }

    function checkForWin(): void {
        const cells = Array.from(
            document.querySelectorAll<HTMLDivElement>('.bingo-cell:not(.board-header)')
        );

        const getCell = (col: number, row: number): HTMLDivElement | undefined =>
            cells.find(c => c.dataset['col'] === String(col) && c.dataset['row'] === String(row));

        let completedLines = 0;

        // Columns
        for (let col = 0; col < 5; col++) {
            const lineCells: HTMLDivElement[] = [];
            let win = true;
            for (let row = 0; row < 5; row++) {
                const c = getCell(col, row);
                if (!c?.classList.contains('marked')) { win = false; break; }
                lineCells.push(c);
            }
            if (win) { completedLines++; lineCells.forEach(c => c.classList.add('strike-vertical')); }
        }

        // Rows
        for (let row = 0; row < 5; row++) {
            const lineCells: HTMLDivElement[] = [];
            let win = true;
            for (let col = 0; col < 5; col++) {
                const c = getCell(col, row);
                if (!c?.classList.contains('marked')) { win = false; break; }
                lineCells.push(c);
            }
            if (win) { completedLines++; lineCells.forEach(c => c.classList.add('strike-horizontal')); }
        }

        // Diagonal top-left → bottom-right
        const diag1: HTMLDivElement[] = [];
        let diag1Win = true;
        for (let i = 0; i < 5; i++) {
            const c = getCell(i, i);
            if (!c?.classList.contains('marked')) { diag1Win = false; break; }
            diag1.push(c);
        }
        if (diag1Win) { completedLines++; diag1.forEach(c => c.classList.add('strike-diag-1')); }

        // Diagonal top-right → bottom-left
        const diag2: HTMLDivElement[] = [];
        let diag2Win = true;
        for (let i = 0; i < 5; i++) {
            const c = getCell(i, 4 - i);
            if (!c?.classList.contains('marked')) { diag2Win = false; break; }
            diag2.push(c);
        }
        if (diag2Win) { completedLines++; diag2.forEach(c => c.classList.add('strike-diag-2')); }

        // Update BINGO header letters
        for (let i = 0; i < 5; i++) {
            const header = document.getElementById(`header-${i}`);
            if (header) {
                if (i < completedLines) {
                    header.classList.add('lit-up');
                    header.textContent = BINGO_LETTERS[i];
                } else {
                    header.classList.remove('lit-up');
                    header.textContent = BINGO_LETTERS[i];
                }
            }
        }

        if (completedLines >= 5) {
            socket.emit('claimWin', { roomId: currentRoom! });
        }
    }
});
