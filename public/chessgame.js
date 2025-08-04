const chessGame = new Chess();
const boardElement = document.getElementById('board');
let draggedPiece = null, sourceSquare = null, playerRole = null;
let socket = io();

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
  const timeLimit = document.getElementById('multiplayerTimeLimit').value;
  
  if (!nickname) return alert('Please enter a nickname');
  
  document.getElementById('multiplayerSetup').classList.add('hidden');
  document.getElementById('gameContainer').classList.remove('hidden');
  
  socket.emit('player-join', { name: nickname, timeLimit: timeLimit });
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
  if (players.white) {
    document.getElementById('whitePlayerName').innerHTML = 
      `<span class="status-indicator active"></span>${players.white.name}`;
  } else {
    document.getElementById('whitePlayerName').innerHTML = 
      `<span class="status-indicator waiting"></span>Waiting for player...`;
  }
  
  if (players.black) {
    document.getElementById('blackPlayerName').innerHTML = 
      `<span class="status-indicator active"></span>${players.black.name}`;
  } else {
    document.getElementById('blackPlayerName').innerHTML = 
      `<span class="status-indicator waiting"></span>Waiting for player...`;
  }
}

function updateTimerDisplay(color, time) {
  const timerElement = document.getElementById(`${color}Timer`);
  timerElement.textContent = time;
  
  // Update timer styling based on remaining time
  const seconds = parseInt(time.split(':')[0]) * 60 + parseInt(time.split(':')[1]);
  timerElement.classList.remove('danger', 'warning', 'active', 'inactive');
  
  if (seconds <= 30) {
    timerElement.classList.add('danger');
  } else if (seconds <= 60) {
    timerElement.classList.add('warning');
  }
}

function setActiveTimer(color) {
  document.getElementById('whiteTimer').classList.toggle('active', color === 'white');
  document.getElementById('whiteTimer').classList.toggle('inactive', color !== 'white');
  document.getElementById('blackTimer').classList.toggle('active', color === 'black');
  document.getElementById('blackTimer').classList.toggle('inactive', color !== 'black');
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
  renderBoard(); 
});

socket.on("spectator", () => { 
  playerRole = 'spectator'; 
  document.getElementById('roleDisplay').textContent = 'You are spectating';
  renderBoard(); 
});

socket.on("boardState", fen => { 
  chessGame.load(fen); 
  renderBoard(); 
  const turn = chessGame.turn() === 'w' ? 'white' : 'black';
  document.getElementById('currentTurn').textContent = `${turn.charAt(0).toUpperCase() + turn.slice(1)}'s turn`;
  setActiveTimer(turn);
});

socket.on("timerUpdate", ({ white, black }) => {
  updateTimerDisplay('white', white);
  updateTimerDisplay('black', black);
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

// Initialize timers
updateTimerDisplay('white', '05:00');
updateTimerDisplay('black', '05:00');

// Make functions available globally
window.showGameModeSelection = showGameModeSelection;
window.showMultiplayerSetup = showMultiplayerSetup;
window.showBotSetup = showBotSetup;
window.joinMultiplayerGame = joinMultiplayerGame;
window.startBotGame = startBotGame;