(function() {
  // Send webViewReady immediately when script loads
  function sendMessage(message) {
    window.parent.postMessage(message, '*');
  }
  
  // Notify parent immediately that web view is ready
  sendMessage({ type: 'webViewReady' });

  // DOM elements
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('chessStatus');
  const restartBtn = document.getElementById('restartChess');
  const playersElem = document.getElementById('players-info');
  const timerElem = document.getElementById('timer');
  const loadingElem = document.getElementById('loading');

  // Game state
  let gameState = null;
  let currentUsername = null;
  let gameActive = false;
  let refreshInterval = null;
  let timerInterval = null;

  // Three.js variables
  let scene, camera, renderer, raycaster, mouse;
  let boardSquares = [];
  let chessPieces = [];
  let selectedPiece = null;
  let possibleMoves = [];
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 15;
  let cameraTheta = Math.PI / 4; // azimuth angle
  let cameraPhi = Math.PI / 3;   // polar angle

  // Chess piece models (simplified 3D representations)
  const pieceModels = {};

  // Initialize Three.js scene
  function initThreeJS() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // Camera setup
    camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    updateCameraPosition();

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Add a subtle fill light from the opposite side
    const fillLight = new THREE.DirectionalLight(0x7777ff, 0.3);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    // Raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create piece models
    createPieceModels();

    // Create the game board
    createBoard();

    // Add a subtle grid floor for better depth perception
    const gridHelper = new THREE.GridHelper(20, 20, 0x000000, 0x000000);
    gridHelper.position.y = -0.5;
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Event listeners
    canvas.addEventListener('mousedown', onMouseDown, false);
    canvas.addEventListener('mousemove', onMouseMove, false);
    canvas.addEventListener('mouseup', onMouseUp, false);
    canvas.addEventListener('wheel', onMouseWheel, false);
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, false);
    window.addEventListener('resize', onWindowResize);

    // Start render loop
    animate();

    // Hide loading indicator
    loadingElem.style.display = 'none';
    isSceneReady = true;
  }

  // Update camera position based on spherical coordinates
  function updateCameraPosition() {
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  // Mouse event handlers for camera control
  function onMouseDown(event) {
    isDragging = true;
    previousMousePosition = {
      x: event.clientX,
      y: event.clientY
    };
  }

  function onMouseMove(event) {
    if (!isDragging) return;
    
    const deltaX = event.clientX - previousMousePosition.x;
    const deltaY = event.clientY - previousMousePosition.y;
    
    previousMousePosition = {
      x: event.clientX,
      y: event.clientY
    };
    
    // Adjust rotation speed
    cameraTheta += deltaX * 0.01;
    cameraPhi += deltaY * 0.01;
    
    // Constrain phi to avoid flipping
    cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
    
    updateCameraPosition();
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onMouseWheel(event) {
    event.preventDefault();
    
    // Adjust zoom speed
    cameraDistance += event.deltaY * 0.01;
    
    // Constrain zoom distance
    cameraDistance = Math.max(8, Math.min(25, cameraDistance));
    
    updateCameraPosition();
  }

  // Touch event handlers for mobile
  function onTouchStart(event) {
    if (event.touches.length === 1) {
      isDragging = true;
      previousMousePosition = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      };
    }
    event.preventDefault();
  }

  function onTouchMove(event) {
    if (!isDragging || event.touches.length !== 1) return;
    
    const deltaX = event.touches[0].clientX - previousMousePosition.x;
    const deltaY = event.touches[0].clientY - previousMousePosition.y;
    
    previousMousePosition = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY
    };
    
    cameraTheta += deltaX * 0.01;
    cameraPhi += deltaY * 0.01;
    
    // Constrain phi to avoid flipping
    cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
    
    updateCameraPosition();
    event.preventDefault();
  }

  function onTouchEnd() {
    isDragging = false;
  }

  // Create simplified 3D models for chess pieces with improved visuals
  function createPieceModels() {
    const whiteMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xf5f5f5,
      roughness: 0.7,
      metalness: 0.2
    });
    
    const blackMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x222222,
      roughness: 0.8,
      metalness: 0.3
    });

    // Pawn
    pieceModels.pawn = (color) => {
      const group = new THREE.Group();
      const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 16);
      const headGeometry = new THREE.SphereGeometry(0.25, 16, 12);
      const material = color === 'white' ? whiteMaterial : blackMaterial;
      
      const body = new THREE.Mesh(bodyGeometry, material);
      const head = new THREE.Mesh(headGeometry, material);
      head.position.y = 0.5;
      
      body.castShadow = true;
      head.castShadow = true;
      
      group.add(body);
      group.add(head);
      return group;
    };

    // Rook
    pieceModels.rook = (color) => {
      const group = new THREE.Group();
      const baseGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.8, 16);
      const topGeometry = new THREE.CylinderGeometry(0.25, 0.3, 0.2, 16);
      const material = color === 'white' ? whiteMaterial : blackMaterial;
      
      const base = new THREE.Mesh(baseGeometry, material);
      const top = new THREE.Mesh(topGeometry, material);
      top.position.y = 0.5;
      
      base.castShadow = true;
      top.castShadow = true;
      
      group.add(base);
      group.add(top);
      return group;
    };

    // Knight
    pieceModels.knight = (color) => {
      const group = new THREE.Group();
      const bodyGeometry = new THREE.CylinderGeometry(0.25, 0.3, 0.7, 16);
      const headGeometry = new THREE.ConeGeometry(0.25, 0.5, 16);
      const material = color === 'white' ? whiteMaterial : blackMaterial;
      
      const body = new THREE.Mesh(bodyGeometry, material);
      const head = new THREE.Mesh(headGeometry, material);
      head.position.y = 0.6;
      head.rotation.x = Math.PI;
      
      body.castShadow = true;
      head.castShadow = true;
      
      group.add(body);
      group.add(head);
      return group;
    };

    // Bishop
    pieceModels.bishop = (color) => {
      const group = new THREE.Group();
      const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.3, 0.8, 16);
      const topGeometry = new THREE.ConeGeometry(0.15, 0.4, 16);
      const material = color === 'white' ? whiteMaterial : blackMaterial;
      
      const body = new THREE.Mesh(bodyGeometry, material);
      const top = new THREE.Mesh(topGeometry, material);
      top.position.y = 0.6;
      
      body.castShadow = true;
      top.castShadow = true;
      
      group.add(body);
      group.add(top);
      return group;
    };

    // Queen
    pieceModels.queen = (color) => {
      const group = new THREE.Group();
      const bodyGeometry = new THREE.CylinderGeometry(0.25, 0.35, 0.9, 16);
      const crownGeometry = new THREE.SphereGeometry(0.3, 16, 16);
      const material = color === 'white' ? whiteMaterial : blackMaterial;
      
      const body = new THREE.Mesh(bodyGeometry, material);
      const crown = new THREE.Mesh(crownGeometry, material);
      crown.position.y = 0.7;
      crown.scale.set(1, 0.7, 1);
      
      body.castShadow = true;
      crown.castShadow = true;
      
      group.add(body);
      group.add(crown);
      return group;
    };

    // King
    pieceModels.king = (color) => {
      const group = new THREE.Group();
      const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.4, 1.0, 16);
      const crossGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
      const material = color === 'white' ? whiteMaterial : blackMaterial;
      
      const body = new THREE.Mesh(bodyGeometry, material);
      const cross = new THREE.Mesh(crossGeometry, material);
      cross.position.y = 0.8;
      cross.rotation.z = Math.PI / 4;
      
      body.castShadow = true;
      cross.castShadow = true;
      
      group.add(body);
      group.add(cross);
      return group;
    };
  }

  // Create the 3D chess board with improved visuals
  function createBoard() {
    boardSquares = [];
    
    // Create 64 squares
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const isLight = (row + col) % 2 === 0;
        const squareGeometry = new THREE.BoxGeometry(1, 0.1, 1);
        const squareMaterial = new THREE.MeshStandardMaterial({ 
          color: isLight ? 0xf0d9b5 : 0xb58863,
          roughness: 0.8,
          metalness: 0.1
        });
        const square = new THREE.Mesh(squareGeometry, squareMaterial);
        
        square.position.set(
          col - 3.5,
          -0.05,
          row - 3.5
        );
        square.receiveShadow = true;
        square.userData = { row: row, col: col, isLight: isLight };
        
        scene.add(square);
        boardSquares.push(square);
      }
    }

    // Board border/frame
    const borderGeometry = new THREE.BoxGeometry(9, 0.5, 9);
    const borderMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8b4513,
      roughness: 0.9,
      metalness: 0.1
    });
    const border = new THREE.Mesh(borderGeometry, borderMaterial);
    border.position.set(0, -0.3, 0);
    border.receiveShadow = true;
    scene.add(border);
  }

  // Create a 3D chess piece
  function createChessPiece(pieceType, color, position) {
    const piece = pieceModels[pieceType.toLowerCase()](color);
    piece.position.copy(position);
    piece.position.y = 0.5;
    piece.userData = { type: pieceType, color: color };
    piece.castShadow = true;
    return piece;
  }

  // Handle canvas click
  function onCanvasClick(event) {
    handleInteraction(event.clientX, event.clientY);
  }

  // Handle canvas touch
  function onCanvasTouch(event) {
    event.preventDefault();
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      handleInteraction(touch.clientX, touch.clientY);
    }
  }

  // Handle interaction (click or touch)
  function handleInteraction(clientX, clientY) {
    if (!gameState || !gameActive || gameState.status !== 'active' || !isSceneReady) return;
    if (gameState.turn !== currentUsername) return;

    // Calculate mouse position in normalized device coordinates
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast
    raycaster.setFromCamera(mouse, camera);
    
    // Check for piece selection first
    const pieceIntersects = raycaster.intersectObjects(chessPieces, true);
    if (pieceIntersects.length > 0) {
      const clickedPiece = pieceIntersects[0].object.parent || pieceIntersects[0].object;
      const playerColor = getPlayerColor(currentUsername);
      
      if (clickedPiece.userData.color === playerColor) {
        selectPiece(clickedPiece);
        return;
      }
    }

    // Check for square selection (move destination)
    const squareIntersects = raycaster.intersectObjects(boardSquares);
    if (squareIntersects.length > 0 && selectedPiece) {
      const square = squareIntersects[0].object;
      const fromRow = Math.floor(selectedPiece.position.z + 3.5);
      const fromCol = Math.floor(selectedPiece.position.x + 3.5);
      const toRow = square.userData.row;
      const toCol = square.userData.col;
      
      makeMove(fromRow, fromCol, toRow, toCol);
    }
  }

  // Select a piece
  function selectPiece(piece) {
    // Clear previous selection
    clearSelection();
    
    selectedPiece = piece;
    
    // Highlight selected piece
    piece.position.y = 0.7;
    
    // Show possible moves (simplified - just highlight squares)
    highlightPossibleMoves(piece);
  }

  // Clear selection
  function clearSelection() {
    if (selectedPiece) {
      selectedPiece.position.y = 0.5;
      selectedPiece = null;
    }
    
    // Reset square colors
    boardSquares.forEach(square => {
      const isLight = square.userData.isLight;
      square.material.color.setHex(isLight ? 0xf0d9b5 : 0xb58863);
    });
  }

  // Highlight possible moves (simplified)
  function highlightPossibleMoves(piece) {
    // This is a simplified version - in a real implementation,
    // you would calculate legal moves based on chess rules
    boardSquares.forEach(square => {
      if (Math.random() < 0.3) { // Random highlighting for demo
        square.material.color.setHex(0x90EE90);
      }
    });
  }

  // Make a move
  function makeMove(fromRow, fromCol, toRow, toCol) {
    const from = positionToNotation(fromRow, fromCol);
    const to = positionToNotation(toRow, toCol);
    
    // Create updated board state (simplified)
    const newBoard = JSON.parse(JSON.stringify(gameState.chess.board));
    newBoard[toRow][toCol] = newBoard[fromRow][fromCol];
    newBoard[fromRow][fromCol] = null;
    
    // Send move to server
    sendMessage({
      type: 'makeMove',
      data: {
        username: currentUsername,
        position: { 
          from, 
          to, 
          board: newBoard
        },
        gameType: 'chess'
      }
    });
    
    clearSelection();
  }

  // Convert board position to chess notation
  function positionToNotation(row, col) {
    const files = 'abcdefgh';
    const ranks = '87654321';
    return files[col] + ranks[row];
  }

  // Get player color (white for first player, black for second)
  function getPlayerColor(username) {
    if (!gameState || !gameState.players) return 'white';
    const playerIndex = gameState.players.indexOf(username);
    return playerIndex === 0 ? 'white' : 'black';
  }

  // Update 3D scene based on game state
  function updateScene() {
    if (!gameState || !gameState.chess || !isSceneReady) return;

    // Clear existing pieces
    chessPieces.forEach(piece => {
      scene.remove(piece);
    });
    chessPieces = [];

    // Add pieces based on game state
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = gameState.chess.board[row][col];
        if (piece) {
          const position = new THREE.Vector3(
            col - 3.5,
            0,
            row - 3.5
          );
          
          const color = piece === piece.toUpperCase() ? 'white' : 'black';
          const pieceType = getPieceType(piece.toLowerCase());
          
          const chessPiece = createChessPiece(pieceType, color, position);
          scene.add(chessPiece);
          chessPieces.push(chessPiece);
        }
      }
    }
  }

  // Get piece type from chess notation
  function getPieceType(piece) {
    const types = {
      'p': 'pawn',
      'r': 'rook',
      'n': 'knight',
      'b': 'bishop',
      'q': 'queen',
      'k': 'king'
    };
    return types[piece] || 'pawn';
  }

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    
    if (isSceneReady) {
      renderer.render(scene, camera);
    }
  }

  // Handle window resize
  function onWindowResize() {
    if (!isSceneReady) return;
    
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  // Auto-refresh game state every 3 seconds
  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      if (gameActive && gameState && gameState.status === 'active') {
        sendMessage({ type: 'requestGameState' });
        sendMessage({ type: 'checkTurnTimer' });
      }
    }, 3000);
  }

  // Start turn timer
  function startTurnTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      sendMessage({ type: 'checkTurnTimer' });
    }, 1000);
  }

  // Show win/loss modal
  function showGameEndModal(winner, isDraw, reason) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    let modalClass = '';
    let title = '';
    let message = '';
    let emoji = '';
    
    if (isDraw) {
      modalClass = 'draw-modal';
      title = "It's a Draw! 🤝";
      if (reason === 'stalemate') {
        message = "Stalemate! No legal moves available.";
      } else if (reason === 'insufficient') {
        message = "Draw by insufficient material.";
      } else if (reason === 'repetition') {
        message = "Draw by threefold repetition.";
      } else if (reason === 'fifty-move') {
        message = "Draw by fifty-move rule.";
      } else {
        message = "Great game! Well played by both sides.";
      }
      emoji = '🤝';
    } else if (winner === currentUsername) {
      modalClass = 'win-modal celebration';
      title = "🎉 Congratulations! 🎉";
      if (reason === 'checkmate') {
        message = `Checkmate! You are the chess master!`;
      } else if (reason === 'timeout') {
        message = `You win by timeout! Well played!`;
      } else {
        message = `Victory! Excellent chess skills!`;
      }
      emoji = '♛';
    } else {
      modalClass = 'lose-modal';
      title = "Game Over 😔";
      if (reason === 'timeout') {
        message = `Time's up! ${winner} wins by timeout.`;
      } else if (reason === 'checkmate') {
        message = `Checkmate! ${winner} wins! Better luck next time.`;
      } else {
        message = `${winner} wins! Keep practicing your chess skills.`;
      }
      emoji = '😔';
    }
    
    modal.innerHTML = `
      <div class="modal-content ${modalClass}">
        <h2>${emoji} ${title} ${emoji}</h2>
        <p>${message}</p>
        <button onclick="this.closest('.modal').remove(); sendMessage({type: 'restartGame'});">
          Play Again
        </button>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (modal.parentNode) {
        modal.remove();
      }
    }, 5000);
  }

  // Update game status display
  function updateStatus() {
    if (!gameState) {
      statusElem.textContent = 'Loading...';
      statusElem.className = 'status-display-3d';
      return;
    }

    statusElem.className = 'status-display-3d';

    if (gameState.status === 'waiting') {
      statusElem.textContent = `⏳ Waiting for players... (${gameState.players.length}/${gameState.maxPlayers})`;
    } else if (gameState.status === 'active') {
      const isMyTurn = gameState.turn === currentUsername;
      const turnColor = getPlayerColor(gameState.turn);
      const colorEmoji = turnColor === 'white' ? '⚪' : '⚫';
      
      statusElem.textContent = isMyTurn 
        ? `🎯 Your turn - Make your move! (${colorEmoji})` 
        : `⏳ ${gameState.turn}'s turn (${colorEmoji})`;
      
      if (isMyTurn) {
        statusElem.style.background = 'rgba(40, 167, 69, 0.95)';
        statusElem.style.color = 'white';
      } else {
        statusElem.style.background = 'rgba(255, 255, 255, 0.95)';
        statusElem.style.color = '#333';
      }
    } else if (gameState.status === 'finished') {
      const winnerColor = getPlayerColor(gameState.winner);
      const colorEmoji = winnerColor === 'white' ? '⚪' : '⚫';
      statusElem.textContent = gameState.winner === currentUsername 
        ? `♛ Checkmate! You won! (${colorEmoji})` 
        : `😔 Checkmate! ${gameState.winner} won! (${colorEmoji})`;
      statusElem.style.background = gameState.winner === currentUsername 
        ? 'rgba(40, 167, 69, 0.95)'
        : 'rgba(220, 53, 69, 0.95)';
      statusElem.style.color = 'white';
    } else if (gameState.status === 'draw') {
      statusElem.textContent = "🤝 It's a draw!";
      statusElem.style.background = 'rgba(255, 193, 7, 0.95)';
      statusElem.style.color = '#333';
    }
  }

  // Update timer display
  function updateTimer(timeRemaining, currentTurn) {
    if (!timerElem) return;
    
    if (gameState && gameState.status === 'active' && gameState.players.length >= 2 && gameState.firstMoveMade) {
      timerElem.style.display = 'block';
      timerElem.className = 'timer-display-3d';
      timerElem.textContent = `⏰ ${timeRemaining}s - ${currentTurn}'s turn`;
      
      if (timeRemaining <= 10) {
        timerElem.style.background = 'rgba(220, 53, 69, 0.95)';
      } else {
        timerElem.style.background = 'rgba(255, 107, 107, 0.95)';
      }
    } else {
      timerElem.style.display = 'none';
    }
  }

  // Update players info
  function updatePlayersInfo() {
    if (!gameState || !playersElem) return;
    
    playersElem.className = 'status-display-3d';
    
    if (gameState.players.length === 0) {
      playersElem.textContent = '👥 No players yet';
    } else {
      const playersList = gameState.players.map((player, index) => {
        const color = index === 0 ? 'White' : 'Black';
        const emoji = index === 0 ? '⚪' : '⚫';
        const isCurrent = player === currentUsername;
        return `${player} (${emoji} ${color})${isCurrent ? ' - You' : ''}`;
      }).join(', ');
      playersElem.textContent = `👥 Players: ${playersList}`;
    }
  }

  // Handle messages from parent
  function handleMessage(event) {
    let message = event.data;
    if (message.type === 'devvit-message' && message.data && message.data.message) {
      message = message.data.message;
    }
    
    switch (message.type) {
      case 'initialData':
        currentUsername = message.data.username;
        sendMessage({ type: 'initializeGame' });
        sendMessage({ type: 'requestGameState' });
        break;

      case 'gameState':
        gameState = message.data;
        gameActive = gameState.status === 'active';
        updateScene();
        updateStatus();
        updatePlayersInfo();
        
        if (!gameState.players.includes(currentUsername)) {
          sendMessage({
            type: 'joinGame',
            data: { username: currentUsername }
          });
          sendMessage({ type: 'requestGameState' });
        } else if (gameActive) {
          startAutoRefresh();
          startTurnTimer();
        }
        break;

      case 'playerJoined':
        if (message.data.gameState) {
          gameState = message.data.gameState;
          gameActive = gameState.status === 'active';
          updateScene();
          updateStatus();
          updatePlayersInfo();
          
          if (gameActive && gameState.players.includes(currentUsername)) {
            startAutoRefresh();
            startTurnTimer();
          }
        }
        break;

      case 'gameStarted':
        gameActive = true;
        if (message.data.gameState) {
          gameState = message.data.gameState;
          updateScene();
          updateStatus();
          updatePlayersInfo();
        }
        
        if (gameActive && gameState && gameState.players.includes(currentUsername)) {
          startAutoRefresh();
          startTurnTimer();
        }
        break;

      case 'gameUpdate':
      case 'moveMade':
        if (message.data.gameState || message.data) {
          gameState = message.data.gameState || message.data;
          gameActive = gameState.status === 'active';
          updateScene();
          updateStatus();
          updatePlayersInfo();
        }
        break;

      case 'turnChanged':
        updateStatus();
        break;

      case 'timerUpdate':
        updateTimer(message.data.timeRemaining, message.data.currentTurn);
        break;

      case 'gameEnded':
        gameActive = false;
        if (refreshInterval) clearInterval(refreshInterval);
        if (timerInterval) clearInterval(timerInterval);
        
        if (message.data.finalState) {
          gameState = message.data.finalState;
          updateScene();
          updateStatus();
          updatePlayersInfo();
        }
        
        setTimeout(() => {
          showGameEndModal(message.data.winner, message.data.isDraw, message.data.reason);
        }, 500);
        break;

      case 'error':
        statusElem.textContent = `❌ Error: ${message.message}`;
        statusElem.className = 'status-display-3d';
        statusElem.style.background = 'rgba(220, 53, 69, 0.95)';
        statusElem.style.color = 'white';
        break;
    }
  }

  // Add event listeners
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => {
    sendMessage({ type: 'webViewReady' });
  });

  restartBtn.addEventListener('click', () => {
    sendMessage({ type: 'restartGame' });
  });

  // Initialize Three.js when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThreeJS);
  } else {
    initThreeJS();
  }

  window.sendMessage = sendMessage;
})();