const chessGame = new Chess();
const boardElement = document.getElementById('board');
let draggedPiece = null, sourceSquare = null, playerRole = null;
let socket = io();
let gameTimers = { white: 0, black: 0 };
let currentPlayerTurn = 'white';

function showGameModeSelection() {
  document.getElementById('loginSection').classList.remove('hidden');
  document.getElementById('multiplayerSetup').classList.add('hidden');
  document.getElementById('botSetup').classList.add('hidden');
}

function showMultiplayerSetup() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('multiplayerSetup').classList.remove('hidden');
  document.getElementById('botSetup').classList.add('hidden');
}

function showBotSetup() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('multiplayerSetup').classList.add('hidden');
  document.getElementById('botSetup').classList.remove('hidden');
}

function joinMultiplayerGame() {
  const nickname = document.getElementById('multiplayerNickname').value.trim();
  const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
  const timeLimit = document.getElementById('multiplayerTimeLimit').value;
  
  if (!nickname) return alert('Please enter a nickname');
  
  document.getElementById('multiplayerSetup').classList.add('hidden');
  document.getElementById('gameContainer').classList.remove('hidden');
  
  socket.emit('player-join', { name: nickname, timeLimit: timeLimit, roomCode: roomCode });
}

function startBotGame() {
  const nickname = document.getElementById('botNickname').value.trim();
  const timeLimit = document.getElementById('botTimeLimit').value;
  const botDifficulty = document.getElementById('botDifficulty').value;
  
  if (!nickname) return alert('Please enter a nickname');
  
  document.getElementById('botSetup').classList.add('hidden');
  document.getElementById('gameContainer').classList.remove('hidden');
  
  socket.emit('create-bot-game', { 
    playerName: nickname, 
    timeLimit: timeLimit,
    botDifficulty: botDifficulty
  });
}

function updatePlayerInfo(players) {
  // Update player names based on player role
  const topPlayerElement = document.getElementById('topPlayerInfo').querySelector('.font-bold');
  const bottomPlayerElement = document.getElementById('bottomPlayerInfo').querySelector('.font-bold');
  
  if (playerRole === 'w') {
    // White player - show black opponent at top, white self at bottom
    if (players.black) {
      topPlayerElement.innerHTML = 
        `<span class="status-indicator active"></span>${players.black.name}`;
    } else {
      topPlayerElement.innerHTML = 
        `<span class="status-indicator waiting"></span>Waiting for opponent...`;
    }
    
    if (players.white) {
      bottomPlayerElement.innerHTML = 
        `<span class="status-indicator active"></span>${players.white.name} (You)`;
    }
  } else if (playerRole === 'b') {
    // Black player - show white opponent at top, black self at bottom
    if (players.white) {
      topPlayerElement.innerHTML = 
        `<span class="status-indicator active"></span>${players.white.name}`;
    } else {
      topPlayerElement.innerHTML = 
        `<span class="status-indicator waiting"></span>Waiting for opponent...`;
    }
    
    if (players.black) {
      bottomPlayerElement.innerHTML = 
        `<span class="status-indicator active"></span>${players.black.name} (You)`;
    }
  } else {
    // Spectator or unknown role - show standard layout
    if (players.black) {
      topPlayerElement.innerHTML = 
        `<span class="status-indicator active"></span>${players.black.name}`;
    } else {
      topPlayerElement.innerHTML = 
        `<span class="status-indicator waiting"></span>Waiting for player...`;
    }
    
    if (players.white) {
      bottomPlayerElement.innerHTML = 
        `<span class="status-indicator active"></span>${players.white.name}`;
    } else {
      bottomPlayerElement.innerHTML = 
        `<span class="status-indicator waiting"></span>Waiting for player...`;
    }
  }
  
  // Update UI based on player role
  updatePlayerPositions();
}

function updatePlayerPositions() {
  const topPlayerInfo = document.getElementById('topPlayerInfo');
  const bottomPlayerInfo = document.getElementById('bottomPlayerInfo');
  const topTimer = document.getElementById('topTimer');
  const bottomTimer = document.getElementById('bottomTimer');
  
  if (playerRole === 'w') {
    // White player - show white at bottom, black at top
    topPlayerInfo.querySelector('.player-avatar').textContent = '♛';
    topPlayerInfo.querySelector('.text-sm').textContent = 'Black Pieces';
    bottomPlayerInfo.querySelector('.player-avatar').textContent = '♔';
    bottomPlayerInfo.querySelector('.text-sm').textContent = 'White Pieces (You)';
  } else if (playerRole === 'b') {
    // Black player - show black at bottom, white at top
    topPlayerInfo.querySelector('.player-avatar').textContent = '♔';
    topPlayerInfo.querySelector('.text-sm').textContent = 'White Pieces';
    bottomPlayerInfo.querySelector('.player-avatar').textContent = '♛';
    bottomPlayerInfo.querySelector('.text-sm').textContent = 'Black Pieces (You)';
  }
}

function updateTimerDisplay(timers) {
  gameTimers = timers;
  
  const topTimer = document.getElementById('topTimer');
  const bottomTimer = document.getElementById('bottomTimer');
  
  if (playerRole === 'w') {
    // White player - white timer at bottom, black timer at top
    topTimer.textContent = timers.black;
    bottomTimer.textContent = timers.white;
    updateTimerStyling(topTimer, timers.black, currentPlayerTurn === 'black');
    updateTimerStyling(bottomTimer, timers.white, currentPlayerTurn === 'white');
  } else if (playerRole === 'b') {
    // Black player - black timer at bottom, white timer at top
    topTimer.textContent = timers.white;
    bottomTimer.textContent = timers.black;
    updateTimerStyling(topTimer, timers.white, currentPlayerTurn === 'white');
    updateTimerStyling(bottomTimer, timers.black, currentPlayerTurn === 'black');
  } else {
    // Spectator - show as normal
    topTimer.textContent = timers.black;
    bottomTimer.textContent = timers.white;
    updateTimerStyling(topTimer, timers.black, currentPlayerTurn === 'black');
    updateTimerStyling(bottomTimer, timers.white, currentPlayerTurn === 'white');
  }
}

function updateTimerStyling(timerElement, time, isActive) {
  const seconds = parseInt(time.split(':')[0]) * 60 + parseInt(time.split(':')[1]);
  timerElement.classList.remove('danger', 'warning', 'active', 'inactive');
  
  if (seconds <= 30) {
    timerElement.classList.add('danger');
  } else if (seconds <= 60) {
    timerElement.classList.add('warning');
  }
  
  if (isActive) {
    timerElement.classList.add('active');
  } else {
    timerElement.classList.add('inactive');
  }
}

function setActiveTimer(color) {
  currentPlayerTurn = color;
  // Update timer display with current styling
  updateTimerDisplay(gameTimers);
}

const renderBoard = () => {
  const board = chessGame.board();
  boardElement.innerHTML = '';
  boardElement.classList.toggle('flipped', playerRole === 'b');

  board.forEach((row, rowIndex) => {
    row.forEach((square, colIndex) => {
      const sq = document.createElement('div');
      sq.className = `square ${(rowIndex + colIndex) % 2 === 0 ? 'light' : 'dark'}`;
      sq.dataset.row = rowIndex;
      sq.dataset.col = colIndex;

      if (square) {
        const piece = document.createElement('div');
        piece.className = `piece ${square.color === 'w' ? 'white' : 'black'}`;
        piece.innerText = getPieceUnicode(square);
        piece.draggable = playerRole === square.color[0];

        piece.addEventListener('dragstart', (e) => {
          if (piece.draggable) {
            draggedPiece = piece;
            sourceSquare = { row: rowIndex, col: colIndex };
            e.dataTransfer.setData('text/plain', "");
          }
        });

        piece.addEventListener('dragend', () => {
          draggedPiece = null;
          sourceSquare = null;
        });

        sq.appendChild(piece);
      }

      sq.addEventListener('dragover', e => e.preventDefault());
      sq.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedPiece) return;
        const targetSquare = { 
          row: parseInt(sq.dataset.row), 
          col: parseInt(sq.dataset.col) 
        };
        const move = {
          from: `${String.fromCharCode(97 + sourceSquare.col)}${8 - sourceSquare.row}`,
          to: `${String.fromCharCode(97 + targetSquare.col)}${8 - targetSquare.row}`,
          promotion: 'q'
        };
        socket.emit('movePiece', move);
      });

      boardElement.appendChild(sq);
    });
  });
};

const getPieceUnicode = (piece) => {
  const map = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
  };
  const char = piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase();
  return map[char] || '';
};

// Socket event listeners
socket.on("playerRole", (role) => { 
  playerRole = role; 
  document.getElementById('roleDisplay').textContent = 
    `You are playing as ${role === 'w' ? 'White' : 'Black'}`;
  updatePlayerPositions();
  renderBoard(); 
});

socket.on("spectator", () => { 
  playerRole = 'spectator'; 
  document.getElementById('roleDisplay').textContent = 'You are spectating';
  updatePlayerPositions();
  renderBoard(); 
});

socket.on("boardState", fen => { 
  chessGame.load(fen); 
  renderBoard(); 
  const turn = chessGame.turn() === 'w' ? 'white' : 'black';
  currentPlayerTurn = turn;
  document.getElementById('currentTurn').textContent = `${turn.charAt(0).toUpperCase() + turn.slice(1)}'s turn`;
  setActiveTimer(turn);
});

socket.on("timerUpdate", (timers) => {
  updateTimerDisplay(timers);
});

socket.on("timeout", ({ winner }) => {
  document.getElementById('gameResult').textContent = 
    `Time's up! ${winner === 'white' ? 'White' : 'Black'} wins!`;
  document.getElementById('gameOverModal').classList.remove('hidden');
});

socket.on("gameOver", ({ result }) => {
  document.getElementById('gameResult').textContent = result;
  document.getElementById('gameOverModal').classList.remove('hidden');
});

socket.on("invalidMove", () => alert("Invalid move!"));
socket.on("playerLeft", data => alert(`${data.player} has left the game.`));
socket.on("playerUpdate", updatePlayerInfo);

socket.on("roomCreated", ({ roomCode }) => {
  document.getElementById('roomCodeDisplay').textContent = `Room Code: ${roomCode}`;
  document.getElementById('gameStatus').textContent = 'Waiting for opponent to join...';
});

socket.on("roomJoined", ({ roomCode }) => {
  document.getElementById('roomCodeDisplay').textContent = `Room Code: ${roomCode}`;
  document.getElementById('gameStatus').textContent = 'Game starting...';
});

socket.on("roomNotFound", () => {
  alert('Room not found! Please check the room code.');
  document.getElementById('gameContainer').classList.add('hidden');
  document.getElementById('multiplayerSetup').classList.remove('hidden');
});

socket.on("roomFull", () => {
  alert('This room is full! Please try another room or create a new one.');
  document.getElementById('gameContainer').classList.add('hidden');
  document.getElementById('multiplayerSetup').classList.remove('hidden');
});

// Initialize timers
updateTimerDisplay({ white: '05:00', black: '05:00' });

// Make functions available globally
window.showGameModeSelection = showGameModeSelection;
window.showMultiplayerSetup = showMultiplayerSetup;
window.showBotSetup = showBotSetup;
window.joinMultiplayerGame = joinMultiplayerGame;
window.startBotGame = startBotGame;