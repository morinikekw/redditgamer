(function() {
  // Send webViewReady immediately when script loads
  function sendMessage(message) {
    window.parent.postMessage(message, '*');
  }

  // Notify parent immediately that web view is ready
  sendMessage({ type: 'webViewReady' });

  // DOM elements
  const canvas = document.getElementById('gameCanvas');
  const startBtn = document.getElementById('startGame');
  const scoreElem = document.getElementById('reactionScore');
  const leaderboardElem = document.getElementById('leaderboard');
  const playersElem = document.getElementById('players-info');
  const paginationElem = document.getElementById('pagination');
  const loadingElem = document.getElementById('loading');

  // Game state
  let currentUsername = "Guest";
  let gameActive = false;
  let score = 0;
  let clickTimes = [];
  let gameTimer = null;
  let refreshInterval = null;
  let allScores = [];
  let currentPage = 0;
  const scoresPerPage = 5;

  // Three.js variables
  let scene, camera, renderer, raycaster, mouse;
  let gridCubes = [];
  let overlayMaterials = []; // keep overlay shader materials so we can update cameraPos
  let activeCube = null;
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 12;
  let cameraTheta = Math.PI / 4; // azimuth
  let cameraPhi = Math.PI / 3;   // polar

  // Idle orbit
  let lastInteractionTime = Date.now();

  // Particle system
  let particleSystem = null;

  // Touch/tap detection (robust)
  let touchStartTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  let touchMoved = false;
  let lastTouchWasTap = false;
  const TOUCH_MOVE_THRESHOLD = 10; // px - slightly larger for reliability
  const TAP_MAX_DURATION = 300; // ms

  // Visual constants
  const GRID_SIZE = 5;
  const CELL_SPACING = 1.5;

  // Easing helpers
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutQuad(t) { return t * (2 - t); }

  // Audio: small pop synth (no external files)
  let audioCtx = null;
  function ensureAudioContext() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('AudioContext not available', e);
        audioCtx = null;
      }
    }
  }

  function playPop(correct = true) {
    ensureAudioContext();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    // Create a short noise burst layer for 'pop' body
    const bufferSize = Math.floor(audioCtx.sampleRate * 0.03); // 30ms noise
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (0.5 - i / bufferSize * 0.45);

    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(correct ? 0.22 : 0.16, now + 0.005);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
    noise.connect(noiseGain);
    // Filter to give glassy bite
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 800;
    noiseGain.connect(noiseFilter);

    // Tone layer
    const osc = audioCtx.createOscillator();
    osc.type = correct ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(correct ? 600 : 420, now);
    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(correct ? 0.18 : 0.12, now + 0.006);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    // slight bandpass on tone for clarity
    const toneFilter = audioCtx.createBiquadFilter();
    toneFilter.type = 'bandpass';
    toneFilter.frequency.value = correct ? 900 : 520;
    toneFilter.Q.value = 1.6;

    // Master mapping to destination
    noiseFilter.connect(audioCtx.destination);
    osc.connect(oscGain);
    oscGain.connect(toneFilter);
    toneFilter.connect(audioCtx.destination);

    noise.start(now);
    noise.stop(now + 0.035);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  // Initialize Three.js scene
  function initThreeJS() {
    scene = new THREE.Scene();
    // deep almost-black glassy sky sphere for contrast
    const skyGeo = new THREE.SphereGeometry(120, 32, 32);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x03040a, side: THREE.BackSide });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    // subtle fog for depth
    scene.fog = new THREE.FogExp2(0x03040a, 0.02);

    // Camera
    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
    updateCameraPosition();

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting - layered dramatic lighting
    const ambientLight = new THREE.AmbientLight(0x202838, 0.9);
    scene.add(ambientLight);

    const key = new THREE.DirectionalLight(0xfff7e6, 1.0);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.width = 2048;
    key.shadow.mapSize.height = 2048;
    scene.add(key);

    const coolFill = new THREE.PointLight(0x4fb0ff, 0.5, 40);
    coolFill.position.set(-7, 6, -6);
    scene.add(coolFill);

    const warmRim = new THREE.PointLight(0xff66aa, 0.35, 40);
    warmRim.position.set(6, 4, -4);
    scene.add(warmRim);

    // Raycaster + mouse
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create scene content
    createGrid();
    createParticleSystem();

    // Ground / platform with glossy reflection-like look
    const platformGeo = new THREE.PlaneGeometry(60, 60);
    const platformMat = new THREE.MeshPhysicalMaterial({
      color: 0x07080b,
      roughness: 0.18,
      metalness: 0.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.rotation.x = -Math.PI / 2;
    platform.position.y = -3;
    platform.receiveShadow = true;
    scene.add(platform);

    // Input listeners
    canvas.addEventListener('mousedown', onMouseDown, false);
    canvas.addEventListener('mousemove', onMouseMove, false);
    canvas.addEventListener('mouseup', onMouseUp, false);
    canvas.addEventListener('wheel', onMouseWheel, { passive: false });
    canvas.addEventListener('click', onCanvasClick, false);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('resize', onWindowResize);

    // Start loop
    animate();

    // Hide loading
    if (loadingElem) loadingElem.style.display = 'none';
    isSceneReady = true;
  }

  // Update camera based on spherical coords
  function updateCameraPosition() {
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  // Mouse handlers
  function onMouseDown(e) {
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
    lastInteractionTime = Date.now();
    // resume audio context on first user gesture (some browsers require)
    ensureAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function onMouseMove(e) {
    updateHoverFromPointer(e.clientX, e.clientY);
    if (!isDragging) return;
    const dx = e.clientX - previousMousePosition.x;
    const dy = e.clientY - previousMousePosition.y;
    previousMousePosition = { x: e.clientX, y: e.clientY };
    cameraTheta += dx * 0.008;
    cameraPhi += dy * 0.008;
    cameraPhi = Math.max(0.2, Math.min(Math.PI - 0.2, cameraPhi));
    updateCameraPosition();
    lastInteractionTime = Date.now();
  }

  function onMouseUp() {
    isDragging = false;
    lastInteractionTime = Date.now();
  }

  function onMouseWheel(e) {
    e.preventDefault();
    cameraDistance += e.deltaY * 0.01;
    cameraDistance = Math.max(8, Math.min(20, cameraDistance));
    updateCameraPosition();
  }

  // Touch handlers (tap vs pan)
  function onTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStartTime = Date.now();
      touchStartPos = { x: t.clientX, y: t.clientY };
      touchMoved = false;
      isDragging = false; // only become dragging if move passes threshold
    }
    // resume audio on touch
    ensureAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    e.preventDefault();
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartPos.x;
    const dy = t.clientY - touchStartPos.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (!touchMoved && dist > TOUCH_MOVE_THRESHOLD) {
      touchMoved = true;
      isDragging = true;
      previousMousePosition = { x: t.clientX, y: t.clientY };
    }

    if (isDragging) {
      const mdx = t.clientX - previousMousePosition.x;
      const mdy = t.clientY - previousMousePosition.y;
      previousMousePosition = { x: t.clientX, y: t.clientY };
      cameraTheta += mdx * 0.008;
      cameraPhi += mdy * 0.008;
      cameraPhi = Math.max(0.2, Math.min(Math.PI - 0.2, cameraPhi));
      updateCameraPosition();
    } else {
      // update hover for finger
      updateHoverFromPointer(t.clientX, t.clientY);
    }
    lastInteractionTime = Date.now();
    e.preventDefault();
  }

  function onTouchEnd(e) {
    const duration = Date.now() - touchStartTime;
    if (!touchMoved && duration <= TAP_MAX_DURATION) {
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      const cx = t ? t.clientX : touchStartPos.x;
      const cy = t ? t.clientY : touchStartPos.y;
      handleInteraction(cx, cy);
      lastTouchWasTap = true;
      setTimeout(() => lastTouchWasTap = false, 400);
    }
    isDragging = false;
    touchMoved = false;
    lastInteractionTime = Date.now();
    e.preventDefault();
  }

  // Create grid of cubes (glass-like black tiles with bright rim overlay shader)
  function createGrid() {
    gridCubes = [];
    overlayMaterials = [];

    // glass-like tile base under cubes (darker so cubes pop)
    const tileGeo = new THREE.PlaneGeometry(GRID_SIZE * CELL_SPACING + 2, GRID_SIZE * CELL_SPACING + 2);
    const tileMat = new THREE.MeshPhysicalMaterial({
      color: 0x050812,
      roughness: 0.12,
      metalness: 0.2,
      clearcoat: 0.9,
      clearcoatRoughness: 0.06,
      reflectivity: 0.6,
      transparent: true,
      opacity: 0.95
    });
    const tile = new THREE.Mesh(tileGeo, tileMat);
    tile.rotation.x = -Math.PI / 2;
    tile.position.y = -1.0;
    tile.receiveShadow = true;
    scene.add(tile);

    // overlay shader: additive white Fresnel-like highlight that depends on camera position (world-space).
    // Vertex shader computes vWorldPos and vNormal (world-space), fragment computes fresnel = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(cameraPos - vWorldPos))), exponent)
    const overlayVertex = `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;
    const overlayFragment = `
      uniform vec3 cameraPos;
      uniform vec3 highlightColor;
      uniform float intensity;
      uniform float exponent;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vec3 viewDir = normalize(cameraPos - vWorldPos);
        float ndotv = max(0.0, dot(normalize(vNormal), viewDir));
        float fresnel = pow(1.0 - ndotv, exponent);
        // Make the highlight slightly stronger at grazing angles, clamp
        float alpha = clamp(fresnel * intensity, 0.0, 0.9);
        vec3 col = highlightColor * fresnel * intensity;
        // additive blending expected; output premultiplied color
        gl_FragColor = vec4(col, alpha);
      }
    `;

    // create cubes and overlays
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const geo = new THREE.BoxGeometry(1, 1, 1);

        // base physical material for the cube (glassy near-black)
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0x0e1116,            // deep near-black
          roughness: 0.12,
          metalness: 0.2,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05,
          reflectivity: 0.8,
          transmission: 0.05,
          transparent: true,
          opacity: 0.95,
          envMapIntensity: 0.9
        });
        const cube = new THREE.Mesh(geo, mat);
        cube.castShadow = true;
        cube.receiveShadow = true;
        cube.position.set((c - 2) * CELL_SPACING, 0.5, (r - 2) * CELL_SPACING);
        cube.userData = { row: r, col: c, index: r * GRID_SIZE + c, highlightTime: 0 };

        // create an overlay mesh slightly larger than the cube
        const overlayGeo = geo.clone();
        const overlayMat = new THREE.ShaderMaterial({
          vertexShader: overlayVertex,
          fragmentShader: overlayFragment,
          uniforms: {
            cameraPos: { value: new THREE.Vector3() },
            highlightColor: { value: new THREE.Color(0xffffff) }, // white highlight
            intensity: { value: 1.2 },
            exponent: { value: 2.6 }
          },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        const overlayMesh = new THREE.Mesh(overlayGeo, overlayMat);
        overlayMesh.scale.set(1.03, 1.03, 1.03); // slightly larger to avoid Z-fighting
        overlayMesh.position.copy(cube.position);

        // keep references to update camera uniform each frame
        overlayMaterials.push(overlayMat);

        // ring (glow) under cube to improve visibility in all lighting situations
        const ringGeo = new THREE.RingGeometry(0.65, 0.95, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00ffd8,
          transparent: true,
          opacity: 0.0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(cube.position.x, 0.01, cube.position.z);
        ring.renderOrder = 999;
        cube.userData.ring = ring;

        // small glossy highlight plane on top to show reflections better
        const capGeo = new THREE.PlaneGeometry(0.9, 0.9);
        const capMat = new THREE.MeshStandardMaterial({
          color: 0x000000,
          roughness: 0.04,
          metalness: 0.1,
          transparent: true,
          opacity: 0.08
        });
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.rotation.x = -Math.PI / 2;
        cap.position.set(cube.position.x, 1.01, cube.position.z);
        scene.add(cap);

        scene.add(ring);
        scene.add(cube);
        scene.add(overlayMesh);

        // store overlay mesh for easier cleanup/animation relation (attach so it moves with cube if we animate)
        cube.userData.overlay = overlayMesh;

        gridCubes.push(cube);
      }
    }
  }

  // Particle system for background ambiance (slow drifting orbs)
  function createParticleSystem() {
    const count = 60;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i*3] = (Math.random() - 0.5) * 30;
      positions[i*3+1] = (Math.random() - 0.5) * 6 + 1;
      positions[i*3+2] = (Math.random() - 0.5) * 30;
      sizes[i] = Math.random() * 0.25 + 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      color: 0x66b7ff,
      size: 0.16,
      transparent: true,
      opacity: 0.20,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    particleSystem = new THREE.Points(geo, mat);
    scene.add(particleSystem);
  }

  // pick and highlight a random cube with smooth transitions
  function highlightRandomCube() {
    // reset existing visuals
    gridCubes.forEach(cube => {
      cube.material.color.setHex(0x0e1116);
      cube.material.emissive.setHex(0x000000);
      if (cube.userData.ring) cube.userData.ring.material.opacity = 0.0;
      cube.scale.set(1,1,1);
    });

    const idx = Math.floor(Math.random() * gridCubes.length);
    activeCube = gridCubes[idx];
    activeCube.userData.highlightTime = performance.now();

    // animate emissive bloom/pulse via scale & emissive
    const start = performance.now();
    const duration = 700;
    const initialScale = 1;
    const targetScale = 1.22;
    const emissiveColor = 0x00ffd8; // bright teal glow

    // show ring glow under tile
    if (activeCube.userData.ring) {
      activeCube.userData.ring.material.color.setHex(emissiveColor);
      activeCube.userData.ring.material.opacity = 0.32;
    }

    (function pulse() {
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutQuad(t);
      activeCube.scale.set(
        lerp(initialScale, targetScale, eased),
        lerp(initialScale, targetScale, eased),
        lerp(initialScale, targetScale, eased)
      );
      // emissive intensity control (approx using RGB scale)
      const baseIntensity = lerp(0, 0.65, eased);
      const r = ((emissiveColor >> 16) & 0xff) * baseIntensity;
      const g = ((emissiveColor >> 8) & 0xff) * baseIntensity;
      const b = (emissiveColor & 0xff) * baseIntensity;
      const colorHex = ((Math.round(r) & 0xff) << 16) | ((Math.round(g) & 0xff) << 8) | (Math.round(b) & 0xff);
      activeCube.material.emissive.setHex(colorHex || 0x001f17);
      if (t < 1) requestAnimationFrame(pulse);
    })();
  }

  // Generate a burst effect at a given position (correct click)
  function createCorrectBurst(position) {
    const count = 40;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = position.x;
      positions[i3+1] = position.y;
      positions[i3+2] = position.z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1.4;
      velocities[i3] = Math.cos(angle) * speed;
      velocities[i3+1] = (Math.random() * 0.9 + 0.4);
      velocities[i3+2] = Math.sin(angle) * speed;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8cffdf,
      size: 0.12,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);

    let life = 0;
    const maxLife = 1.0;
    function step(dt) {
      life += dt;
      const pos = geo.attributes.position.array;
      const vel = geo.attributes.velocity.array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] += vel[i] * dt * 60;
        pos[i+1] += vel[i+1] * dt * 60 - dt * 1.6;
        pos[i+2] += vel[i+2] * dt * 60;
        vel[i] *= 0.985;
        vel[i+1] *= 0.985;
        vel[i+2] *= 0.985;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - life / maxLife);
      if (life < maxLife) {
        requestAnimationFrame((t) => step(0.016));
      } else {
        scene.remove(pts);
      }
    }
    step(0);
  }

  // Wrong click ripple
  function createWrongRipple(position) {
    const ringGeo = new THREE.RingGeometry(0.6, 0.9, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(position);
    ring.position.y -= 0.4;
    ring.rotation.x = -Math.PI/2;
    scene.add(ring);

    const start = performance.now();
    const dur = 520;
    (function expand() {
      const now = performance.now();
      const t = Math.min(1, (now - start) / dur);
      ring.scale.set(lerp(1, 2.8, t), 1, lerp(1, 2.8, t));
      ring.material.opacity = lerp(0.9, 0, t);
      if (t < 1) requestAnimationFrame(expand);
      else scene.remove(ring);
    })();
  }

  // Canvas click (desktop)
  function onCanvasClick(e) {
    if (lastTouchWasTap) return;
    handleInteraction(e.clientX, e.clientY);
  }

  // Hover indicator for mouse/finger (slight glow on hovered cube)
  function updateHoverFromPointer(clientX, clientY) {
    if (!isSceneReady) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(gridCubes);
    // clear previous hover rings if any except activeCube's ring
    gridCubes.forEach(c => {
      if (c !== activeCube && c.userData.ring) c.userData.ring.material.opacity = 0.0;
    });
    if (intersects.length > 0) {
      const hovered = intersects[0].object;
      if (hovered.userData.ring) hovered.userData.ring.material.opacity = 0.12;
    }
  }

  // Main interaction handler
  function handleInteraction(clientX, clientY) {
    if (!gameActive || !isSceneReady) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(gridCubes);
    if (intersects.length === 0) return;
    const clicked = intersects[0].object;

    if (!activeCube) {
      return;
    }

    if (clicked === activeCube) {
      // correct
      const reaction = performance.now() - activeCube.userData.highlightTime;
      clickTimes.push(reaction);
      score++;
      // visual feedback
      activeCube.material.color.setHex(0x00ffb3);
      activeCube.material.emissive.setHex(0x002b1a);
      createCorrectBurst(activeCube.position.clone().add(new THREE.Vector3(0,0.2,0)));
      // small scale pop animation
      animateScale(activeCube, 1.4, 160).then(() => {
        if (gameActive) highlightRandomCube();
      });
      // audio pop
      playPop(true);
      // update score display
      const avgTime = clickTimes.length ? (clickTimes.reduce((a,b)=>a+b,0)/clickTimes.length) : 0;
      scoreElem && (scoreElem.textContent = `Score: ${score} | Avg: ${Math.round(avgTime)}ms`);
    } else {
      // wrong - negative feedback
      clicked.material.color.setHex(0xff3366);
      clicked.material.emissive.setHex(0x22000a);
      createWrongRipple(clicked.position.clone());
      animateShake(clicked);
      playPop(false);
      // after short delay, restore cube appearance
      setTimeout(() => {
        clicked.material.color.setHex(0x0e1116);
        clicked.material.emissive.setHex(0x000000);
      }, 260);
    }
    lastInteractionTime = Date.now();

    // small ambient lighting pulse on correct/wrong
    pulseAmbient();
  }

  // animate scale helper returns promise
  function animateScale(mesh, peak, ms) {
    return new Promise(resolve => {
      const start = performance.now();
      const from = mesh.scale.x;
      const dur = ms;
      (function step() {
        const now = performance.now();
        const t = Math.min(1, (now - start) / dur);
        const eased = easeOutQuad(t);
        const s = lerp(from, peak, (1 - Math.abs(1 - 2*eased))); // pulse to peak then back
        mesh.scale.set(s, s, s);
        if (t < 1) requestAnimationFrame(step); else { mesh.scale.set(1,1,1); resolve(); }
      })();
    });
  }

  // small shake animation
  function animateShake(mesh) {
    const start = performance.now();
    const dur = 260;
    const orig = mesh.position.clone();
    (function step() {
      const now = performance.now();
      const t = Math.min(1, (now - start) / dur);
      const shake = Math.sin(t * Math.PI * 6) * (1 - t) * 0.12;
      mesh.position.x = orig.x + shake;
      mesh.position.z = orig.z + (shake * 0.3);
      if (t < 1) requestAnimationFrame(step);
      else { mesh.position.copy(orig); }
    })();
  }

  // small ambient light pulse
  function pulseAmbient() {
    const found = scene.children.find(c => c.isPointLight && c.color && c.color.getHex() === 0x4fb0ff);
    if (!found) return;
    const light = found;
    const startIntensity = light.intensity;
    const start = performance.now();
    const dur = 320;
    (function step() {
      const now = performance.now();
      const t = Math.min(1, (now - start) / dur);
      light.intensity = lerp(startIntensity, startIntensity + 0.8, 1 - Math.abs(1 - 2 * t));
      if (t < 1) requestAnimationFrame(step);
      else light.intensity = startIntensity;
    })();
  }

  // animation loop
  function animate() {
    requestAnimationFrame(animate);

    // update overlay materials' cameraPos so highlight follows camera (and remains visible at all rotations)
    overlayMaterials.forEach(mat => {
      if (mat && mat.uniforms && mat.uniforms.cameraPos) {
        mat.uniforms.cameraPos.value.copy(camera.position);
      }
    });

    // idle camera gentle orbit if no interaction for 3.5s
    const idleTime = Date.now() - lastInteractionTime;
    if (!isDragging && idleTime > 3500) {
      cameraTheta += 0.0008 * (1 + Math.sin(Date.now()*0.001));
      cameraPhi = lerp(cameraPhi, Math.PI/3.2, 0.002);
      updateCameraPosition();
    }

    // particle subtle motion
    if (particleSystem) {
      const posAttr = particleSystem.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.array[i*3+0] += Math.sin((Date.now()*0.0002) + i) * 0.0006;
        posAttr.array[i*3+2] += Math.cos((Date.now()*0.00025) + i) * 0.0006;
      }
      posAttr.needsUpdate = true;
    }

    // pulse ring opacity on activeCube
    if (activeCube && activeCube.userData.ring) {
      const ring = activeCube.userData.ring;
      ring.material.opacity = 0.32 + Math.sin(Date.now() * 0.01) * 0.06;
    }

    renderer.render(scene, camera);
  }

  // handle window resize
  function onWindowResize() {
    if (!isSceneReady) return;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  // start game
  function startGame() {
    score = 0;
    clickTimes = [];
    gameActive = true;
    startBtn.disabled = true;
    startBtn.textContent = 'Game in Progress...';
    scoreElem && (scoreElem.textContent = `Score: ${score}`);
    highlightRandomCube();
    // run for 20s
    gameTimer && clearTimeout(gameTimer);
    gameTimer = setTimeout(endGame, 20000);
  }

  // end game
  function endGame() {
    gameActive = false;
    startBtn.disabled = false;
    startBtn.textContent = 'Start Game';
    // reset visuals
    gridCubes.forEach(cube => {
      cube.material.color.setHex(0x0e1116);
      cube.material.emissive.setHex(0x000000);
      if (cube.userData.ring) cube.userData.ring.material.opacity = 0.0;
      cube.scale.set(1,1,1);
    });
    activeCube = null;

    // stats
    const avgTime = clickTimes.length ? (clickTimes.reduce((a,b)=>a+b,0)/clickTimes.length) : 0;
    const sorted = [...clickTimes].sort((a,b)=>a-b);
    const median = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
    const avgRounded = Number(avgTime.toFixed(2));
    scoreElem && (scoreElem.textContent = `Final Score: ${score} | Avg: ${avgRounded}ms`);

    // modal
    setTimeout(()=> showGameEndModal(score, avgRounded), 400);

    // send score to server
    sendMessage({
      type: 'updateScore',
      data: {
        username: currentUsername,
        score: score,
        avgTime: avgRounded,
        medianTime: Math.round(median)
      }
    });
  }

  // show modal
  function showGameEndModal(finalScore, avgTime) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    let title = '🎉 Game Complete! 🎉';
    let message = `Final Score: ${finalScore} clicks<br>Average Time: ${avgTime}ms<br>Great reflexes!`;
    if (avgTime < 300) message += '<br>🏎️ F1 Driver level reflexes!';
    else if (avgTime < 500) message += '<br>⚡ Lightning fast!';
    else if (avgTime < 700) message += '<br>👍 Good reflexes!';
    modal.innerHTML = `
      <div class="modal-content win-modal celebration" style="text-align:center;padding:18px;">
        <h2>🏆 ${title} 🏆</h2>
        <p style="line-height:1.4">${message}</p>
        <button style="margin-top:10px;padding:8px 12px;border-radius:8px;" onclick="this.closest('.modal').remove();">Continue</button>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(()=> { if (modal.parentNode) modal.remove(); }, 8000);
  }

  // leaderboard update logic (same as before)
  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(()=> {
      sendMessage({ type: 'getReactionScores' });
    }, 5000);
  }

  function updateLeaderboard(scores) {
    allScores = scores || [];
    const sortedScores = [...allScores].sort((a,b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.avgTime - b.avgTime;
    });
    // clear old rows
    if (leaderboardElem) {
      const rows = leaderboardElem.querySelectorAll('tr:not(:first-child)');
      rows.forEach(r => r.remove());
      const totalPages = Math.ceil(sortedScores.length / scoresPerPage);
      const pageScores = sortedScores.slice(currentPage * scoresPerPage, (currentPage+1) * scoresPerPage);
      pageScores.forEach((sd, i) => {
        const rank = currentPage * scoresPerPage + i + 1;
        const tr = document.createElement('tr');
        const isMe = sd.username === currentUsername;
        if (isMe) { tr.style.backgroundColor = '#111827'; tr.style.fontWeight = '700'; }
        let emoji = '';
        if (rank === 1) emoji='🥇'; else if (rank===2) emoji='🥈'; else if (rank===3) emoji='🥉';
        tr.innerHTML = `<td>${emoji} ${rank}</td><td>${sd.username}${isMe?' (You)':''}</td><td>${sd.score}</td><td>${sd.avgTime} ms</td><td>${sd.medianTime} ms</td>`;
        leaderboardElem.appendChild(tr);
      });
      updatePagination(Math.ceil(sortedScores.length / scoresPerPage));
    }
  }

  function updatePagination(totalPages) {
    if (!paginationElem) return;
    paginationElem.innerHTML = '';
    if (totalPages <= 1) return;
    if (currentPage > 0) {
      const prev = document.createElement('button');
      prev.textContent = '← Prev';
      prev.onclick = ()=> { currentPage--; updateLeaderboard(allScores); };
      paginationElem.appendChild(prev);
    }
    const info = document.createElement('span');
    info.textContent = `Page ${currentPage+1} of ${totalPages}`;
    info.style.margin = '0 10px';
    paginationElem.appendChild(info);
    if (currentPage < totalPages - 1) {
      const next = document.createElement('button');
      next.textContent = 'Next →';
      next.onclick = ()=> { currentPage++; updateLeaderboard(allScores); };
      paginationElem.appendChild(next);
    }
  }

  // message handling (server)
  function handleMessage(event) {
    let message = event.data;
    if (message.type === 'devvit-message' && message.data && message.data.message) {
      message = message.data.message;
    }
    switch (message.type) {
      case 'initialData':
        currentUsername = message.data.username || currentUsername;
        if (playersElem) { playersElem.textContent = `👥 Player: ${currentUsername}`; playersElem.className = 'status-display-3d'; }
        startAutoRefresh();
        sendMessage({ type: 'initializeGame' });
        sendMessage({ type: 'requestGameState' });
        sendMessage({ type: 'getReactionScores' });
        break;
      case 'scoreUpdate':
        if (message.data && message.data.scores) updateLeaderboard(message.data.scores);
        break;
      case 'gameState':
        // optionally handle server-side state if needed
        break;
      case 'error':
        if (playersElem) {
          playersElem.textContent = `❌ Error: ${message.message}`;
          playersElem.style.background = 'rgba(220,53,69,0.95)';
          playersElem.style.color = 'white';
          // Clear error message after 3 seconds
          setTimeout(() => {
            playersElem.textContent = `👥 Player: ${currentUsername}`;
            playersElem.className = 'status-display-3d';
            playersElem.style.background = '';
            playersElem.style.color = '';
          }, 3000);
        }
        break;
    }
  }

  // Add event listeners
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => sendMessage({ type: 'webViewReady' }));

 // Request fresh scores when tab becomes visible (helps with reconnection)
 document.addEventListener('visibilitychange', () => {
   if (!document.hidden && currentUsername) {
     sendMessage({ type: 'getReactionScores' });
   }
 });
  startBtn && startBtn.addEventListener('click', startGame);

  // init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThreeJS);
  } else {
    initThreeJS();
  }

  // expose sendMessage for buttons
  window.sendMessage = sendMessage;
})();
