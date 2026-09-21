import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Player {
    id: string;
    name: string;
}

interface Room {
    players: Player[];
    hostId: string | null;
    maxNumber: number;
    drawnNumbers: Set<number>;
    gameStarted: boolean;
    winner: string | null;
    currentTurnIndex: number;  // index into players[] — whose turn to draw
}

// Client → Server
interface ClientToServerEvents {
    joinRoom: (payload: { roomId: string; playerName: string; maxNumber: number }) => void;
    drawNumber: (payload: { roomId: string; number: number }) => void;
    claimWin: (payload: { roomId: string }) => void;
    restartGame: (payload: { roomId: string }) => void;
}

// Server → Client
interface ServerToClientEvents {
    roomFull: () => void;
    roomUpdated: (payload: { players: Player[]; gameStarted: boolean; hostId: string | null }) => void;
    gameStarted: (payload: { maxNumber: number }) => void;
    numberDrawn: (payload: { drawnNumber: number; letter: string }) => void;
    drawError: (payload: { message: string }) => void;
    gameOver: (payload: { winnerName: string }) => void;
    playerLeft: (payload: { playerName: string }) => void;
    turnChanged: (payload: { currentPlayerId: string; currentPlayerName: string }) => void;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);

const PORT = process.env.PORT || 3000;

// Serve compiled client from public/, and HTML/CSS from root
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '..')));

// ─── Game State ───────────────────────────────────────────────────────────────

const rooms: Record<string, Room> = {};

function createGameState(maxNumber: number): Room {
    return {
        players: [],
        hostId: null,
        maxNumber,
        drawnNumbers: new Set<number>(),
        gameStarted: false,
        winner: null,
        currentTurnIndex: 0,
    };
}

function getLetter(n: number, max: number): string {
    const seg = Math.ceil(max / 5);
    if (n <= seg)       return 'B';
    if (n <= seg * 2)   return 'I';
    if (n <= seg * 3)   return 'N';
    if (n <= seg * 4)   return 'G';
    return 'O';
}

function startGame(roomId: string): void {
    const room = rooms[roomId];
    if (!room) return;

    room.gameStarted = true;
    room.winner = null;
    room.drawnNumbers = new Set<number>();
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

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, playerName, maxNumber }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            const max = Math.max(25, Number(maxNumber) || 25);
            rooms[roomId] = createGameState(max);
        }

        const room = rooms[roomId];

        if (room.players.length >= 2) {
            socket.emit('roomFull');
            return;
        }

        room.players.push({ id: socket.id, name: playerName });
        if (!room.hostId) room.hostId = socket.id;
        console.log(`${playerName} joined room ${roomId} (max: ${room.maxNumber})`);

        io.to(roomId).emit('roomUpdated', {
            players: room.players,
            gameStarted: room.gameStarted,
            hostId: room.hostId,
        });

        if (room.players.length === 2 && !room.gameStarted) {
            startGame(roomId);
        }
    });

    socket.on('drawNumber', ({ roomId, number }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted || room.winner) return;

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
