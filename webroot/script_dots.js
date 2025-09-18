(function() {
  const GAME_TYPE = 'dots';

  // Send webViewReady immediately when script loads
  function sendMessage(message) {
    try {
      // attempt to attach gameType and sessionId without mutating caller's object
      const msg = (typeof message === 'object' && message !== null) ? JSON.parse(JSON.stringify(message)) : { type: String(message) };
      if (!msg.data || typeof msg.data !== 'object') msg.data = {};
      msg.data.gameType = GAME_TYPE;
      if (currentSessionId) msg.data.sessionId = currentSessionId;
      window.parent.postMessage(msg, '*');
    } catch (e) {
      // fallback to original behavior
      try { window.parent.postMessage(message, '*'); } catch (err) { console.warn('postMessage failed', err, e); }
    }
  }
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
  let currentSessionId = null;
  let gameActive = false;
  let refreshInterval = null;
  let timerInterval = null;

  // Interaction state
  let selectedDot = null;        // chosen endpoint (persistent across taps until cleared or used)
  let hoverDot = null;           // dot under cursor (desktop)
  let lastTouchTime = 0;
  const TOUCH_CLICK_SUPPRESSION_MS = 700;

  // Touch tap detection
  let touchActive = false;
  let touchMoved = false;
  let touchStartTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  const TOUCH_TAP_MAX_DURATION = 280; // ms
  const TOUCH_TAP_MOVE_THRESHOLD = 10; // px

  // Three.js variables
  let scene, camera, renderer, raycaster, mouse;
  let dotMeshes = [];
  let lineMeshes = [];
  let boxMeshes = [];
  let platform = null;
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 12;
  let cameraTheta = Math.PI / 4;
  let cameraPhi = Math.PI / 3;

  // Visual animation
  let clock = { start: Date.now(), getElapsed: () => (Date.now() - clock.start) / 1000 };

  // Game parameters
  const gridSize = 5;
  const dotSpacing = 2;

  /* ----------------------
     Initialize ThreeJS
     ---------------------- */
  function initThreeJS() {
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020);

    // Camera
    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    updateCameraPosition();

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting for an immersive look
    const ambient = new THREE.HemisphereLight(0x8088ff, 0x101020, 0.4);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff3d7, 0.9);
    keyLight.position.set(6, 8, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdde8ff, 0.35);
    fillLight.position.set(-6, 4, -6);
    scene.add(fillLight);

    // Subtle atmosphere (fog)
    scene.fog = new THREE.FogExp2(0x08101a, 0.02);

    // Raycaster + mouse
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create grid, platform and ambient details
    createDotsGrid();
    createPlatformDetails();

    // Event listeners
    canvas.addEventListener('mousedown', onMouseDown, false);
    canvas.addEventListener('mousemove', onMouseMove, false);
    canvas.addEventListener('mouseup', onMouseUp, false);
    canvas.addEventListener('wheel', onMouseWheel, { passive: false });
    canvas.addEventListener('click', onCanvasClick, false);

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    window.addEventListener('resize', onWindowResize);

    animate();

    if (loadingElem) loadingElem.style.display = 'none';
    isSceneReady = true;
  }

  function updateCameraPosition() {
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    if (camera) {
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    }
  }

  /* ----------------------
     Create dots & platform
     ---------------------- */
  function createDotsGrid() {
    // clear previous dots if any
    dotMeshes.forEach(m => { try { scene.remove(m); } catch (e) {} });
    dotMeshes = [];

    const baseGeom = new THREE.SphereGeometry(0.14, 20, 20);

    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.25,
          metalness: 0.8,
          emissive: 0x000000,
          emissiveIntensity: 0.8
        });
        const dot = new THREE.Mesh(baseGeom, mat);
        dot.position.set(
          (x - (gridSize - 1) / 2) * dotSpacing,
          0,
          (y - (gridSize - 1) / 2) * dotSpacing
        );
        dot.userData = { x: x, y: y };
        dot.castShadow = true;
        dot.receiveShadow = true;
        scene.add(dot);
        dotMeshes.push(dot);
      }
    }
  }

  function createPlatformDetails() {
    if (platform) { try { scene.remove(platform); } catch (e) {} }
    const g = new THREE.BoxGeometry(gridSize * dotSpacing + 2, 0.25, gridSize * dotSpacing + 2);
    const m = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.85,
      metalness: 0.2
    });
    platform = new THREE.Mesh(g, m);
    platform.position.y = -0.55;
    platform.receiveShadow = true;
    scene.add(platform);

    // rim - a subtle glossy ring
    const ringGeo = new THREE.RingGeometry( (gridSize * dotSpacing + 2)/2 - 0.2, (gridSize * dotSpacing + 2)/2, 64 );
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0b2a40, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.44;
    scene.add(ring);
  }

  /* ----------------------
     Lines & Boxes
     ---------------------- */
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
    const geometry = new THREE.CylinderGeometry(0.04, 0.04, length, 10, 1, true);
    const playerColors = {};
    if (gameState && Array.isArray(gameState.players)) {
      playerColors[gameState.players[0]] = 0xff6b6b;
      playerColors[gameState.players[1]] = 0x6b9bff;
    }
    const color = (player && playerColors[player]) ? playerColors[player] : 0xf7f7f7;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.6, emissive: color, emissiveIntensity: 0.2 });

    const line = new THREE.Mesh(geometry, material);
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    line.position.copy(center);
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    line.castShadow = true;

    scene.add(line);
    lineMeshes.push(line);
    return line;
  }

  function createBox(x, y, player) {
    const boxGeometry = new THREE.PlaneGeometry(dotSpacing * 0.82, dotSpacing * 0.82);
    const playerColors = {};
    if (gameState && Array.isArray(gameState.players)) {
      playerColors[gameState.players[0]] = 0xff6b6b;
      playerColors[gameState.players[1]] = 0x6b9bff;
    }
    const color = (player && playerColors[player]) ? playerColors[player] : 0x9aa0a6;
    const material = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
    const box = new THREE.Mesh(boxGeometry, material);
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

  /* ----------------------
     Helpers & Visuals
     ---------------------- */
  function safeSetEmissive(mesh, hex, intensity = 1) {
    try {
      if (mesh && mesh.material && 'emissive' in mesh.material) {
        mesh.material.emissive.setHex(hex);
        mesh.material.emissiveIntensity = intensity;
      }
    } catch (e) {}
  }

  function scaleDotPulse(dot, t) {
    if (!dot) return;
    const base = 1;
    const pulse = 0.06 * Math.sin(t * 6) + 0.02; // subtle
    dot.scale.setScalar(base + pulse);
  }

  // Check if a line already exists in state (either direction)
  function isLineExists(x1, y1, x2, y2) {
    if (!gameState || !gameState.dots || !Array.isArray(gameState.dots.lines)) return false;
    const a = `${x1},${y1},${x2},${y2}`;
    const b = `${x2},${y2},${x1},${y1}`;
    return gameState.dots.lines.includes(a) || gameState.dots.lines.includes(b);
  }

  /* ----------------------
     Interaction: Mouse
     ---------------------- */
  function onMouseDown(event) {
    if (event.button !== 0) return;
    isDragging = true;
    previousMousePosition = { x: event.clientX, y: event.clientY };
  }

  function onMouseMove(event) {
    if (!isSceneReady) return;

    // If dragging -> rotate
    if (isDragging) {
      const deltaX = event.clientX - previousMousePosition.x;
      const deltaY = event.clientY - previousMousePosition.y;
      previousMousePosition = { x: event.clientX, y: event.clientY };

      cameraTheta += deltaX * 0.01;
      cameraPhi += deltaY * 0.01;
      cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
      updateCameraPosition();
      return;
    }

    // Hover highlighting when not dragging
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(dotMeshes, true);
    if (intersects.length > 0) {
      const dot = intersects[0].object;
      if (hoverDot !== dot) {
        if (hoverDot && hoverDot !== selectedDot) safeSetEmissive(hoverDot, 0x000000, 0.0);
        hoverDot = dot;
        if (hoverDot !== selectedDot) safeSetEmissive(hoverDot, 0x3333ff, 0.9);
      }
    } else {
      if (hoverDot && hoverDot !== selectedDot) safeSetEmissive(hoverDot, 0x000000, 0.0);
      hoverDot = null;
    }
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

  // click (desktop) => only if not rotating and not synthetic after touch
  function onCanvasClick(event) {
    if (Date.now() - lastTouchTime < TOUCH_CLICK_SUPPRESSION_MS) return;
    if (touchActive) return;
    if (isDragging) return;
    handleInteraction(event.clientX, event.clientY);
  }

  /* ----------------------
     Interaction: Touch
     ---------------------- */
  function onTouchStart(event) {
    if (!event.touches || event.touches.length === 0) return;
    touchActive = true;
    touchMoved = false;
    touchStartTime = Date.now();
    touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };

    if (event.touches.length === 1) {
      previousMousePosition = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else if (event.touches.length === 2) {
      const t0 = event.touches[0], t1 = event.touches[1];
      previousMousePosition = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
        pinchDistance: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY)
      };
      touchMoved = true; // treat as movement so a tap won't be accidentally triggered
    }
    // prevent synthetic click
    event.preventDefault();
  }

  function onTouchMove(event) {
    if (!touchActive) return;
    if (!event.touches || event.touches.length === 0) return;

    // single -> rotate
    if (event.touches.length === 1) {
      const t = event.touches[0];
      const deltaX = t.clientX - previousMousePosition.x;
      const deltaY = t.clientY - previousMousePosition.y;
      if (!touchMoved && (Math.abs(deltaX) > TOUCH_TAP_MOVE_THRESHOLD || Math.abs(deltaY) > TOUCH_TAP_MOVE_THRESHOLD)) {
        touchMoved = true;
      }
      previousMousePosition = { x: t.clientX, y: t.clientY };
      if (touchMoved) {
        cameraTheta += deltaX * 0.01;
        cameraPhi += deltaY * 0.01;
        cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
        updateCameraPosition();
      }
    }
    // pinch -> zoom + slight rotate
    else if (event.touches.length === 2) {
      const t0 = event.touches[0], t1 = event.touches[1];
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const pinchDistance = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);

      const dx = midX - previousMousePosition.x;
      const dy = midY - previousMousePosition.y;

      cameraTheta += dx * 0.01;
      cameraPhi += dy * 0.01;
      cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));

      if (previousMousePosition.pinchDistance) {
        const ratio = previousMousePosition.pinchDistance / pinchDistance;
        cameraDistance *= ratio;
        cameraDistance = Math.max(6, Math.min(20, cameraDistance));
      }
      previousMousePosition = { x: midX, y: midY, pinchDistance };
      updateCameraPosition();
      touchMoved = true;
    }

    event.preventDefault();
  }

  function onTouchEnd(event) {
    touchActive = false;
    lastTouchTime = Date.now();
    const duration = Date.now() - touchStartTime;

    // If quick tap (no movement) treat as tap (draw/select)
    if (!touchMoved && duration <= TOUCH_TAP_MAX_DURATION) {
      const touch = (event.changedTouches && event.changedTouches[0]) ? event.changedTouches[0] : null;
      const clientX = touch ? touch.clientX : touchStartPos.x;
      const clientY = touch ? touch.clientY : touchStartPos.y;
      handleInteraction(clientX, clientY);
    }

    // Do not automatically clear selectedDot here — keep selection until user taps elsewhere or a move is made.
    // Prevent synthetic click
    if (event) {
      try { event.preventDefault(); event.stopPropagation(); } catch (e) {}
    }
  }

  /* ----------------------
     Handle selecting/drawing
     ---------------------- */
  function getDotAtScreenCoords(clientX, clientY) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(dotMeshes, true);
    return intersects.length > 0 ? intersects[0].object : null;
  }

  function handleInteraction(clientX, clientY) {
    if (!gameState || !gameActive || gameState.status !== 'active' || !isSceneReady) return;
    if (gameState.turn !== currentUsername) return;

    const dot = getDotAtScreenCoords(clientX, clientY);
    if (!dot) {
      // If user tapped away from dots -> clear selectedDot
      if (selectedDot) {
        safeSetEmissive(selectedDot, 0x000000, 0.0);
        selectedDot = null;
      }
      return;
    }

    // If no selected endpoint -> pick this one
    if (!selectedDot) {
      selectedDot = dot;
      safeSetEmissive(selectedDot, 0x00ff66, 1.2);
      return;
    }

    // If same dot tapped -> deselect
    if (selectedDot === dot) {
      safeSetEmissive(selectedDot, 0x000000, 0.0);
      selectedDot = null;
      return;
    }

    // Attempt to create a line between selectedDot and dot
    const d1 = selectedDot.userData;
    const d2 = dot.userData;

    const dx = Math.abs(d2.x - d1.x);
    const dy = Math.abs(d2.y - d1.y);
    const adjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);

    if (!adjacent) {
      // invalid: briefly flash both red
      safeSetEmissive(dot, 0xff3333, 1.0);
      safeSetEmissive(selectedDot, 0xff3333, 1.0);
      setTimeout(() => {
        if (selectedDot) safeSetEmissive(selectedDot, 0x00ff66, 1.2); // restore selected
        safeSetEmissive(dot, 0x000000, 0.0);
      }, 450);
      return;
    }

    // Check duplicate
    if (isLineExists(d1.x, d1.y, d2.x, d2.y)) {
      // already exists: brief yellow flash
      safeSetEmissive(dot, 0xffcc00, 1.0);
      setTimeout(() => safeSetEmissive(dot, 0x000000, 0.0), 400);
      // keep the selectedDot (user may want to pick another)
      return;
    }

    // Otherwise valid: send move to parent
    const lineKey = `${d1.x},${d1.y},${d2.x},${d2.y}`;
    sendMessage({
      type: 'makeMove',
      data: {
        username: currentUsername,
        position: lineKey,
        gameType: GAME_TYPE
      }
    });

    // provide immediate local feedback: create a temporary line & small flash
    createLine(d1.x, d1.y, d2.x, d2.y, currentUsername || 'local');
    safeSetEmissive(selectedDot, 0x33ff88, 1.0);
    safeSetEmissive(dot, 0x33ff88, 0.9);
    setTimeout(() => {
      if (selectedDot) safeSetEmissive(selectedDot, 0x000000, 0.0);
      safeSetEmissive(dot, 0x000000, 0.0);
      selectedDot = null;
      // rely on server update to draw final state (boxes, colors, persistent lines)
    }, 250);
  }

  /* ----------------------
     Scene updates from gameState
     ---------------------- */
  function updateScene() {
    if (!gameState || !isSceneReady) return;

    // Clear lines & boxes
    lineMeshes.forEach(l => { try { scene.remove(l); } catch (e) {} });
    boxMeshes.forEach(b => { try { scene.remove(b); } catch (e) {} });
    lineMeshes = [];
    boxMeshes = [];

    // Draw lines
    if (gameState.dots && Array.isArray(gameState.dots.lines)) {
      gameState.dots.lines.forEach(lineKey => {
        const coords = (typeof lineKey === 'string' ? lineKey : '').split(',').map(Number);
        if (coords.length === 4) {
          const [x1, y1, x2, y2] = coords;
          // pass player if available
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

  /* ----------------------
     Render loop
     ---------------------- */
  function animate() {
    requestAnimationFrame(animate);

    // animate selected dot pulse
    const t = clock.getElapsed();
    if (selectedDot) scaleDotPulse(selectedDot, t);
    if (hoverDot && hoverDot !== selectedDot) {
      // slight bob on hover
      const bob = 1 + 0.03 * Math.sin(t * 4);
      hoverDot.scale.setScalar(bob);
    } else {
      // reset scales for non selected non-hover dots gradually
      dotMeshes.forEach(d => {
        if (d !== selectedDot && d !== hoverDot) {
          d.scale.lerp(new THREE.Vector3(1,1,1), 0.08);
        }
      });
    }

    if (isSceneReady && renderer && scene && camera) renderer.render(scene, camera);
  }

  /* ----------------------
     Window / UI helpers
     ---------------------- */
  function onWindowResize() {
    if (!camera || !renderer || !canvas) return;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      if (gameActive && gameState && gameState.status === 'active') {
        sendMessage({ type: 'requestGameState' });
        sendMessage({ type: 'checkTurnTimer' });
      }
    }, 3000);
  }

  function startTurnTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      sendMessage({ type: 'checkTurnTimer' });
    }, 1000);
  }

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
      if (reason === 'timeout') message = `Time's up! ${winner} wins by timeout.`;
      else {
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
    setTimeout(() => { if (modal.parentNode) modal.remove(); }, 5000);
  }

  function updateStatus() {
    if (!gameState) {
      if (statusElem) { statusElem.textContent = 'Loading...'; statusElem.className = 'status-display-3d'; }
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
      if (isMyTurn) { statusElem.style.background = 'rgba(40, 167, 69, 0.95)'; statusElem.style.color = 'white'; }
      else { statusElem.style.background = 'rgba(255, 255, 255, 0.95)'; statusElem.style.color = '#333'; }
    } else if (gameState.status === 'finished') {
      const winnerScore = gameState.dots?.scores?.[gameState.winner] || 0;
      statusElem.textContent = gameState.winner === currentUsername
        ? `🏆 You won with ${winnerScore} boxes!`
        : `😔 ${gameState.winner} won with ${winnerScore} boxes!`;
      statusElem.style.background = gameState.winner === currentUsername ? 'rgba(40, 167, 69, 0.95)' : 'rgba(220, 53, 69, 0.95)';
      statusElem.style.color = 'white';
    } else if (gameState.status === 'draw') {
      statusElem.textContent = "🤝 It's a draw!";
      statusElem.style.background = 'rgba(255, 193, 7, 0.95)';
      statusElem.style.color = '#333';
    }
  }

  function updateTimer(timeRemaining, currentTurn) {
    if (!timerElem) return;
    if (gameState && gameState.status === 'active' && gameState.players.length >= 2 && gameState.firstMoveMade) {
      timerElem.style.display = 'block';
      timerElem.className = 'timer-display-3d';
      timerElem.textContent = `⏰ ${timeRemaining}s - ${currentTurn}'s turn`;
      if (timeRemaining <= 10) timerElem.style.background = 'rgba(220, 53, 69, 0.95)';
      else timerElem.style.background = 'rgba(255, 107, 107, 0.95)';
    } else {
      timerElem.style.display = 'none';
    }
  }

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

  /* ----------------------
     Message handling
     ---------------------- */
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
        currentSessionId = message.data && message.data.sessionId;
        sendMessage({ type: 'initializeGame' });
        sendMessage({ type: 'requestGameState' });
        break;
      case 'gameState':
        gameState = message.data;
        gameActive = gameState.status === 'active';
        updateScene();
        updateStatus();
        updatePlayersInfo();
        // auto-join if needed
        if (!Array.isArray(gameState.players) || !gameState.players.includes(currentUsername)) {
          sendMessage({ type: 'joinGame', data: { username: currentUsername } });
        } else if (gameActive) { startAutoRefresh(); startTurnTimer(); }
        break;
      case 'playerJoined':
        if (message.data && message.data.gameState) {
          gameState = message.data.gameState;
          gameActive = gameState.status === 'active';
          updateScene(); updateStatus(); updatePlayersInfo();
          if (gameActive && gameState.players.includes(currentUsername)) { startAutoRefresh(); startTurnTimer(); }
        }
        break;
      case 'gameStarted':
        gameActive = true;
        if (message.data && message.data.gameState) {
          gameState = message.data.gameState;
          updateScene(); updateStatus(); updatePlayersInfo();
        }
        if (gameActive && gameState && Array.isArray(gameState.players) && gameState.players.includes(currentUsername)) {
          startAutoRefresh(); startTurnTimer();
        }
        break;
      case 'gameUpdate':
      case 'moveMade':
        if (message.data && (message.data.gameState || message.data)) {
          gameState = message.data.gameState || message.data;
          gameActive = gameState.status === 'active';
          // keep selection as user experience; if server changed something that invalidates selection, clear it
          if (selectedDot) {
            // if selected dot coordinates no longer valid, clear
            const { x, y } = selectedDot.userData || {};
            if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0) {
              safeSetEmissive(selectedDot, 0x000000); selectedDot = null;
            }
          }
          updateScene(); updateStatus(); updatePlayersInfo();
        }
        break;
      case 'turnChanged':
        updateStatus(); break;
      case 'timerUpdate':
        if (message.data) updateTimer(message.data.timeRemaining, message.data.currentTurn);
        break;
      case 'gameEnded':
        gameActive = false;
        if (refreshInterval) clearInterval(refreshInterval);
        if (timerInterval) clearInterval(timerInterval);
        if (message.data && message.data.finalState) {
          gameState = message.data.finalState;
          updateScene(); updateStatus(); updatePlayersInfo();
        }
        setTimeout(() => {
          showGameEndModal(message.data && message.data.winner, message.data && message.data.isDraw, message.data && message.data.reason);
        }, 500);
        break;
      case 'error':
        if (statusElem) {
          statusElem.textContent = `❌ Error: ${message.message || (message.data && message.data.message) || 'unknown'}`;
          statusElem.className = 'status-display-3d';
          statusElem.style.background = 'rgba(220, 53, 69, 0.95)';
          statusElem.style.color = 'white';
          setTimeout(() => { updateStatus(); }, 3000);
        }
        break;
    }
  }

  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => sendMessage({ type: 'webViewReady' }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUsername) sendMessage({ type: 'requestGameState' });
  });

  if (restartBtn) {
    restartBtn.addEventListener('click', () => sendMessage({ type: 'requestGameState' }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThreeJS);
  } else {
    initThreeJS();
  }

  // expose debug sendMessage
  window.sendMessage = sendMessage;

})();