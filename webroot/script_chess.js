(function() {
  const GAME_TYPE = 'chess';

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

  // Notify parent immediately that web view is ready
  sendMessage({ type: 'webViewReady' });

  // DOM elements
  const canvas = document.getElementById('gameCanvas');
  const statusElem = document.getElementById('chessStatus');
  const restartBtn = document.getElementById('restartChess');
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

  // Three.js variables
  let scene, camera, renderer, raycaster, mouse;
  let chessBoard = null;
  let boardSquares = []; // keep flat list of square meshes
  let chessPieces = [];
  let selectedSquare = null;
  let possibleMoves = [];
  let isSceneReady = false;

  // Camera control variables (with inertia)
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let cameraDistance = 10;                      // starting distance (closer than before for immersive view)
  let targetDistance = cameraDistance;
  let cameraTheta = Math.PI / 4;
  let cameraPhi = Math.PI / 3;
  let targetTheta = cameraTheta;
  let targetPhi = cameraPhi;
  const ROTATION_DAMPING = 0.12;
  const ZOOM_DAMPING = 0.12;
  const MIN_PHI = 0.35;    // prevents flipping under board
  const MAX_PHI = Math.PI - 0.8;
  const MIN_DISTANCE = 6;
  const MAX_DISTANCE = 20;

  // Touch control variables
  let touchStartTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  let touchMoved = false;
  let lastTouchWasTap = false;
  const TOUCH_MOVE_THRESHOLD = 8;
  const TAP_MAX_DURATION = 300;

  // Pinch variables
  let lastPinchDist = null;
  let isPinching = false;

  // Chess engine (unchanged logic)
  let chess = null;

  //
  // --- Minimal Chess Engine Implementation (copied unchanged) ---
  // (The engine implementation is the same as before; omitted here for brevity in explanation,
  // but included in the full file below exactly as your previous engine.)
  //
  // (In the code snapshot delivered below the ChessEngine class is exactly as in your prior file:
  // board(), get(), moves(), move(), load(), fen(), etc. I preserved all rules.)
  //
  class ChessEngine {
    constructor(fen) {
      this.reset();
      if (fen) this.load(fen);
      else this.load(this.defaultFen());
    }
    reset() {
      this._board = this._emptyBoard();
      this.turn = 'w';
      this.castling = { w: { K: true, Q: true }, b: { K: true, Q: true } };
      this.enPassant = null;
      this.halfmoveClock = 0;
      this.fullmoveNumber = 1;
    }
    defaultFen() { return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; }
    _emptyBoard() {
      const b = new Array(8);
      for (let r = 0; r < 8; r++) b[r] = new Array(8).fill(null);
      return b;
    }
    _sqToRC(sq) {
      if (!sq || typeof sq !== 'string' || sq.length < 2) return null;
      const file = sq.charCodeAt(0) - 97;
      const rank = 8 - parseInt(sq[1], 10);
      if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
      return { r: rank, f: file };
    }
    _rcToSq(r, f) { return String.fromCharCode(97 + f) + (8 - r); }
    board() {
      const out = [];
      for (let r = 0; r < 8; r++) {
        out[r] = [];
        for (let f = 0; f < 8; f++) {
          const p = this._board[r][f];
          out[r][f] = p ? { type: p.type, color: p.color } : null;
        }
      }
      return out;
    }
    get(sq) {
      const rc = this._sqToRC(sq);
      if (!rc) return null;
      const p = this._board[rc.r][rc.f];
      return p ? { type: p.type, color: p.color } : null;
    }
    load(fen) {
      try {
        const parts = fen.trim().split(/\s+/);
        if (parts.length < 4) throw new Error('Invalid FEN');
        const rows = parts[0].split('/');
        if (rows.length !== 8) throw new Error('Invalid FEN rows');
        this._board = this._emptyBoard();
        for (let r = 0; r < 8; r++) {
          const row = rows[r];
          let f = 0;
          for (const ch of row) {
            if (ch >= '1' && ch <= '8') {
              f += parseInt(ch, 10);
            } else {
              const color = ch === ch.toUpperCase() ? 'w' : 'b';
              const type = ch.toLowerCase();
              this._board[r][f] = { type, color };
              f++;
            }
          }
          if (f !== 8) throw new Error('Invalid FEN row length');
        }
        this.turn = parts[1] === 'b' ? 'b' : 'w';
        const cast = parts[2];
        this.castling = { w: { K: false, Q: false }, b: { K: false, Q: false } };
        if (cast.indexOf('K') !== -1) this.castling.w.K = true;
        if (cast.indexOf('Q') !== -1) this.castling.w.Q = true;
        if (cast.indexOf('k') !== -1) this.castling.b.K = true;
        if (cast.indexOf('q') !== -1) this.castling.b.Q = true;
        this.enPassant = parts[3] === '-' ? null : parts[3];
        this.halfmoveClock = parts[4] ? parseInt(parts[4], 10) : 0;
        this.fullmoveNumber = parts[5] ? parseInt(parts[5], 10) : 1;
        return true;
      } catch (e) {
        console.error('FEN load error', e);
        return false;
      }
    }
    fen() {
      const rows = [];
      for (let r = 0; r < 8; r++) {
        let row = '';
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this._board[r][f];
          if (!p) { empty++; } else {
            if (empty > 0) { row += String(empty); empty = 0; }
            const ch = p.color === 'w' ? p.type.toUpperCase() : p.type;
            row += ch;
          }
        }
        if (empty > 0) row += String(empty);
        rows.push(row);
      }
      const placement = rows.join('/');
      const turnStr = this.turn === 'b' ? 'b' : 'w';
      let cast = '';
      if (this.castling.w.K) cast += 'K';
      if (this.castling.w.Q) cast += 'Q';
      if (this.castling.b.K) cast += 'k';
      if (this.castling.b.Q) cast += 'q';
      if (cast === '') cast = '-';
      const ep = this.enPassant ? this.enPassant : '-';
      return `${placement} ${turnStr} ${cast} ${ep} ${this.halfmoveClock} ${this.fullmoveNumber}`;
    }
    _findKing(color) {
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const p = this._board[r][f];
        if (p && p.type === 'k' && p.color === color) return { r, f, sq: this._rcToSq(r, f) };
      }
      return null;
    }
    _isSquareAttackedBy(r, f, byColor) {
      const dir = byColor === 'w' ? -1 : 1;
      const pawnR = r + dir;
      if (pawnR >= 0 && pawnR <= 7) {
        for (const df of [-1, 1]) {
          const pf = f + df;
          if (pf >= 0 && pf <= 7) {
            const p = this._board[pawnR][pf];
            if (p && p.color === byColor && p.type === 'p') return true;
          }
        }
      }
      const knightOffsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (const o of knightOffsets) {
        const rr = r + o[0], ff = f + o[1];
        if (rr>=0 && rr<=7 && ff>=0 && ff<=7) {
          const p = this._board[rr][ff];
          if (p && p.color === byColor && p.type === 'n') return true;
        }
      }
      const directions = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
      for (let i = 0; i < directions.length; i++) {
        const d = directions[i];
        let rr = r + d[0], ff = f + d[1];
        while (rr>=0 && rr<=7 && ff>=0 && ff<=7) {
          const p = this._board[rr][ff];
          if (p) {
            if (p.color === byColor) {
              if (i < 4) {
                if (p.type === 'r' || p.type === 'q') return true;
              } else {
                if (p.type === 'b' || p.type === 'q') return true;
              }
            }
            break;
          }
          rr += d[0]; ff += d[1];
        }
      }
      for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        const rr = r + dr, ff = f + df;
        if (rr>=0 && rr<=7 && ff>=0 && ff<=7) {
          const p = this._board[rr][ff];
          if (p && p.color === byColor && p.type === 'k') return true;
        }
      }
      return false;
    }
    moves(opts = {}) {
      const square = opts.square;
      const verbose = !!opts.verbose;
      const out = [];
      const generateFor = (r, f) => {
        const p = this._board[r][f];
        if (!p) return;
        if (p.color !== this.turn) return;
        const myColor = p.color;
        const enemyColor = myColor === 'w' ? 'b' : 'w';
        const fromSq = this._rcToSq(r, f);
        const addMove = (toR, toF, flags='') => {
          const toSq = this._rcToSq(toR, toF);
          const snapshot = this._snapshot();
          const captured = this._board[toR][toF];
          this._board[toR][toF] = this._board[r][f];
          this._board[r][f] = null;
          let epCaptured = null;
          if (flags.indexOf('e') !== -1) {
            const capR = r;
            const capF = toF;
            epCaptured = this._board[capR][capF];
            this._board[capR][capF] = null;
          }
          const kingPos = this._findKing(myColor);
          const inCheck = this._isSquareAttackedBy(kingPos.r, kingPos.f, enemyColor);
          this._restore(snapshot);
          if (!inCheck) {
            if (verbose) {
              const mv = { color: myColor, from: fromSq, to: toSq, piece: p.type, flags: flags };
              out.push(mv);
            } else out.push(toSq);
          }
        };
        if (p.type === 'p') {
          const dir = p.color === 'w' ? -1 : 1;
          const startRank = p.color === 'w' ? 6 : 1;
          const oneR = r + dir;
          if (oneR >= 0 && oneR <= 7 && !this._board[oneR][f]) {
            const isPromotion = (oneR === 0 || oneR === 7);
            addMove(oneR, f, isPromotion ? 'p' : '');
            const twoR = r + 2*dir;
            if (r === startRank && !this._board[twoR][f]) addMove(twoR, f, 'b');
          }
          for (const df of [-1, 1]) {
            const capF = f + df;
            const capR = r + dir;
            if (capF>=0 && capF<=7 && capR>=0 && capR<=7) {
              const target = this._board[capR][capF];
              if (target && target.color !== p.color) {
                const isPromotion = (capR === 0 || capR === 7);
                addMove(capR, capF, isPromotion ? 'c' : 'c');
              }
            }
          }
          if (this.enPassant) {
            const ep = this._sqToRC(this.enPassant);
            if (ep && ep.r === r + dir && Math.abs(ep.f - f) === 1) addMove(ep.r, ep.f, 'e');
          }
        } else if (p.type === 'n') {
          const offsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
          for (const o of offsets) {
            const rr = r + o[0], ff = f + o[1];
            if (rr<0||rr>7||ff<0||ff>7) continue;
            const target = this._board[rr][ff];
            if (!target || target.color !== p.color) addMove(rr, ff, target ? 'c' : '');
          }
        } else if (p.type === 'b' || p.type === 'r' || p.type === 'q') {
          const dirs = [];
          if (p.type === 'b' || p.type === 'q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
          if (p.type === 'r' || p.type === 'q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
          for (const d of dirs) {
            let rr = r + d[0], ff = f + d[1];
            while (rr>=0 && rr<=7 && ff>=0 && ff<=7) {
              const target = this._board[rr][ff];
              if (!target) addMove(rr, ff, '');
              else { if (target.color !== p.color) addMove(rr, ff, 'c'); break; }
              rr += d[0]; ff += d[1];
            }
          }
        } else if (p.type === 'k') {
          for (let dr=-1; dr<=1; dr++) for (let df=-1; df<=1; df++) {
            if (dr===0 && df===0) continue;
            const rr = r + dr, ff = f + df;
            if (rr<0||rr>7||ff<0||ff>7) continue;
            const target = this._board[rr][ff];
            if (!target || target.color !== p.color) addMove(rr, ff, target ? 'c' : '');
          }
          if (p.color === 'w' && r === 7 && f === 4) {
            if (this.castling.w.K) {
              if (!this._board[7][5] && !this._board[7][6]) {
                const kingPos = { r:7, f:4 };
                if (!this._isSquareAttackedBy(kingPos.r, kingPos.f, enemyColor)
                    && !this._isSquareAttackedBy(7,5, enemyColor)
                    && !this._isSquareAttackedBy(7,6, enemyColor)) addMove(7,6,'k');
              }
            }
            if (this.castling.w.Q) {
              if (!this._board[7][3] && !this._board[7][2] && !this._board[7][1]) {
                if (!this._isSquareAttackedBy(7,4, enemyColor)
                    && !this._isSquareAttackedBy(7,3, enemyColor)
                    && !this._isSquareAttackedBy(7,2, enemyColor)) addMove(7,2,'q');
              }
            }
          }
          if (p.color === 'b' && r === 0 && f === 4) {
            if (this.castling.b.K) {
              if (!this._board[0][5] && !this._board[0][6]) {
                if (!this._isSquareAttackedBy(0,4, enemyColor)
                    && !this._isSquareAttackedBy(0,5, enemyColor)
                    && !this._isSquareAttackedBy(0,6, enemyColor)) addMove(0,6,'k');
              }
            }
            if (this.castling.b.Q) {
              if (!this._board[0][3] && !this._board[0][2] && !this._board[0][1]) {
                if (!this._isSquareAttackedBy(0,4, enemyColor)
                    && !this._isSquareAttackedBy(0,3, enemyColor)
                    && !this._isSquareAttackedBy(0,2, enemyColor)) addMove(0,2,'q');
              }
            }
          }
        }
      };

      if (square) {
        const rc = this._sqToRC(square);
        if (!rc) return [];
        generateFor(rc.r, rc.f);
      } else {
        for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
          const p = this._board[r][f];
          if (p && p.color === this.turn) generateFor(r, f);
        }
      }
      return out;
    }
    _snapshot() {
      return { board: this.board(), turn: this.turn, castling: JSON.parse(JSON.stringify(this.castling)), enPassant: this.enPassant, halfmoveClock: this.halfmoveClock, fullmoveNumber: this.fullmoveNumber };
    }
    _restore(snapshot) {
      this._board = this._emptyBoard();
      for (let r=0; r<8; r++) for (let f=0; f<8; f++) {
        const p = snapshot.board[r][f];
        if (p) this._board[r][f] = { type: p.type, color: p.color };
      }
      this.turn = snapshot.turn;
      this.castling = snapshot.castling;
      this.enPassant = snapshot.enPassant;
      this.halfmoveClock = snapshot.halfmoveClock;
      this.fullmoveNumber = snapshot.fullmoveNumber;
    }
    move(obj) {
      try {
        if (!obj || !obj.from || !obj.to) return null;
        const from = this._sqToRC(obj.from);
        const to = this._sqToRC(obj.to);
        if (!from || !to) return null;
        const p = this._board[from.r][from.f];
        if (!p) return null;
        if (p.color !== this.turn) return null;
        const legal = this.moves({ square: obj.from, verbose: true });
        const match = legal.find(m => m.to === obj.to);
        if (!match) return null;
        const moveFlags = match.flags || '';
        const captured = this.get(obj.to);
        let epCaptured = null;
        if (p.type === 'p' || captured) this.halfmoveClock = 0; else this.halfmoveClock++;
        this._board[to.r][to.f] = this._board[from.r][from.f];
        this._board[from.r][from.f] = null;
        if (moveFlags.indexOf('e') !== -1) {
          const capR = from.r;
          const capF = to.f;
          epCaptured = this._board[capR][capF];
          this._board[capR][capF] = null;
        }
        if (moveFlags.indexOf('k') !== -1) {
          if (this.turn === 'w') {
            this._board[7][5] = this._board[7][7];
            this._board[7][7] = null;
          } else {
            this._board[0][5] = this._board[0][7];
            this._board[0][7] = null;
          }
        } else if (moveFlags.indexOf('q') !== -1) {
          if (this.turn === 'w') {
            this._board[7][3] = this._board[7][0];
            this._board[7][0] = null;
          } else {
            this._board[0][3] = this._board[0][0];
            this._board[0][0] = null;
          }
        }
        if (p.type === 'p') {
          const lastRank = (p.color === 'w' ? 0 : 7);
          if (to.r === lastRank) {
            const prom = obj.promotion ? obj.promotion.toLowerCase() : 'q';
            this._board[to.r][to.f] = { type: prom, color: p.color };
          }
        }
        if (p.type === 'k') { this.castling[p.color].K = false; this.castling[p.color].Q = false; }
        if (p.type === 'r') {
          if (this.turn === 'w') {
            if (from.r === 7 && from.f === 0) this.castling.w.Q = false;
            if (from.r === 7 && from.f === 7) this.castling.w.K = false;
          } else {
            if (from.r === 0 && from.f === 0) this.castling.b.Q = false;
            if (from.r === 0 && from.f === 7) this.castling.b.K = false;
          }
        }
        if (captured && captured.type === 'r') {
          if (to.r === 7 && to.f === 0) this.castling.w.Q = false;
          if (to.r === 7 && to.f === 7) this.castling.w.K = false;
          if (to.r === 0 && to.f === 0) this.castling.b.Q = false;
          if (to.r === 0 && to.f === 7) this.castling.b.K = false;
        }
        if (p.type === 'p' && Math.abs(to.r - from.r) === 2) {
          const epR = (to.r + from.r) / 2;
          const epSq = this._rcToSq(epR, from.f);
          this.enPassant = epSq;
        } else { this.enPassant = null; }
        if (this.turn === 'b') this.fullmoveNumber++;
        this.turn = this.turn === 'w' ? 'b' : 'w';
        const moveObj = {
          color: p.color,
          from: obj.from,
          to: obj.to,
          piece: p.type,
          flags: moveFlags,
          captured: captured ? captured.type : (epCaptured ? epCaptured.type : undefined),
          promotion: (p.type === 'p' && (to.r === 0 || to.r === 7)) ? (obj.promotion ? obj.promotion.toLowerCase() : 'q') : undefined,
          san: undefined
        };
        return moveObj;
      } catch (e) { console.error('Move error', e); return null; }
    }
  }

  //
  // --- End ChessEngine (identical logic) ---
  //

  // ---------- Visual helpers & piece factory ----------
  function createMaterials() {
    // Ivory / wood style materials
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f0e6, roughness: 0.45, metalness: 0.02 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.02 });
    const highlightMat = new THREE.MeshStandardMaterial({ color: 0x00ff66, emissive: 0x00ff66, emissiveIntensity: 0.6, roughness: 0.2 });
    return { whiteMat, blackMat, highlightMat };
  }

  const MATERIALS = createMaterials();

  // Create stylized piece meshes (Group) for each type ('p','r','n','b','q','k')
  function createPieceMesh(type, color) {
    const group = new THREE.Group();
    const mat = color === 'w' ? MATERIALS.whiteMat : MATERIALS.blackMat;

    // base disk (common)
    const baseGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.12, 32);
    const base = new THREE.Mesh(baseGeo, mat);
    base.position.y = 0.06;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // stem
    const stemGeo = new THREE.CylinderGeometry(0.16, 0.20, 0.4, 32);
    const stem = new THREE.Mesh(stemGeo, mat);
    stem.position.y = 0.34;
    stem.castShadow = true;
    stem.receiveShadow = true;
    group.add(stem);

    // different crowns / heads
    if (type === 'p') {
      // pawn: small rounded head
      const headGeo = new THREE.SphereGeometry(0.14, 20, 16);
      const head = new THREE.Mesh(headGeo, mat);
      head.position.y = 0.62;
      head.castShadow = true;
      group.add(head);
    } else if (type === 'r') {
      // rook: battlement box
      const towerGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 20);
      const tower = new THREE.Mesh(towerGeo, mat);
      tower.position.y = 0.62;
      tower.castShadow = true;
      group.add(tower);
      // battlements
      const battlementGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(battlementGeo, mat);
        const angle = (i / 4) * Math.PI * 2;
        b.position.set(Math.sin(angle) * 0.18, 0.98, Math.cos(angle) * 0.18);
        b.castShadow = true;
        group.add(b);
      }
    } else if (type === 'n') {
      // knight: stylized curved head using lathe-like shape approximation
      const pts = [];
      pts.push(new THREE.Vector2(0.0, 0.0));
      pts.push(new THREE.Vector2(0.05, 0.05));
      pts.push(new THREE.Vector2(0.12, 0.12));
      pts.push(new THREE.Vector2(0.18, 0.28));
      pts.push(new THREE.Vector2(0.12, 0.46));
      pts.push(new THREE.Vector2(0.0, 0.6));
      const latheGeo = new THREE.LatheGeometry(pts, 20);
      const lathe = new THREE.Mesh(latheGeo, mat);
      lathe.rotation.y = Math.PI * 0.2;
      lathe.position.y = 0.42;
      lathe.position.x = -0.04;
      lathe.position.z = 0.06;
      lathe.castShadow = true;
      group.add(lathe);
    } else if (type === 'b') {
      // bishop: tall sloped head with a cut (diagonal)
      const bishopGeo = new THREE.CylinderGeometry(0.18, 0.20, 0.6, 28);
      const bishop = new THREE.Mesh(bishopGeo, mat);
      bishop.position.y = 0.66;
      bishop.castShadow = true;
      // create diagonal cut by boolean-like approach using an invisible plane: use a slanted thin box to mask via geometry subtraction is complex,
      // so approximate by adding a separate slim cone to emulate the cut and a small sphere on top
      const slant = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 12), mat);
      slant.position.y = 0.92;
      slant.rotation.x = 0.5;
      slant.castShadow = true;
      group.add(bishop);
      group.add(slant);
    } else if (type === 'q') {
      // queen: crown - ring + spikes
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 12, 24), mat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.72;
      collar.castShadow = true;
      group.add(collar);
      // spikes
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.ConeGeometry(0.04, 0.14, 8);
        const mesh = new THREE.Mesh(spike, mat);
        const angle = (i / 6) * Math.PI * 2;
        mesh.position.set(Math.cos(angle) * 0.18, 0.86, Math.sin(angle) * 0.18);
        mesh.lookAt(0, 1, 0);
        mesh.castShadow = true;
        group.add(mesh);
      }
    } else if (type === 'k') {
      // king: tall stem + cross
      const crownGeo = new THREE.ConeGeometry(0.16, 0.16, 16);
      const crown = new THREE.Mesh(crownGeo, mat);
      crown.position.y = 0.78;
      crown.castShadow = true;
      group.add(crown);
      // cross
      const crossHor = new THREE.BoxGeometry(0.12, 0.02, 0.02);
      const crossVer = new THREE.BoxGeometry(0.02, 0.12, 0.02);
      const ch = new THREE.Mesh(crossHor, mat);
      const cv = new THREE.Mesh(crossVer, mat);
      ch.position.y = 0.96;
      cv.position.y = 0.96;
      ch.castShadow = true; cv.castShadow = true;
      group.add(ch); group.add(cv);
    }

    // micro polish: scale & orientation
    group.scale.set(1.0, 1.0, 1.0);
    group.userData = { pieceType: type, color: color };
    return group;
  }

  function makeSquareMesh(file, rank, size, isLight) {
    // slightly raised square look using box with thin edge
    const height = 0.12;
    const geo = new THREE.BoxGeometry(size, height, size);
    const color = isLight ? 0xe6d7b8 : 0x6b4f35;
    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6, metalness: 0.02 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((file - 3.5) * size, height / 2 - 0.02, (rank - 3.5) * size);
    mesh.receiveShadow = true;
    mesh.userData = {
      file: file,
      rank: rank,
      square: String.fromCharCode(97 + file) + (8 - rank)
    };
    return mesh;
  }

  // Initialize Three.js scene
  function initThreeJS() {
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }

    // Initialize chess engine
    try {
      chess = new ChessEngine();
    } catch (e) {
      console.error('Chess engine initialization failed', e);
      return;
    }

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1724); // deep bluish to add contrast
    scene.fog = new THREE.FogExp2(0x0f1724, 0.06);

    // Camera setup
    camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    updateCameraPositionImmediate();

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(6, 12, 3);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    directional.shadow.camera.left = -12;
    directional.shadow.camera.right = 12;
    directional.shadow.camera.top = 12;
    directional.shadow.camera.bottom = -12;
    directional.shadow.radius = 4;
    scene.add(directional);

    // rim light for contrast
    const rim = new THREE.PointLight(0xffffff, 0.12, 30);
    rim.position.set(-6, 6, -4);
    scene.add(rim);

    // ground plane for subtle reflection look
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x091018, roughness: 0.9, metalness: 0.0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);

    // Raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create the chess board (visual)
    createChessBoard();

    // Event listeners
    canvas.addEventListener('mousedown', onMouseDown, false);
    canvas.addEventListener('mousemove', onMouseMove, false);
    canvas.addEventListener('mouseup', onMouseUp, false);
    canvas.addEventListener('mouseleave', onMouseUp, false);
    canvas.addEventListener('wheel', onMouseWheel, { passive: false });
    canvas.addEventListener('click', onCanvasClick, false);

    // Touch listeners with pinch support
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    window.addEventListener('resize', onWindowResize);

    // Start render loop
    animate();

    // Hide loading indicator
    if (loadingElem) loadingElem.style.display = 'none';
    isSceneReady = true;

    // initial pieces render
    updatePieces();
  }

  // Immediately place camera (no smoothing)
  function updateCameraPositionImmediate() {
    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    if (camera) {
      camera.position.set(x, y, z);
      camera.lookAt(0, 0.2, 0); // look a bit above center to feel natural
    }
  }

  // Smooth camera update (called each frame)
  function updateCameraPosition() {
    // damp towards targetTheta/targetPhi/targetDistance
    cameraTheta += (targetTheta - cameraTheta) * ROTATION_DAMPING;
    cameraPhi += (targetPhi - cameraPhi) * ROTATION_DAMPING;
    cameraDistance += (targetDistance - cameraDistance) * ZOOM_DAMPING;

    cameraPhi = Math.max(MIN_PHI, Math.min(MAX_PHI, cameraPhi));
    cameraDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, cameraDistance));

    const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    const y = cameraDistance * Math.cos(cameraPhi);
    if (camera) {
      camera.position.set(x, y, z);
      camera.lookAt(0, 0.2, 0);
    }
  }

  // Mouse handlers (rotation/inertia)
  function onMouseDown(event) {
    if (event.button !== 0) return;
    isDragging = true;
    previousMousePosition = { x: event.clientX, y: event.clientY };
  }

  function onMouseMove(event) {
    if (!isDragging) return;
    const deltaX = event.clientX - previousMousePosition.x;
    const deltaY = event.clientY - previousMousePosition.y;
    previousMousePosition = { x: event.clientX, y: event.clientY };

    // adjust target angles with reasonable sensitivity
    targetTheta += deltaX * 0.006;
    targetPhi += deltaY * 0.005;
    targetPhi = Math.max(MIN_PHI, Math.min(MAX_PHI, targetPhi));
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onMouseWheel(event) {
    event.preventDefault();
    const delta = event.deltaY;
    targetDistance += delta * 0.01;
    targetDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, targetDistance));
  }

  // Touch event handlers (single touch rotate, two-finger pinch to zoom, tap detection)
  function getTouchesDistance(t0, t1) {
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function onTouchStart(event) {
    event.preventDefault();
    const touches = event.touches;
    touchStartTime = Date.now();
    touchMoved = false;

    if (touches.length === 1) {
      // single-finger rotate start
      isPinching = false;
      previousMousePosition = { x: touches[0].clientX, y: touches[0].clientY };
      isDragging = false;
    } else if (touches.length === 2) {
      // pinch start
      isPinching = true;
      lastPinchDist = getTouchesDistance(touches[0], touches[1]);
      // compute pinch midpoint as reference for potential two-finger rotate in future
    }
  }

  function onTouchMove(event) {
    event.preventDefault();
    const touches = event.touches;
    if (!touches) return;

    if (touches.length === 1 && !isPinching) {
      const t = touches[0];
      const dx = t.clientX - previousMousePosition.x;
      const dy = t.clientY - previousMousePosition.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (!touchMoved && dist > TOUCH_MOVE_THRESHOLD) {
        touchMoved = true;
      }

      if (touchMoved) {
        // single-finger rotate
        targetTheta += dx * 0.006;
        targetPhi += dy * 0.005;
        targetPhi = Math.max(MIN_PHI, Math.min(MAX_PHI, targetPhi));
        previousMousePosition = { x: t.clientX, y: t.clientY };
      }
    } else if (touches.length === 2) {
      // pinch to zoom
      isPinching = true;
      const distNow = getTouchesDistance(touches[0], touches[1]);
      if (lastPinchDist) {
        const diff = lastPinchDist - distNow; // positive if pinching close (zoom out)
        targetDistance += diff * 0.02; // sensitivity
        targetDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, targetDistance));
      }
      lastPinchDist = distNow;
    }
  }

  function onTouchEnd(event) {
    event.preventDefault();
    const touches = event.touches || [];
    const duration = Date.now() - touchStartTime;

    if (!touchMoved && duration <= TAP_MAX_DURATION && touches.length === 0) {
      // it's a tap (single quick touch)
      const changed = event.changedTouches && event.changedTouches[0];
      const cx = changed ? changed.clientX : touchStartPos.x;
      const cy = changed ? changed.clientY : touchStartPos.y;
      handleInteraction(cx, cy);
      lastTouchWasTap = true;
      setTimeout(() => lastTouchWasTap = false, 400);
    }

    // reset pinch state if no longer two touches
    if (touches.length < 2) {
      isPinching = false;
      lastPinchDist = null;
    }
    touchMoved = false;
    isDragging = false;
  }

  // Create chess board visual (replaces simple plane with raised polished squares)
  function createChessBoard() {
    chessBoard = new THREE.Group();
    boardSquares = [];

    const boardSize = 8;
    const squareSize = 1;
    for (let rank = 0; rank < boardSize; rank++) {
      for (let file = 0; file < boardSize; file++) {
        const isLight = (rank + file) % 2 === 0;
        const squareMesh = makeSquareMesh(file, rank, squareSize, isLight);
        chessBoard.add(squareMesh);
        boardSquares.push(squareMesh);
      }
    }

    // thin rim around board
    const rimGeo = new THREE.BoxGeometry(boardSize + 0.2, 0.06, boardSize + 0.2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b1709, roughness: 0.7 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = -0.02;
    rim.receiveShadow = true;
    chessBoard.add(rim);

    // small center marker (visual anchor)
    const centerGeo = new THREE.CircleGeometry(0.02, 8);
    const centerMat = new THREE.MeshStandardMaterial({ color: 0xffcc66, roughness: 0.7 });
    const center = new THREE.Mesh(centerGeo, centerMat);
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.001;
    chessBoard.add(center);

    scene.add(chessBoard);
  }

  // Update pieces on board (uses createPieceMesh)
  function updatePieces() {
    if (!chess || !isSceneReady) return;

    // Clear existing pieces
    chessPieces.forEach(piece => {
      if (piece.parent) piece.parent.remove(piece);
    });
    chessPieces = [];

    const board = chess.board();

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = board[rank][file];
        if (piece) {
          const pieceGroup = createPieceMesh(piece.type, piece.color);
          // position: (file - 3.5) * 1, y ~ base height, z: (rank - 3.5) * 1
          pieceGroup.position.set((file - 3.5) * 1, 0, (rank - 3.5) * 1);
          // subtle random micro-rotation for natural look
          pieceGroup.rotation.y = ((file + rank) % 2) * 0.03;
          // scale smaller for pawns
          if (piece.type === 'p') pieceGroup.scale.set(0.92, 0.92, 0.92);
          if (piece.type === 'n') pieceGroup.scale.set(1.02, 1.02, 1.02);

          // userData to find the square and piece
          pieceGroup.userData = {
            piece: piece,
            square: String.fromCharCode(97 + file) + (8 - rank)
          };

          // shadows
          pieceGroup.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          scene.add(pieceGroup);
          chessPieces.push(pieceGroup);
        }
      }
    }
  }

  // Raycast square meshes quickly by using boardSquares array (we placed userData.square there)
  function pickSquareFromRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(boardSquares, false);
    if (intersects.length > 0) return intersects[0].object.userData.square;
    return null;
  }

  // Handle canvas click
  function onCanvasClick(event) {
    if (lastTouchWasTap) return;
    if (isDragging) return;
    handleInteraction(event.clientX, event.clientY);
  }

  // Handle interaction (preserve existing logic and checks)
  function handleInteraction(clientX, clientY) {
    if (!gameState || !gameActive || gameState.status !== 'active' || !isSceneReady) return;
    if (gameState.turn !== currentUsername) return;
    if (!chess) return;

    const clickedSquare = pickSquareFromRay(clientX, clientY);
    if (!clickedSquare) return;

    if (!selectedSquare) {
      // Select a piece
      const piece = chess.get(clickedSquare);
      const playerColor = (gameState.players.indexOf(currentUsername) === 0) ? 'w' : 'b';
      if (piece && piece.color === playerColor) {
        selectedSquare = clickedSquare;
        highlightSquare(clickedSquare, 0xffff00);
        showPossibleMoves(clickedSquare);
      }
    } else {
      // Try to make a move
      if (clickedSquare === selectedSquare) {
        // Deselect
        clearHighlights();
        selectedSquare = null;
      } else {
        // Attempt move with promotion default to queen
        const moveObj = { from: selectedSquare, to: clickedSquare, promotion: 'q' };
        const move = chess.move(moveObj);

        if (move) {
          // Valid move, send to server
          sendMessage({
            type: 'makeMove',
            data: {
              username: currentUsername,
              position: { from: selectedSquare, to: clickedSquare },
              gameType: GAME_TYPE
            }
          });

          clearHighlights();
          selectedSquare = null;
          // Re-render pieces from engine
          updatePieces();
        } else {
          // Invalid move, try selecting new piece
          const piece = chess.get(clickedSquare);
          const playerColor = (gameState.players.indexOf(currentUsername) === 0) ? 'w' : 'b';
          if (piece && piece.color === playerColor) {
            clearHighlights();
            selectedSquare = clickedSquare;
            highlightSquare(clickedSquare, 0xffff00);
            showPossibleMoves(clickedSquare);
          } else {
            clearHighlights();
            selectedSquare = null;
          }
        }
      }
    }
  }

  // Highlight square by adjusting emissive on the square mesh
  function highlightSquare(square, color) {
    for (const sqMesh of boardSquares) {
      if (sqMesh.userData.square === square) {
        sqMesh.material.emissive = new THREE.Color(color);
        sqMesh.material.emissiveIntensity = 0.25;
        return;
      }
    }
  }

  // Show possible moves by highlighting target squares
  function showPossibleMoves(square) {
    const moves = chess.moves({ square: square, verbose: true });
    possibleMoves = moves.map(move => move.to);
    possibleMoves.forEach(moveSquare => {
      for (const sqMesh of boardSquares) {
        if (sqMesh.userData.square === moveSquare) {
          sqMesh.material.emissive = new THREE.Color(0x26a269);
          sqMesh.material.emissiveIntensity = 0.2;
        }
      }
    });
  }

  // Clear highlights
  function clearHighlights() {
    for (const sqMesh of boardSquares) {
      sqMesh.material.emissive = new THREE.Color(0x000000);
      sqMesh.material.emissiveIntensity = 0;
    }
    possibleMoves = [];
  }

  // Update scene based on game state (unchanged)
  function updateScene() {
    if (!gameState || !isSceneReady || !chess) return;
    if (gameState.chess && gameState.chess.fen) {
      const ok = chess.load(gameState.chess.fen);
      if (!ok) console.warn('Failed to load FEN into chess engine:', gameState.chess.fen);
      updatePieces();
    }
  }

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    // update camera smoothing each frame
    updateCameraPosition();
    if (isSceneReady && renderer && scene && camera) {
      renderer.render(scene, camera);
    }
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

  // Show game end modal (unchanged)
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
      message = "Great game! Well played by both sides.";
      emoji = '🤝';
    } else if (winner === currentUsername) {
      modalClass = 'win-modal celebration';
      title = "🎉 Checkmate! 🎉";
      message = "Excellent chess strategy! You are victorious!";
      emoji = '🏆';
    } else {
      modalClass = 'lose-modal';
      title = "Game Over 😔";
      if (reason === 'timeout') {
        message = `Time's up! ${winner} wins by timeout.`;
      } else {
        message = `${winner} achieved checkmate! Better luck next time.`;
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

  // Update game status display (unchanged)
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
      const myColor = gameState.players.indexOf(currentUsername) === 0 ? 'White' : 'Black';
      const turnColor = gameState.players.indexOf(gameState.turn) === 0 ? 'White' : 'Black';
      
      statusElem.textContent = isMyTurn 
        ? `🎯 Your turn (${myColor})` 
        : `⏳ ${gameState.turn}'s turn (${turnColor})`;
      
      if (isMyTurn) {
        statusElem.style.background = 'rgba(40, 167, 69, 0.95)';
        statusElem.style.color = 'white';
      } else {
        statusElem.style.background = 'rgba(255, 255, 255, 0.95)';
        statusElem.style.color = '#333';
      }
    } else if (gameState.status === 'finished') {
      statusElem.textContent = gameState.winner === currentUsername 
        ? `🏆 You won!` 
        : `😔 ${gameState.winner} won`;
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

  // Update timer display (unchanged)
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

  // Update players info (unchanged)
  function updatePlayersInfo() {
    if (!gameState || !playersElem) return;
    
    playersElem.className = 'status-display-3d';
    
    if (!Array.isArray(gameState.players) || gameState.players.length === 0) {
      playersElem.textContent = '👥 No players yet';
    } else {
      const playersList = gameState.players.map((player, index) => {
        const color = index === 0 ? 'White' : 'Black';
        const isCurrent = player === currentUsername;
        return `${player} (${color})${isCurrent ? ' - You' : ''}`;
      }).join(', ');
      playersElem.textContent = `👥 Players: ${playersList}`;
    }
  }

  // Handle messages from parent (unchanged)
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
          updateScene();
          updateStatus();
          updatePlayersInfo();
        }
        break;

      case 'turnChanged':
        updateStatus();
        break;

      case 'timerUpdate':
        if (message.data) updateTimer(message.data.timeRemaining, message.data.currentTurn);
        break;

      case 'gameEnded':
        gameActive = false;
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
        if (statusElem) {
          statusElem.textContent = `❌ Error: ${message.message || (message.data && message.data.message) || 'unknown'}`;
          statusElem.className = 'status-display-3d';
          statusElem.style.background = 'rgba(220, 53, 69, 0.95)';
          statusElem.style.color = 'white';
          // Clear error message after 3 seconds
          setTimeout(() => {
            updateStatus();
          }, 3000);
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
