(function () {
  const GAME_TYPE = 'connect4';

  // Send ready
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

  // DOM
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('connect4Status');
  const restartBtn = document.getElementById('restartConnect4');
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

  // Three.js objects
  let scene, camera, renderer, raycaster, mouse;
  let boardColumns = [];       // clickable column meshes
  let gameDiscs = [];          // authoritative discs
  let transientDiscs = [];     // optimistic discs awaiting server
  let hoverDisc = null;        // hover preview (visible)
  let isSceneReady = false;
  let particleSystem = null;

  // camera control
  let isDragging = false;
  let prevPointer = { x: 0, y: 0 };
  let cameraDistance = 15;
  let cameraTheta = Math.PI / 4;
  let cameraPhi = Math.PI / 3;

  // touch
  let touchStartTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  let touchMoved = false;
  let lastTouchWasTap = false;
  const TOUCH_MOVE_THRESHOLD = 8;
  const TAP_MAX_DURATION = 300;

  // board constants
  const COL_COUNT = 7;
  const ROW_COUNT = 6;
  const COL_SPACING = 1.1;

  // audio
  let audioCtx = null;
  function ensureAudioContext() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; console.warn('AudioCtx not available', e); }
    }
  }
  function playPop(correct = true) {
    ensureAudioContext();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.03, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.6;
    const noise = audioCtx.createBufferSource(); noise.buffer = buffer;
    const nGain = audioCtx.createGain(); nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.exponentialRampToValueAtTime(correct ? 0.22 : 0.14, now + 0.004);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
    const filter = audioCtx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 700;
    noise.connect(nGain); nGain.connect(filter);
    const osc = audioCtx.createOscillator(); osc.type = correct ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(correct ? 720 : 440, now);
    const oGain = audioCtx.createGain(); oGain.gain.setValueAtTime(0.0001, now);
    oGain.gain.exponentialRampToValueAtTime(correct ? 0.18 : 0.11, now + 0.006);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    const band = audioCtx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = correct ? 950 : 520; band.Q.value = 1.6;
    osc.connect(oGain); oGain.connect(band);
    filter.connect(audioCtx.destination); band.connect(audioCtx.destination);
    noise.start(now); noise.stop(now + 0.035);
    osc.start(now); osc.stop(now + 0.07);
  }

  // helpers: map players/values to colors
  function mapPlayerToColor(val) {
    if (!gameState || !Array.isArray(gameState.players)) return 'red';
    const idx = gameState.players.indexOf(val);
    if (idx >= 0) return idx === 0 ? 'red' : 'yellow';
    if (val === 'red' || val === 'yellow') return val;
    if (val === currentUsername) {
      const myIdx = gameState.players.indexOf(currentUsername);
      return myIdx === 0 ? 'red' : 'yellow';
    }
    return 'red';
  }

  // coordinate conversions
  const files = null;
  function rowToY(rowIndex) { return ((ROW_COUNT - 1) / 2 - rowIndex) * COL_SPACING; }
  function colToX(colIndex) { return (colIndex - (COL_COUNT - 1) / 2) * COL_SPACING; }

  // ----- Visual helpers: glowing discs + glass frame -----

  // create an emissive disc + additive halo pair
  function createGlowingDisc(colorName) {
    // base disc material (solid, casts shadow)
    const baseColor = (colorName === 'red') ? 0xdc2626 : 0xfbbf24;
    const discMat = new THREE.MeshPhysicalMaterial({
      color: baseColor,
      roughness: 0.18,
      metalness: 0.66,
      clearcoat: 0.6,
      sheen: 0.3,
      emissive: baseColor,
      emissiveIntensity: 0.8,
      transparent: false
    });

    const geo = new THREE.CylinderGeometry(0.45, 0.45, 0.22, 48);
    const disc = new THREE.Mesh(geo, discMat);
    disc.rotation.x = Math.PI / 2;
    disc.castShadow = true;
    disc.receiveShadow = true;

    // halo: slightly larger, additive, depthTest false so glow shows through glass
    const haloGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.02, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthTest: false // ensures halo is visible through glass
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.renderOrder = 999; // render later so it appears on top

    // small inner emissive disc (glow core) rendered slightly above base (depthTest true for core)
    const coreGeo = new THREE.CircleGeometry(0.32, 32);
    const coreMat = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.01; // tiny offset so it sits just above disc top
    core.renderOrder = 998;

    // parent group
    const group = new THREE.Group();
    group.add(disc);
    group.add(core);
    group.add(halo);

    // attach convenience refs for animation & data
    group.userData = { base: disc, core, halo, colorName };
    return group;
  }

  // create glass frame with a blue rim glow (single coherent material)
  function createGlassFrame() {
    const width = COL_COUNT * COL_SPACING + 2;
    const height = ROW_COUNT * COL_SPACING + 2;
    const thickness = 1.6;

    // glass panel: use MeshPhysicalMaterial - 'transmission' gives glass-like effect in r125+; fallback to opacity
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b2940,
      roughness: 0.02,
      metalness: 0.05,
      transmission: 0.85, // if supported by renderer
      thickness: 0.8,
      clearcoat: 0.6,
      reflectivity: 0.35,
      envMapIntensity: 0.7,
      transparent: true,
      opacity: 0.85
    });

    const frameGeo = new THREE.BoxGeometry(width, height, thickness);
    const frame = new THREE.Mesh(frameGeo, glassMat);
    frame.receiveShadow = true;
    frame.castShadow = false;

    // blue rim (line edges) using a slightly enlarged box as glowing shell (additive)
    const rimGeo = new THREE.BoxGeometry(width * 1.005, height * 1.005, thickness * 1.06);
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x3ca7ff,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);

    // an inner subtle blue halo plane behind glass that gives the impression of the glass glowing from inside
    const glowGeo = new THREE.PlaneGeometry(width * 1.02, height * 1.02);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x256fbf,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.z = - (thickness / 2) - 0.01;

    const group = new THREE.Group();
    group.add(frame);
    group.add(rim);
    group.add(glow);

    // soft point lights to enhance the blue glow (subtle)
    const blueLight = new THREE.PointLight(0x3ca7ff, 0.45, Math.max(width, height) * 0.9);
    blueLight.position.set(width / 4, height / 8, -0.4);
    group.add(blueLight);

    const softFill = new THREE.PointLight(0x2b6fb5, 0.22, Math.max(width, height) * 0.9);
    softFill.position.set(-width / 5, -height / 10, 0.6);
    group.add(softFill);

    return group;
  }

  // ----- Scene & interaction -----

  function initThreeJS() {
    if (!canvas) {
      console.error('Canvas element not found (#gameCanvas)');
      return;
    }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07101a);
    scene.fog = new THREE.FogExp2(0x07101a, 0.02);

    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 400);
    updateCameraPosition();

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // lights - key / fill to shape discs; extra blue rim light added inside frame creation
    const amb = new THREE.AmbientLight(0x22313a, 0.9); scene.add(amb);
    const key = new THREE.DirectionalLight(0xfff5e6, 0.95); key.position.set(6, 12, 6); key.castShadow = true; scene.add(key);
    const warmFill = new THREE.PointLight(0xffc9a0, 0.22, 40); warmFill.position.set(3, 2, -5); scene.add(warmFill);

    // build environment
    const frameGroup = createGlassFrame();
    frameGroup.position.set(0, 0, 0);
    scene.add(frameGroup);

    createBoard();              // holes, rims, clickable columns
    createHoverDiscVisual();    // preview disc
    createAmbientParticles();   // subtle particles

    // ground / stand
    const stand = new THREE.Mesh(new THREE.BoxGeometry(16, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.95 }));
    stand.position.set(0, -((ROW_COUNT / 2) * COL_SPACING + 1.6), 0); stand.receiveShadow = true; scene.add(stand);

    // events
    canvas.addEventListener('mousedown', onPointerDown, false);
    canvas.addEventListener('mousemove', onPointerMove, false);
    canvas.addEventListener('mouseup', onPointerUp, false);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onCanvasClick, false);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('resize', onWindowResize);

    isSceneReady = true;
    if (loadingElem) loadingElem.style.display = 'none';

    animate(); // start loop
  }

  function updateCameraPosition() {
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  function onPointerDown(e) {
    isDragging = true;
    prevPointer = { x: e.clientX, y: e.clientY };
    ensureAudioContext(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function onPointerMove(e) {
    updateHover(e.clientX, e.clientY);
    if (!isDragging) return;
    const dx = e.clientX - prevPointer.x; const dy = e.clientY - prevPointer.y;
    prevPointer = { x: e.clientX, y: e.clientY };
    cameraTheta += dx * 0.008; cameraPhi += dy * 0.008;
    cameraPhi = Math.max(0.18, Math.min(Math.PI - 0.18, cameraPhi));
    updateCameraPosition();
  }
  function onPointerUp() { isDragging = false; }

  function onWheel(e) {
    e.preventDefault();
    cameraDistance += e.deltaY * 0.01;
    cameraDistance = Math.max(9, Math.min(26, cameraDistance));
    updateCameraPosition();
  }

  function onTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStartTime = Date.now();
      touchStartPos = { x: t.clientX, y: t.clientY };
      touchMoved = false; isDragging = false;
    }
    ensureAudioContext(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    e.preventDefault();
  }
  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartPos.x, dy = t.clientY - touchStartPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!touchMoved && dist > TOUCH_MOVE_THRESHOLD) { touchMoved = true; isDragging = true; prevPointer = { x: t.clientX, y: t.clientY }; }
    if (isDragging) {
      const mdx = t.clientX - prevPointer.x, mdy = t.clientY - prevPointer.y;
      prevPointer = { x: t.clientX, y: t.clientY };
      cameraTheta += mdx * 0.008; cameraPhi += mdy * 0.008;
      cameraPhi = Math.max(0.18, Math.min(Math.PI - 0.18, cameraPhi));
      updateCameraPosition();
    } else {
      updateHover(t.clientX, t.clientY);
    }
    e.preventDefault();
  }
  function onTouchEnd(e) {
    const dur = Date.now() - touchStartTime;
    if (!touchMoved && dur <= TAP_MAX_DURATION) {
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      const cx = t ? t.clientX : touchStartPos.x; const cy = t ? t.clientY : touchStartPos.y;
      handleInteraction(cx, cy);
      lastTouchWasTap = true; setTimeout(() => lastTouchWasTap = false, 350);
    }
    isDragging = false; touchMoved = false;
    e.preventDefault();
  }

  // create board clickable columns and decorative holes/rims
  function createBoard() {
    boardColumns = [];

    // for each column create a group with an invisible click mesh and visible hole rims
    for (let c = 0; c < COL_COUNT; c++) {
      const xPos = colToX(c);
      const colGroup = new THREE.Group();

      // invisible click mesh
      const clickGeo = new THREE.BoxGeometry(1.0, ROW_COUNT * COL_SPACING + 1.0, 2.0);
      const clickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
      const clickMesh = new THREE.Mesh(clickGeo, clickMat);
      clickMesh.position.set(xPos, 0, 0);
      clickMesh.userData = { column: c };
      colGroup.add(clickMesh);

      // holes and rims
      for (let r = 0; r < ROW_COUNT; r++) {
        const visualY = rowToY(r);
        // dark inner ring (hole depth illusion)
        const holeMat = new THREE.MeshStandardMaterial({ color: 0x00122a, roughness: 0.9, metalness: 0.08, transparent: true, opacity: 0.92 });
        const holeGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.6, 32);
        const hole = new THREE.Mesh(holeGeo, holeMat);
        hole.rotation.x = Math.PI / 2;
        hole.position.set(xPos, visualY, 0);
        hole.receiveShadow = true;
        colGroup.add(hole);

        // rim with blue tint
        const rimMat = new THREE.MeshStandardMaterial({ color: 0x3ca7ff, roughness: 0.14, metalness: 0.6 });
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 8, 32), rimMat);
        rim.rotation.copy(hole.rotation);
        rim.position.copy(hole.position);
        colGroup.add(rim);

        // micro glow ring (additive) for brightness inside glass
        const glowGeo = new THREE.TorusGeometry(0.45, 0.08, 8, 64);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0x3ca7ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.rotation.copy(hole.rotation);
        glow.position.copy(hole.position);
        colGroup.add(glow);
      }

      scene.add(colGroup);
      boardColumns.push(clickMesh);
    }
  }

  // hover preview disc - bright emissive and always visible
  function createHoverDiscVisual() {
    hoverDisc = createGlowingDisc('red'); // default, color changed later
    hoverDisc.visible = false;
    // to ensure hover is visible through glass, set halos to render on top
    hoverDisc.userData.halo = hoverDisc.userData.halo || null;
    scene.add(hoverDisc);
  }

  function setHoverColorFor(username) {
    if (!hoverDisc) return;
    const color = mapPlayerToColor(username);
    const colHex = (color === 'red') ? 0xdc2626 : 0xfbbf24;
    // update materials
    const base = hoverDisc.userData.base;
    base.material.color.setHex(colHex);
    base.material.emissive.setHex(colHex);
    hoverDisc.userData.core.material.color.setHex(colHex);
    hoverDisc.userData.halo.material.color.setHex(colHex);
    hoverDisc.visible = true;
  }

  // ambient particles
  function createAmbientParticles() {
    const count = 60;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 32;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6 + 1;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 32;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x66c8ff, size: 0.14, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false });
    particleSystem = new THREE.Points(geo, mat); scene.add(particleSystem);
  }

  // update hover based on pointer
  function updateHover(clientX, clientY) {
    if (!isSceneReady || boardColumns.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(boardColumns);
    if (hits.length > 0 && gameState && gameState.turn === currentUsername && gameState.status === 'active') {
      const col = hits[0].object.userData.column;
      const x = colToX(col);
      const topY = rowToY(0) + COL_SPACING * 0.9;
      hoverDisc.position.set(x, topY, 0.02);
      setHoverColorFor(currentUsername);
      hoverDisc.visible = true;
    } else {
      if (hoverDisc) hoverDisc.visible = false;
    }
  }

  // click/tap handling
  function onCanvasClick(e) {
    if (lastTouchWasTap) return;
    handleInteraction(e.clientX, e.clientY);
  }

  async function handleInteraction(clientX, clientY) {
    if (!gameState || !isSceneReady || !gameActive || gameState.status !== 'active') return;
    if (gameState.turn !== currentUsername) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(boardColumns);
    if (hits.length === 0) return;
    const column = hits[0].object.userData.column;

    // full-check
    if (gameState.connect4 && gameState.connect4[column] && gameState.connect4[column][0]) {
      shakeColumn(column);
      playPop(false);
      return;
    }
    // find lowest row (bottom-most null)
    let chosenRow = -1;
    for (let r = ROW_COUNT - 1; r >= 0; r--) {
      if (!gameState.connect4[column][r]) { chosenRow = r; break; }
    }
    if (chosenRow === -1) { shakeColumn(column); playPop(false); return; }

    // target visuals
    const targetY = rowToY(chosenRow);
    const color = mapPlayerToColor(currentUsername);
    const discGroup = createGlowingDisc(color);
    const startY = rowToY(0) + COL_SPACING * 3.2;
    const startX = colToX(column);
    discGroup.position.set(startX, startY, 0.02);
    scene.add(discGroup);
    transientDiscs.push(discGroup);

    if (hoverDisc) hoverDisc.visible = false;
    playPop(true);

    await animateDropTo(discGroup, targetY);

    // send to server (server authoritative)
    sendMessage({
      type: 'makeMove',
      data: { username: currentUsername, position: column, gameType: GAME_TYPE }
    });
  }

  function animateDropTo(group, targetY) {
    return new Promise(resolve => {
      const startY = group.position.y;
      const duration = 420;
      const arc = Math.max(0.8, (startY - targetY) * 0.25);
      const start = performance.now();
      (function frame() {
        const now = performance.now();
        const t = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        const y = startY + (targetY - startY) * ease - Math.sin(Math.PI * ease) * arc * (1 - ease);
        group.position.y = y;
        if (t < 1) requestAnimationFrame(frame);
        else {
          // bounce
          const orig = group.position.y;
          setTimeout(() => { group.position.y = orig + 0.08; setTimeout(() => { group.position.y = orig; resolve(); }, 100); }, 40);
        }
      })();
    });
  }

  function shakeColumn(colIndex) {
    const mesh = boardColumns[colIndex];
    if (!mesh) return;
    const g = mesh.parent || mesh;
    const originX = g.position.x;
    let n = 0;
    const max = 6;
    (function s() {
      g.position.x = originX + (n % 2 === 0 ? 0.06 : -0.06);
      n++; if (n <= max) setTimeout(s, 36); else g.position.x = originX;
    })();
  }

  // utility: remove all discs and re-render authoritative state
  function updateSceneFromState() {
    if (!isSceneReady || !gameState) return;
    // remove existing
    gameDiscs.forEach(d => { if (d.parent) scene.remove(d); });
    gameDiscs = [];

    // clear transients — do not re-add transient discs (server authoritative)
    transientDiscs.forEach(td => { if (td.parent) scene.remove(td); });
    transientDiscs = [];

    if (!gameState.connect4) return;
    for (let c = 0; c < COL_COUNT; c++) {
      for (let r = 0; r < ROW_COUNT; r++) {
        const cell = gameState.connect4[c][r];
        if (cell) {
          const color = mapPlayerToColor(cell);
          const g = createGlowingDisc(color);
          g.position.set(colToX(c), rowToY(r), 0.02);
          scene.add(g);
          gameDiscs.push(g);
        }
      }
    }
  }

  // animation loop
  function animate() {
    requestAnimationFrame(animate);
    // idle particle movement
    renderer.render(scene, camera);
    if (particleSystem) {
      const pos = particleSystem.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3 + 0] += Math.sin(Date.now() * 0.00025 + i) * 0.0006;
        pos.array[i * 3 + 2] += Math.cos(Date.now() * 0.0003 + i) * 0.0006;
      }
      pos.needsUpdate = true;
    }
  }

  function onWindowResize() {
    if (!isSceneReady) return;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  // UI & server messages
  function handleMessage(ev) {
    let message = ev.data;
    if (message.type === 'devvit-message' && message.data && message.data.message) message = message.data.message;
    switch (message.type) {
      case 'initialData':
        currentUsername = message.data.username;
        currentSessionId = message.data.sessionId;
        sendMessage({ type: 'initializeGame' });
        sendMessage({ type: 'requestGameState' });
        break;
      case 'gameState':
        gameState = message.data;
        gameActive = gameState.status === 'active';
        updateSceneFromState();
        updateUI();
        if (!gameState.players.includes(currentUsername)) {
          sendMessage({ type: 'joinGame', data: { username: currentUsername } });
        } else if (gameActive) {
          startAutoRefresh(); startTurnTimer();
        }
        break;
      case 'moveMade':
      case 'gameUpdate':
        gameState = message.data.gameState || message.data;
        gameActive = gameState.status === 'active';
        updateSceneFromState();
        updateUI();
        break;
      case 'playerJoined':
        if (message.data.gameState) {
          gameState = message.data.gameState; gameActive = gameState.status === 'active';
          updateSceneFromState(); updateUI();
          if (gameActive && gameState.players.includes(currentUsername)) { startAutoRefresh(); startTurnTimer(); }
        }
        break;
      case 'gameEnded':
        gameActive = false;
        if (refreshInterval) clearInterval(refreshInterval);
        if (timerInterval) clearInterval(timerInterval);
        if (message.data.finalState) { gameState = message.data.finalState; updateSceneFromState(); updateUI(); }
        setTimeout(() => { showGameEndModal(message.data.winner, message.data.isDraw, message.data.reason); }, 500);
        break;
      case 'timerUpdate':
        updateTimer(message.data.timeRemaining, message.data.currentTurn);
        break;
      case 'error':
        if (statusElem) { statusElem.textContent = `❌ Error: ${message.message}`; statusElem.style.background = 'rgba(220,53,69,0.95)'; statusElem.style.color = 'white'; }
        // Clear error message after 3 seconds
        setTimeout(() => {
          updateUI();
        }, 3000);
        break;
    }
  }

  function updateUI() {
    updateStatus(); updatePlayersInfo();
  }
  function updateStatus() {
    if (!statusElem) return;
    if (!gameState) { statusElem.textContent = 'Loading...'; return; }
    if (gameState.status === 'waiting') statusElem.textContent = `⏳ Waiting (${gameState.players.length}/${gameState.maxPlayers})`;
    else if (gameState.status === 'active') {
      const isMine = gameState.turn === currentUsername;
      const emoji = mapPlayerToColor(gameState.turn) === 'red' ? '🔴' : '🟡';
      statusElem.textContent = isMine ? `🎯 Your turn (${emoji})` : `⏳ ${gameState.turn}'s turn (${emoji})`;
      statusElem.style.background = isMine ? 'rgba(40,167,69,0.95)' : 'rgba(255,255,255,0.95)';
      statusElem.style.color = isMine ? 'white' : '#333';
    } else if (gameState.status === 'finished') {
      statusElem.textContent = gameState.winner === currentUsername ? `🏆 You won!` : `😔 ${gameState.winner} won`;
      statusElem.style.background = gameState.winner === currentUsername ? 'rgba(40,167,69,0.95)' : 'rgba(220,53,69,0.95)';
      statusElem.style.color = 'white';
    } else if (gameState.status === 'draw') {
      statusElem.textContent = "🤝 It's a draw!";
      statusElem.style.background = 'rgba(255,193,7,0.95)'; statusElem.style.color = '#333';
    }
  }
  function updatePlayersInfo() {
    if (!playersElem || !gameState) return;
    playersElem.className = 'status-display-3d';
    if (gameState.players.length === 0) playersElem.textContent = '👥 No players yet';
    else {
      playersElem.textContent = `👥 Players: ${gameState.players.map((p, i) => `${p} (${i === 0 ? '🔴' : '🟡'})`).join(', ')}`;
    }
  }
  function updateTimer(timeRemaining, currentTurn) {
    if (!timerElem) return;
    if (gameState && gameState.status === 'active' && gameState.firstMoveMade) {
      timerElem.style.display = 'block'; timerElem.textContent = `⏰ ${timeRemaining}s - ${currentTurn}'s turn`;
      timerElem.style.background = timeRemaining <= 10 ? 'rgba(220,53,69,0.95)' : 'rgba(255,107,107,0.95)';
    } else { timerElem.style.display = 'none'; }
  }

  function showGameEndModal(winner, isDraw, reason) {
    const modal = document.createElement('div'); modal.className = 'modal';
    let title = '', msg = '', emoji = '';
    if (isDraw) { title = "It's a Draw"; msg = "Board is full or draw condition reached."; emoji = '🤝'; }
    else if (winner === currentUsername) { title = "You Win!"; msg = "Nice connect-4!"; emoji = '🏆'; }
    else { title = "You Lose"; msg = `${winner} connected 4.`; emoji = '😔'; }
    modal.innerHTML = `<div class="modal-content" style="padding:18px;background:#111;color:#fff;border-radius:8px;"><h2>${emoji} ${title}</h2><p>${msg}</p><button style="margin-top:8px;padding:8px 12px;border-radius:6px;" onclick="this.closest('.modal').remove(); window.parent.postMessage({type:'requestGameState'}, '*');">OK</button></div>`;
    document.body.appendChild(modal); setTimeout(() => { if (modal.parentNode) modal.remove(); }, 5000);
  }

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => { if (gameActive) sendMessage({ type: 'requestGameState' }); }, 3000);
  }
  function startTurnTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => sendMessage({ type: 'checkTurnTimer' }), 1000);
  }

  // listeners & init
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => sendMessage({ type: 'webViewReady' }));
  restartBtn && restartBtn.addEventListener('click', () => sendMessage({ type: 'restartGame' }));

 // Request fresh game state when tab becomes visible (helps with reconnection)
 document.addEventListener('visibilitychange', () => {
   if (!document.hidden && currentUsername) {
     sendMessage({ type: 'requestGameState' });
   }
 });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThreeJS);
  else initThreeJS();

  // expose for debug
  window.sendMessage = sendMessage;
})();