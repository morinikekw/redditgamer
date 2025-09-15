(function() {
  // Send webViewReady immediately when script loads
  function sendMessage(message) {
    try { window.parent.postMessage(message, '*'); }
    catch (e) { console.warn('postMessage failed', e); }
  }
  
  // Notify parent immediately that web view is ready
  sendMessage({ type: 'webViewReady' });

  // DOM elements
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('dotsStatus');
  const restartBtn = document.getElementById('restartDots');
  const playersElem = document.getElementById('players-info');
  const timerElem = document.getElementById('timer');
  const loadingElem = document.getElementById('loading');

  // Game state
  let gameState = null;
  let currentUsername = null;
  let gameActive = false;
  let refreshInterval = null;
  let timerInterval = null;
  let selectedDot = null; // Track selected dot for line drawing (mouse only)

  // Three.js variables
  let scene, camera, renderer, raycaster, mouse;
  let dotMeshes = [];
  let lineMeshes = [];
  let boxMeshes = [];
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;                    // mouse dragging
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 12;
  let cameraTheta = Math.PI / 4;
  let cameraPhi = Math.PI / 3;

  // Touch control variables (separate from mouse)
  let touchActive = false;                   // set during touch interactions
  let touchMoved = false;                    // true if finger moved (we treat as rotate)
  let lastTouchTime = 0;                     // used to suppress synthetic click after touch
  const TOUCH_CLICK_SUPPRESSION_MS = 700;    // ignore clicks within this many ms after touch

  // Game parameters
  const gridSize = 5;
  const dotSpacing = 2;

  // Initialize Three.js scene
  function initThreeJS() {
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

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
    scene.add(directionalLight);

    // Raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create the dots grid
    createDotsGrid();

    // Event listeners (mouse)
    canvas.addEventListener('mousedown', onMouseDown, false);
    canvas.addEventListener('mousemove', onMouseMove, false);
    canvas.addEventListener('mouseup', onMouseUp, false);
    canvas.addEventListener('wheel', onMouseWheel, { passive: false });
    canvas.addEventListener('click', onCanvasClick, false);

    // Touch listeners (touch-only rotates; taps do NOT draw)
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    window.addEventListener('resize', onWindowResize);

    // Start render loop
    animate();

    // Hide loading indicator
    if (loadingElem) loadingElem.style.display = 'none';
    isSceneReady = true;
  }

  // Update camera position
  function updateCameraPosition() {
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    
    if (camera) {
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    }
  }

  // Mouse event handlers (desktop)
  function onMouseDown(event) {
    if (event.button !== 0) return; // only left button
    isDragging = true;
    previousMousePosition = { x: event.clientX, y: event.clientY };
  }

  function onMouseMove(event) {
    if (!isDragging) return;
    const deltaX = event.clientX - previousMousePosition.x;
    const deltaY = event.clientY - previousMousePosition.y;
    previousMousePosition = { x: event.clientX, y: event.clientY };

    cameraTheta += deltaX * 0.01;
    cameraPhi += deltaY * 0.01;
    cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
    updateCameraPosition();
  }

  function onMouseUp(/*event*/) {
    isDragging = false;
  }

  function onMouseWheel(event) {
    event.preventDefault();
    cameraDistance += event.deltaY * 0.01;
    cameraDistance = Math.max(6, Math.min(20, cameraDistance));
    updateCameraPosition();
  }

  // Touch event handlers (mobile): rotate / zoom only, NO drawing
  function onTouchStart(event) {
    // We explicitly prevent touch taps from causing clicks that draw lines.
    // Touch interactions WILL rotate the camera when user drags their finger.
    if (!event.touches || event.touches.length === 0) return;
    touchActive = true;
    touchMoved = false;

    // single-finger rotation start
    if (event.touches.length === 1) {
      previousMousePosition = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }

    // two-finger pinch start: store initial distance for zoom
    if (event.touches.length === 2) {
      // store midpoint and distance for potential pinch zoom
      const t0 = event.touches[0], t1 = event.touches[1];
      previousMousePosition = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
        pinchDistance: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY)
      };
      // mark as moved so taps are ignored
      touchMoved = true;
    }

    // block the synthetic click that some browsers emit
    event.preventDefault();
  }

  function onTouchMove(event) {
    if (!touchActive) return;
    if (!event.touches || event.touches.length === 0) return;

    // single-finger -> rotate
    if (event.touches.length === 1) {
      const t = event.touches[0];
      const deltaX = t.clientX - previousMousePosition.x;
      const deltaY = t.clientY - previousMousePosition.y;
      previousMousePosition = { x: t.clientX, y: t.clientY };

      cameraTheta += deltaX * 0.01;
      cameraPhi += deltaY * 0.01;
      cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
      updateCameraPosition();
      touchMoved = true;
    }

    // two-finger pinch -> zoom (and rotate by midpoint movement)
    else if (event.touches.length === 2) {
      const t0 = event.touches[0], t1 = event.touches[1];
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const pinchDistance = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);

      const dx = midX - previousMousePosition.x;
      const dy = midY - previousMousePosition.y;
      // rotate a little by centroid movement
      cameraTheta += dx * 0.01;
      cameraPhi += dy * 0.01;
      cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));

      // zoom by pinch ratio
      if (previousMousePosition.pinchDistance) {
        const ratio = previousMousePosition.pinchDistance / pinchDistance;
        cameraDistance *= ratio;
        cameraDistance = Math.max(6, Math.min(20, cameraDistance));
      }
      previousMousePosition = { x: midX, y: midY, pinchDistance };
      updateCameraPosition();

      touchMoved = true;
    }

    // prevent scrolling when touching the canvas
    event.preventDefault();
  }

  function onTouchEnd(event) {
    // When the touch sequence ends, record lastTouchTime so subsequent synthetic click is ignored.
    touchActive = false;
    lastTouchTime = Date.now();
    // do not call handleInteraction or any selection: touches never draw lines
    // ensure selection is cleared if any (only mouse selects)
    if (selectedDot) {
      safeSetEmissive(selectedDot, 0x000000);
      selectedDot = null;
    }
    // prevent synthetic click: stopPropagation + preventDefault
    if (event) {
      try { event.preventDefault(); event.stopPropagation(); } catch (e) {}
    }
  }

  // Create dots grid
  function createDotsGrid() {
    dotMeshes = [];
    
    const dotGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const dotMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x000000
    });

    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        const dot = new THREE.Mesh(dotGeometry, dotMaterial.clone());
        dot.position.set(
          (x - (gridSize - 1) / 2) * dotSpacing,
          0,
          (y - (gridSize - 1) / 2) * dotSpacing
        );
        dot.userData = { x: x, y: y };
        dot.castShadow = true;
        
        scene.add(dot);
        dotMeshes.push(dot);
      }
    }

    // Add base platform
    const platformGeometry = new THREE.BoxGeometry(gridSize * dotSpacing + 2, 0.2, gridSize * dotSpacing + 2);
    const platformMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333,
      roughness: 0.8,
      metalness: 0.2
    });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.y = -0.5;
    platform.receiveShadow = true;
    scene.add(platform);
  }

  // Create line between two dots
  function createLine(x1, y1, x2, y2, player) {
    const start = new THREE.Vector3(
      (x1 - (gridSize - 1) / 2) * dotSpacing,
      0.05,
      (y1 - (gridSize - 1) / 2) * dotSpacing
    );
    const end = new THREE.Vector3(
      (x2 - (gridSize - 1) / 2) * dotSpacing,
      0.05,
      (y2 - (gridSize - 1) / 2) * dotSpacing
    );

    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    
    const lineGeometry = new THREE.CylinderGeometry(0.03, 0.03, length, 8);
    const playerColors = {};
    if (gameState && Array.isArray(gameState.players)) {
      playerColors[gameState.players[0]] = 0xff4444;
      playerColors[gameState.players[1]] = 0x4444ff;
    }
    const lineColor = (player && playerColors[player]) ? playerColors[player] : 0xffffff;
    
    const lineMaterial = new THREE.MeshStandardMaterial({ 
      color: lineColor,
      roughness: 0.3,
      metalness: 0.7
    });
    
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    
    // Position and orient the line
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    line.position.copy(center);
    // Cylinder in three points its local Y is along its height; orient it from center to end
    const up = new THREE.Vector3(0, 1, 0);
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    line.castShadow = true;
    
    scene.add(line);
    lineMeshes.push(line);
    
    return line;
  }

  // Create completed box
  function createBox(x, y, player) {
    const boxGeometry = new THREE.PlaneGeometry(dotSpacing * 0.8, dotSpacing * 0.8);
    const playerColors = {};
    if (gameState && Array.isArray(gameState.players)) {
      playerColors[gameState.players[0]] = 0xff4444;
      playerColors[gameState.players[1]] = 0x4444ff;
    }
    const boxColor = (player && playerColors[player]) ? playerColors[player] : 0x888888;
    
    const boxMaterial = new THREE.MeshStandardMaterial({ 
      color: boxColor,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.set(
      (x + 0.5 - (gridSize - 1) / 2) * dotSpacing,
      0.01,
      (y + 0.5 - (gridSize - 1) / 2) * dotSpacing
    );
    box.rotation.x = -Math.PI / 2;
    box.receiveShadow = true;
    
    scene.add(box);
    boxMeshes.push(box);
    
    return box;
  }

  // Helper to safely set emissive color (some materials may not have emissive)
  function safeSetEmissive(mesh, hex) {
    try {
      if (mesh && mesh.material && 'emissive' in mesh.material) {
        mesh.material.emissive.setHex(hex);
      }
    } catch (e) {}
  }

  // Handle canvas click (mouse only)
  function onCanvasClick(event) {
    // Suppress clicks that come immediately after a touch (synthetic clicks)
    if (Date.now() - lastTouchTime < TOUCH_CLICK_SUPPRESSION_MS) {
      return;
    }
    // If the last interaction was a touch (touchActive recently), do not treat click as drawing.
    if (touchActive) return;
    if (isDragging) return;
    handleInteraction(event.clientX, event.clientY);
  }

  // Handle interaction (mouse only draws lines)
  function handleInteraction(clientX, clientY) {
    if (!gameState || !gameActive || gameState.status !== 'active' || !isSceneReady) return;
    if (gameState.turn !== currentUsername) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(dotMeshes, true);

    if (intersects.length > 0) {
      const dot = intersects[0].object;
      
      // Only mouse interactions control selectedDot and drawing
      if (!selectedDot) {
        // First dot selection
        selectedDot = dot;
        safeSetEmissive(selectedDot, 0x00ff00); // Green highlight
      } else if (selectedDot === dot) {
        // Deselect the same dot
        safeSetEmissive(selectedDot, 0x000000);
        selectedDot = null;
      } else {
        // Second dot selection - attempt to draw line
        const dot1 = selectedDot.userData;
        const dot2 = dot.userData;
        
        // Check if dots are adjacent
        const dx = Math.abs(dot2.x - dot1.x);
        const dy = Math.abs(dot2.y - dot1.y);
        
        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
          // Valid adjacent dots - send move
          const lineKey = `${dot1.x},${dot1.y},${dot2.x},${dot2.y}`;
          
          sendMessage({
            type: 'makeMove',
            data: {
              username: currentUsername,
              position: lineKey,
              gameType: 'dots'
            }
          });
          
          // Clear selection
          safeSetEmissive(selectedDot, 0x000000);
          selectedDot = null;
        } else {
          // Invalid selection - highlight error briefly
          safeSetEmissive(dot, 0xff0000);
          setTimeout(() => {
            safeSetEmissive(dot, 0x000000);
          }, 500);
          
          // Keep first dot selected
        }
      }
    }
  }

  // Update scene based on game state
  function updateScene() {
    if (!gameState || !isSceneReady) return;

    // Clear existing lines and boxes
    lineMeshes.forEach(line => { try { scene.remove(line); } catch (e) {} });
    boxMeshes.forEach(box => { try { scene.remove(box); } catch (e) {} });
    lineMeshes = [];
    boxMeshes = [];

    // Draw lines (from gameState.dots.lines)
    if (gameState.dots && Array.isArray(gameState.dots.lines)) {
      gameState.dots.lines.forEach(lineKey => {
        const coords = (typeof lineKey === 'string' ? lineKey : '').split(',').map(Number);
        if (coords.length === 4) {
          const [x1, y1, x2, y2] = coords;
          // pass player if stored as system uses a string; we ignore if not available
          createLine(x1, y1, x2, y2, 'system');
        }
      });
    }

    // Draw boxes
    if (gameState.dots && gameState.dots.boxes) {
      Object.entries(gameState.dots.boxes).forEach(([boxKey, player]) => {
        const coords = boxKey.split(',').map(Number);
        if (coords.length === 2) {
          const [x, y] = coords;
          createBox(x, y, player);
        }
      });
    }
  }

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    if (isSceneReady && renderer && scene && camera) renderer.render(scene, camera);
  }

  // Handle window resize
  function onWindowResize() {
    if (!isSceneReady || !camera || !renderer || !canvas) return;
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
      message = "Great game! Equal boxes captured.";
      emoji = '🤝';
    } else if (winner === currentUsername) {
      modalClass = 'win-modal celebration';
      title = "🎉 Congratulations! 🎉";
      const myScore = gameState?.dots?.scores?.[winner] || 0;
      message = `You captured ${myScore} boxes! Strategic genius!`;
      emoji = '🏆';
    } else {
      modalClass = 'lose-modal';
      title = "Game Over 😔";
      if (reason === 'timeout') {
        message = `Time's up! ${winner} wins by timeout.`;
      } else {
        const winnerScore = gameState?.dots?.scores?.[winner] || 0;
        message = `${winner} captured ${winnerScore} boxes! Better luck next time.`;
      }
      emoji = '😔';
    }
    
    modal.innerHTML = `
      <div class="modal-content ${modalClass}">
        <h2>${emoji} ${title} ${emoji}</h2>
        <p>${message}</p>
        <button id="playAgainBtn">Play Again</button>
      </div>
    `;
    
    document.body.appendChild(modal);
    const playBtn = document.getElementById('playAgainBtn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (modal.parentNode) modal.remove();
        sendMessage({ type: 'requestGameState' });
      });
    }
    
    setTimeout(() => {
      if (modal.parentNode) modal.remove();
    }, 5000);
  }

  // Update game status display
  function updateStatus() {
    if (!gameState) {
      if (statusElem) {
        statusElem.textContent = 'Loading...';
        statusElem.className = 'status-display-3d';
      }
      return;
    }

    if (!statusElem) return;
    statusElem.className = 'status-display-3d';

    if (gameState.status === 'waiting') {
      statusElem.textContent = `⏳ Waiting for players... (${gameState.players.length}/${gameState.maxPlayers})`;
      statusElem.style.background = '';
      statusElem.style.color = '';
    } else if (gameState.status === 'active') {
      const isMyTurn = gameState.turn === currentUsername;
      const myScore = gameState.dots?.scores?.[currentUsername] || 0;
      const opponentScore = gameState.players
        .filter(p => p !== currentUsername)
        .reduce((max, p) => Math.max(max, gameState.dots?.scores?.[p] || 0), 0);
      
      statusElem.textContent = isMyTurn 
        ? `🎯 Your turn - Boxes: You ${myScore}, Opponent ${opponentScore}` 
        : `⏳ ${gameState.turn}'s turn - Boxes: You ${myScore}, Opponent ${opponentScore}`;
      
      if (isMyTurn) {
        statusElem.style.background = 'rgba(40, 167, 69, 0.95)';
        statusElem.style.color = 'white';
      } else {
        statusElem.style.background = 'rgba(255, 255, 255, 0.95)';
        statusElem.style.color = '#333';
      }
    } else if (gameState.status === 'finished') {
      const winnerScore = gameState.dots?.scores?.[gameState.winner] || 0;
      statusElem.textContent = gameState.winner === currentUsername 
        ? `🏆 You won with ${winnerScore} boxes!` 
        : `😔 ${gameState.winner} won with ${winnerScore} boxes!`;
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
    
    if (!Array.isArray(gameState.players) || gameState.players.length === 0) {
      playersElem.textContent = '👥 No players yet';
    } else {
      const playersList = gameState.players.map((player) => {
        const score = gameState.dots?.scores?.[player] || 0;
        const isCurrent = player === currentUsername;
        return `${player} (${score} boxes)${isCurrent ? ' - You' : ''}`;
      }).join(', ');
      playersElem.textContent = `👥 Players: ${playersList}`;
    }
  }

  // Handle messages from parent
  function handleMessage(event) {
    let message = event.data;
    if (!message) return;
    if (message.type === 'devvit-message' && message.data && message.data.message) {
      message = message.data.message;
    }

    if (!message || !message.type) return;
    
    switch (message.type) {
      case 'initialData':
        currentUsername = message.data && message.data.username;
        sendMessage({ type: 'initializeGame' });
        sendMessage({ type: 'requestGameState' });
        break;

      case 'gameState':
        gameState = message.data;
        gameActive = gameState.status === 'active';
        // Stop selection if something changed
        if (selectedDot) {
          safeSetEmissive(selectedDot, 0x000000);
          selectedDot = null;
        }
        updateScene();
        updateStatus();
        updatePlayersInfo();
        
        if (!Array.isArray(gameState.players) || !gameState.players.includes(currentUsername)) {
          sendMessage({
            type: 'joinGame',
            data: { username: currentUsername }
          });
        } else if (gameActive) {
          startAutoRefresh();
          startTurnTimer();
        }
        break;

      case 'playerJoined':
        if (message.data && message.data.gameState) {
          gameState = message.data.gameState;
          gameActive = gameState.status === 'active';
          if (selectedDot) {
            safeSetEmissive(selectedDot, 0x000000);
            selectedDot = null;
          }
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
        if (message.data && message.data.gameState) {
          gameState = message.data.gameState;
          updateScene();
          updateStatus();
          updatePlayersInfo();
        }
        if (gameActive && gameState && Array.isArray(gameState.players) && gameState.players.includes(currentUsername)) {
          startAutoRefresh();
          startTurnTimer();
        }
        break;

      case 'gameUpdate':
      case 'moveMade':
        if (message.data && (message.data.gameState || message.data)) {
          gameState = message.data.gameState || message.data;
          gameActive = gameState.status === 'active';
          if (selectedDot) {
            safeSetEmissive(selectedDot, 0x000000);
            selectedDot = null;
          }
          updateScene();
          updateStatus();
          updatePlayersInfo();
        }
        break;

      case 'turnChanged':
        if (selectedDot) {
          safeSetEmissive(selectedDot, 0x000000);
          selectedDot = null;
        }
        updateStatus();
        break;

      case 'timerUpdate':
        if (message.data) updateTimer(message.data.timeRemaining, message.data.currentTurn);
        break;

      case 'gameEnded':
        gameActive = false;
        if (selectedDot) {
          safeSetEmissive(selectedDot, 0x000000);
          selectedDot = null;
        }
        if (refreshInterval) clearInterval(refreshInterval);
        if (timerInterval) clearInterval(timerInterval);

        if (message.data && message.data.finalState) {
          gameState = message.data.finalState;
          updateScene();
          updateStatus();
          updatePlayersInfo();
        }
        setTimeout(() => {
          showGameEndModal(message.data && message.data.winner, message.data && message.data.isDraw, message.data && message.data.reason);
        }, 500);
        break;

      case 'error':
        if (selectedDot) {
          safeSetEmissive(selectedDot, 0x000000);
          selectedDot = null;
        }
        if (statusElem) {
          statusElem.textContent = `❌ Error: ${message.message || (message.data && message.data.message) || 'unknown'}`;
          statusElem.className = 'status-display-3d';
          statusElem.style.background = 'rgba(220, 53, 69, 0.95)';
          statusElem.style.color = 'white';
        }
        break;
    }
  }

  // Add event listeners
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => {
    sendMessage({ type: 'webViewReady' });
  });

  // Request fresh game state when tab becomes visible (helps with reconnection)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUsername) {
      sendMessage({ type: 'requestGameState' });
    }
  });

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      sendMessage({ type: 'requestGameState' });
    });
  }

  // Initialize Three.js when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThreeJS);
  } else {
    initThreeJS();
  }

  // expose debug sendMessage
  window.sendMessage = sendMessage;

})();
