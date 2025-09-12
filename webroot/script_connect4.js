(function() {
  // Send webViewReady immediately when script loads
  function sendMessage(message) {
    window.parent.postMessage(message, '*');
  }
  
  // Notify parent immediately that web view is ready
  sendMessage({ type: 'webViewReady' });

  // DOM elements
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('connect4Status');
  const restartBtn = document.getElementById('restartConnect4');
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
  let boardColumns = [];
  let gameDiscs = [];
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 15;
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

  // Create the 3D Connect 4 board with improved visuals
  function createBoard() {
    boardColumns = [];
    
    // Board frame - more realistic looking
    const frameGeometry = new THREE.BoxGeometry(8.5, 7.5, 0.8);
    const frameMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x2a4b8d,
      roughness: 0.7,
      metalness: 0.3
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.position.set(0, 0, -0.5);
    frame.receiveShadow = true;
    scene.add(frame);

    // Create 7 columns with 6 holes each
    for (let col = 0; col < 7; col++) {
      const columnGroup = new THREE.Group();
      
      // Column click area (invisible)
      const columnGeometry = new THREE.PlaneGeometry(1, 7);
      const columnMaterial = new THREE.MeshBasicMaterial({ 
        transparent: true, 
        opacity: 0,
        side: THREE.DoubleSide
      });
      const columnMesh = new THREE.Mesh(columnGeometry, columnMaterial);
      columnMesh.position.set((col - 3) * 1.1, 0, 0.1);
      columnMesh.userData = { column: col };
      columnGroup.add(columnMesh);

      // Create holes in the board with better appearance
      for (let row = 0; row < 6; row++) {
        const holeGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.8, 16);
        const holeMaterial = new THREE.MeshStandardMaterial({ 
          color: 0x1e3a8a,
          roughness: 0.8,
          metalness: 0.2
        });
        const hole = new THREE.Mesh(holeGeometry, holeMaterial);
        hole.position.set(
          (col - 3) * 1.1,
          (row - 2.5) * 1.1,
          0
        );
        hole.rotation.x = Math.PI / 2;
        hole.receiveShadow = true;
        columnGroup.add(hole);
      }

      scene.add(columnGroup);
      boardColumns.push(columnMesh);
    }

    // Add column indicators at the top
    for (let col = 0; col < 7; col++) {
      const indicatorGeometry = new THREE.ConeGeometry(0.25, 0.6, 8);
      const indicatorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffff00,
        roughness: 0.5,
        metalness: 0.5,
        emissive: 0x444400
      });
      const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
      indicator.position.set((col - 3) * 1.1, 4, 0);
      indicator.visible = false;
      indicator.userData = { column: col };
      scene.add(indicator);
    }

    // Add a stand for the board
    const standGeometry = new THREE.BoxGeometry(10, 1, 10);
    const standMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x5a3921,
      roughness: 0.9,
      metalness: 0.1
    });
    const stand = new THREE.Mesh(standGeometry, standMaterial);
    stand.position.set(0, -4, 0);
    stand.receiveShadow = true;
    scene.add(stand);
  }

  // Create 3D red disc with improved appearance
  function createRedDisc(position) {
    const discGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.2, 32);
    const discMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xdc2626,
      roughness: 0.3,
      metalness: 0.7
    });
    const disc = new THREE.Mesh(discGeometry, discMaterial);
    
    disc.position.copy(position);
    disc.castShadow = true;
    disc.receiveShadow = true;
    
    return disc;
  }

  // Create 3D yellow disc with improved appearance
  function createYellowDisc(position) {
    const discGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.2, 32);
    const discMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xfbbf24,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x443300
    });
    const disc = new THREE.Mesh(discGeometry, discMaterial);
    
    disc.position.copy(position);
    disc.castShadow = true;
    disc.receiveShadow = true;
    
    return disc;
  }

  // Animate disc dropping with more realistic physics
  function animateDiscDrop(disc, targetY, column, row) {
    const startY = 8;
    disc.position.set((column - 3) * 1.1, startY, 0);
    
    // Create a slight arc in the animation
    const centerX = (column - 3) * 1.1;
    const arcHeight = 1.5;
    
    let progress = 0;
    const duration = 30; // frames
    
    const animate = () => {
      if (progress < duration) {
        progress++;
        const t = progress / duration;
        
        // Quadratic ease out for smooth landing
        const easeT = t * (2 - t);
        
        // Calculate position with arc
        const currentY = startY - (startY - targetY) * easeT;
        const arcOffset = Math.sin(Math.PI * t) * arcHeight;
        
        disc.position.y = currentY - arcOffset;
        
        requestAnimationFrame(animate);
      } else {
        disc.position.y = targetY;
        
        // Add a slight bounce effect at the end
        setTimeout(() => {
          disc.position.y = targetY + 0.1;
          setTimeout(() => {
            disc.position.y = targetY;
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
    const intersects = raycaster.intersectObjects(boardColumns);

    if (intersects.length > 0) {
      const column = intersects[0].object.userData.column;
      
      // Check if column is full (check top row)
      if (gameState.connect4[column][0]) return;
      
      // Find the first empty row in the column
      let row = 5;
      while (row >= 0 && gameState.connect4[column][row]) {
        row--;
      }
      
      if (row < 0) return; // Column is full
      
      // Create a temporary disc for animation
      const position = new THREE.Vector3(0, 0, 0);
      let disc;
      if (getPlayerColor(currentUsername) === 'red') {
        disc = createRedDisc(position);
      } else {
        disc = createYellowDisc(position);
      }
      
      scene.add(disc);
      animateDiscDrop(disc, (row - 2.5) * 1.1, column, row);
      
      // Send move to server
      sendMessage({
        type: 'makeMove',
        data: {
          username: currentUsername,
          position: column,
          gameType: 'connect4'
        }
      });
    }
  }

  // Update 3D scene based on game state
  function updateScene() {
    if (!gameState || !isSceneReady) return;

    // Clear existing discs
    gameDiscs.forEach(disc => {
      scene.remove(disc);
    });
    gameDiscs = [];

    // Add discs based on game state
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 6; row++) {
        if (gameState.connect4[col][row]) {
          const position = new THREE.Vector3(
            (col - 3) * 1.1,
            (row - 2.5) * 1.1,
            0
          );

          let disc;
          if (getPlayerColor(gameState.connect4[col][row]) === 'red') {
            disc = createRedDisc(position);
          } else {
            disc = createYellowDisc(position);
          }

          scene.add(disc);
          gameDiscs.push(disc);
        }
      }
    }
  }

  // Get player color (red for first player, yellow for second)
  function getPlayerColor(username) {
    if (!gameState || !gameState.players) return 'red';
    const playerIndex = gameState.players.indexOf(username);
    return playerIndex === 0 ? 'red' : 'yellow';
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
      message = `You got four in a row! Excellent strategy!`;
      emoji = '🏆';
    } else {
      modalClass = 'lose-modal';
      title = "Game Over 😔";
      message = reason === 'timeout' 
        ? `Time's up! ${winner} wins by timeout.`
        : `${winner} got four in a row! Better luck next time.`;
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
      const colorEmoji = turnColor === 'red' ? '🔴' : '🟡';
      statusElem.textContent = isMyTurn 
        ? `🎯 Your turn - Drop your disc! (${colorEmoji})` 
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
      const colorEmoji = winnerColor === 'red' ? '🔴' : '🟡';
      statusElem.textContent = gameState.winner === currentUsername 
        ? `🏆 You won! (${colorEmoji})` 
        : `😔 ${gameState.winner} won! (${colorEmoji})`;
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
        const color = index === 0 ? 'Red' : 'Yellow';
        const emoji = index === 0 ? '🔴' : '🟡';
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

  // Make sendMessage available globally for modal buttons
  window.sendMessage = sendMessage;
})();