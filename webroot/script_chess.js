(async function () {
  // --- transport helper ---
  function sendMessage(message) {
    try { window.parent.postMessage(message, '*'); }
    catch (e) { console.warn('postMessage failed', e); }
  }
  sendMessage({ type: 'webViewReady' });

  // --- DOM refs ---
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('chessStatus');
  const restartBtn = document.getElementById('restartChess');
  const playersElem = document.getElementById('players-info');
  const timerElem = document.getElementById('timer');
  const loadingElem = document.getElementById('loading');
  const errorBanner = document.getElementById('errorBanner');

  // --- state ---
  let gameState = null;
  let currentUsername = null;
  let gameActive = false;

  // --- three.js pieces ---
  let scene, camera, renderer, raycaster, mouse;
  let boardSquares = [], squareMap = {};
  let chessPieces = [];
  let selectedPiece = null;
  let isSceneReady = false;

  // camera
  let cameraDistance = 15;
  let cameraTheta = Math.PI / 4;
  let cameraPhi = Math.PI / 3;
  function updateCameraPosition() {
    if (!camera) return;
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  // optional chess.js local engine for move hints & validation
  let ChessCtor = (typeof window !== 'undefined' && window.Chess) ? window.Chess : null;
  let clientChess = null;

  // constants & helpers
  const DEFAULT_STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const files = 'abcdefgh';
  const ranks = '87654321';
  function notationToCoords(square) {
    if (!square || square.length < 2) return null;
    const col = files.indexOf(square[0]);
    const row = ranks.indexOf(square[1]);
    if (col < 0 || row < 0) return null;
    return { row, col };
  }
  function coordsToNotation(row, col) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return null;
    return files[col] + ranks[row];
  }
  function coordsToPosition(row, col) {
    return new THREE.Vector3(col - 3.5, 0, row - 3.5);
  }

  // --- piece models (compact & readable) ---
  const pieceModels = {};
  function createPieceModels() {
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.35, metalness: 0.08 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.12, metalness: 0.6 });

    pieceModels.pawn = (color) => {
      const mat = color === 'white' ? whiteMat.clone() : blackMat.clone();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.55, 16), mat));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), mat);
      head.position.y = 0.5; g.add(head);
      return g;
    };
    pieceModels.rook = (color) => {
      const mat = color === 'white' ? whiteMat.clone() : blackMat.clone();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.8, 16), mat));
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.36), mat);
      top.position.y = 0.5; g.add(top);
      return g;
    };
    pieceModels.knight = (color) => {
      const mat = color === 'white' ? whiteMat.clone() : blackMat.clone();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.65, 16), mat));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 12), mat);
      head.position.y = 0.55; head.rotation.x = Math.PI; head.rotation.z = 0.5; g.add(head);
      return g;
    };
    pieceModels.bishop = (color) => {
      const mat = color === 'white' ? whiteMat.clone() : blackMat.clone();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 16), mat));
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 12), mat);
      top.position.y = 0.55; g.add(top);
      return g;
    };
    pieceModels.queen = (color) => {
      const mat = color === 'white' ? whiteMat.clone() : blackMat.clone();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.9, 16), mat));
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 32), mat); crown.position.y = 0.78; g.add(crown);
      return g;
    };
    pieceModels.king = (color) => {
      const mat = color === 'white' ? whiteMat.clone() : blackMat.clone();
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.05, 16), mat);
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.04), mat);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), mat);
      crossV.position.y = 0.95; crossH.position.y = 0.95; g.add(body, crossV, crossH);
      return g;
    };
  }

  // --- board generation ---
  function createBoard() {
    boardSquares = []; squareMap = {};
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        const mat = new THREE.MeshStandardMaterial({ color: isLight ? 0xf0d9b5 : 0xb58863, roughness: 0.8, metalness: 0.06 });
        const sq = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), mat);
        sq.position.set(c - 3.5, -0.06, r - 3.5);
        sq.receiveShadow = true;
        sq.userData = { row: r, col: c, isLight, isMove: false, isSelected: false };
        scene.add(sq);
        boardSquares.push(sq);
        squareMap[`${r},${c}`] = sq;
      }
    }
    const border = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 9), new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.95 }));
    border.position.set(0, -0.35, 0); border.receiveShadow = true; scene.add(border);
  }

  // --- FEN parsing & piece placement ---
  function parseFEN(fen) {
    try {
      const parts = (fen || DEFAULT_STARTING_FEN).split(' ');
      const rows = parts[0].split('/');
      const board = Array.from({ length: 8 }, () => Array(8).fill(null));
      for (let r = 0; r < 8; r++) {
        const rowStr = rows[r] || '';
        let c = 0;
        for (let i = 0; i < rowStr.length; i++) {
          const ch = rowStr[i];
          if (/\d/.test(ch)) c += parseInt(ch, 10);
          else { board[r][c] = ch; c++; }
        }
      }
      return board;
    } catch (err) {
      console.warn('Invalid FEN', err);
      return parseFEN(DEFAULT_STARTING_FEN);
    }
  }

  function clearAllPieces() {
    chessPieces.forEach(p => { if (p.parent) scene.remove(p); });
    chessPieces = [];
  }

  function getPieceType(char) {
    const types = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };
    return types[char] || 'pawn';
  }

  function createChessPiece(pieceType, color, row, col) {
    const maker = pieceModels[pieceType] || pieceModels.pawn;
    const group = maker(color);
    const pos = coordsToPosition(row, col);
    group.position.copy(pos); group.position.y = 0.45;
    group.userData = { type: pieceType, color, boardRow: row, boardCol: col, isSelected: false };
    group.castShadow = true;
    return group;
  }

  function placePiecesFromFEN(fen) {
    if (!scene) return;
    clearAllPieces();
    const board = parseFEN(fen);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const ch = board[r][c];
        if (ch) {
          const color = (ch === ch.toUpperCase()) ? 'white' : 'black';
          const type = getPieceType(ch.toLowerCase());
          const mesh = createChessPiece(type, color, r, c);
          scene.add(mesh);
          chessPieces.push(mesh);
        }
      }
    }
  }

  function findPieceOnSquare(row, col) {
    return chessPieces.find(p => p.userData.boardRow === row && p.userData.boardCol === col);
  }

  function highlightLastMove(lastMove) {
    boardSquares.forEach(sq => {
      const isLight = sq.userData.isLight;
      sq.material.color.setHex(isLight ? 0xf0d9b5 : 0xb58863);
      sq.userData.isMove = false;
    });
    if (!lastMove) return;
    const from = notationToCoords(lastMove.from);
    const to = notationToCoords(lastMove.to);
    if (!from || !to) return;
    const fromSq = squareMap[`${from.row},${from.col}`];
    const toSq = squareMap[`${to.row},${to.col}`];
    if (fromSq) fromSq.material.color.setHex(0xfff2b6);
    if (toSq) toSq.material.color.setHex(0xd1ffd6);
  }

  // --- input basics ---
  function screenToBoardRay(clientX, clientY) {
    if (!canvas || !raycaster || !camera) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
  }
  function getRootPiece(obj) {
    let o = obj; while (o && !o.userData.type) o = o.parent; return o || obj;
  }

  function computeLegalMovesFor(fromNotation) {
    if (!clientChess) return [];
    try {
      const verbose = clientChess.moves({ verbose: true }) || [];
      return verbose.filter(m => m.from === fromNotation);
    } catch (err) { console.warn('computeLegalMovesFor error', err); return []; }
  }

  function resetAllSquareColors() {
    boardSquares.forEach(sq => {
      const isLight = sq.userData.isLight;
      sq.userData.isMove = false; sq.userData.isSelected = false;
      sq.material.color.setHex(isLight ? 0xf0d9b5 : 0xb58863);
    });
  }

  function applyLegalMoves(movesArray) {
    if (!movesArray || movesArray.length === 0) return;
    movesArray.forEach(m => {
      const to = notationToCoords(m.to);
      if (!to) return;
      const sq = squareMap[`${to.row},${to.col}`];
      if (sq) { sq.userData.isMove = true; sq.material.color.setHex(0x90EE90); }
    });
  }

  function selectPiece(piece) {
    resetAllSquareColors();
    selectedPiece = piece;
    piece.userData.isSelected = true;
    piece.position.y = 0.7;
    const from = coordsToNotation(piece.userData.boardRow, piece.userData.boardCol);
    const legal = computeLegalMovesFor(from);
    applyLegalMoves(legal);
    sendMessage({ type: 'clientSelectedPiece', data: { from, postId: (gameState && gameState.postId) ? gameState.postId : undefined } });
  }

  function clearSelectionHighlights() {
    boardSquares.forEach(sq => {
      const isLight = sq.userData.isLight;
      sq.userData.isMove = false; sq.userData.isSelected = false;
      sq.material.color.setHex(isLight ? 0xf0d9b5 : 0xb58863);
    });
    if (selectedPiece) { selectedPiece.position.y = 0.45; selectedPiece.userData.isSelected = false; selectedPiece = null; }
  }

  function animatePieceTo(piece, destRow, destCol, lift = true, duration = 200, cb) {
    if (!piece) { if (cb) cb(); return; }
    const start = piece.position.clone();
    const targetPos = coordsToPosition(destRow, destCol);
    const end = targetPos.clone(); end.y = lift ? 0.7 : 0.45;
    const startTime = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      piece.position.lerpVectors(start, end, 1 - Math.pow(1 - t, 3));
      if (t < 1) requestAnimationFrame(step);
      else { piece.position.copy(end); piece.position.y = 0.45; if (cb) cb(); }
    })(performance.now());
  }
  function animateShake(mesh) {
    if (!mesh) return;
    const orig = mesh.position.clone(); let t = 0; const dur = 300;
    (function step() {
      t += 16;
      const progress = Math.min(1, t / dur);
      const offset = Math.sin(progress * Math.PI * 6) * (1 - progress) * 0.08;
      mesh.position.x = orig.x + offset; mesh.position.z = orig.z + offset * 0.3;
      if (progress < 1) requestAnimationFrame(step); else mesh.position.copy(orig);
    })();
  }

  // --- move handling (local + send) ---
  function performLocalMoveAndSend(from, to, promotion) {
    if (clientChess) {
      const mv = { from, to }; if (promotion) mv.promotion = promotion;
      const result = clientChess.move(mv);
      if (!result) { if (selectedPiece) animateShake(selectedPiece); clearSelectionHighlights(); return; }
    }
    const destCoords = notationToCoords(to);
    const movedPiece = selectedPiece;
    const captured = findPieceOnSquare(destCoords.row, destCoords.col);
    if (captured && captured !== movedPiece) {
      const cap = captured;
      (function fade() {
        cap.scale.multiplyScalar(0.92);
        if (cap.scale.x < 0.04) { if (cap.parent) scene.remove(cap); chessPieces = chessPieces.filter(p => p !== cap); }
        else requestAnimationFrame(fade);
      })();
    }
    movedPiece.userData.boardRow = destCoords.row; movedPiece.userData.boardCol = destCoords.col;
    animatePieceTo(movedPiece, destCoords.row, destCoords.col, true, 260, () => {
      clearSelectionHighlights();
      highlightLastMove({ from, to });
      sendMessage({
        type: 'makeMove',
        data: {
          username: currentUsername,
          position: { from, to, promotion: promotion || undefined },
          gameType: 'chess',
          postId: (gameState && gameState.postId) ? gameState.postId : undefined
        }
      });
    });
  }

  function attemptMoveFromSelectedTo(destRow, destCol) {
    if (!selectedPiece) return;
    const fromNotation = coordsToNotation(selectedPiece.userData.boardRow, selectedPiece.userData.boardCol);
    const toNotation = coordsToNotation(destRow, destCol);
    if (!fromNotation || !toNotation) { clearSelectionHighlights(); return; }
    if (!clientChess) { performLocalMoveAndSend(fromNotation, toNotation); return; }
    const legal = computeLegalMovesFor(fromNotation);
    const match = legal.find(m => m.from === fromNotation && m.to === toNotation);
    if (!match) { animateShake(selectedPiece); setTimeout(() => clearSelectionHighlights(), 200); return; }
    const isPromotion = match.promotion || (selectedPiece.userData.type === 'pawn' && (destRow === 0 || destRow === 7));
    if (isPromotion && !match.promotion) {
      showPromotionPicker(chosen => performLocalMoveAndSend(fromNotation, toNotation, chosen));
      return;
    }
    performLocalMoveAndSend(fromNotation, toNotation, match.promotion);
  }

  function showPromotionPicker(callback) {
    const modal = document.createElement('div'); modal.className = 'modal'; modal.style.zIndex = 9999;
    const box = document.createElement('div'); box.className = 'modal-content'; box.style.display = 'flex';
    box.style.gap = '10px'; box.style.justifyContent = 'center'; box.style.alignItems = 'center';
    box.style.padding = '12px'; box.style.background = '#111'; box.style.borderRadius = '8px';
    ['q', 'r', 'b', 'n'].forEach(p => {
      const btn = document.createElement('button'); btn.textContent = p.toUpperCase(); btn.style.padding = '8px 12px';
      btn.onclick = () => { modal.remove(); callback(p); };
      box.appendChild(btn);
    });
    modal.appendChild(box); document.body.appendChild(modal);
  }

  // --- update scene from server state ---
  function updateSceneFromGameState() {
    if (!isSceneReady || !gameState) return;
    // sync local engine and visuals
    if (gameState.chess && gameState.chess.fen) {
      try {
        if (!clientChess && ChessCtor) clientChess = new ChessCtor(gameState.chess.fen);
        else if (clientChess && clientChess.fen() !== gameState.chess.fen) clientChess.load(gameState.chess.fen);
      } catch (e) { console.warn('clientChess sync failed', e); }
      placePiecesFromFEN(gameState.chess.fen);
      highlightLastMove((gameState.chess && gameState.chess.lastMove) ? gameState.chess.lastMove : null);
    } else {
      placePiecesFromFEN(DEFAULT_STARTING_FEN);
    }
    gameActive = gameState.status === 'active';
    // ensure a valid top-level turn username exists so UI & checks won't see empty string
    ensureTurnMappingFromChess();
    updateStatus();
  }

  // --- robust players handling & UI ---
  function updatePlayersInfo() {
    if (!playersElem) return;
    if (!gameState || !Array.isArray(gameState.players) || gameState.players.length === 0) {
      playersElem.textContent = '👥 No players yet';
      return;
    }
    const maxPlayers = (gameState.maxPlayers != null) ? gameState.maxPlayers : gameState.players.length;
    const list = gameState.players.map((p, i) => {
      const color = (gameState.chess && gameState.chess.playersColor && gameState.chess.playersColor[p]) || (i === 0 ? 'White' : 'Black');
      const emoji = color && color.toLowerCase().startsWith('w') ? '⚪' : '⚫';
      return `${p} (${emoji} ${color})${p === currentUsername ? ' - You' : ''}`;
    }).join(', ');
    playersElem.textContent = `👥 (${gameState.players.length}/${maxPlayers}) ${list}`;
  }

  function setPlayersArray(arr) {
    if (!gameState) gameState = {};
    gameState.players = Array.isArray(arr) ? Array.from(new Set(arr)) : [];
    updatePlayersInfo();
  }
  function addPlayerLocally(username) {
    if (!username) return;
    if (!gameState) gameState = {};
    if (!Array.isArray(gameState.players)) gameState.players = [];
    if (!gameState.players.includes(username)) { gameState.players.push(username); updatePlayersInfo(); }
  }
  function removePlayerLocally(username) {
    if (!gameState || !Array.isArray(gameState.players)) return;
    gameState.players = gameState.players.filter(p => p !== username);
    updatePlayersInfo();
  }

  function getPlayerColor(username) {
    if (!gameState) return null;
    if (gameState.chess && gameState.chess.playersColor && gameState.chess.playersColor[username]) return gameState.chess.playersColor[username];
    const idx = gameState.players ? gameState.players.indexOf(username) : -1;
    if (idx === 0) return 'white';
    if (idx === 1) return 'black';
    return null;
  }

  // --- CRITICAL: ensure top-level gameState.turn is set to a username ---
  function ensureTurnMappingFromChess() {
    if (!gameState) return;
    // If already set and non-empty, nothing to do
    if (gameState.turn && typeof gameState.turn === 'string' && gameState.turn.length > 0) return;

    // If chess state provides side to move and playersColor map, map color -> username
    if (gameState.chess && gameState.chess.turn && gameState.chess.playersColor) {
      const sideToMove = gameState.chess.turn; // 'white'|'black'
      const entry = Object.entries(gameState.chess.playersColor).find(([, c]) => c === sideToMove);
      if (entry && entry[0]) {
        gameState.turn = entry[0];
        return;
      }
    }

    // If no mapping available, fallback to players[0] if present
    if (Array.isArray(gameState.players) && gameState.players.length > 0) {
      gameState.turn = gameState.players[0];
    }
  }

  // When UI needs to show who is on turn, use this resolver (never returns empty string)
  function resolveDisplayedTurnUsername() {
    if (!gameState) return '';
    if (typeof gameState.turn === 'string' && gameState.turn.length > 0) return gameState.turn;
    if (gameState.chess && gameState.chess.turn && gameState.chess.playersColor) {
      const color = gameState.chess.turn;
      const found = Object.entries(gameState.chess.playersColor).find(([, c]) => c === color);
      if (found) return found[0];
    }
    if (Array.isArray(gameState.players) && gameState.players.length > 0) return gameState.players[0];
    return '';
  }

  // --- status & timer UI ---
  function updateStatus() {
    if (!statusElem) return;
    if (!gameState) { statusElem.textContent = 'Loading...'; return; }
    if (gameState.status === 'waiting') {
      const count = Array.isArray(gameState.players) ? gameState.players.length : 0;
      statusElem.textContent = `⏳ Waiting for players... (${count}/${gameState.maxPlayers || 2})`;
      statusElem.style.background = '';
      statusElem.style.color = '';
    } else if (gameState.status === 'active') {
      const displayTurnUser = resolveDisplayedTurnUsername();
      const isMyTurn = (displayTurnUser && currentUsername) ? (displayTurnUser === currentUsername) : false;
      const turnColor = getPlayerColor(displayTurnUser) || (gameState.chess && gameState.chess.turn) || null;
      const emoji = (turnColor && turnColor.toLowerCase().startsWith('w')) ? '⚪' : '⚫';
      statusElem.textContent = isMyTurn ? `🎯 Your turn (${emoji})` : `⏳ ${displayTurnUser || 'Opponent'}'s turn (${emoji})`;
      statusElem.style.background = isMyTurn ? 'rgba(40,167,69,0.95)' : 'rgba(255,255,255,0.95)';
      statusElem.style.color = isMyTurn ? 'white' : '#222';
    } else if (gameState.status === 'finished') {
      statusElem.textContent = gameState.winner === currentUsername ? '♛ You won (checkmate)!' : `♛ ${gameState.winner || 'Winner'} won`;
      statusElem.style.background = gameState.winner === currentUsername ? 'rgba(40,167,69,0.95)' : 'rgba(220,53,69,0.95)';
      statusElem.style.color = 'white';
    } else if (gameState.status === 'draw') {
      statusElem.textContent = '🤝 Draw'; statusElem.style.background = 'rgba(255,193,7,0.95)'; statusElem.style.color = '#222';
    }
  }

  function updateTimer(timeRemaining, currentTurn) {
    if (!timerElem) return;
    if (gameState && gameState.status === 'active' && gameState.players && gameState.players.length >= 2 && gameState.firstMoveMade) {
      timerElem.style.display = 'block';
      timerElem.textContent = `⏰ ${timeRemaining}s - ${currentTurn || resolveDisplayedTurnUsername()}'s turn`;
      timerElem.style.background = timeRemaining <= 10 ? 'rgba(220,53,69,0.95)' : 'rgba(255,107,107,0.95)';
    } else timerElem.style.display = 'none';
  }

  // --- messaging handler ---
  function handleMessage(event) {
    let message = event.data;
    if (message && message.type === 'devvit-message' && message.data && message.data.message) message = message.data.message;
    if (!message || !message.type) return;

    switch (message.type) {
      case 'initialData':
        currentUsername = (message.data && message.data.username) || currentUsername;
        if (currentUsername) addPlayerLocally(currentUsername);
        if (currentUsername) sendMessage({ type: 'joinGame', data: { username: currentUsername } });
        sendMessage({ type: 'requestGameState' });
        break;

      case 'playerJoined':
        if (message.data && message.data.username) {
          addPlayerLocally(message.data.username);
          sendMessage({ type: 'requestGameState' });
        } else if (message.data && message.data.gameState) {
          gameState = message.data.gameState;
          if (!Array.isArray(gameState.players)) gameState.players = gameState.players || [];
          setPlayersArray(gameState.players || []);
          updateSceneFromGameState();
        } else {
          sendMessage({ type: 'requestGameState' });
        }
        break;

      case 'playerLeft':
        if (message.data && message.data.username) {
          removePlayerLocally(message.data.username);
          sendMessage({ type: 'requestGameState' });
        } else if (message.data && message.data.gameState) {
          gameState = message.data.gameState;
          if (!Array.isArray(gameState.players)) gameState.players = gameState.players || [];
          setPlayersArray(gameState.players || []);
          updateSceneFromGameState();
        }
        break;

      case 'playerList':
      case 'players':
        if (message.data && Array.isArray(message.data.players)) setPlayersArray(message.data.players);
        else if (message.data && Array.isArray(message.data)) setPlayersArray(message.data);
        break;

      case 'gameState':
        gameState = message.data || {};
        if (!Array.isArray(gameState.players)) gameState.players = gameState.players || [];
        setPlayersArray(gameState.players);
        try {
          if (ChessCtor && gameState.chess && gameState.chess.fen) {
            if (!clientChess) clientChess = new ChessCtor(gameState.chess.fen);
            else if (clientChess.fen() !== gameState.chess.fen) clientChess.load(gameState.chess.fen);
          }
        } catch (e) { console.warn('sync engine failed', e); }
        ensureTurnMappingFromChess();
        updateSceneFromGameState();
        updateStatus();
        break;

      case 'moveMade':
      case 'gameUpdate':
        gameState = message.data.gameState || message.data || gameState;
        if (!gameState) break;
        if (!Array.isArray(gameState.players)) gameState.players = gameState.players || [];
        setPlayersArray(gameState.players);
        try {
          if (ChessCtor && gameState.chess && gameState.chess.fen) {
            if (!clientChess) clientChess = new ChessCtor(gameState.chess.fen);
            else if (clientChess.fen() !== gameState.chess.fen) clientChess.load(gameState.chess.fen);
          }
        } catch (e) {}
        ensureTurnMappingFromChess();
        updateSceneFromGameState();
        updateStatus();
        break;

      case 'timerUpdate':
        updateTimer((message.data && message.data.timeRemaining) || 0, (message.data && message.data.currentTurn) || null);
        break;

      case 'gameEnded':
        gameActive = false;
        if (message.data && message.data.finalState) {
          gameState = message.data.finalState;
          if (!Array.isArray(gameState.players)) gameState.players = gameState.players || [];
          setPlayersArray(gameState.players || []);
          updateSceneFromGameState();
        }
        setTimeout(() => { showGameEndModal(message.data && message.data.winner, message.data && message.data.isDraw, message.data && message.data.reason); }, 300);
        break;

      case 'error':
        if (statusElem) {
          statusElem.textContent = `❌ Error: ${message.message || message.data || 'unknown'}`;
          statusElem.style.background = 'rgba(220,53,69,0.95)'; statusElem.style.color = 'white';
        }
        break;

      default:
        break;
    }
  }

  function showGameEndModal(winner, isDraw, reason) {
    const modal = document.createElement('div'); modal.className = 'modal'; modal.style.zIndex = 9999;
    const box = document.createElement('div'); box.className = 'modal-content';
    box.style.padding = '18px'; box.style.background = '#111'; box.style.color = '#fff'; box.style.borderRadius = '8px';
    const text = document.createElement('div');
    if (isDraw) text.textContent = `Game ended in a draw (${reason || 'draw'})`;
    else text.textContent = `${winner} won! (${reason || 'finished'})`;
    box.appendChild(text); modal.appendChild(box); document.body.appendChild(modal);
    setTimeout(() => modal.remove(), 2500);
  }

  // --- click handler (simple) ---
  function handleInteraction(clientX, clientY) {
    if (!isSceneReady || !gameState || !gameActive) return;
    screenToBoardRay(clientX, clientY);
    const pieceIntersects = raycaster.intersectObjects(chessPieces, true);
    if (pieceIntersects.length > 0) {
      const clicked = getRootPiece(pieceIntersects[0].object);
      const playerColor = getPlayerColor(currentUsername);
      if (!playerColor) return;
      if (clicked.userData.color === playerColor) { selectPiece(clicked); return; }
      else {
        if (selectedPiece) { attemptMoveFromSelectedTo(clicked.userData.boardRow, clicked.userData.boardCol); return; }
      }
    }
    const squareIntersects = raycaster.intersectObjects(boardSquares);
    if (squareIntersects.length > 0) {
      const sq = squareIntersects[0].object;
      if (selectedPiece) attemptMoveFromSelectedTo(sq.userData.row, sq.userData.col);
      else {
        const pieceAt = findPieceOnSquare(sq.userData.row, sq.userData.col);
        if (pieceAt) {
          const playerColor = getPlayerColor(currentUsername);
          if (pieceAt.userData.color === playerColor) selectPiece(pieceAt);
        }
      }
    }
  }

  // --- animate loop & three init ---
  function animate() { requestAnimationFrame(animate); if (isSceneReady && renderer && scene && camera) renderer.render(scene, camera); }

  async function initThreeJS() {
    if (!canvas) { console.error('Canvas not found'); return; }
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x1a1a1a);
    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    updateCameraPosition();

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;

    const ambient = new THREE.AmbientLight(0x707070, 0.9); scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(10, 20, 10); key.castShadow = true; scene.add(key);
    const fill = new THREE.PointLight(0x8866ff, 0.25, 50); fill.position.set(-10, 8, -6); scene.add(fill);

    raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();

    createPieceModels(); createBoard();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1; floor.receiveShadow = true; scene.add(floor);

    canvas.addEventListener('click', (e) => handleInteraction(e.clientX, e.clientY));
    window.addEventListener('resize', () => {
      if (!renderer || !camera) return;
      camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    });

    isSceneReady = true;
    if (loadingElem) loadingElem.style.display = 'none';
    animate();
  }

  // --- join + request helpers ---
  function ensureJoinedAndRequestState() {
    if (currentUsername) {
      sendMessage({ type: 'joinGame', data: { username: currentUsername } });
      addPlayerLocally(currentUsername);
    }
    sendMessage({ type: 'requestGameState' });
  }

  if (restartBtn) restartBtn.addEventListener('click', ensureJoinedAndRequestState);

  // --- wire host messages & start ---
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => sendMessage({ type: 'webViewReady' }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThreeJS);
  else initThreeJS();

  // request authoritative state when tab becomes visible (helps stale clients)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sendMessage({ type: 'requestGameState' }); });

  // expose debug helpers
  window.sendMessage = sendMessage;
  window._getGameState = () => gameState;

})();
