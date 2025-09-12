(function() {
  // Send webViewReady immediately when script loads
  function sendMessage(message) {
    window.parent.postMessage(message, '*');
  }
  
  // Notify parent immediately that web view is ready
  sendMessage({ type: 'webViewReady' });

  // DOM elements
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('status');
  const restartBtn = document.getElementById('restart');
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
  let boardCells = [];
  let gamePieces = [];
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 8;
  let cameraTheta = Math.PI / 4; // azimuth angle
  let cameraPhi = Math.PI / 3;   // polar angle

  // Initialize Three.js scene
  function initThreeJS() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 5, 15);

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

    // Add colored point lights for more dynamic lighting
    const redLight = new THREE.PointLight(0xff0000, 0.5, 8);
    redLight.position.set(3, 3, 3);
    scene.add(redLight);

    const blueLight = new THREE.PointLight(0x0000ff, 0.5, 8);
    blueLight.position.set(-3, 3, -3);
    scene.add(blueLight);

    // Raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create the game board
    createBoard();

    // Add a grid floor for better depth perception
    const gridHelper = new THREE.GridHelper(10, 10, 0x000000, 0x000000);
    gridHelper.position.y = -2;
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
    cameraDistance = Math.max(5, Math.min(15, cameraDistance));
    
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

  // Create the 3D Tic Tac Toe board with improved visuals
  function createBoard() {
    boardCells = [];
    
    // Board base - wooden table
    const boardGeometry = new THREE.BoxGeometry(8, 0.5, 8);
    const boardMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,
      roughness: 0.8,
      metalness: 0.1
    });
    const board = new THREE.Mesh(boardGeometry, boardMaterial);
    board.position.y = -0.25;
    board.receiveShadow = true;
    scene.add(board);

    // Create 9 cells
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      
      // Cell geometry
      const cellGeometry = new THREE.PlaneGeometry(1.8, 1.8);
      const cellMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xF5DEB3,
        roughness: 0.7,
        metalness: 0.2,
        transparent: true,
        opacity: 0.9
      });
      const cell = new THREE.Mesh(cellGeometry, cellMaterial);
      
      // Position the cell
      cell.position.set(
        (col - 1) * 2,
        0.26,
        (row - 1) * 2
      );
      cell.rotation.x = -Math.PI / 2;
      cell.userData = { index: i, occupied: false };
      cell.receiveShadow = true;
      
      scene.add(cell);
      boardCells.push(cell);
    }

    // Grid lines - 3D bars instead of lines
    const lineMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,
      roughness: 0.7,
      metalness: 0.3
    });
    
    // Vertical lines
    for (let i = 1; i <= 2; i++) {
      const lineGeometry = new THREE.BoxGeometry(0.2, 0.3, 6.2);
      const line = new THREE.Mesh(lineGeometry, lineMaterial);
      line.position.set((i - 1.5) * 2, 0.15, 0);
      line.receiveShadow = true;
      scene.add(line);
    }

    // Horizontal lines
    for (let i = 1; i <= 2; i++) {
      const lineGeometry = new THREE.BoxGeometry(6.2, 0.3, 0.2);
      const line = new THREE.Mesh(lineGeometry, lineMaterial);
      line.position.set(0, 0.15, (i - 1.5) * 2);
      line.receiveShadow = true;
      scene.add(line);
    }
  }

  // Create 3D X piece with improved appearance
  function createXPiece(position) {
    const group = new THREE.Group();
    
    // Create two crossed bars with better materials
    const barGeometry = new THREE.BoxGeometry(2, 0.2, 0.2);
    const xMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFF4444,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x440000
    });
    
    const bar1 = new THREE.Mesh(barGeometry, xMaterial);
    bar1.rotation.y = Math.PI / 4;
    bar1.castShadow = true;
    
    const bar2 = new THREE.Mesh(barGeometry, xMaterial);
    bar2.rotation.y = -Math.PI / 4;
    bar2.castShadow = true;
    
    group.add(bar1);
    group.add(bar2);
    group.position.copy(position);
    group.position.y = 0.5;
    
    return group;
  }

  // Create 3D O piece with improved appearance
  function createOPiece(position) {
    const group = new THREE.Group();
    
    // Create torus (ring) with better materials
    const torusGeometry = new THREE.TorusGeometry(0.7, 0.15, 16, 32);
    const oMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x4444FF,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x000044
    });
    
    const torus = new THREE.Mesh(torusGeometry, oMaterial);
    torus.rotation.x = Math.PI / 2;
    torus.castShadow = true;
    
    group.add(torus);
    group.position.copy(position);
    group.position.y = 0.5;
    
    return group;
  }

  // Animate piece placement
  function animatePiecePlacement(piece, targetX, targetZ) {
    const startY = 5;
    piece.position.y = startY;
    piece.position.x = targetX;
    piece.position.z = targetZ;
    
    let progress = 0;
    const duration = 15; // frames
    
    const animate = () => {
      if (progress < duration) {
        progress++;
        const t = progress / duration;
        
        // Quadratic ease out for smooth landing
        const easeT = t * (2 - t);
        
        // Calculate position
        const currentY = startY - (startY - 0.5) * easeT;
        
        piece.position.y = currentY;
        
        requestAnimationFrame(animate);
      } else {
        piece.position.y = 0.5;
        
        // Add a slight bounce effect at the end
        setTimeout(() => {
          piece.position.y = 0.55;
          setTimeout(() => {
            piece.position.y = 0.5;
          }, 50);
        }, 50);
      }
    };
    
    animate();
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
    const intersects = raycaster.intersectObjects(boardCells);

    if (intersects.length > 0) {
      const cell = intersects[0].object;
      if (!cell.userData.occupied) {
        const index = cell.userData.index;
        const row = Math.floor(index / 3);
        const col = index % 3;
        const position = new THREE.Vector3(
          (col - 1) * 2,
          0,
          (row - 1) * 2
        );

        // Create a temporary piece for animation
        let piece;
        if (getPlayerSymbol(currentUsername) === 'X') {
          piece = createXPiece(position);
        } else {
          piece = createOPiece(position);
        }
        
        scene.add(piece);
        animatePiecePlacement(piece, (col - 1) * 2, (row - 1) * 2);
        
        // Send move to server
        sendMessage({
          type: 'makeMove',
          data: {
            username: currentUsername,
            position: index,
            gameType: 'tictactoe'
          }
        });
      }
    }
  }

  // Update 3D scene based on game state
  function updateScene() {
    if (!gameState || !isSceneReady) return;

    // Clear existing pieces
    gamePieces.forEach(piece => {
      scene.remove(piece);
    });
    gamePieces = [];

    // Reset cell states
    boardCells.forEach(cell => {
      cell.userData.occupied = false;
      cell.material.color.setHex(0xF5DEB3);
    });

    // Add pieces based on game state
    gameState.tictactoe.forEach((cell, index) => {
      if (cell) {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const position = new THREE.Vector3(
          (col - 1) * 2,
          0,
          (row - 1) * 2
        );

        let piece;
        if (getPlayerSymbol(cell) === 'X') {
          piece = createXPiece(position);
        } else {
          piece = createOPiece(position);
        }

        scene.add(piece);
        gamePieces.push(piece);
        boardCells[index].userData.occupied = true;
        boardCells[index].material.color.setHex(0xDDDDDD);
      }
    });
  }

  // Get player symbol (X for first player, O for second)
  function getPlayerSymbol(username) {
    if (!gameState || !gameState.players) return username;
    const playerIndex = gameState.players.indexOf(username);
    return playerIndex === 0 ? 'X' : 'O';
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
      message = "Great game! Both players played well.";
      emoji = '🤝';
    } else if (winner === currentUsername) {
      modalClass = 'win-modal celebration';
      title = "🎉 Congratulations! 🎉";
      message = `You won! Excellent strategy and gameplay!`;
      emoji = '🏆';
    } else {
      modalClass = 'lose-modal';
      title = "Game Over 😔";
      message = reason === 'timeout' 
        ? `Time's up! ${winner} wins by timeout.`
        : `${winner} wins! Better luck next time.`;
      emoji = '😔';
    }
    
    modal.innerHTML = `
      <div class="modal-content ${modalClass}">
        <h2>${emoji} ${title} ${emoji}</h2>
        <p>${message}</p>
        <button onclick="this.closest('.modal').remove(); sendMessage({type: 'requestGameState'});">
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
      const turnSymbol = getPlayerSymbol(gameState.turn);
      statusElem.textContent = isMyTurn 
        ? `🎯 Your turn (${turnSymbol})` 
        : `⏳ ${gameState.turn}'s turn (${turnSymbol})`;
      
      if (isMyTurn) {
        statusElem.style.background = 'rgba(40, 167, 69, 0.95)';
        statusElem.style.color = 'white';
      } else {
        statusElem.style.background = 'rgba(255, 255, 255, 0.95)';
        statusElem.style.color = '#333';
      }
    } else if (gameState.status === 'finished') {
      const winnerSymbol = getPlayerSymbol(gameState.winner);
      statusElem.textContent = gameState.winner === currentUsername 
        ? `🏆 You won! (${winnerSymbol})` 
        : `😔 ${gameState.winner} won! (${winnerSymbol})`;
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
        const symbol = index === 0 ? 'X' : 'O';
        const isCurrent = player === currentUsername;
        return `${player} (${symbol})${isCurrent ? ' - You' : ''}`;
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
  document.addEventListener('DOMContentLoaded', () {
    sendMessage({ type: 'webViewReady' });
  });

  restartBtn.addEventListener('click', () => {
    sendMessage({ type: 'requestGameState' });
  });

  // Initialize Three.js when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThreeJS);
  } else {
    initThreeJS();
  }

  // Make sendMessage available globally for modal buttons
  window.sendMessage = sendMessage;
})();