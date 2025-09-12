(function() {
  // Get element references.
  const gameScreen = document.getElementById('gameScreen');
  const gameMenu = document.getElementById('gameMenu');
  const gameContainer = document.getElementById('gameContainer');

  // Get buttons.
  const btnTictactoe = document.getElementById('btn-tictactoe');
  const btnGomoku = document.getElementById('btn-gomoku');
  const btnDots = document.getElementById('btn-dots');
  const btnConnect4 = document.getElementById('btn-connect4');

  // Local state for the game.
  let gameState = null;

  // Function to send messages to the parent Devvit app.
  function sendMessage(message) {
    window.parent.postMessage(message, '*');
  }

  // Render the game based on current gameState.
  function renderGame() {
    if (!gameState) return;
    // Clear previous content.
    gameContainer.innerHTML = '';

    switch (gameState.currentGame) {
      case 'tictactoe':
        renderTicTacToe();
        break;
      case 'gomoku':
        gameContainer.innerHTML = '<p>Gomoku rendering not implemented yet.</p>';
        break;
      case 'dots':
        gameContainer.innerHTML = '<p>Dots & Boxes rendering not implemented yet.</p>';
        break;
      case 'connect4':
        gameContainer.innerHTML = '<p>Connect Four rendering not implemented yet.</p>';
        break;
      default:
        gameContainer.innerHTML = '<p>Unknown game type.</p>';
    }
  }

  // Render a Tic Tac Toe grid.
  function renderTicTacToe() {
    if (!Array.isArray(gameState.tictactoe)) return;
    const grid = document.createElement('div');
    grid.className = 'grid grid-3x3';
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';

    gameState.tictactoe.forEach((cell, index) => {
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      cellEl.textContent = cell || '';
      cellEl.setAttribute('data-index', index);
      cellEl.addEventListener('click', () => handleMove(index));
      grid.appendChild(cellEl);
    });
    gameContainer.appendChild(grid);
  }

  // Update local state when a new game state is received.
  function handleGameState(newState) {
    // console.log('Received game state:', newState);
    if (!newState) return;
    gameState = newState;
    renderGame();
  }

  // Send a move message when a cell is clicked.
  function handleMove(position) {
    if (!gameState || !gameState.currentGame) return;
    sendMessage({
      type: 'gameAction',
      data: {
        type: 'move',
        game: gameState.currentGame,
        position: position
      }
    });
  }

  // Attach event listeners to game selection buttons.
  btnTictactoe.addEventListener('click', () => {
    sendMessage({
      type: 'gameAction',
      data: { type: 'changeGame', game: 'tictactoe' }
    });
  });
  btnGomoku.addEventListener('click', () => {
    sendMessage({
      type: 'gameAction',
      data: { type: 'changeGame', game: 'gomoku' }
    });
  });
  btnDots.addEventListener('click', () => {
    sendMessage({
      type: 'gameAction',
      data: { type: 'changeGame', game: 'dots' }
    });
  });
  btnConnect4.addEventListener('click', () => {
    sendMessage({
      type: 'gameAction',
      data: { type: 'changeGame', game: 'connect4' }
    });
  });

  // Listen for messages from the parent Devvit app.
  window.addEventListener('message', (event) => {
    // console.log('Received message:', event.data);
    if (event.data && event.data.type === 'gameState') {
      handleGameState(event.data.data);
    }
  });

  // On load, notify parent that web view is ready and request initial state.
  window.addEventListener('load', () => {
    sendMessage({ type: 'webViewReady' });
    sendMessage({ type: 'requestState' });
  });
})();
