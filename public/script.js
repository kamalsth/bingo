"use strict";
// ─── Types ────────────────────────────────────────────────────────────────────
// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildRanges(max) {
    const size = Math.ceil(max / 5);
    return [
        { min: 1, max: size },
        { min: size + 1, max: size * 2 },
        { min: size * 2 + 1, max: size * 3 },
        { min: size * 3 + 1, max: size * 4 },
        { min: size * 4 + 1, max: max },
    ];
}
function getEl(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Element #${id} not found`);
    return el;
}
// ─── Main ─────────────────────────────────────────────────────────────────────
const socket = io();
document.addEventListener('DOMContentLoaded', () => {
    // ── Lobby refs ────────────────────────────────────────────────────────────
    const lobby = getEl('lobby');
    const gameUI = getEl('game-ui');
    const playerNameInput = getEl('player-name');
    const tabCreate = getEl('tab-create');
    const tabJoin = getEl('tab-join');
    const panelCreate = getEl('panel-create');
    const panelJoin = getEl('panel-join');
    const createRoomIdInput = getEl('create-room-id');
    const joinRoomIdInput = getEl('join-room-id');
    const btnRandomRoom = getEl('btn-random-room');
    const createMaxNumber = getEl('create-max-number');
    const createRoomBtn = getEl('create-room-btn');
    const joinRoomBtn = getEl('join-room-btn');
    const presetChips = document.querySelectorAll('.preset-chip');
    const playerChips = document.querySelectorAll('.player-chip');
    const lobbyMessage = getEl('lobby-message');
    // ── Game refs ─────────────────────────────────────────────────────────────
    const roomStatus = getEl('room-status');
    const startEarlyBtn = getEl('start-early-btn');
    const playerNamesEl = getEl('player-names');
    const winnerNameDisplay = getEl('winner-name-display');
    const boardElement = getEl('bingo-board');
    const currentDrawElement = getEl('current-draw');
    const calledNumbersEl = getEl('called-numbers');
    const winMessage = getEl('win-message');
    const drawError = getEl('draw-error');
    const restartBtn = getEl('restart-btn');
    // ── State ─────────────────────────────────────────────────────────────────
    const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
    let RANGES = [];
    let maxNumber = 25;
    let selectedMaxPlayers = 2;
    let board = [];
    let calledNumbers = new Set();
    let gameOver = false;
    let currentRoom = null;
    let isHost = false;
    let isMyTurn = false;
    // ── Lobby Tab Switcher ───────────────────────────────────────────────────
    tabCreate.addEventListener('click', () => {
        tabCreate.classList.add('active');
        tabJoin.classList.remove('active');
        panelCreate.classList.remove('hidden');
        panelJoin.classList.add('hidden');
        lobbyMessage.textContent = '';
    });
    tabJoin.addEventListener('click', () => {
        tabJoin.classList.add('active');
        tabCreate.classList.remove('active');
        panelJoin.classList.remove('hidden');
        panelCreate.classList.add('hidden');
        lobbyMessage.textContent = '';
    });
    // ── Random Room Generator ─────────────────────────────────────────────────
    btnRandomRoom.addEventListener('click', () => {
        const rand = 'room-' + Math.floor(1000 + Math.random() * 9000);
        createRoomIdInput.value = rand;
        createRoomIdInput.focus();
    });
    // ── Max Number Presets ────────────────────────────────────────────────────
    presetChips.forEach(chip => {
        chip.addEventListener('click', () => {
            presetChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const val = chip.dataset['val'];
            if (val) {
                createMaxNumber.value = val;
            }
        });
    });
    createMaxNumber.addEventListener('input', () => {
        const currentVal = createMaxNumber.value.trim();
        presetChips.forEach(chip => {
            if (chip.dataset['val'] === currentVal) {
                chip.classList.add('active');
            }
            else {
                chip.classList.remove('active');
            }
        });
    });
    // ── Player Count Presets ──────────────────────────────────────────────────
    playerChips.forEach(chip => {
        chip.addEventListener('click', () => {
            playerChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedMaxPlayers = parseInt(chip.dataset['players'] ?? '2', 10);
        });
    });
    // ── Create Room ───────────────────────────────────────────────────────────
    createRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        const roomId = createRoomIdInput.value.trim();
        const parsedMax = parseInt(createMaxNumber.value, 10);
        if (!playerName) {
            lobbyMessage.textContent = 'Please enter your name.';
            playerNameInput.focus();
            return;
        }
        if (!roomId) {
            lobbyMessage.textContent = 'Please enter a Room ID.';
            createRoomIdInput.focus();
            return;
        }
        if (isNaN(parsedMax) || parsedMax < 25) {
            lobbyMessage.textContent = 'Max number must be at least 25.';
            createMaxNumber.focus();
            return;
        }
        lobby.classList.add('force-hidden');
        gameUI.classList.remove('force-hidden');
        gameUI.style.display = 'grid';
        playerNamesEl.textContent = playerName;
        roomStatus.textContent = `Room "${roomId}" • Waiting for players (1/${selectedMaxPlayers})...`;
        socket.emit('createRoom', {
            roomId,
            playerName,
            maxNumber: parsedMax,
            maxPlayers: selectedMaxPlayers
        });
        currentRoom = roomId;
    });
    // ── Join Room ─────────────────────────────────────────────────────────────
    joinRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        const roomId = joinRoomIdInput.value.trim();
        if (!playerName) {
            lobbyMessage.textContent = 'Please enter your name.';
            playerNameInput.focus();
            return;
        }
        if (!roomId) {
            lobbyMessage.textContent = 'Please enter a Room ID to join.';
            joinRoomIdInput.focus();
            return;
        }
        lobby.classList.add('force-hidden');
        gameUI.classList.remove('force-hidden');
        gameUI.style.display = 'grid';
        playerNamesEl.textContent = playerName;
        roomStatus.textContent = `Joining room "${roomId}"...`;
        socket.emit('joinRoom', { roomId, playerName });
        currentRoom = roomId;
    });
    // Enter key shortcuts
    [playerNameInput, createRoomIdInput, createMaxNumber].forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')
                createRoomBtn.click();
        });
    });
    joinRoomIdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            joinRoomBtn.click();
    });
    // ── Restart & Start Early ─────────────────────────────────────────────────
    restartBtn.addEventListener('click', () => {
        if (currentRoom) {
            socket.emit('restartGame', { roomId: currentRoom });
        }
    });
    startEarlyBtn.addEventListener('click', () => {
        if (currentRoom && isHost) {
            socket.emit('startGameEarly', { roomId: currentRoom });
        }
    });
    // ── Socket events ─────────────────────────────────────────────────────────
    socket.on('roomError', ({ message }) => {
        gameUI.classList.add('force-hidden');
        lobby.classList.remove('force-hidden');
        lobbyMessage.textContent = message;
        startEarlyBtn.classList.add('hidden');
    });
    socket.on('roomFull', () => {
        gameUI.classList.add('force-hidden');
        lobby.classList.remove('force-hidden');
        lobbyMessage.textContent = 'Room is full! Try a different one.';
        startEarlyBtn.classList.add('hidden');
    });
    socket.on('roomUpdated', ({ players, gameStarted: started, hostId, maxPlayers }) => {
        isHost = socket.id === hostId;
        const me = players.find(p => p.id === socket.id);
        playerNamesEl.textContent = me?.name ?? playerNameInput.value.trim();
        if (!started) {
            const target = maxPlayers || selectedMaxPlayers || 2;
            if (players.length < target) {
                roomStatus.textContent = `Room "${currentRoom}" • Waiting for players (${players.length}/${target})...`;
                if (isHost && players.length >= 2) {
                    startEarlyBtn.classList.remove('hidden');
                    startEarlyBtn.textContent = `Start Game Now (${players.length} players)`;
                }
                else {
                    startEarlyBtn.classList.add('hidden');
                }
            }
            else {
                roomStatus.textContent = 'All players joined! Starting game...';
                startEarlyBtn.classList.add('hidden');
            }
        }
        else {
            startEarlyBtn.classList.add('hidden');
        }
    });
    socket.on('gameStarted', ({ maxNumber: serverMax }) => {
        maxNumber = serverMax;
        RANGES = buildRanges(maxNumber);
        startEarlyBtn.classList.add('hidden');
        initGame();
    });
    socket.on('turnChanged', ({ currentPlayerId, currentPlayerName }) => {
        isMyTurn = socket.id === currentPlayerId;
        drawError.textContent = '';
        if (isMyTurn) {
            roomStatus.textContent = 'Your turn to draw! Click an uncalled number on your board.';
        }
        else {
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
    function initGame() {
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
    function getColumnNumbers(colIndex) {
        const { min, max } = RANGES[colIndex];
        const available = Array.from({ length: max - min + 1 }, (_, i) => min + i);
        const nums = [];
        for (let i = 0; i < 5; i++) {
            const ri = Math.floor(Math.random() * available.length);
            nums.push(available.splice(ri, 1)[0]);
        }
        return nums;
    }
    function createBoard() {
        board = [];
        for (let i = 0; i < 5; i++) {
            board.push(getColumnNumbers(i));
        }
    }
    function renderBoard() {
        // Headers (hidden initially; shown one by one as lines are completed)
        BINGO_LETTERS.forEach((_, idx) => {
            const h = document.createElement('div');
            h.classList.add('board-header');
            h.id = `header-${idx}`;
            h.textContent = '';
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
    function handleCellClick(cellEl, _row, _col) {
        if (gameOver)
            return;
        const val = parseInt(cellEl.dataset['val'] ?? '0', 10);
        if (calledNumbers.has(val)) {
            if (!cellEl.classList.contains('marked')) {
                cellEl.classList.add('marked');
                checkForWin();
            }
        }
        else {
            if (isMyTurn) {
                drawError.textContent = '';
                // Optimistically mark the cell so the user doesn't have to click it again
                cellEl.classList.add('marked');
                checkForWin();
                socket.emit('drawNumber', { roomId: currentRoom, number: val });
            }
            else {
                drawError.textContent = "It's not your turn!";
            }
        }
    }
    function handleNumberDrawn(drawnNumber, letter) {
        if (gameOver)
            return;
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
    function checkForWin() {
        const cells = Array.from(document.querySelectorAll('.bingo-cell:not(.board-header)'));
        const getCell = (col, row) => cells.find(c => c.dataset['col'] === String(col) && c.dataset['row'] === String(row));
        let completedLines = 0;
        // Columns
        for (let col = 0; col < 5; col++) {
            const lineCells = [];
            let win = true;
            for (let row = 0; row < 5; row++) {
                const c = getCell(col, row);
                if (!c?.classList.contains('marked')) {
                    win = false;
                    break;
                }
                lineCells.push(c);
            }
            if (win) {
                completedLines++;
                lineCells.forEach(c => c.classList.add('strike-vertical'));
            }
        }
        // Rows
        for (let row = 0; row < 5; row++) {
            const lineCells = [];
            let win = true;
            for (let col = 0; col < 5; col++) {
                const c = getCell(col, row);
                if (!c?.classList.contains('marked')) {
                    win = false;
                    break;
                }
                lineCells.push(c);
            }
            if (win) {
                completedLines++;
                lineCells.forEach(c => c.classList.add('strike-horizontal'));
            }
        }
        // Diagonal top-left → bottom-right
        const diag1 = [];
        let diag1Win = true;
        for (let i = 0; i < 5; i++) {
            const c = getCell(i, i);
            if (!c?.classList.contains('marked')) {
                diag1Win = false;
                break;
            }
            diag1.push(c);
        }
        if (diag1Win) {
            completedLines++;
            diag1.forEach(c => c.classList.add('strike-diag-1'));
        }
        // Diagonal top-right → bottom-left
        const diag2 = [];
        let diag2Win = true;
        for (let i = 0; i < 5; i++) {
            const c = getCell(i, 4 - i);
            if (!c?.classList.contains('marked')) {
                diag2Win = false;
                break;
            }
            diag2.push(c);
        }
        if (diag2Win) {
            completedLines++;
            diag2.forEach(c => c.classList.add('strike-diag-2'));
        }
        // Update BINGO header letters (revealed one by one per completed line)
        for (let i = 0; i < 5; i++) {
            const header = document.getElementById(`header-${i}`);
            if (header) {
                if (i < completedLines) {
                    header.classList.add('lit-up');
                    header.textContent = BINGO_LETTERS[i];
                }
                else {
                    header.classList.remove('lit-up');
                    header.textContent = '';
                }
            }
        }
        if (completedLines >= 5) {
            socket.emit('claimWin', { roomId: currentRoom });
        }
    }
});
