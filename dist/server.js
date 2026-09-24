"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const path_1 = __importDefault(require("path"));
// ─── Setup ────────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server);
const PORT = process.env.PORT || 3000;
// Serve compiled client from public/, and HTML/CSS from root
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
app.use(express_1.default.static(path_1.default.join(__dirname, '..')));
// ─── Game State ───────────────────────────────────────────────────────────────
const rooms = {};
function createGameState(maxNumber) {
    return {
        players: [],
        hostId: null,
        maxNumber,
        drawnNumbers: new Set(),
        gameStarted: false,
        winner: null,
        currentTurnIndex: 0,
    };
}
function getLetter(n, max) {
    const seg = Math.ceil(max / 5);
    if (n <= seg)
        return 'B';
    if (n <= seg * 2)
        return 'I';
    if (n <= seg * 3)
        return 'N';
    if (n <= seg * 4)
        return 'G';
    return 'O';
}
function startGame(roomId) {
    const room = rooms[roomId];
    if (!room)
        return;
    room.gameStarted = true;
    room.winner = null;
    room.drawnNumbers = new Set();
    room.currentTurnIndex = 0;
    io.to(roomId).emit('gameStarted', { maxNumber: room.maxNumber });
    // Tell everyone whose turn it is first
    const first = room.players[0];
    io.to(roomId).emit('turnChanged', {
        currentPlayerId: first.id,
        currentPlayerName: first.name,
    });
}
// ─── Socket Handlers ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    socket.on('createRoom', ({ roomId, playerName, maxNumber }) => {
        const cleanRoomId = (roomId || '').trim();
        const cleanName = (playerName || '').trim();
        const parsedMax = Number(maxNumber);
        if (!cleanName || !cleanRoomId) {
            socket.emit('roomError', { message: 'Please enter both your name and a room ID.' });
            return;
        }
        if (isNaN(parsedMax) || parsedMax < 25) {
            socket.emit('roomError', { message: 'Max number must be at least 25.' });
            return;
        }
        const existingRoom = rooms[cleanRoomId];
        if (existingRoom && existingRoom.players.length > 0) {
            socket.emit('roomError', { message: `Room "${cleanRoomId}" already exists! Join it or choose a different ID.` });
            return;
        }
        socket.join(cleanRoomId);
        rooms[cleanRoomId] = createGameState(parsedMax);
        const room = rooms[cleanRoomId];
        room.hostId = socket.id;
        room.players.push({ id: socket.id, name: cleanName });
        console.log(`${cleanName} created room ${cleanRoomId} (max: ${room.maxNumber})`);
        io.to(cleanRoomId).emit('roomUpdated', {
            players: room.players,
            gameStarted: room.gameStarted,
            hostId: room.hostId,
        });
    });
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const cleanRoomId = (roomId || '').trim();
        const cleanName = (playerName || '').trim();
        if (!cleanName || !cleanRoomId) {
            socket.emit('roomError', { message: 'Please enter both your name and a room ID.' });
            return;
        }
        const room = rooms[cleanRoomId];
        if (!room || room.players.length === 0) {
            socket.emit('roomError', { message: `Room "${cleanRoomId}" does not exist. Please create it first.` });
            return;
        }
        if (room.players.length >= 2) {
            socket.emit('roomFull');
            return;
        }
        if (room.gameStarted) {
            socket.emit('roomError', { message: `Game is already in progress in room "${cleanRoomId}".` });
            return;
        }
        socket.join(cleanRoomId);
        room.players.push({ id: socket.id, name: cleanName });
        console.log(`${cleanName} joined room ${cleanRoomId} (max: ${room.maxNumber})`);
        io.to(cleanRoomId).emit('roomUpdated', {
            players: room.players,
            gameStarted: room.gameStarted,
            hostId: room.hostId,
        });
        if (room.players.length === 2 && !room.gameStarted) {
            startGame(cleanRoomId);
        }
    });
    socket.on('drawNumber', ({ roomId, number }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted || room.winner)
            return;
        // Enforce turn
        const currentPlayer = room.players[room.currentTurnIndex];
        if (socket.id !== currentPlayer.id) {
            socket.emit('drawError', { message: `It's not your turn!` });
            return;
        }
        const num = Number(number);
        if (!Number.isInteger(num) || num < 1 || num > room.maxNumber) {
            socket.emit('drawError', { message: `Number must be between 1 and ${room.maxNumber}.` });
            return;
        }
        if (room.drawnNumbers.has(num)) {
            socket.emit('drawError', { message: `${num} was already called!` });
            return;
        }
        room.drawnNumbers.add(num);
        io.to(roomId).emit('numberDrawn', {
            drawnNumber: num,
            letter: getLetter(num, room.maxNumber),
        });
        // Alternate turn
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.currentTurnIndex];
        io.to(roomId).emit('turnChanged', {
            currentPlayerId: nextPlayer.id,
            currentPlayerName: nextPlayer.name,
        });
    });
    socket.on('claimWin', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.gameStarted && !room.winner) {
            const winnerName = room.players.find(p => p.id === socket.id)?.name ?? 'Someone';
            room.winner = winnerName;
            room.gameStarted = false;
            io.to(roomId).emit('gameOver', { winnerName });
        }
    });
    socket.on('restartGame', ({ roomId }) => {
        const room = rooms[roomId];
        // Only restart if the room exists and players are still there
        if (room && room.players.length === 2) {
            startGame(roomId);
        }
    });
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const roomId of Object.keys(rooms)) {
            const room = rooms[roomId];
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const [departed] = room.players.splice(idx, 1);
                if (room.gameStarted) {
                    room.gameStarted = false;
                    io.to(roomId).emit('playerLeft', { playerName: departed.name });
                }
                io.to(roomId).emit('roomUpdated', {
                    players: room.players,
                    gameStarted: room.gameStarted,
                    hostId: room.hostId,
                });
                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
