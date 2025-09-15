(function () {
  // --- messaging helper ---
  function sendMessage(message) { window.parent.postMessage(message, '*'); }
  sendMessage({ type: 'webViewReady' });

  // --- DOM ---
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('gomokuStatus');
  const restartBtn = document.getElementById('gomokuRestart');
  const playersElem = document.getElementById('players-info');
  const timerElem = document.getElementById('timer');
  const loadingElem = document.getElementById('loading');

  // --- game state ---
  let gameState = null;
  let currentUsername = null;
  let gameActive = false;
  let refreshInterval = null;
  let timerInterval = null;

  // --- three / scene ---
  let scene, camera, renderer, raycaster, mouse;
  let boardIntersections = [];   // raycast targets for each cell
  let gameStones = [];           // authoritative stones shown on board
  let hoverPreview = null;       // small preview when pointer over cell
  let dragPreview = null;        // stone shown while dragging
  let particleSystem = null;
  let gridParent = null;
  let isSceneReady = false;

  // camera controls state
  let isCameraDragging = false;
  let prevPointer = { x: 0, y: 0 };
  let cameraDistance = 22;
  let cameraTheta = Math.PI / 4;
  let cameraPhi = Math.PI / 3;

  // pointer/drag state
  let activePointerId = null;
  let pointerStart = { x: 0, y: 0 };
  let pointerMoved = false;
  const DRAG_MOVE_THRESHOLD = 6; // px
  let draggingStone = false;     // true when user started dragging a stone
  let dragStartCell = null;      // {x,y}
  let lastHitCell = null;        // last cell raycast hit while dragging

  // board constants
  const SIZE = 15;
  const CELL = 1.0;
  const HALF = (SIZE - 1) / 2;

  // audio (tiny pop)
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
  }
  function popSound(correct = true) {
    ensureAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = correct ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(correct ? 720 : 380, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(correct ? 0.09 : 0.04, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(now); osc.stop(now + 0.11);
  }

  // --- camera helper ---
  function updateCameraPosition() {
    if (!camera) return;
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  // --- animation loop ---
  function animate() {
    requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;

    // particle gentle motion
    if (particleSystem) {
      const pos = particleSystem.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3 + 0] += Math.sin((Date.now() * 0.00022) + i) * 0.0006;
        pos.array[i * 3 + 2] += Math.cos((Date.now() * 0.00017) + i) * 0.0006;
      }
      pos.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }

  // --- init three.js ---
  function initThreeJS() {
    if (!canvas) { console.error('Canvas #gameCanvas not found'); return; }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06121a);

    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    updateCameraPosition();

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // lighting
    const amb = new THREE.AmbientLight(0x6a7b85, 0.9); scene.add(amb);
    const key = new THREE.DirectionalLight(0xfff7ea, 0.9); key.position.set(8, 18, 10); key.castShadow = true; scene.add(key);
    const blu = new THREE.PointLight(0x2ea6ff, 0.26, 120); blu.position.set(-12, 6, -14); scene.add(blu);
    const rim = new THREE.PointLight(0xff66aa, 0.14, 120); rim.position.set(12, 6, 14); scene.add(rim);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // ground / table
    createTable();

    // glass board with glowing separators & intersections
    createGlassGridBoard(); // sets boardIntersections

    // hover preview (small non-interactive)
    createHoverPreview();

    // subtle particles for atmosphere
    createParticles();

    // pointer events (unified for mouse & touch)
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerCancel, { passive: false });

    // wheel for zoom
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // small fallback click (desktop) - only used if pointer is not available, but safe to keep
    canvas.addEventListener('click', onCanvasClick);

    window.addEventListener('resize', onWindowResize);

    isSceneReady = true;
    if (loadingElem) loadingElem.style.display = 'none';
    animate();
  }

  // --- visuals: table & glass board ---
  function createTable() {
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(26, 1.6, 26),
      new THREE.MeshStandardMaterial({ color: 0x24160f, roughness: 0.95 })
    );
    table.position.y = -2.2;
    table.receiveShadow = true;
    scene.add(table);
  }

  function createGlassGridBoard() {
    gridParent = new THREE.Group();

    const width = SIZE * CELL + 1.4;
    const height = SIZE * CELL + 1.4;

    // glass - physical material with slight tint
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x071a26,
      roughness: 0.06,
      metalness: 0.02,
      transmission: 0.86,
      thickness: 0.6,
      clearcoat: 0.5,
      transparent: true,
      opacity: 0.92
    });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(width, 0.84, height), glassMat);
    glass.position.y = 0.36;
    glass.receiveShadow = true;
    gridParent.add(glass);

    // inner soft blue glow plane under the glass
    const innerGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.98, height * 0.98),
      new THREE.MeshBasicMaterial({ color: 0x1b9cff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    innerGlow.rotation.x = -Math.PI / 2;
    innerGlow.position.y = 0.5;
    gridParent.add(innerGlow);

    // separators (glowing thin walls between cells)
    const separatorMat = new THREE.MeshStandardMaterial({
      color: 0x1b9cff,
      emissive: 0x1b9cff,
      emissiveIntensity: 0.8,
      roughness: 0.12,
      metalness: 0.6
    });
    const separatorAdd = new THREE.MeshBasicMaterial({
      color: 0x1b9cff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false
    });

    const sepThickness = 0.06;
    const sepHeight = 0.18;

    // vertical separators
    for (let i = 0; i <= SIZE; i++) {
      const x = (i - HALF) * CELL - CELL / 2;
      const geo = new THREE.BoxGeometry(sepThickness, sepHeight, SIZE * CELL + 0.08);
      const line = new THREE.Mesh(geo, separatorMat);
      line.position.set(x, 0.72, 0);
      gridParent.add(line);

      const addPlane = new THREE.Mesh(new THREE.PlaneGeometry(sepThickness * 2.6, SIZE * CELL + 0.12), separatorAdd);
      addPlane.rotation.x = -Math.PI / 2;
      addPlane.position.set(x, 0.73, 0);
      addPlane.renderOrder = 1000;
      gridParent.add(addPlane);
    }

    // horizontal separators
    for (let j = 0; j <= SIZE; j++) {
      const z = (j - HALF) * CELL - CELL / 2;
      const geo = new THREE.BoxGeometry(SIZE * CELL + 0.08, sepHeight, sepThickness);
      const line = new THREE.Mesh(geo, separatorMat);
      line.position.set(0, 0.72, z);
      gridParent.add(line);

      const addPlane = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * CELL + 0.12, sepThickness * 2.6), separatorAdd);
      addPlane.rotation.x = -Math.PI / 2;
      addPlane.position.set(0, 0.73, z);
      addPlane.renderOrder = 1000;
      gridParent.add(addPlane);
    }

    // glowing intersections (little discs)
    const pointMat = new THREE.MeshStandardMaterial({
      color: 0x87e1ff, emissive: 0x87e1ff, emissiveIntensity: 0.5, roughness: 0.18, metalness: 0.4
    });
    const markerGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.08, 18);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const px = (x - HALF) * CELL;
        const pz = (y - HALF) * CELL;
        const marker = new THREE.Mesh(markerGeo, pointMat);
        marker.position.set(px, 0.72, pz);
        marker.rotation.x = Math.PI / 2;
        gridParent.add(marker);
      }
    }

    // invisible intersection planes for raycasting and occupancy
    boardIntersections = [];
    const interMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide });
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94), interMat);
        plane.position.set((x - HALF) * CELL, 0.74, (y - HALF) * CELL);
        plane.rotation.x = -Math.PI / 2;
        plane.userData = { x, y, occupied: false };
        gridParent.add(plane);
        boardIntersections.push(plane);
      }
    }

    // subtle rim/glass edge with blue emissive
    const rimGeo = new THREE.BoxGeometry(width + 0.18, 0.28, height + 0.18);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x062a46, emissive: 0x0f5fbf, emissiveIntensity: 0.14, roughness: 0.3 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(0, 0.62, 0);
    gridParent.add(rim);

    gridParent.position.y = 0;
    scene.add(gridParent);
  }

  // --- stones: black glass and white variants ---
  function createGlowingStone(colorName) {
    // black stone: deep black glass with tiny inner shine (oil-like).
    // white stone: glossy off-white.
    const isBlack = colorName === 'black-stone';
    const baseColor = isBlack ? 0x060608 : 0xf7f7f2;
    const emissiveColor = isBlack ? 0x0c2b3f : 0xffe6a8;

    // main body: use MeshPhysicalMaterial for glassy look
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: baseColor,
      metalness: isBlack ? 0.9 : 0.6,
      roughness: isBlack ? 0.06 : 0.18,
      clearcoat: isBlack ? 1.0 : 0.6,
      clearcoatRoughness: isBlack ? 0.02 : 0.08,
      reflectivity: isBlack ? 1.0 : 0.7,
      emissive: isBlack ? 0x000000 : 0x222222,
      emissiveIntensity: isBlack ? 0.02 : 0.06
    });

    const geom = new THREE.SphereGeometry(0.42, 40, 28);
    const body = new THREE.Mesh(geom, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    body.scale.set(1.0, 0.86, 1.0); // flattened stone profile

    // tiny bright highlight cap on top (oil-like shallow reflection)
    const capGeo = new THREE.CircleGeometry(0.2, 24);
    const capMat = new THREE.MeshStandardMaterial({ color: isBlack ? 0x142a3b : 0xffffff, roughness: 0.05, metalness: 0.9, emissive: emissiveColor, emissiveIntensity: isBlack ? 0.06 : 0.11 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 0.28;
    cap.renderOrder = 1001;

    // subtle additive halo sprite so stone is visible behind glass
    const canvasGlow = makeRadialTexture(isBlack ? '#122633' : '#ffdba0');
    const spriteMat = new THREE.SpriteMaterial({ map: canvasGlow, transparent: true, blending: THREE.AdditiveBlending, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.6, 1.6, 1.6);
    sprite.position.y = 0.28;
    sprite.renderOrder = 1000;

    const group = new THREE.Group();
    group.add(body);
    group.add(cap);
    group.add(sprite);
    group.userData = { type: colorName, base: body, cap, halo: sprite };
    return group;
  }

  // helper: radial texture for sprite halo
  function makeRadialTexture(cssColor) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, size*0.02, size/2, size/2, size*0.6);
    g.addColorStop(0, cssColor);
    g.addColorStop(0.18, cssColor);
    g.addColorStop(0.6, 'rgba(0,0,0,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
    return new THREE.CanvasTexture(c);
  }

  function createHoverPreview() {
    hoverPreview = createGlowingStone('black-stone');
    hoverPreview.visible = false;
    scene.add(hoverPreview);
  }

  // --- particles ---
  function createParticles() {
    const count = 80;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i*3] = (Math.random() - 0.5) * 28;
      positions[i*3+1] = Math.random() * 4 + 0.5;
      positions[i*3+2] = (Math.random() - 0.5) * 28;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ size: 0.08, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, map: generateSoftDot() });
    particleSystem = new THREE.Points(geo, mat);
    scene.add(particleSystem);
  }
  function generateSoftDot() {
    const size = 64;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.2, 'rgba(200,230,255,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
    return new THREE.CanvasTexture(c);
  }

  // --- input / pointer handling (drag-and-drop stone) ---
  function onPointerDown(evt) {
    if (!isSceneReady) return;
    // capture pointer if available
    try { canvas.setPointerCapture && canvas.setPointerCapture(evt.pointerId); } catch (e) {}
    activePointerId = evt.pointerId;
    pointerStart = { x: evt.clientX, y: evt.clientY };
    pointerMoved = false;
    prevPointer = { x: evt.clientX, y: evt.clientY };

    // check intersection
    const hit = pointerHitIntersection(evt.clientX, evt.clientY);
    if (hit && gameState && gameState.status === 'active' && gameState.turn === currentUsername && !hit.object.userData.occupied) {
      draggingStone = true;
      dragStartCell = { x: hit.object.userData.x, y: hit.object.userData.y };
      lastHitCell = dragStartCell;
      createOrReplaceDragPreviewForCurrentPlayer();
      const px = (dragStartCell.x - HALF) * CELL;
      const pz = (dragStartCell.y - HALF) * CELL;
      dragPreview.position.set(px, 0.28, pz);
      dragPreview.visible = true;
      // block camera while dragging a stone
      isCameraDragging = false;
    } else {
      // start camera drag
      isCameraDragging = true;
    }

    ensureAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    evt.preventDefault();
  }

  function onPointerMove(evt) {
    if (!isSceneReady) return;
    // ignore other pointers
    if (activePointerId !== null && evt.pointerId !== activePointerId) return;

    const dx = evt.clientX - pointerStart.x;
    const dy = evt.clientY - pointerStart.y;
    if (Math.abs(dx) > DRAG_MOVE_THRESHOLD || Math.abs(dy) > DRAG_MOVE_THRESHOLD) pointerMoved = true;

    if (draggingStone && dragPreview) {
      // follow hovered cell or world plane
      const hit = pointerHitIntersection(evt.clientX, evt.clientY);
      if (hit) {
        const x = hit.object.userData.x, y = hit.object.userData.y;
        lastHitCell = { x, y };
        const px = (x - HALF) * CELL;
        const pz = (y - HALF) * CELL;
        dragPreview.position.set(px, 0.28, pz);
        dragPreview.visible = true;
      } else {
        const worldPos = pointerToWorldOnBoard(evt.clientX, evt.clientY);
        if (worldPos) {
          dragPreview.position.set(worldPos.x, 0.28, worldPos.z);
          dragPreview.visible = true;
        } else {
          dragPreview.visible = false;
        }
      }
      evt.preventDefault();
      return;
    }

    if (isCameraDragging) {
      const pdx = evt.clientX - prevPointer.x;
      const pdy = evt.clientY - prevPointer.y;
      prevPointer = { x: evt.clientX, y: evt.clientY };
      cameraTheta += pdx * 0.0075;
      cameraPhi += pdy * 0.0075;
      cameraPhi = Math.max(0.12, Math.min(Math.PI - 0.12, cameraPhi));
      updateCameraPosition();
      evt.preventDefault();
      return;
    }

    // update hover preview (pointer moving but not dragging)
    updateHoverFromPointer(evt.clientX, evt.clientY);
  }

  function onPointerUp(evt) {
    if (!isSceneReady) return;
    if (activePointerId !== null && evt.pointerId !== activePointerId) return;

    try { canvas.releasePointerCapture && canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
    activePointerId = null;

    if (draggingStone) {
      // place the stone at lastHitCell if valid & empty
      if (lastHitCell && gameState && gameState.status === 'active' && gameState.turn === currentUsername) {
        const xi = lastHitCell.x, yi = lastHitCell.y;
        if (typeof xi === 'number' && typeof yi === 'number') {
          const idx = yi * SIZE + xi;
          const intersect = (boardIntersections && boardIntersections[idx]) ? boardIntersections[idx] : null;
          if (intersect && !intersect.userData.occupied) {
            // optimistic placement animation
            const px = (xi - HALF) * CELL;
            const pz = (yi - HALF) * CELL;
            const placedStone = createGlowingStone(getPlayerStone(currentUsername));
            placedStone.position.set(px, 8.0, pz);
            placedStone.visible = true;
            scene.add(placedStone);
            gameStones.push(placedStone);
            popSound(true);
            animateDrop(placedStone, 0.4, () => {
              intersect.userData.occupied = true;
              sendMessage({ type: 'makeMove', data: { username: currentUsername, position: [xi, yi], gameType: 'gomoku' } });
            });
          } else {
            popSound(false);
            if (intersect) shakeArea(intersect.position.x, intersect.position.z);
          }
        }
      }
      // clean up drag preview
      if (dragPreview && dragPreview.parent) { scene.remove(dragPreview); dragPreview = null; }
      draggingStone = false;
      dragStartCell = null;
      lastHitCell = null;
      evt.preventDefault();
      return;
    }

    // short click -> attempt tap placement
    const dx = evt.clientX - pointerStart.x;
    const dy = evt.clientY - pointerStart.y;
    if (!pointerMoved && Math.abs(dx) < DRAG_MOVE_THRESHOLD && Math.abs(dy) < DRAG_MOVE_THRESHOLD) {
      handleTapPlace(evt.clientX, evt.clientY);
    }

    isCameraDragging = false;
    pointerMoved = false;
    evt.preventDefault();
  }

  function onPointerCancel(evt) {
    if (activePointerId !== null && evt.pointerId === activePointerId) {
      activePointerId = null;
      draggingStone = false;
      if (dragPreview && dragPreview.parent) { scene.remove(dragPreview); dragPreview = null; }
    }
  }

  // convert pointer coords to intersection hit
  function pointerHitIntersection(clientX, clientY) {
    if (!canvas || !raycaster || !boardIntersections || boardIntersections.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(boardIntersections, true);
    return hits.length ? hits[0] : null;
  }

  // convert pointer to world position on board plane (y ~ 0.74) - fallback when pointer not over a cell
  function pointerToWorldOnBoard(clientX, clientY) {
    if (!canvas || !raycaster || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: mx, y: my }, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.74); // plane at y = 0.74
    const pos = new THREE.Vector3();
    const intersect = raycaster.ray.intersectPlane(plane, pos);
    return intersect ? pos : null;
  }

  // handle simple tap placement (non-drag)
  function handleTapPlace(clientX, clientY) {
    if (!isSceneReady || !gameState || !gameActive || gameState.status !== 'active') return;
    if (gameState.turn !== currentUsername) return;
    const hit = pointerHitIntersection(clientX, clientY);
    if (!hit) return;
    const ux = hit.object && hit.object.userData ? hit.object.userData.x : undefined;
    const uy = hit.object && hit.object.userData ? hit.object.userData.y : undefined;
    if (typeof ux !== 'number' || typeof uy !== 'number') return;
    const idx = uy * SIZE + ux;
    const intersect = (boardIntersections && boardIntersections[idx]) ? boardIntersections[idx] : null;
    if (intersect && !intersect.userData.occupied) {
      const x = intersect.userData.x, y = intersect.userData.y;
      const px = (x - HALF) * CELL;
      const pz = (y - HALF) * CELL;
      const placedStone = createGlowingStone(getPlayerStone(currentUsername));
      placedStone.position.set(px, 8.0, pz);
      scene.add(placedStone);
      gameStones.push(placedStone);
      popSound(true);
      animateDrop(placedStone, 0.4, () => {
        intersect.userData.occupied = true;
        sendMessage({ type: 'makeMove', data: { username: currentUsername, position: [x, y], gameType: 'gomoku' } });
      });
    } else {
      popSound(false);
      if (hit && hit.object) shakeArea(hit.object.position.x, hit.object.position.z);
    }
  }

  // create or replace dragPreview with current player's stone type
  function createOrReplaceDragPreviewForCurrentPlayer() {
    if (dragPreview && dragPreview.parent) {
      scene.remove(dragPreview);
      dragPreview = null;
    }
    const stoneType = getPlayerStone(currentUsername);
    dragPreview = createGlowingStone(stoneType);
    dragPreview.scale.set(1.05, 1.05, 1.05);
    dragPreview.visible = false;
    scene.add(dragPreview);
  }

  // wheel zoom
  function onWheel(e) {
    e.preventDefault();
    cameraDistance += e.deltaY * 0.02;
    cameraDistance = Math.max(12, Math.min(48, cameraDistance));
    updateCameraPosition();
  }

  // click fallback
  function onCanvasClick(e) {
    handleTapPlace(e.clientX, e.clientY);
  }

  function onWindowResize() {
    if (!canvas || !renderer || !camera) return;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  // animate drop
  function animateDrop(group, targetY, cb) {
    const startY = group.position.y;
    const duration = 480;
    const start = performance.now();
    (function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      group.position.y = startY + (targetY - startY) * ease;
      if (t < 1) requestAnimationFrame(frame);
      else {
        const up = 60, down = 120;
        setTimeout(() => { group.position.y = targetY + 0.06; setTimeout(() => { group.position.y = targetY; if (cb) cb(); }, down); }, up);
      }
    })(performance.now());
  }

  function shakeArea(x, z) {
    if (!gridParent) return;
    const originX = gridParent.position.x, originZ = gridParent.position.z;
    let n = 0;
    const max = 8;
    (function s() {
      gridParent.position.x = originX + (n % 2 === 0 ? 0.05 : -0.05);
      gridParent.position.z = originZ + (n % 2 === 0 ? -0.03 : 0.03);
      n++; if (n <= max) setTimeout(s, 28); else { gridParent.position.x = originX; gridParent.position.z = originZ; }
    })();
  }

  // --- hover preview logic ---
  function updateHoverFromPointer(clientX, clientY) {
    if (!isSceneReady || !boardIntersections || boardIntersections.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(boardIntersections, true);
    // default hide preview
    if (hoverPreview) hoverPreview.visible = false;
    if (hits.length > 0 && gameState && gameState.status === 'active' && gameState.turn === currentUsername) {
      const hit = hits[0].object;
      if (hit && hit.userData && !hit.userData.occupied) {
        const x = hit.userData.x, y = hit.userData.y;
        if (typeof x === 'number' && typeof y === 'number') {
          const px = (x - HALF) * CELL;
          const pz = (y - HALF) * CELL;
          if (hoverPreview) {
            // match player's stone color preview
            const desired = getPlayerStone(currentUsername);
            if (hoverPreview.userData && hoverPreview.userData.type !== desired) {
              scene.remove(hoverPreview);
              hoverPreview = createGlowingStone(desired);
              scene.add(hoverPreview);
            }
            hoverPreview.position.set(px, 0.28, pz);
            hoverPreview.visible = true;
          }
        }
      }
    }
  }

  // --- update scene from server authoritative state ---
  function updateScene() {
    if (!isSceneReady || !gameState) return;

    // remove previous stones
    gameStones.forEach(s => { if (s.parent) scene.remove(s); });
    gameStones = [];

    // reset occupied flags
    boardIntersections.forEach(i => { if (i) i.userData.occupied = false; });

    if (!Array.isArray(gameState.gomoku)) return;
    gameState.gomoku.forEach((cell, index) => {
      if (cell) {
        const x = index % SIZE;
        const y = Math.floor(index / SIZE);
        const px = (x - HALF) * CELL;
        const pz = (y - HALF) * CELL;
        const stoneType = getPlayerStone(cell);
        const g = createGlowingStone(stoneType);
        g.position.set(px, 0.4, pz);
        scene.add(g);
        gameStones.push(g);
        const intersectionIndex = y * SIZE + x;
        if (boardIntersections[intersectionIndex]) boardIntersections[intersectionIndex].userData.occupied = true;
      }
    });
  }

  function getPlayerStone(username) {
    if (!gameState || !Array.isArray(gameState.players)) return 'black-stone';
    const idx = gameState.players.indexOf(username);
    if (idx === 0) return 'black-stone';
    if (idx === 1) return 'white-stone';
    return username && username.toLowerCase().includes('white') ? 'white-stone' : 'black-stone';
  }

  // --- messaging & UI ---
  function handleMessage(event) {
    let message = event.data;
    if (message.type === 'devvit-message' && message.data && message.data.message) message = message.data.message;
    switch (message.type) {
      case 'initialData':
        currentUsername = message.data.username;
        sendMessage({ type: 'initializeGame' });
        sendMessage({ type: 'requestGameState' });
        break;
      case 'gameState':
        gameState = message.data;
        gameActive = gameState.status === 'active';
        // ensure we attempt to auto-join if missing
        tryAutoJoin();
        updateScene();
        updateStatus();
        updatePlayersInfo();
        if (gameActive) {
          startAutoRefresh();
          startTurnTimer();
        } else {
          if (refreshInterval) clearInterval(refreshInterval);
          if (timerInterval) clearInterval(timerInterval);
        }
        break;
      case 'moveMade':
      case 'gameUpdate':
        gameState = message.data.gameState || message.data;
        gameActive = gameState.status === 'active';
        updateScene(); updateStatus(); updatePlayersInfo();
        break;
      case 'timerUpdate':
        updateTimer(message.data.timeRemaining, message.data.currentTurn);
        break;
      case 'gameEnded':
        gameActive = false;
        if (refreshInterval) clearInterval(refreshInterval);
        if (timerInterval) clearInterval(timerInterval);
        if (message.data.finalState) { gameState = message.data.finalState; updateScene(); updateStatus(); updatePlayersInfo(); }
        setTimeout(() => { showGameEndModal(message.data.winner, message.data.isDraw, message.data.reason); }, 400);
        break;
      case 'error':
        if (statusElem) {
          statusElem.textContent = `❌ Error: ${message.message || message.data}`;
          statusElem.style.background = 'rgba(220,53,69,0.95)';
          statusElem.style.color = 'white';
        }
        break;
    }
  }

  function tryAutoJoin() {
    // If currentUsername is set and not in gameState.players, attempt to join
    if (currentUsername && gameState && Array.isArray(gameState.players)) {
      if (!gameState.players.includes(currentUsername)) {
        sendMessage({ type: 'joinGame', data: { username: currentUsername }});
        // request immediate refresh
        setTimeout(() => sendMessage({ type: 'requestGameState' }), 300);
      }
    }
  }

  function updateStatus() {
    if (!statusElem) return;
    if (!gameState) { statusElem.textContent = 'Loading...'; statusElem.className = 'status-display-3d'; return; }
    statusElem.className = 'status-display-3d';
    if (gameState.status === 'waiting') statusElem.textContent = `⏳ Waiting (${gameState.players.length}/${gameState.maxPlayers})`;
    else if (gameState.status === 'active') {
      const isMy = gameState.turn === currentUsername;
      const stoneType = getPlayerStone(gameState.turn) === 'black-stone' ? 'Black ⚫' : 'White ⚪';
      statusElem.textContent = isMy ? `🎯 Your turn (${stoneType})` : `⏳ ${gameState.turn}'s turn (${stoneType})`;
      statusElem.style.background = isMy ? 'rgba(40,167,69,0.95)' : 'rgba(255,255,255,0.95)';
      statusElem.style.color = isMy ? 'white' : '#333';
    } else if (gameState.status === 'finished') {
      statusElem.textContent = gameState.winner === currentUsername ? `🏆 You won!` : `😔 ${gameState.winner} won`;
      statusElem.style.background = gameState.winner === currentUsername ? 'rgba(40,167,69,0.95)' : 'rgba(220,53,69,0.95)';
      statusElem.style.color = 'white';
    } else if (gameState.status === 'draw') {
      statusElem.textContent = "🤝 It's a draw!";
      statusElem.style.background = 'rgba(255,193,7,0.95)';
      statusElem.style.color = '#333';
    }
  }

  function updatePlayersInfo() {
    if (!playersElem || !gameState) return;
    playersElem.className = 'status-display-3d';
    if (!Array.isArray(gameState.players) || gameState.players.length === 0) playersElem.textContent = '👥 No players yet';
    else playersElem.textContent = `👥 Players: ${gameState.players.map((p,i)=>`${p} (${i===0? '⚫': '⚪'})`).join(', ')}`;
  }

  function updateTimer(timeRemaining, currentTurn) {
    if (!timerElem) return;
    if (gameState && gameState.status === 'active' && gameState.players.length >= 2 && gameState.firstMoveMade) {
      timerElem.style.display = 'block';
      timerElem.textContent = `⏰ ${timeRemaining}s - ${currentTurn}'s turn`;
      timerElem.style.background = timeRemaining <= 10 ? 'rgba(220,53,69,0.95)' : 'rgba(255,107,107,0.95)';
    } else timerElem.style.display = 'none';
  }

  function showGameEndModal(winner, isDraw, reason) {
    const modal = document.createElement('div'); modal.className = 'modal';
    const box = document.createElement('div'); box.className = 'modal-content'; box.style.padding = '18px'; box.style.background = '#111'; box.style.color = '#fff'; box.style.borderRadius='8px';
    const title = document.createElement('h2'); const p = document.createElement('p');
    if (isDraw) { title.textContent = "🤝 It's a Draw"; p.textContent = 'No one reached five in a row.'; }
    else if (winner === currentUsername) { title.textContent = '🏆 You Win!'; p.textContent = 'Nice five in a row!'; }
    else { title.textContent = 'Game Over'; p.textContent = `${winner} won. ${reason || ''}`; }
    box.appendChild(title); box.appendChild(p);
    const btn = document.createElement('button'); btn.textContent = 'OK'; btn.style.marginTop = '12px'; btn.onclick = () => { modal.remove(); sendMessage({ type:'requestGameState' }); };
    box.appendChild(btn); modal.appendChild(box); document.body.appendChild(modal);
    setTimeout(()=> { if (modal.parentNode) modal.remove(); }, 6000);
  }

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => { if (gameActive) sendMessage({ type: 'requestGameState' }); }, 3000);
  }
  function startTurnTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => sendMessage({ type: 'checkTurnTimer' }), 1000);
  }

  // wire up messages + start
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => sendMessage({ type: 'webViewReady' }));
  if (restartBtn) restartBtn.addEventListener('click', () => sendMessage({ type: 'requestGameState' }));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThreeJS);
  else initThreeJS();

  // expose sendMessage for modal buttons / debugging
  window.sendMessage = sendMessage;
  window._gomokuState = () => gameState;

})();
