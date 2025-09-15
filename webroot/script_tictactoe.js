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
  let gameCube = null;
  let cubeFaces = [];
  let gamePieces = [];
  let isSceneReady = false;

  // Camera and cube control variables
  let isDragging = false;
  let isRotatingCube = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 6;
  let cameraTheta = Math.PI / 4;
  let cameraPhi = Math.PI / 3;
  let cubeRotation = { x: 0, y: 0, z: 0 };

  // Touch-specific helpers
  let touchStartTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  let touchMoved = false;
  let lastTouchWasTap = false;
  const TOUCH_MOVE_THRESHOLD = 8; // pixels
  const TAP_MAX_DURATION = 300; // ms

  // Initialize Three.js scene
  function initThreeJS() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 8, 20);

    // Camera setup
    camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    updateCameraPosition();

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(10, 10, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Add colored point lights for better cube visibility
    const lights = [
      { color: 0xff4444, position: [8, 0, 0] },
      { color: 0x44ff44, position: [-8, 0, 0] },
      { color: 0x4444ff, position: [0, 8, 0] },
      { color: 0xffff44, position: [0, -8, 0] },
      { color: 0xff44ff, position: [0, 0, 8] },
      { color: 0x44ffff, position: [0, 0, -8] }
    ];

    lights.forEach(light => {
      const pointLight = new THREE.PointLight(light.color, 0.3, 15);
      pointLight.position.set(...light.position);
      scene.add(pointLight);
    });

    // Raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create the 3D cube
    createCube();

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

  // Update camera position
  function updateCameraPosition() {
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);

    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  // Create the 3D Tic Tac Toe cube
  function createCube() {
    gameCube = new THREE.Group();
    cubeFaces = [];

    const faceSize = 3;
    const cellSize = 0.9;
    const gap = 0.1;

    // Define face positions and rotations
    const faceConfigs = [
      { position: [0, 0, faceSize/2], rotation: [0, 0, 0], name: 'front' },      // Front (0)
      { position: [0, 0, -faceSize/2], rotation: [0, Math.PI, 0], name: 'back' }, // Back (1)
      { position: [faceSize/2, 0, 0], rotation: [0, Math.PI/2, 0], name: 'right' }, // Right (2)
      { position: [-faceSize/2, 0, 0], rotation: [0, -Math.PI/2, 0], name: 'left' }, // Left (3)
      { position: [0, faceSize/2, 0], rotation: [-Math.PI/2, 0, 0], name: 'top' },   // Top (4)
      { position: [0, -faceSize/2, 0], rotation: [Math.PI/2, 0, 0], name: 'bottom' } // Bottom (5)
    ];

    faceConfigs.forEach((config, faceIndex) => {
      const faceGroup = new THREE.Group();
      const faceCells = [];

      // Create 9 cells for each face
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const cellIndex = row * 3 + col;

          // Cell geometry
          const cellGeometry = new THREE.PlaneGeometry(cellSize, cellSize);
          const cellMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a3a,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
          });
          const cell = new THREE.Mesh(cellGeometry, cellMaterial);

          // Position cell
          const x = (col - 1) * (cellSize + gap);
          const y = (1 - row) * (cellSize + gap);
          cell.position.set(x, y, 0.01);

          // Add border
          const borderGeometry = new THREE.EdgesGeometry(cellGeometry);
          const borderMaterial = new THREE.LineBasicMaterial({ color: 0x666666 });
          const border = new THREE.LineSegments(borderGeometry, borderMaterial);
          border.position.copy(cell.position);

          cell.userData = {
            faceIndex: faceIndex,
            cellIndex: cellIndex,
            occupied: false,
            face: config.name
          };

          faceGroup.add(cell);
          faceGroup.add(border);
          faceCells.push(cell);
        }
      }

      // Position and rotate face
      faceGroup.position.set(...config.position);
      faceGroup.rotation.set(...config.rotation);
      faceGroup.userData = { faceIndex: faceIndex, name: config.name };

      gameCube.add(faceGroup);
      cubeFaces.push(faceCells);
    });

    // Add cube frame
    const frameGeometry = new THREE.BoxGeometry(faceSize + 0.1, faceSize + 0.1, faceSize + 0.1);
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444,
      transparent: true,
      opacity: 0.1,
      wireframe: true
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    gameCube.add(frame);

    scene.add(gameCube);
  }

  // Mouse event handlers
  function onMouseDown(event) {
    isDragging = true;
    previousMousePosition = {
      x: event.clientX,
      y: event.clientY
    };

    // Check if we should rotate cube or camera
    isRotatingCube = event.shiftKey || event.ctrlKey;
  }

  function onMouseMove(event) {
    if (!isDragging) return;

    const deltaX = event.clientX - previousMousePosition.x;
    const deltaY = event.clientY - previousMousePosition.y;

    previousMousePosition = {
      x: event.clientX,
      y: event.clientY
    };

    if (isRotatingCube && gameCube) {
      // Rotate the cube
      cubeRotation.y += deltaX * 0.01;
      cubeRotation.x += deltaY * 0.01;
      gameCube.rotation.set(cubeRotation.x, cubeRotation.y, cubeRotation.z);
    } else {
      // Rotate the camera
      cameraTheta += deltaX * 0.01;
      cameraPhi += deltaY * 0.01;
      cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
      updateCameraPosition();
    }
  }

  function onMouseUp() {
    isDragging = false;
    isRotatingCube = false;
  }

  function onMouseWheel(event) {
    event.preventDefault();
    cameraDistance += event.deltaY * 0.01;
    cameraDistance = Math.max(6, Math.min(20, cameraDistance));
    updateCameraPosition();
  }

  // Touch event handlers (improved tap vs pan detection)
  function onTouchStart(event) {
    if (event.touches.length === 1) {
      const t = event.touches[0];
      touchStartTime = Date.now();
      touchStartPos = { x: t.clientX, y: t.clientY };
      touchMoved = false;
      // do NOT set isDragging yet; only set when movement passes threshold
      isRotatingCube = false;
    }
    // Prevent default to avoid the browser doing its own gestures
    event.preventDefault();
  }

  function onTouchMove(event) {
    if (event.touches.length !== 1) return;

    const t = event.touches[0];
    const deltaX = t.clientX - touchStartPos.x;
    const deltaY = t.clientY - touchStartPos.y;
    const distSq = deltaX * deltaX + deltaY * deltaY;

    if (!touchMoved && Math.sqrt(distSq) > TOUCH_MOVE_THRESHOLD) {
      // Considered a move/pan — enable dragging/rotation
      touchMoved = true;
      isDragging = true;
      isRotatingCube = true; // user intends to rotate on touch-drag
      previousMousePosition = { x: t.clientX, y: t.clientY };
    }

    if (touchMoved) {
      // perform rotation just like mouse move
      const deltaMoveX = t.clientX - previousMousePosition.x;
      const deltaMoveY = t.clientY - previousMousePosition.y;
      previousMousePosition = { x: t.clientX, y: t.clientY };

      if (isRotatingCube && gameCube) {
        cubeRotation.y += deltaMoveX * 0.01;
        cubeRotation.x += deltaMoveY * 0.01;
        gameCube.rotation.set(cubeRotation.x, cubeRotation.y, cubeRotation.z);
      } else {
        cameraTheta += deltaMoveX * 0.01;
        cameraPhi += deltaMoveY * 0.01;
        cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
        updateCameraPosition();
      }
    }

    event.preventDefault();
  }

  function onTouchEnd(event) {
    // If this was a quick tap (no movement and short duration), treat as a click/tap
    const duration = Date.now() - touchStartTime;
    if (!touchMoved && duration <= TAP_MAX_DURATION) {
      // Use changedTouches if available, otherwise fallback to touchStartPos
      const touch = (event.changedTouches && event.changedTouches[0]) || null;
      const clientX = touch ? touch.clientX : touchStartPos.x;
      const clientY = touch ? touch.clientY : touchStartPos.y;

      // Send interaction
      handleInteraction(clientX, clientY);

      // Mark to prevent duplicate click event (some browsers fire click after touchend)
      lastTouchWasTap = true;
      setTimeout(() => { lastTouchWasTap = false; }, 400);
    }

    // Reset dragging/rotation flags
    isDragging = false;
    isRotatingCube = false;
    touchMoved = false;
    event.preventDefault();
  }

  // Create 3D X piece
  function createXPiece(position, faceIndex) {
    const group = new THREE.Group();

    const barGeometry = new THREE.BoxGeometry(0.6, 0.1, 0.1);
    const xMaterial = new THREE.MeshStandardMaterial({
      color: 0xFF4444,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x440000
    });

    const bar1 = new THREE.Mesh(barGeometry, xMaterial);
    bar1.rotation.z = Math.PI / 4;
    bar1.castShadow = true;

    const bar2 = new THREE.Mesh(barGeometry, xMaterial);
    bar2.rotation.z = -Math.PI / 4;
    bar2.castShadow = true;

    group.add(bar1);
    group.add(bar2);
    group.position.copy(position);
    group.position.z += 0.05;

    return group;
  }

  // Create 3D O piece
  function createOPiece(position, faceIndex) {
    const group = new THREE.Group();

    const torusGeometry = new THREE.TorusGeometry(0.25, 0.05, 8, 16);
    const oMaterial = new THREE.MeshStandardMaterial({
      color: 0x4444FF,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x000044
    });

    const torus = new THREE.Mesh(torusGeometry, oMaterial);
    torus.castShadow = true;

    group.add(torus);
    group.position.copy(position);
    group.position.z += 0.05;

    return group;
  }

  // Handle canvas click
  function onCanvasClick(event) {
    // Ignore if a touch tap already handled the interaction
    if (lastTouchWasTap) return;
    // Don't process clicks during drag
    if (isDragging) return;
    handleInteraction(event.clientX, event.clientY);
  }

  // Handle interaction
  function handleInteraction(clientX, clientY) {
    if (!gameState || !gameActive || gameState.status !== 'active' || !isSceneReady) return;
    if (gameState.turn !== currentUsername) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Get all face cells for raycasting
    const allCells = [];
    cubeFaces.forEach(face => {
      allCells.push(...face);
    });

    const intersects = raycaster.intersectObjects(allCells);

    if (intersects.length > 0) {
      const cell = intersects[0].object;
      if (!cell.userData.occupied) {
        const faceIndex = cell.userData.faceIndex;
        const cellIndex = cell.userData.cellIndex;

        // Send move to server
        sendMessage({
          type: 'makeMove',
          data: {
            username: currentUsername,
            position: { face: faceIndex, cell: cellIndex },
            gameType: 'tictactoe'
          }
        });
      }
    }
  }

  // Update 3D scene based on game state
  function updateScene() {
    if (!gameState || !isSceneReady || !gameState.tictactoe) return;

    // Clear existing pieces
    gamePieces.forEach(piece => {
      const parent = piece.parent;
      if (parent) parent.remove(piece);
    });
    gamePieces = [];

    // Reset cell states
    cubeFaces.forEach(face => {
      face.forEach(cell => {
        cell.userData.occupied = false;
        cell.material.color.setHex(0x2a2a3a);
        cell.material.opacity = 0.8;
      });
    });

    // Add pieces based on game state
    gameState.tictactoe.faces.forEach((face, faceIndex) => {
      face.forEach((cell, cellIndex) => {
        if (cell && cubeFaces[faceIndex] && cubeFaces[faceIndex][cellIndex]) {
          const cellMesh = cubeFaces[faceIndex][cellIndex];
          const position = cellMesh.position.clone();

          let piece;
          if (getPlayerSymbol(cell) === 'X') {
            piece = createXPiece(position, faceIndex);
          } else {
            piece = createOPiece(position, faceIndex);
          }

          // Add piece to the same parent as the cell (the face group)
          cellMesh.parent.add(piece);
          gamePieces.push(piece);

          cellMesh.userData.occupied = true;
          cellMesh.material.color.setHex(0x444444);
          cellMesh.material.opacity = 0.6;
        }
      });
    });

    // Update cube rotation from game state
    if (gameState.tictactoe.cubeRotation) {
      cubeRotation = { ...gameState.tictactoe.cubeRotation };
      if (gameCube) {
        gameCube.rotation.set(cubeRotation.x, cubeRotation.y, cubeRotation.z);
      }
    }
  }

  // Get player symbol
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

  // Auto-refresh game state
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

  // Show game end modal
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
      const facesWon = gameState?.tictactoe?.facesWon?.[winner] || 0;
      message = `You won ${facesWon} faces! Master of the cube!`;
      emoji = '🏆';
    } else {
      modalClass = 'lose-modal';
      title = "Game Over 😔";
      if (reason === 'timeout') {
        message = `Time's up! ${winner} wins by timeout.`;
      } else {
        const facesWon = gameState?.tictactoe?.facesWon?.[winner] || 0;
        message = `${winner} won ${facesWon} faces! Better luck next time.`;
      }
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
      const myFaces = gameState.tictactoe?.facesWon?.[currentUsername] || 0;
      const opponentFaces = gameState.players
        .filter(p => p !== currentUsername)
        .reduce((max, p) => Math.max(max, gameState.tictactoe?.facesWon?.[p] || 0), 0);

      statusElem.textContent = isMyTurn
        ? `🎯 Your turn (${turnSymbol}) - Faces: You ${myFaces}, Opponent ${opponentFaces}`
        : `⏳ ${gameState.turn}'s turn (${turnSymbol}) - Faces: You ${myFaces}, Opponent ${opponentFaces}`;

      if (isMyTurn) {
        statusElem.style.background = 'rgba(40, 167, 69, 0.95)';
        statusElem.style.color = 'white';
      } else {
        statusElem.style.background = 'rgba(255, 255, 255, 0.95)';
        statusElem.style.color = '#333';
      }
    } else if (gameState.status === 'finished') {
      const winnerSymbol = getPlayerSymbol(gameState.winner);
      const winnerFaces = gameState.tictactoe?.facesWon?.[gameState.winner] || 0;
      statusElem.textContent = gameState.winner === currentUsername
        ? `🏆 You won ${winnerFaces} faces! (${winnerSymbol})`
        : `😔 ${gameState.winner} won ${winnerFaces} faces! (${winnerSymbol})`;
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
        const faces = gameState.tictactoe?.facesWon?.[player] || 0;
        const isCurrent = player === currentUsername;
        return `${player} (${symbol}, ${faces} faces)${isCurrent ? ' - You' : ''}`;
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

  window.sendMessage = sendMessage;
})();
