(function() {
  // Send webViewReady immediately when script loads
  function sendMessage(message) {
    window.parent.postMessage(message, '*');
  }
  
  // Notify parent immediately that web view is ready
  sendMessage({ type: 'webViewReady' });

  // DOM elements
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('gomokuStatus');
  const restartBtn = document.getElementById('gomokuRestart');
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
  let boardIntersections = [];
  let gameStones = [];
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 20;
  let cameraTheta = Math.PI / 4; // azimuth angle
  let cameraPhi = Math.PI / 3;   // polar angle

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

    // Create the game board
    createBoard();

    // Add a subtle grid floor for better depth perception
    const gridHelper = new THREE.GridHelper(20, 20, 0x000000, 0x000000);
    gridHelper.position.y = -4;
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
    cameraDistance = Math.max(10, Math.min(30, cameraDistance));
    
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

  // Create the 3D Gomoku board with improved visuals
  function createBoard() {
    boardIntersections = [];
    
    // Board base - wooden table
    const boardGeometry = new THREE.BoxGeometry(18, 1, 18);
    const boardMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,
      roughness: 0.8,
      metalness: 0.1
    });
    const board = new THREE.Mesh(boardGeometry, boardMaterial);
    board.position.y = -0.5;
    board.receiveShadow = true;
    scene.add(board);

    // Game board surface
    const surfaceGeometry = new THREE.PlaneGeometry(16, 16);
    const surfaceMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xD2B48C,
      roughness: 0.7,
      metalness: 0.1
    });
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.01;
    surface.receiveShadow = true;
    scene.add(surface);

    // Create grid lines with improved appearance
    const lineMaterial = new THREE.LineBasicMaterial({ 
      color: 0x8B4513, 
      linewidth: 2 
    });
    
    // Vertical lines
    for (let i = 0; i < 15; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3((i - 7) * 1, 0.02, -7),
        new THREE.Vector3((i - 7) * 1, 0.02, 7)
      ]);
      const line = new THREE.Line(geometry, lineMaterial);
      scene.add(line);
    }

    // Horizontal lines
    for (let i = 0; i < 15; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-7, 0.02, (i - 7) * 1),
        new THREE.Vector3(7, 0.02, (i - 7) * 1)
      ]);
      const line = new THREE.Line(geometry, lineMaterial);
      scene.add(line);
    }

    // Create invisible intersection points for raycasting
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        const intersectionGeometry = new THREE.PlaneGeometry(0.8, 0.8);
        const intersectionMaterial = new THREE.MeshBasicMaterial({ 
          transparent: true, 
          opacity: 0,
          side: THREE.DoubleSide
        });
        const intersection = new THREE.Mesh(intersectionGeometry, intersectionMaterial);
        
        intersection.position.set(
          (x - 7) * 1,
          0.03,
          (y - 7) * 1
        );
        intersection.rotation.x = -Math.PI / 2;
        intersection.userData = { x: x, y: y, occupied: false };
        
        scene.add(intersection);
        boardIntersections.push(intersection);
      }
    }

    // Add star points (traditional Gomoku board markers) with improved appearance
    const starGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    const starMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,
      roughness: 0.3,
      metalness: 0.7
    });
    
    const starPositions = [
      [3, 3], [3, 11], [11, 3], [11, 11], [7, 7]
    ];
    
    starPositions.forEach(([x, y]) => {
      const star = new THREE.Mesh(starGeometry, starMaterial);
      star.position.set((x - 7) * 1, 0.03, (y - 7) * 1);
      scene.add(star);
    });
  }

  // Create 3D black stone with improved appearance
  function createBlackStone(position) {
    const stoneGeometry = new THREE.SphereGeometry(0.4, 32, 32);
    const stoneMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x111111,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x111111
    });
    const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
    
    stone.position.copy(position);
    stone.position.y = 0.4;
    stone.castShadow = true;
    stone.receiveShadow = true;
    
    return stone;
  }

  // Create 3D white stone with improved appearance
  function createWhiteStone(position) {
    const stoneGeometry = new THREE.SphereGeometry(0.4, 32, 32);
    const stoneMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xF5F5F5,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x222222
    });
    const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
    
    stone.position.copy(position);
    stone.position.y = 0.4;
    stone.castShadow = true;
    stone.receiveShadow = true;
    
    return stone;
  }

  // Animate stone placement
  function animateStonePlacement(stone, targetX, targetZ) {
    const startY = 10;
    stone.position.y = startY;
    stone.position.x = targetX;
    stone.position.z = targetZ;
    
    let progress = 0;
    const duration = 20; // frames
    
    const animate = () => {
      if (progress < duration) {
        progress++;
        const t = progress / duration;
        
        // Quadratic ease out for smooth landing
        const easeT = t * (2 - t);
        
        // Calculate position
        const currentY = startY - (startY - 0.4) * easeT;
        
        stone.position.y = currentY;
        
        requestAnimationFrame(animate);
      } else {
        stone.position.y = 0.4;
        
        // Add a slight bounce effect at the end
        setTimeout(() => {
          stone.position.y = 0.45;
          setTimeout(() => {
            stone.position.y = 0.4;
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
    const intersects = raycaster.intersectObjects(boardIntersections);

    if (intersects.length > 0) {
      const intersection = intersects[0].object;
      if (!intersection.userData.occupied) {
        const x = intersection.userData.x;
        const y = intersection.userData.y;
        
        // Create a temporary stone for animation
        const position = new THREE.Vector3(0, 0, 0);
        let stone;
        if (getPlayerStone(currentUsername) === 'black-stone') {
          stone = createBlackStone(position);
        } else {
          stone = createWhiteStone(position);
        }
        
        scene.add(stone);
        animateStonePlacement(stone, (x - 7) * 1, (y - 7) * 1);
        
        // Send move to server
        sendMessage({
          type: 'makeMove',
          data: {
            username: currentUsername,
            position: [x, y],
            gameType: 'gomoku'
          }
        });
      }
    }
  }

  // Update 3D scene based on game state
  function updateScene() {
    if (!gameState || !isSceneReady) return;

    // Clear existing stones
    gameStones.forEach(stone => {
      scene.remove(stone);
    });
    gameStones = [];

    // Reset intersection states
    boardIntersections.forEach(intersection => {
      intersection.userData.occupied = false;
    });

    // Add stones based on game state
    gameState.gomoku.forEach((cell, index) => {
      if (cell) {
        const x = index % 15;
        const y = Math.floor(index / 15);
        const position = new THREE.Vector3(
          (x - 7) * 1,
          0,
          (y - 7) * 1
        );

        let stone;
        if (getPlayerStone(cell) === 'black-stone') {
          stone = createBlackStone(position);
        } else {
          stone = createWhiteStone(position);
        }

        scene.add(stone);
        gameStones.push(stone);
        
        // Mark intersection as occupied
        const intersectionIndex = y * 15 + x;
        if (boardIntersections[intersectionIndex]) {
          boardIntersections[intersectionIndex].userData.occupied = true;
        }
      }
    });
  }

  // Get player stone type (black for first player, white for second)
  function getPlayerStone(username) {
    if (!gameState || !gameState.players) return 'black-stone';
    const playerIndex = gameState.players.indexOf(username);
    return playerIndex === 0 ? 'black-stone' : 'white-stone';
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
      message = "Great game! The board is full with no winner.";
      emoji = '🤝';
    } else if (winner === currentUsername) {
      modalClass = 'win-modal celebration';
      title = "🎉 Congratulations! 🎉";
      message = `You got five in a row! Master strategist!`;
      emoji = '🏆';
    } else {
      modalClass = 'lose-modal';
      title = "Game Over 😔";
      message = reason === 'timeout' 
        ? `Time's up! ${winner} wins by timeout.`
        : `${winner} got five in a row! Better luck next time.`;
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
      const stoneType = getPlayerStone(gameState.turn) === 'black-stone' ? 'Black ⚫' : 'White ⚪';
      statusElem.textContent = isMyTurn 
        ? `🎯 Your turn (${stoneType})` 
        : `⏳ ${gameState.turn}'s turn (${stoneType})`;
      
      if (isMyTurn) {
        statusElem.style.background = 'rgba(40, 167, 69, 0.95)';
        statusElem.style.color = 'white';
      } else {
        statusElem.style.background = 'rgba(255, 255, 255, 0.95)';
        statusElem.style.color = '#333';
      }
    } else if (gameState.status === 'finished') {
      const winnerStone = getPlayerStone(gameState.winner) === 'black-stone' ? 'Black ⚫' : 'White ⚪';
      statusElem.textContent = gameState.winner === currentUsername 
        ? `🏆 You won! (${winnerStone})` 
        : `😔 ${gameState.winner} won! (${winnerStone})`;
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
        const stone = index === 0 ? 'Black ⚫' : 'White ⚪';
        const isCurrent = player === currentUsername;
        return `${player} (${stone})${isCurrent ? ' - You' : ''}`;
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