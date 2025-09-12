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
  let activeCube = null;
  let isSceneReady = false;

  // Camera control variables
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 12;
  let cameraTheta = Math.PI / 4; // azimuth angle
  let cameraPhi = Math.PI / 3;   // polar angle

  // Particle system
  let particleSystem = null;

  // Initialize Three.js scene
  function initThreeJS() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a2a);
    scene.fog = new THREE.Fog(0x0a0a2a, 5, 20);

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
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Add colored point lights for more dynamic lighting
    const redLight = new THREE.PointLight(0xff0000, 1, 10);
    redLight.position.set(5, 3, 5);
    scene.add(redLight);

    const blueLight = new THREE.PointLight(0x0000ff, 1, 10);
    blueLight.position.set(-5, 3, -5);
    scene.add(blueLight);

    // Raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create the game grid
    createGrid();

    // Create particle system
    createParticleSystem();

    // Add a grid floor for better depth perception
    const gridHelper = new THREE.GridHelper(15, 15, 0x000000, 0x000000);
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
    cameraDistance = Math.max(8, Math.min(20, cameraDistance));
    
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

  // Create the 3D grid of cubes with improved visuals
  function createGrid() {
    gridCubes = [];
    
    // Create 5x5 grid of cubes
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
        const cubeMaterial = new THREE.MeshStandardMaterial({ 
          color: 0x444444,
          roughness: 0.7,
          metalness: 0.3,
          emissive: 0x111111
        });
        const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
        
        cube.position.set(
          (col - 2) * 1.5,
          0.5,
          (row - 2) * 1.5
        );
        cube.castShadow = true;
        cube.receiveShadow = true;
        cube.userData = { row: row, col: col, index: row * 5 + col };
        
        scene.add(cube);
        gridCubes.push(cube);
      }
    }

    // Add a base platform
    const platformGeometry = new THREE.BoxGeometry(12, 0.5, 12);
    const platformMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x222222,
      roughness: 0.8,
      metalness: 0.2
    });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.y = -0.75;
    platform.receiveShadow = true;
    scene.add(platform);
  }

  // Create particle system for visual effects
  function createParticleSystem() {
    const particleCount = 100;
    const particles = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSizes = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      particlePositions[i3] = (Math.random() - 0.5) * 20;
      particlePositions[i3 + 1] = (Math.random() - 0.5) * 20;
      particlePositions[i3 + 2] = (Math.random() - 0.5) * 20;
      particleSizes[i] = Math.random() * 0.1 + 0.05;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particles.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));
    
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.1,
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    
    particleSystem = new THREE.Points(particles, particleMaterial);
    scene.add(particleSystem);
  }

  // Highlight a random cube
  function highlightRandomCube() {
    // Reset all cubes
    gridCubes.forEach(cube => {
      cube.material.color.setHex(0x444444);
      cube.material.emissive.setHex(0x111111);
      cube.scale.set(1, 1, 1);
    });

    // Pick random cube
    const randomIndex = Math.floor(Math.random() * gridCubes.length);
    activeCube = gridCubes[randomIndex];
    
    // Highlight the active cube
    activeCube.material.color.setHex(0x00ff00);
    activeCube.material.emissive.setHex(0x004400);
    activeCube.material.needsUpdate = true;
    activeCube.scale.set(1.2, 1.2, 1.2);
    
    // Record highlight time
    activeCube.userData.highlightTime = performance.now();
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
    if (!gameActive || !isSceneReady) return;

    // Calculate mouse position in normalized device coordinates
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(gridCubes);

    if (intersects.length > 0) {
      const clickedCube = intersects[0].object;
      
      if (clickedCube === activeCube) {
        // Correct cube clicked
        const reactionTime = performance.now() - activeCube.userData.highlightTime;
        clickTimes.push(reactionTime);
        score++;
        
        // Visual feedback with particle effect
        createClickEffect(clickedCube.position);
        
        // Visual feedback on cube
        clickedCube.material.color.setHex(0xffff00);
        clickedCube.material.emissive.setHex(0x444400);
        clickedCube.material.needsUpdate = true;
        
        setTimeout(() => {
          if (gameActive) {
            highlightRandomCube();
          }
        }, 100);
        
        // Update score display
        const avgTime = clickTimes.reduce((a, b) => a + b, 0) / clickTimes.length;
        scoreElem.textContent = `Score: ${score} | Avg: ${Math.round(avgTime)}ms`;
      } else {
        // Wrong cube clicked - visual feedback
        clickedCube.material.color.setHex(0xff0000);
        clickedCube.material.emissive.setHex(0x440000);
        clickedCube.material.needsUpdate = true;
        
        setTimeout(() => {
          clickedCube.material.color.setHex(0x444444);
          clickedCube.material.emissive.setHex(0x111111);
          clickedCube.material.needsUpdate = true;
        }, 200);
      }
    }
  }

  // Create particle effect for cube clicks
  function createClickEffect(position) {
    const particleCount = 30;
    const particles = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 0.5 + 0.1;
      
      particlePositions[i3] = position.x;
      particlePositions[i3 + 1] = position.y;
      particlePositions[i3 + 2] = position.z;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffff00,
      size: 0.1,
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    
    const particleSystem = new THREE.Points(particles, particleMaterial);
    scene.add(particleSystem);
    
    // Animate particles
    const startPositions = particlePositions.slice();
    let progress = 0;
    
    function animateParticles() {
      progress += 0.02;
      
      if (progress < 1) {
        for (let i = 0; i < particleCount; i++) {
          const i3 = i * 3;
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 0.5 + 0.1;
          
          particlePositions[i3] = startPositions[i3] + Math.cos(angle) * speed * progress * 3;
          particlePositions[i3 + 1] = startPositions[i3 + 1] + Math.sin(angle) * speed * progress * 3;
          particlePositions[i3 + 2] = startPositions[i3 + 2] + (Math.random() - 0.5) * speed * progress * 2;
        }
        
        particles.attributes.position.needsUpdate = true;
        requestAnimationFrame(animateParticles);
      } else {
        scene.remove(particleSystem);
      }
    }
    
    animateParticles();
  }

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    
    if (isSceneReady) {
      // Animate active cube
      if (activeCube && gameActive) {
        const pulseTime = Date.now() * 0.01;
        activeCube.scale.set(
          1.2 + Math.sin(pulseTime) * 0.1,
          1.2 + Math.sin(pulseTime) * 0.1,
          1.2 + Math.sin(pulseTime) * 0.1
        );
      }
      
      // Animate particles
      if (particleSystem) {
        const positions = particleSystem.geometry.attributes.position.array;
        const time = Date.now() * 0.001;
        
        for (let i = 0; i < positions.length; i += 3) {
          positions[i] += Math.sin(time + i) * 0.001;
          positions[i + 1] += Math.cos(time + i) * 0.001;
          positions[i + 2] += Math.sin(time + i * 0.5) * 0.001;
        }
        
        particleSystem.geometry.attributes.position.needsUpdate = true;
      }
      
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

  // Start the Reaction Speed game
  function startGame() {
    score = 0;
    clickTimes = [];
    gameActive = true;
    startBtn.disabled = true;
    startBtn.textContent = 'Game in Progress...';
    scoreElem.textContent = `Score: ${score}`;
    
    highlightRandomCube();
    
    // End the game after 20 seconds
    gameTimer = setTimeout(endGame, 20000);
  }

  // End the game
  function endGame() {
    gameActive = false;
    startBtn.disabled = false;
    startBtn.textContent = 'Start Game';
    
    // Reset all cubes
    gridCubes.forEach(cube => {
      cube.material.color.setHex(0x444444);
      cube.material.emissive.setHex(0x111111);
      cube.material.needsUpdate = true;
      cube.scale.set(1, 1, 1);
    });
    activeCube = null;
    
    // Calculate stats
    const avgTime = clickTimes.length ? (clickTimes.reduce((a, b) => a + b, 0) / clickTimes.length) : 0;
    const sortedTimes = [...clickTimes].sort((a, b) => a - b);
    const medianTime = sortedTimes.length ? sortedTimes[Math.floor(sortedTimes.length / 2)] : 0;
    const avgRounded = Number(avgTime.toFixed(2));

    scoreElem.textContent = `Final Score: ${score} | Avg: ${avgRounded}ms`;

    // Show completion modal
    setTimeout(() => {
      showGameEndModal(score, avgRounded);
    }, 500);

    // Send score to server
    sendMessage({
      type: 'updateScore',
      data: {
        username: currentUsername,
        score: score,
        avgTime: avgRounded,
        medianTime: Math.round(medianTime)
      }
    });
  }

  // Show game end modal
  function showGameEndModal(finalScore, avgTime) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    let modalClass = 'win-modal celebration';
    let title = '🎉 Game Complete! 🎉';
    let message = `Final Score: ${finalScore} clicks<br>Average Time: ${avgTime}ms<br>Great reflexes!`;
    
    if (avgTime < 300) {
      message += '<br>🏎️ F1 Driver level reflexes!';
    } else if (avgTime < 500) {
      message += '<br>⚡ Lightning fast!';
    } else if (avgTime < 700) {
      message += '<br>👍 Good reflexes!';
    }
    
    modal.innerHTML = `
      <div class="modal-content ${modalClass}">
        <h2>🏆 ${title} 🏆</h2>
        <p>${message}</p>
        <button onclick="this.closest('.modal').remove();">
          Continue
        </button>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (modal.parentNode) {
        modal.remove();
      }
    }, 8000);
  }

  // Auto-refresh leaderboard every 5 seconds
  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      sendMessage({ type: 'getReactionScores' });
    }, 5000);
  }

  // Update leaderboard display with pagination
  function updateLeaderboard(scores) {
    allScores = scores;
    
    // Sort scores by score (descending), then by average time (ascending)
    const sortedScores = [...allScores].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.avgTime - b.avgTime;
    });

    // Clear existing rows except header
    const rows = leaderboardElem.querySelectorAll('tr:not(:first-child)');
    rows.forEach(row => row.remove());

    // Calculate pagination
    const totalPages = Math.ceil(sortedScores.length / scoresPerPage);
    const maxPages = Math.min(totalPages, 5); // Limit to 5 pages max
    
    // Find current user's position
    const userPosition = sortedScores.findIndex(s => s.username === currentUsername);
    
    // Determine which page to show
    let startIndex, endIndex;
    if (userPosition !== -1 && userPosition >= scoresPerPage * maxPages) {
      // Show page with current user if they're beyond the first 5 pages
      const userPage = Math.floor(userPosition / scoresPerPage);
      currentPage = Math.min(userPage, maxPages - 1);
    }
    
    startIndex = currentPage * scoresPerPage;
    endIndex = Math.min(startIndex + scoresPerPage, sortedScores.length);
    
    // Add rows for current page
    const pageScores = sortedScores.slice(startIndex, endIndex);
    pageScores.forEach((scoreData, index) => {
      const globalRank = startIndex + index + 1;
      const newRow = document.createElement('tr');
      const isCurrentUser = scoreData.username === currentUsername;
      
      if (isCurrentUser) {
        newRow.style.backgroundColor = '#ffffcc';
        newRow.style.fontWeight = 'bold';
      }
      
      // Add rank emoji
      let rankEmoji = '';
      if (globalRank === 1) rankEmoji = '🥇';
      else if (globalRank === 2) rankEmoji = '🥈';
      else if (globalRank === 3) rankEmoji = '🥉';
      
      newRow.innerHTML = `
        <td>${rankEmoji} ${globalRank}</td>
        <td>${scoreData.username}${isCurrentUser ? ' (You)' : ''}</td>
        <td>${scoreData.score}</td>
        <td>${scoreData.avgTime} ms</td>
        <td>${scoreData.medianTime} ms</td>
      `;
      leaderboardElem.appendChild(newRow);
    });

    // Update pagination
    updatePagination(totalPages, maxPages);
  }

  // Update pagination controls
  function updatePagination(totalPages, maxPages) {
    if (!paginationElem) return;
    
    paginationElem.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    // Previous button
    if (currentPage > 0) {
      const prevBtn = document.createElement('button');
      prevBtn.textContent = '← Prev';
      prevBtn.onclick = () => {
        currentPage--;
        updateLeaderboard(allScores);
      };
      paginationElem.appendChild(prevBtn);
    }
    
    // Page info
    const pageInfo = document.createElement('span');
    pageInfo.textContent = `Page ${currentPage + 1} of ${Math.min(totalPages, maxPages)}`;
    pageInfo.style.margin = '0 10px';
    paginationElem.appendChild(pageInfo);
    
    // Next button
    if (currentPage < maxPages - 1 && currentPage < totalPages - 1) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next →';
      nextBtn.onclick = () => {
        currentPage++;
        updateLeaderboard(allScores);
      };
      paginationElem.appendChild(nextBtn);
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
        if (playersElem) {
          playersElem.textContent = `👥 Player: ${currentUsername}`;
          playersElem.className = 'status-display-3d';
        }
        
        startAutoRefresh();
        sendMessage({ type: 'initializeGame' });
        sendMessage({ type: 'requestGameState' });
        sendMessage({ type: 'getReactionScores' });
        break;

      case 'gameState':
        if (message.data && message.data.players && !message.data.players.includes(currentUsername)) {
          sendMessage({
            type: 'joinGame',
            data: { username: currentUsername }
          });
          sendMessage({ type: 'requestGameState' });
        }
        
        if (!refreshInterval) {
          startAutoRefresh();
        }
        break;

      case 'playerJoined':
        if (message.data.username === currentUsername && playersElem) {
          playersElem.textContent = `👥 Player: ${currentUsername} - Ready to play!`;
        }
        break;

      case 'gameStarted':
        if (!refreshInterval) {
          startAutoRefresh();
        }
        break;

      case 'scoreUpdate':
        if (message.data.scores) {
          updateLeaderboard(message.data.scores);
        }
        break;

      case 'error':
        if (playersElem) {
          playersElem.textContent = `❌ Error: ${message.message}`;
          playersElem.style.background = 'rgba(220, 53, 69, 0.95)';
          playersElem.style.color = 'white';
        }
        break;
    }
  }

  // Add event listeners
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => {
    sendMessage({ type: 'webViewReady' });
  });

  startBtn.addEventListener('click', startGame);

  // Initialize Three.js when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThreeJS);
  } else {
    initThreeJS();
  }

  // Make sendMessage available globally for modal buttons
  window.sendMessage = sendMessage;
})();