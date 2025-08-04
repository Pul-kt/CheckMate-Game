// Chess Game Server with Socket.IO
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Initialize Claude API
const anthropic = new Anthropic({
  apiKey: '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',
});

// Serve static files
app.use(express.static('public'));

// Game state
let gameState = {
  chess: new Chess(),
  players: { white: null, black: null },
  spectators: [],
  timers: { white: 300, black: 300 },
  gameTime: 300, // Default 5 minutes
  activeTimer: null,
  timerInterval: null,
  botMode: false,
  botColor: null
};

// Bot difficulty levels and corresponding thinking times
const BOT_SETTINGS = {
  easy: { thinkTime: 1000, description: "Easy Bot" },
  medium: { thinkTime: 2000, description: "Medium Bot" },
  hard: { thinkTime: 3000, description: "Hard Bot" }
};

// Time settings in seconds
const TIME_SETTINGS = {
  '1min': 60,
  '3min': 180,
  '5min': 300,
  '10min': 600,
  '30min': 1800
};

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Bot move generation using Claude API
async function getBotMove(fen, difficulty = 'medium') {
  try {
    const prompt = `You are a chess engine. Given the current board position in FEN notation, provide the best move in algebraic notation.

Current position (FEN): ${fen}
Difficulty: ${difficulty}

Rules:
- Respond with ONLY the move in standard algebraic notation (e.g., "e4", "Nf3", "O-O", "Qxd7+")
- For ${difficulty} difficulty, ${difficulty === 'easy' ? 'make simple, straightforward moves' : difficulty === 'medium' ? 'play solid, tactical moves' : 'play the strongest possible moves'}
- Do not include any explanation, just the move

Move:`;

    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }]
    });

    const moveText = response.content[0].text.trim();
    
    // Validate the move
    const tempChess = new Chess(fen);
    const move = tempChess.move(moveText);
    
    if (move) {
      return {
        from: move.from,
        to: move.to,
        promotion: move.promotion || 'q'
      };
    }
    
    // Fallback: get a random legal move
    const legalMoves = tempChess.moves({ verbose: true });
    if (legalMoves.length > 0) {
      const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      return {
        from: randomMove.from,
        to: randomMove.to,
        promotion: randomMove.promotion || 'q'
      };
    }
    
    return null;
  } catch (error) {
    console.error('Bot move error:', error);
    
    // Fallback: random legal move
    const tempChess = new Chess(fen);
    const legalMoves = tempChess.moves({ verbose: true });
    if (legalMoves.length > 0) {
      const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      return {
        from: randomMove.from,
        to: randomMove.to,
        promotion: randomMove.promotion || 'q'
      };
    }
    
    return null;
  }
}

// Make bot move after delay
async function makeBotMove(difficulty = 'medium') {
  if (!gameState.botMode || gameState.chess.isGameOver()) return;
  
  const currentTurn = gameState.chess.turn();
  if ((gameState.botColor === 'white' && currentTurn !== 'w') || 
      (gameState.botColor === 'black' && currentTurn !== 'b')) {
    return;
  }

  const thinkTime = BOT_SETTINGS[difficulty]?.thinkTime || 2000;
  
  setTimeout(async () => {
    try {
      const botMove = await getBotMove(gameState.chess.fen(), difficulty);
      
      if (botMove && !gameState.chess.isGameOver()) {
        const result = gameState.chess.move(botMove);
        
        if (result) {
          // Broadcast new board state
          io.emit('boardState', gameState.chess.fen());
          
          // Switch timer
          const nextTurn = gameState.chess.turn() === 'w' ? 'white' : 'black';
          if (!gameState.chess.isGameOver()) {
            startTimer(nextTurn);
          } else {
            stopTimer();
            handleGameOver();
          }
        }
      }
    } catch (error) {
      console.error('Bot move execution error:', error);
    }
  }, thinkTime);
}

function handleGameOver() {
  let gameResult = '';
  if (gameState.chess.isCheckmate()) {
    const winner = gameState.chess.turn() === 'w' ? 'Black' : 'White';
    gameResult = `Checkmate! ${winner} wins!`;
  } else if (gameState.chess.isDraw()) {
    gameResult = 'Game ended in a draw!';
  } else if (gameState.chess.isStalemate()) {
    gameResult = 'Stalemate! Game is a draw!';
  }
  
  if (gameResult) {
    io.emit('gameOver', { result: gameResult });
  }
}

// Timer functions
function startTimer(color) {
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }
  
  gameState.activeTimer = color;
  gameState.timerInterval = setInterval(() => {
    if (gameState.timers[color] > 0) {
      gameState.timers[color]--;
      
      // Emit timer update
      io.emit('timerUpdate', {
        white: formatTime(gameState.timers.white),
        black: formatTime(gameState.timers.black)
      });
      
      // Check for timeout
      if (gameState.timers[color] === 0) {
        clearInterval(gameState.timerInterval);
        const winner = color === 'white' ? 'black' : 'white';
        io.emit('timeout', { winner });
        resetGame();
      }
    }
  }, 1000);
  
  // Trigger bot move if it's bot's turn
  if (gameState.botMode && 
      ((color === 'white' && gameState.botColor === 'white') || 
       (color === 'black' && gameState.botColor === 'black'))) {
    makeBotMove('medium');
  }
}

function stopTimer() {
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = null;
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function resetGame() {
  gameState.chess = new Chess();
  gameState.timers = { white: gameState.gameTime, black: gameState.gameTime };
  stopTimer();
  gameState.activeTimer = null;
  gameState.botMode = false;
  gameState.botColor = null;
}

function updatePlayerInfo() {
  io.emit('playerUpdate', {
    white: gameState.players.white,
    black: gameState.players.black
  });
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle bot game creation
  socket.on('create-bot-game', (data) => {
    const { playerName, timeLimit, botDifficulty } = data;
    
    // Reset game state
    resetGame();
    gameState.gameTime = TIME_SETTINGS[timeLimit] || 300;
    gameState.timers = { white: gameState.gameTime, black: gameState.gameTime };
    gameState.botMode = true;
    
    // Assign player as white, bot as black
    gameState.players.white = { id: socket.id, name: playerName };
    gameState.players.black = { id: 'bot', name: `${BOT_SETTINGS[botDifficulty]?.description || 'Bot'}` };
    gameState.botColor = 'black';
    
    socket.emit('playerRole', 'w');
    socket.emit('boardState', gameState.chess.fen());
    updatePlayerInfo();
    
    // Send timer state
    socket.emit('timerUpdate', {
      white: formatTime(gameState.timers.white),
      black: formatTime(gameState.timers.black)
    });
    
    // Start timer for white (human player)
    startTimer('white');
    
    console.log(`${playerName} started bot game (${timeLimit}, ${botDifficulty})`);
  });

  // Handle player joining
  socket.on('player-join', (data) => {
    const { name: playerName, timeLimit } = data;
    
    // Set game time if specified
    if (timeLimit && TIME_SETTINGS[timeLimit]) {
      gameState.gameTime = TIME_SETTINGS[timeLimit];
      gameState.timers = { white: gameState.gameTime, black: gameState.gameTime };
    }
    
    // Assign player role
    if (!gameState.players.white) {
      gameState.players.white = { id: socket.id, name: playerName };
      socket.emit('playerRole', 'w');
      console.log(`${playerName} joined as White`);
    } else if (!gameState.players.black) {
      gameState.players.black = { id: socket.id, name: playerName };
      socket.emit('playerRole', 'b');
      console.log(`${playerName} joined as Black`);
    } else {
      // Player becomes spectator
      gameState.spectators.push({ id: socket.id, name: playerName });
      socket.emit('spectator');
      console.log(`${playerName} joined as spectator`);
    }

    // Send current game state
    socket.emit('boardState', gameState.chess.fen());
    updatePlayerInfo();
    
    // Send timer state
    socket.emit('timerUpdate', {
      white: formatTime(gameState.timers.white),
      black: formatTime(gameState.timers.black)
    });

    // Start timer if both players are present and game hasn't started
    if (gameState.players.white && gameState.players.black && !gameState.activeTimer) {
      startTimer('white');
    }
  });

  // Handle piece movement
  socket.on('movePiece', (move) => {
    try {
      // Check if it's the player's turn
      const currentTurn = gameState.chess.turn();
      const isWhitePlayer = gameState.players.white && gameState.players.white.id === socket.id;
      const isBlackPlayer = gameState.players.black && gameState.players.black.id === socket.id;
      
      if ((currentTurn === 'w' && !isWhitePlayer) || (currentTurn === 'b' && !isBlackPlayer)) {
        socket.emit('invalidMove');
        return;
      }

      // Attempt to make the move
      const result = gameState.chess.move(move);
      
      if (result) {
        // Valid move - broadcast new board state
        io.emit('boardState', gameState.chess.fen());
        
        // Switch timer
        const nextTurn = gameState.chess.turn() === 'w' ? 'white' : 'black';
        if (!gameState.chess.isGameOver()) {
          startTimer(nextTurn);
        } else {
          stopTimer();
          
          // Handle game over
          let gameResult = '';
          if (gameState.chess.isCheckmate()) {
            const winner = gameState.chess.turn() === 'w' ? 'Black' : 'White';
            gameResult = `Checkmate! ${winner} wins!`;
          } else if (gameState.chess.isDraw()) {
            gameResult = 'Game ended in a draw!';
          } else if (gameState.chess.isStalemate()) {
            gameResult = 'Stalemate! Game is a draw!';
          }
          
          if (gameResult) {
            io.emit('gameOver', { result: gameResult });
          }
        }
      } else {
        // Invalid move
        socket.emit('invalidMove');
      }
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('invalidMove');
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove player from game
    if (gameState.players.white && gameState.players.white.id === socket.id) {
      io.emit('playerLeft', { player: gameState.players.white.name });
      gameState.players.white = null;
      stopTimer();
    } else if (gameState.players.black && gameState.players.black.id === socket.id) {
      io.emit('playerLeft', { player: gameState.players.black.name });
      gameState.players.black = null;
      stopTimer();
    } else {
      // Remove from spectators
      gameState.spectators = gameState.spectators.filter(spec => spec.id !== socket.id);
    }
    
    updatePlayerInfo();
    
    // Reset game if no players left
    if (!gameState.players.white && !gameState.players.black) {
      resetGame();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess game server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
});