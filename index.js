const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms storage
const gameRooms = new Map();
const waitingPlayers = [];

// Generate random room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Timer management
function startGameTimer(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.gameOver) return;

  // Clear any existing timer
  if (room.timer) {
    clearInterval(room.timer);
  }
  room.timer = setInterval(() => {
    const currentPlayer = room.game.turn();
    const timeKey = currentPlayer === 'w' ? 'whiteTime' : 'blackTime';
    
    room[timeKey]--;
    
    if (room[timeKey] <= 0) {
      clearInterval(room.timer);
      room.gameOver = true;
      const winner = currentPlayer === 'w' ? 'black' : 'white';
      io.to(roomId).emit('timeout', { winner });
      gameRooms.delete(roomId);
      return;
    }
    
    // Format time as MM:SS
    const formatTime = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    
    const timerData = {
      white: formatTime(room.whiteTime),
      black: formatTime(room.blackTime)
    };
    
    io.to(roomId).emit('timerUpdate', timerData);
  }, 1000);
}

// Bot move logic (simple random moves for now)
function makeBotMove(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.gameOver || room.game.turn() !== 'b') return;
  
  setTimeout(() => {
    const moves = room.game.moves({ verbose: true });
    if (moves.length === 0) return;
    
    // Simple bot logic based on difficulty
    let selectedMove;
    switch (room.botDifficulty) {
      case 'easy':
        selectedMove = moves[Math.floor(Math.random() * moves.length)];
        break;
      case 'medium':
        // Prefer captures and checks
        const goodMoves = moves.filter(move => move.captured || move.san.includes('+'));
        selectedMove = goodMoves.length > 0 ? 
          goodMoves[Math.floor(Math.random() * goodMoves.length)] :
          moves[Math.floor(Math.random() * moves.length)];
        break;
      case 'hard':
        // More sophisticated logic could be added here
        const bestMoves = moves.filter(move => move.captured || move.san.includes('+') || move.san.includes('#'));
        selectedMove = bestMoves.length > 0 ? 
          bestMoves[Math.floor(Math.random() * bestMoves.length)] :
          moves[Math.floor(Math.random() * moves.length)];
        break;
      default:
        selectedMove = moves[Math.floor(Math.random() * moves.length)];
    }
    
    room.game.move(selectedMove);
    io.to(roomId).emit('boardState', room.game.fen());
    
    // Check for game over
    if (room.game.isGameOver()) {
      clearInterval(room.timer);
      room.gameOver = true;
      let result = '';
      if (room.game.isCheckmate()) {
        result = room.game.turn() === 'w' ? 'Black wins by checkmate!' : 'White wins by checkmate!';
      } else if (room.game.isDraw()) {
        result = 'Game ended in a draw!';
      }
      io.to(roomId).emit('gameOver', { result });
    }
  }, 1000 + Math.random() * 2000); // Random delay between 1-3 seconds
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('player-join', ({ name, timeLimit, roomCode }) => {
    const timeInSeconds = {
      '1min': 60,
      '3min': 180,
      '5min': 300,
      '10min': 600,
      '30min': 1800
    }[timeLimit] || 300;

    // If room code is provided, try to join that specific room
    if (roomCode) {
      const room = gameRooms.get(roomCode);
      if (!room) {
        socket.emit('roomNotFound');
        return;
      }
      if (room.players.length >= 2) {
        socket.emit('roomFull');
        return;
      }
      
      // Join the specific room
      socket.join(roomCode);
      room.players.push({ id: socket.id, name, color: 'black' });
      socket.emit('playerRole', 'b');
      socket.emit('roomJoined', { roomCode });
      
      // Update player info for all players in room
      const playerInfo = {
        white: room.players.find(p => p.color === 'white'),
        black: room.players.find(p => p.color === 'black')
      };
      io.to(roomCode).emit('playerUpdate', playerInfo);
      io.to(roomCode).emit('boardState', room.game.fen());
      
      // Send initial timer state
      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };
      
      io.to(roomCode).emit('timerUpdate', {
        white: formatTime(room.whiteTime),
        black: formatTime(room.blackTime)
      });
      
      // Start the game timer
      startGameTimer(roomCode);
      return;
    }

    // No room code provided - try to join waiting player or create new room
    const waitingPlayer = waitingPlayers.find(p => p.timeLimit === timeLimit);
    
    if (waitingPlayer) {
      // Join existing waiting player's room
      const roomId = waitingPlayer.roomId;
      const room = gameRooms.get(roomId);
      
      socket.join(roomId);
      room.players.push({ id: socket.id, name, color: 'black' });
      socket.emit('playerRole', 'b');
      socket.emit('roomJoined', { roomCode: roomId });
      
      // Remove from waiting list
      const index = waitingPlayers.indexOf(waitingPlayer);
      waitingPlayers.splice(index, 1);
      
      // Update player info for all players in room
      const playerInfo = {
        white: room.players.find(p => p.color === 'white'),
        black: room.players.find(p => p.color === 'black')
      };
      io.to(roomId).emit('playerUpdate', playerInfo);
      io.to(roomId).emit('boardState', room.game.fen());
      
      // Send initial timer state
      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };
      
      io.to(roomId).emit('timerUpdate', {
        white: formatTime(room.whiteTime),
        black: formatTime(room.blackTime)
      });
      
      // Start the game timer
      startGameTimer(roomId);
    } else {
      // Create new room and wait for opponent
      const roomId = generateRoomCode();
      const room = {
        id: roomId,
        game: new Chess(),
        players: [{ id: socket.id, name, color: 'white' }],
        whiteTime: timeInSeconds,
        blackTime: timeInSeconds,
        gameOver: false,
        timer: null
      };
      
      gameRooms.set(roomId, room);
      waitingPlayers.push({ id: socket.id, name, timeLimit, roomId });
      
      socket.join(roomId);
      socket.emit('playerRole', 'w');
      socket.emit('roomCreated', { roomCode: roomId });
      
      // Update player info
      const playerInfo = {
        white: { name },
        black: null
      };
      socket.emit('playerUpdate', playerInfo);
      socket.emit('boardState', room.game.fen());
      
      // Send initial timer state
      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };
      
      socket.emit('timerUpdate', {
        white: formatTime(room.whiteTime),
        black: formatTime(room.blackTime)
      });
    }
  });

  socket.on('create-bot-game', ({ playerName, timeLimit, botDifficulty }) => {
    const timeInSeconds = {
      '1min': 60,
      '3min': 180,
      '5min': 300,
      '10min': 600,
      '30min': 1800
    }[timeLimit] || 300;

    const roomId = generateRoomCode();
    const room = {
      id: roomId,
      game: new Chess(),
      players: [
        { id: socket.id, name: playerName, color: 'white' },
        { id: 'bot', name: `Bot (${botDifficulty})`, color: 'black' }
      ],
      whiteTime: timeInSeconds,
      blackTime: timeInSeconds,
      gameOver: false,
      timer: null,
      isBot: true,
      botDifficulty
    };
    
    gameRooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('playerRole', 'w');
    socket.emit('roomCreated', { roomCode: roomId });
    
    // Update player info
    const playerInfo = {
      white: { name: playerName },
      black: { name: `Bot (${botDifficulty})` }
    };
    socket.emit('playerUpdate', playerInfo);
    socket.emit('boardState', room.game.fen());
    
    // Send initial timer state
    const formatTime = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    
    socket.emit('timerUpdate', {
      white: formatTime(room.whiteTime),
      black: formatTime(room.blackTime)
    });
    
    // Start the game timer
    startGameTimer(roomId);
  });

  socket.on('movePiece', (move) => {
    // Find which room this socket is in
    let currentRoom = null;
    let roomId = null;
    
    for (const [id, room] of gameRooms.entries()) {
      if (room.players.some(player => player.id === socket.id)) {
        currentRoom = room;
        roomId = id;
        break;
      }
    }
    
    if (!currentRoom || currentRoom.gameOver) return;
    
    // Validate it's the player's turn
    const player = currentRoom.players.find(p => p.id === socket.id);
    if (!player || (player.color === 'white' && currentRoom.game.turn() !== 'w') || 
        (player.color === 'black' && currentRoom.game.turn() !== 'b')) {
      socket.emit('invalidMove');
      return;
    }
    
    // Try to make the move
    try {
      const result = currentRoom.game.move(move);
      if (result) {
        io.to(roomId).emit('boardState', currentRoom.game.fen());
        
        // Check for game over
        if (currentRoom.game.isGameOver()) {
          clearInterval(currentRoom.timer);
          currentRoom.gameOver = true;
          let gameResult = '';
          if (currentRoom.game.isCheckmate()) {
            gameResult = currentRoom.game.turn() === 'w' ? 'Black wins by checkmate!' : 'White wins by checkmate!';
          } else if (currentRoom.game.isDraw()) {
            gameResult = 'Game ended in a draw!';
          }
          io.to(roomId).emit('gameOver', { result: gameResult });
          gameRooms.delete(roomId);
        } else if (currentRoom.isBot && currentRoom.game.turn() === 'b') {
          // Make bot move
          makeBotMove(roomId);
        }
      } else {
        socket.emit('invalidMove');
      }
    } catch (error) {
      socket.emit('invalidMove');
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    // Remove from waiting players
    const waitingIndex = waitingPlayers.findIndex(p => p.id === socket.id);
    if (waitingIndex !== -1) {
      const waitingPlayer = waitingPlayers[waitingIndex];
      waitingPlayers.splice(waitingIndex, 1);
      
      // Clean up the room if it was just created
      const room = gameRooms.get(waitingPlayer.roomId);
      if (room && room.players.length === 1) {
        gameRooms.delete(waitingPlayer.roomId);
      }
    }
    
    // Handle disconnection from active games
    for (const [roomId, room] of gameRooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        
        if (!room.isBot) {
          socket.to(roomId).emit('playerLeft', { player: player.name });
        }
        
        // Clean up the room
        if (room.timer) {
          clearInterval(room.timer);
        }
        gameRooms.delete(roomId);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess server running on port ${PORT}`);
});