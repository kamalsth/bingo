const socket = io();

document.addEventListener('DOMContentLoaded', () => {
    // Lobby UI
    const lobby = document.getElementById('lobby');
    const gameUI = document.getElementById('game-ui');
    const playerNameInput = document.getElementById('player-name');
    const roomIdInput = document.getElementById('room-id');
    const joinBtn = document.getElementById('join-btn');
    const lobbyMessage = document.getElementById('lobby-message');
    const roomStatus = document.getElementById('room-status');
    const winnerNameDisplay = document.getElementById('winner-name-display');

    // Game UI
    const boardElement = document.getElementById('bingo-board');
    const currentDrawElement = document.getElementById('current-draw');
    const calledNumbersElement = document.getElementById('called-numbers');
    const winMessage = document.getElementById('win-message');

    const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
    const RANGES = [
        { min: 1, max: 5 },    // B
        { min: 6, max: 10 },   // I
        { min: 11, max: 15 },  // N
        { min: 16, max: 20 },  // G
        { min: 21, max: 25 }   // O
    ];

    let board = [];
    let calledNumbers = new Set();
    let gameOver = false;
    let currentRoom = null;

    // Join Room logic
    joinBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        const roomId = roomIdInput.value.trim();

        if (!playerName || !roomId) {
            lobbyMessage.textContent = 'Please enter both name and room ID.';
            return;
        }

        socket.emit('joinRoom', { roomId, playerName });
        currentRoom = roomId;
    });

    // Socket Events
    socket.on('roomFull', () => {
        lobbyMessage.textContent = 'Room is full! Try a different one.';
    });

    socket.on('roomUpdated', ({ players, gameStarted }) => {
        if (players.length > 0) {
            // Hide lobby, show game
            lobby.style.display = 'none';
            gameUI.style.display = 'grid';
            
            if (players.length === 1) {
                roomStatus.textContent = 'Waiting for opponent to join...';
            } else {
                roomStatus.textContent = `Playing against: ${players.find(p => p.id !== socket.id)?.name}`;
            }
        }
    });

    socket.on('gameStarted', () => {
        roomStatus.textContent = 'Game Started! Good luck!';
        initGame();
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
        if (currentRoom) {
            // Optional: reset or handle disconnection gracefully
        }
    });

    // Initialize/Reset game board
    function initGame() {
        gameOver = false;
        calledNumbers.clear();
        boardElement.innerHTML = '';
        calledNumbersElement.innerHTML = '';
        currentDrawElement.textContent = '--';
        currentDrawElement.classList.remove('animate');
        winMessage.classList.add('hidden');
        
        createBoard();
        renderBoard();
    }

    // Generate random unique numbers for a specific column
    function getColumnNumbers(colIndex) {
        const { min, max } = RANGES[colIndex];
        const nums = [];
        const available = Array.from({length: max - min + 1}, (_, i) => min + i);
        
        for (let i = 0; i < 5; i++) {
            const randIndex = Math.floor(Math.random() * available.length);
            nums.push(available.splice(randIndex, 1)[0]);
        }
        return nums;
    }

    // Create logical board representation
    function createBoard() {
        board = [];
        for (let i = 0; i < 5; i++) {
            board.push(getColumnNumbers(i));
        }
    }

    // Render HTML board
    function renderBoard() {
        // Render Headers
        BINGO_LETTERS.forEach((letter, idx) => {
            const headerCell = document.createElement('div');
            headerCell.classList.add('board-header');
            headerCell.id = `header-${idx}`;
            // Start with placeholder underscore
            headerCell.textContent = '_';
            boardElement.appendChild(headerCell);
        });

        // Render Cells (Row by Row)
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
                const cellVal = board[col][row];
                const cellElement = document.createElement('div');
                cellElement.classList.add('bingo-cell');
                
                cellElement.textContent = cellVal;
                cellElement.dataset.row = row;
                cellElement.dataset.col = col;
                cellElement.dataset.val = cellVal;
                cellElement.addEventListener('click', () => handleCellClick(cellElement, row, col));
                
                boardElement.appendChild(cellElement);
            }
        }
    }

    // Handle clicking a cell
    function handleCellClick(cellElement, row, col) {
        if (gameOver) return;
        
        const val = parseInt(cellElement.dataset.val);
        
        // Allow marking only if the number has been called
        if (calledNumbers.has(val) && !cellElement.classList.contains('marked')) {
            cellElement.classList.add('marked');
            checkForWin();
        }
    }

    function handleNumberDrawn(drawnNumber, letter) {
        if (gameOver) return;
        
        calledNumbers.add(drawnNumber);

        const drawText = `${letter}-${drawnNumber}`;
        
        // Update display with animation
        currentDrawElement.textContent = drawText;
        currentDrawElement.classList.remove('animate');
        void currentDrawElement.offsetWidth; // trigger reflow
        currentDrawElement.classList.add('animate');

        // Add to history
        const historyBall = document.createElement('div');
        historyBall.classList.add('history-ball');
        historyBall.textContent = drawnNumber;
        // Insert at beginning
        calledNumbersElement.insertBefore(historyBall, calledNumbersElement.firstChild);
    }

    // Check if player has bingo
    function checkForWin() {
        const cells = Array.from(document.querySelectorAll('.bingo-cell:not(.board-header)'));
        
        const getCell = (col, row) => cells.find(c => c.dataset.col == col && c.dataset.row == row);
        let completedLines = 0;

        // Check columns
        for (let col = 0; col < 5; col++) {
            let lineCells = [];
            let colWin = true;
            for (let row = 0; row < 5; row++) {
                const cell = getCell(col, row);
                if (!cell || !cell.classList.contains('marked')) {
                    colWin = false;
                    break;
                }
                lineCells.push(cell);
            }
            if (colWin) {
                completedLines++;
                lineCells.forEach(c => c.classList.add('strike-vertical'));
            }
        }

        // Check rows
        for (let row = 0; row < 5; row++) {
            let lineCells = [];
            let rowWin = true;
            for (let col = 0; col < 5; col++) {
                const cell = getCell(col, row);
                if (!cell || !cell.classList.contains('marked')) {
                    rowWin = false;
                    break;
                }
                lineCells.push(cell);
            }
            if (rowWin) {
                completedLines++;
                lineCells.forEach(c => c.classList.add('strike-horizontal'));
            }
        }

        // Check diagonals
        let diag1Cells = [];
        let diag1Win = true;
        for (let i = 0; i < 5; i++) {
            const cell = getCell(i, i);
            if (!cell || !cell.classList.contains('marked')) {
                diag1Win = false;
                break;
            }
            diag1Cells.push(cell);
        }
        if (diag1Win) {
            completedLines++;
            diag1Cells.forEach(c => c.classList.add('strike-diag-1'));
        }

        let diag2Cells = [];
        let diag2Win = true;
        for (let i = 0; i < 5; i++) {
            const cell = getCell(i, 4 - i);
            if (!cell || !cell.classList.contains('marked')) {
                diag2Win = false;
                break;
            }
            diag2Cells.push(cell);
        }
        if (diag2Win) {
            completedLines++;
            diag2Cells.forEach(c => c.classList.add('strike-diag-2'));
        }

        // Light up headers based on completed lines
        for (let i = 0; i < 5; i++) {
            const header = document.getElementById(`header-${i}`);
            if (header) {
                if (i < completedLines) {
                    header.classList.add('lit-up');
                    header.textContent = BINGO_LETTERS[i]; // reveal letter
                } else {
                    header.classList.remove('lit-up');
                    header.textContent = '_'; // placeholder
                }
            }
        }

        if (completedLines >= 5) {
            // Tell the server we won
            socket.emit('claimWin', { roomId: currentRoom });
        }
    }
});
