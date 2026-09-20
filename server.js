const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// Game State
const rooms = {};

// Helper to generate a new game state
function createGameState() {
    return {
        players: [], // array of { id, name }
        pool: Array.from({ length: 25 }, (_, i) => i + 1),
        drawnNumbers: [],
        gameStarted: false,
        winner: null,
        drawInterval: null,
    };
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join a room
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = createGameState();
        }

        const room = rooms[roomId];

        // Limit to 2 players per room for now
        if (room.players.length >= 2) {
            socket.emit('roomFull');
            return;
        }

        room.players.push({ id: socket.id, name: playerName });
        console.log(`${playerName} joined room ${roomId}`);

        // Notify room
        io.to(roomId).emit('roomUpdated', {
            players: room.players,
            gameStarted: room.gameStarted
        });

        // If 2 players, auto-start
        if (room.players.length === 2 && !room.gameStarted) {
            startGame(roomId);
        }
    });

    // Handle claim win
    socket.on('claimWin', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.gameStarted && !room.winner) {
            const winnerName = room.players.find(p => p.id === socket.id)?.name || 'Someone';
            room.winner = winnerName;
            room.gameStarted = false;
            
            if (room.drawInterval) {
                clearInterval(room.drawInterval);
            }

            io.to(roomId).emit('gameOver', { winnerName });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Find which room the user was in and remove them
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const playerName = room.players[playerIndex].name;
                room.players.splice(playerIndex, 1);
                
                // If game was running, stop it
                if (room.gameStarted) {
                    room.gameStarted = false;
                    if (room.drawInterval) {
                        clearInterval(room.drawInterval);
                    }
                    io.to(roomId).emit('playerLeft', { playerName });
                }
                
                io.to(roomId).emit('roomUpdated', {
                    players: room.players,
                    gameStarted: room.gameStarted
                });

                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

function startGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.gameStarted = true;
    room.winner = null;
    room.drawnNumbers = [];
    room.pool = Array.from({ length: 25 }, (_, i) => i + 1);
    
    // Shuffle pool
    for (let i = room.pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.pool[i], room.pool[j]] = [room.pool[j], room.pool[i]];
    }

    io.to(roomId).emit('gameStarted');

    // Draw a number every 3 seconds
    room.drawInterval = setInterval(() => {
        if (room.pool.length === 0) {
            clearInterval(room.drawInterval);
            return;
        }
        
        const drawnNumber = room.pool.pop();
        room.drawnNumbers.push(drawnNumber);
        
        // Determine letter
        let letter = '';
        if (drawnNumber <= 5) letter = 'B';
        else if (drawnNumber <= 10) letter = 'I';
        else if (drawnNumber <= 15) letter = 'N';
        else if (drawnNumber <= 20) letter = 'G';
        else letter = 'O';

        io.to(roomId).emit('numberDrawn', { drawnNumber, letter });
    }, 3000);
}

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
