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

  // --- Local Chess engine (self-contained) ---
  // Ported/adapted from your server api.ts ChessEngine (converted to plain JS)
  class ChessEngine {
    constructor(fen) {
      this.board = Array(64).fill(null);
      this.turnToMove = 'w'; // 'w' or 'b'
      this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
      this.enPassantSquare = null;
      this.halfmoveClock = 0;
      this.fullmoveNumber = 1;
      this.history = []; // UCI strings
      this.repetitionMap = {};
      if (fen) this.loadFen(fen);
      else this.loadStartingPosition();
    }

    // helpers
    static fileCharToIdx(file) { return 'abcdefgh'.indexOf(file); }
    static idxToFile(i) { return 'abcdefgh'[i]; }
    static indexToFile(i) { return ChessEngine.idxToFile(i); }
    static rankCharToIdx(rank) { return Number(rank) - 1; }
    static squareToIndex(sq) {
      if (!sq || sq.length !== 2) return -1;
      const file = ChessEngine.fileCharToIdx(sq[0]);
      const rank = ChessEngine.rankCharToIdx(sq[1]);
      if (file < 0 || rank < 0 || file > 7 || rank > 7) return -1;
      return (7 - rank) * 8 + file;
    }
    static indexToSquare(index) {
      if (index < 0 || index > 63) return '';
      const rank = 8 - Math.floor(index / 8);
      const file = index % 8;
      return `${'abcdefgh'[file]}${rank}`;
    }

    clone() {
      const copy = new ChessEngine();
      copy.board = this.board.slice();
      copy.turnToMove = this.turnToMove;
      copy.castlingRights = Object.assign({}, this.castlingRights);
      copy.enPassantSquare = this.enPassantSquare;
      copy.halfmoveClock = this.halfmoveClock;
      copy.fullmoveNumber = this.fullmoveNumber;
      copy.history = this.history.slice();
      copy.repetitionMap = Object.assign({}, this.repetitionMap);
      return copy;
    }

    loadStartingPosition() {
      this.board = [
        'r','n','b','q','k','b','n','r',
        'p','p','p','p','p','p','p','p',
        null,null,null,null,null,null,null,null,
        null,null,null,null,null,null,null,null,
        null,null,null,null,null,null,null,null,
        null,null,null,null,null,null,null,null,
        'P','P','P','P','P','P','P','P',
        'R','N','B','Q','K','B','N','R'
      ];
      this.turnToMove = 'w';
      this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
      this.enPassantSquare = null;
      this.halfmoveClock = 0;
      this.fullmoveNumber = 1;
      this.history = [];
      this.repetitionMap = {};
      this.recordFenRepetition();
    }

    loadFen(fen) {
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 6) throw new Error('Invalid FEN');
      const [boardPart, turnPart, castlingPart, enPassantPart, halfmovePart, fullmovePart] = parts;
      const rows = boardPart.split('/');
      if (rows.length !== 8) throw new Error('Invalid FEN board');
      const b = [];
      for (const r of rows) {
        for (const ch of r) {
          if (/\d/.test(ch)) {
            const cnt = Number(ch);
            for (let k = 0; k < cnt; k++) b.push(null);
          } else b.push(ch);
        }
      }
      if (b.length !== 64) throw new Error('Invalid FEN board length');
      this.board = b;
      this.turnToMove = turnPart === 'w' ? 'w' : 'b';
      this.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
      if (castlingPart.includes('K')) this.castlingRights.wK = true;
      if (castlingPart.includes('Q')) this.castlingRights.wQ = true;
      if (castlingPart.includes('k')) this.castlingRights.bK = true;
      if (castlingPart.includes('q')) this.castlingRights.bQ = true;
      this.enPassantSquare = enPassantPart === '-' ? null : enPassantPart;
      this.halfmoveClock = Number(halfmovePart);
      this.fullmoveNumber = Number(fullmovePart);
      this.history = [];
      this.repetitionMap = {};
      this.recordFenRepetition();
    }

    getFen() {
      const rows = [];
      for (let rank = 0; rank < 8; rank++) {
        let emptyCount = 0;
        let row = '';
        for (let file = 0; file < 8; file++) {
          const idx = rank * 8 + file;
          const piece = this.board[idx];
          if (piece === null) { emptyCount++; }
          else {
            if (emptyCount > 0) { row += emptyCount.toString(); emptyCount = 0; }
            row += piece;
          }
        }
        if (emptyCount > 0) row += emptyCount.toString();
        rows.push(row);
      }
      const boardPart = rows.join('/');
      const turnPart = this.turnToMove === 'w' ? 'w' : 'b';
      let castling = '';
      if (this.castlingRights.wK) castling += 'K';
      if (this.castlingRights.wQ) castling += 'Q';
      if (this.castlingRights.bK) castling += 'k';
      if (this.castlingRights.bQ) castling += 'q';
      if (castling === '') castling = '-';
      const enp = this.enPassantSquare ? this.enPassantSquare : '-';
      return `${boardPart} ${turnPart} ${castling} ${enp} ${this.halfmoveClock} ${this.fullmoveNumber}`;
    }

    recordFenRepetition() {
      const base = this.getFen().split(' ');
      const fenNoCounters = `${base[0]} ${base[1]} ${base[2]} ${base[3]}`;
      this.repetitionMap[fenNoCounters] = (this.repetitionMap[fenNoCounters] || 0) + 1;
    }

    pieceColor(piece) {
      if (!piece) return null;
      return piece === piece.toUpperCase() ? 'w' : 'b';
    }

    // generate pseudo-legal moves (does not filter leaving king in check)
    generatePseudoLegalMoves() {
      const moves = [];
      const side = this.turnToMove;
      for (let sq = 0; sq < 64; sq++) {
        const p = this.board[sq];
        if (!p) continue;
        const color = this.pieceColor(p);
        if (color !== side) continue;
        const pieceType = p.toUpperCase();
        const fromSqStr = ChessEngine.indexToSquare(sq);

        if (pieceType === 'P') {
          // pawn single forward / double / captures / en-passant / promotions
          const forwardRankNum = Number(fromSqStr[1]) + (color === 'w' ? 1 : -1);
          const oneForward = (forwardRankNum >= 1 && forwardRankNum <= 8) ? ChessEngine.squareToIndex(`${fromSqStr[0]}${forwardRankNum}`) : -1;
          if (oneForward !== -1 && this.board[oneForward] === null) {
            if ((color === 'w' && forwardRankNum === 8) || (color === 'b' && forwardRankNum === 1)) {
              ['q','r','b','n'].forEach(pr => moves.push({ from: sq, to: oneForward, promotion: pr }));
            } else {
              moves.push({ from: sq, to: oneForward });
              const startRankNum = color === 'w' ? 2 : 7;
              const fromRankNum = Number(fromSqStr[1]);
              if (fromRankNum === startRankNum) {
                const twoForwardRank = color === 'w' ? 4 : 5;
                const twoForwardSq = ChessEngine.squareToIndex(`${fromSqStr[0]}${twoForwardRank}`);
                if (twoForwardSq !== -1 && this.board[twoForwardSq] === null) {
                  moves.push({ from: sq, to: twoForwardSq });
                }
              }
            }
          }
          const captureOffsets = [-1, 1];
          for (const off of captureOffsets) {
            const fileIdx = fromSqStr.charCodeAt(0) + off;
            if (fileIdx < 97 || fileIdx > 104) continue;
            const captureFile = String.fromCharCode(fileIdx);
            const captureRank = forwardRankNum;
            if (captureRank < 1 || captureRank > 8) continue;
            const targetSq = ChessEngine.squareToIndex(`${captureFile}${captureRank}`);
            if (targetSq === -1) continue;
            const targetPiece = this.board[targetSq];
            if (targetPiece && this.pieceColor(targetPiece) !== color) {
              if ((color === 'w' && captureRank === 8) || (color === 'b' && captureRank === 1)) {
                ['q','r','b','n'].forEach(pr => moves.push({ from: sq, to: targetSq, promotion: pr }));
              } else {
                moves.push({ from: sq, to: targetSq });
              }
            } else if (this.enPassantSquare) {
              const enpIdx = ChessEngine.squareToIndex(this.enPassantSquare);
              if (enpIdx === targetSq) {
                moves.push({ from: sq, to: targetSq });
              }
            }
          }
        } else if (pieceType === 'N') {
          const jumps = [ -17, -15, -10, -6, 6, 10, 15, 17 ];
          for (const j of jumps) {
            const to = sq + j;
            if (to < 0 || to >= 64) continue;
            const fx = sq % 8, tx = to % 8;
            const fd = Math.abs(fx - tx);
            const allowed = [1,2].includes(fd);
            if (!allowed) continue;
            const target = this.board[to];
            if (!target || this.pieceColor(target) !== this.pieceColor(this.board[sq])) {
              moves.push({ from: sq, to });
            }
          }
        } else if (pieceType === 'B' || pieceType === 'R' || pieceType === 'Q') {
          const dirs = [];
          if (pieceType === 'B' || pieceType === 'Q') dirs.push(-9, -7, 7, 9);
          if (pieceType === 'R' || pieceType === 'Q') dirs.push(-8, -1, 1, 8);
          for (const d of dirs) {
            let to = sq + d;
            while (to >= 0 && to < 64) {
              const fromFile = sq % 8;
              const toFile = to % 8;
              const diffFile = Math.abs(toFile - fromFile);
              if (diffFile > 2 && (d === -9 || d === -7 || d === 7 || d === 9 || d === -1 || d === 1)) {
                break;
              }
              const target = this.board[to];
              if (!target) {
                moves.push({ from: sq, to });
                to += d;
                continue;
              } else {
                if (this.pieceColor(target) !== this.pieceColor(this.board[sq])) {
                  moves.push({ from: sq, to });
                }
                break;
              }
            }
          }
        } else if (pieceType === 'K') {
          const deltas = [-9,-8,-7,-1,1,7,8,9];
          for (const d of deltas) {
            const to = sq + d;
            if (to < 0 || to >= 64) continue;
            const fx = sq % 8, tx = to % 8;
            if (Math.abs(fx - tx) > 1) continue;
            const target = this.board[to];
            if (!target || this.pieceColor(target) !== this.pieceColor(this.board[sq])) {
              moves.push({ from: sq, to });
            }
          }
          // castling pseudo-legal
          if (this.turnToMove === 'w') {
            if (this.castlingRights.wK) {
              const e1 = ChessEngine.squareToIndex('e1');
              const f1 = ChessEngine.squareToIndex('f1');
              const g1 = ChessEngine.squareToIndex('g1');
              const h1 = ChessEngine.squareToIndex('h1');
              if (this.board[e1] && this.board[h1] && !this.board[f1] && !this.board[g1]) {
                moves.push({ from: sq, to: g1 });
              }
            }
            if (this.castlingRights.wQ) {
              const e1 = ChessEngine.squareToIndex('e1');
              const d1 = ChessEngine.squareToIndex('d1');
              const c1 = ChessEngine.squareToIndex('c1');
              const a1 = ChessEngine.squareToIndex('a1');
              if (this.board[e1] && this.board[a1] && !this.board[d1] && !this.board[c1] && !this.board[ChessEngine.squareToIndex('b1')]) {
                moves.push({ from: sq, to: c1 });
              }
            }
          } else {
            if (this.castlingRights.bK) {
              const e8 = ChessEngine.squareToIndex('e8');
              const f8 = ChessEngine.squareToIndex('f8');
              const g8 = ChessEngine.squareToIndex('g8');
              const h8 = ChessEngine.squareToIndex('h8');
              if (this.board[e8] && this.board[h8] && !this.board[f8] && !this.board[g8]) {
                moves.push({ from: sq, to: g8 });
              }
            }
            if (this.castlingRights.bQ) {
              const e8 = ChessEngine.squareToIndex('e8');
              const d8 = ChessEngine.squareToIndex('d8');
              const c8 = ChessEngine.squareToIndex('c8');
              const a8 = ChessEngine.squareToIndex('a8');
              if (this.board[e8] && this.board[a8] && !this.board[d8] && !this.board[c8] && !this.board[ChessEngine.squareToIndex('b8')]) {
                moves.push({ from: sq, to: c8 });
              }
            }
          }
        }
      }
      return moves;
    }

    isLegalMove(from, to, promotion) {
      const copy = this.clone();
      const result = copy.makeMoveInternal(from, to, promotion, true);
      if (!result) return false;
      const kingIndex = copy.findKing(copy.turnToMove === 'w' ? 'b' : 'w');
      if (kingIndex === -1) return true;
      const inCheck = copy.isSquareAttacked(kingIndex, copy.turnToMove);
      return !inCheck;
    }

    findKing(color) {
      const kingChar = color === 'w' ? 'K' : 'k';
      for (let i = 0; i < 64; i++) if (this.board[i] === kingChar) return i;
      return -1;
    }

    isSquareAttacked(squareIdx, byColor) {
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (!p) continue;
        const color = this.pieceColor(p);
        if (color !== byColor) continue;
        const pt = p.toUpperCase();
        if (pt === 'P') {
          const sqStr = ChessEngine.indexToSquare(i);
          const file = sqStr[0];
          const rank = Number(sqStr[1]);
          const attackRank = byColor === 'w' ? rank + 1 : rank - 1;
          if (attackRank >= 1 && attackRank <= 8) {
            const leftFile = String.fromCharCode(file.charCodeAt(0) - 1);
            const rightFile = String.fromCharCode(file.charCodeAt(0) + 1);
            if (leftFile >= 'a' && leftFile <= 'h') {
              const s = ChessEngine.squareToIndex(`${leftFile}${attackRank}`);
              if (s === squareIdx) return true;
            }
            if (rightFile >= 'a' && rightFile <= 'h') {
              const s = ChessEngine.squareToIndex(`${rightFile}${attackRank}`);
              if (s === squareIdx) return true;
            }
          }
        } else if (pt === 'N') {
          const jumps = [ -17, -15, -10, -6, 6, 10, 15, 17 ];
          for (const j of jumps) {
            const to = i + j;
            if (to < 0 || to >= 64) continue;
            const fx = i % 8, tx = to % 8;
            if (Math.abs(fx - tx) > 2) continue;
            if (to === squareIdx) return true;
          }
        } else if (pt === 'B' || pt === 'R' || pt === 'Q') {
          const dirs = [];
          if (pt === 'B' || pt === 'Q') dirs.push(-9, -7, 7, 9);
          if (pt === 'R' || pt === 'Q') dirs.push(-8, -1, 1, 8);
          for (const d of dirs) {
            let to = i + d;
            while (to >= 0 && to < 64) {
              const fx = i % 8, tx = to % 8;
              if (Math.abs(fx - tx) > 2 && (d === -9 || d === -7 || d === 7 || d === 9 || d === -1 || d === 1)) break;
              if (to === squareIdx) return true;
              if (this.board[to] !== null) break;
              to += d;
            }
          }
        } else if (pt === 'K') {
          const deltas = [-9,-8,-7,-1,1,7,8,9];
          for (const d of deltas) {
            const to = i + d;
            if (to < 0 || to >= 64) continue;
            const fx = i % 8, tx = to % 8;
            if (Math.abs(fx - tx) > 1) continue;
            if (to === squareIdx) return true;
          }
        }
      }
      return false;
    }

    makeMoveInternal(from, to, promotion, skipValidation = false) {
      const piece = this.board[from];
      if (!piece) return null;
      const color = this.pieceColor(piece);
      const fromSq = ChessEngine.indexToSquare(from);
      const toSq = ChessEngine.indexToSquare(to);
      const moveStr = `${fromSq}${toSq}${promotion ? promotion : ''}`;
      let captured = null;
      // en-passant capture
      if (piece.toUpperCase() === 'P') {
        if (toSq === this.enPassantSquare) {
          const epIdx = ChessEngine.squareToIndex(this.enPassantSquare);
          const capIdx = color === 'w' ? epIdx + 8 : epIdx - 8;
          captured = this.board[capIdx];
          this.board[capIdx] = null;
        }
      }
      captured = captured ?? this.board[to];
      this.board[to] = piece;
      this.board[from] = null;
      // promotion
      if (promotion && piece.toUpperCase() === 'P') {
        const promoted = color === 'w' ? promotion.toUpperCase() : promotion.toLowerCase();
        this.board[to] = promoted;
      }
      // castling rook move
      if (piece.toUpperCase() === 'K') {
        if (piece === 'K') {
          if (fromSq === 'e1' && toSq === 'g1') {
            const h1 = ChessEngine.squareToIndex('h1'), f1 = ChessEngine.squareToIndex('f1');
            this.board[f1] = this.board[h1];
            this.board[h1] = null;
          } else if (fromSq === 'e1' && toSq === 'c1') {
            const a1 = ChessEngine.squareToIndex('a1'), d1 = ChessEngine.squareToIndex('d1');
            this.board[d1] = this.board[a1];
            this.board[a1] = null;
          }
        } else if (piece === 'k') {
          if (fromSq === 'e8' && toSq === 'g8') {
            const h8 = ChessEngine.squareToIndex('h8'), f8 = ChessEngine.squareToIndex('f8');
            this.board[f8] = this.board[h8];
            this.board[h8] = null;
          } else if (fromSq === 'e8' && toSq === 'c8') {
            const a8 = ChessEngine.squareToIndex('a8'), d8 = ChessEngine.squareToIndex('d8');
            this.board[d8] = this.board[a8];
            this.board[a8] = null;
          }
        }
        if (color === 'w') { this.castlingRights.wK = false; this.castlingRights.wQ = false; }
        else { this.castlingRights.bK = false; this.castlingRights.bQ = false; }
      }
      // rook moved or captured affects castling rights
      const fromSqLower = fromSq.toLowerCase();
      if (fromSqLower === 'h1') this.castlingRights.wK = false;
      if (fromSqLower === 'a1') this.castlingRights.wQ = false;
      if (fromSqLower === 'h8') this.castlingRights.bK = false;
      if (fromSqLower === 'a8') this.castlingRights.bQ = false;
      const toSqLower = toSq.toLowerCase();
      if (toSqLower === 'h1') this.castlingRights.wK = false;
      if (toSqLower === 'a1') this.castlingRights.wQ = false;
      if (toSqLower === 'h8') this.castlingRights.bK = false;
      if (toSqLower === 'a8') this.castlingRights.bQ = false;
      // update en-passant
      this.enPassantSquare = null;
      if (piece.toUpperCase() === 'P') {
        const fromRank = Number(fromSq[1]);
        const toRank = Number(toSq[1]);
        if (Math.abs(toRank - fromRank) === 2) {
          const epRank = (fromRank + toRank) / 2;
          this.enPassantSquare = `${fromSq[0]}${epRank}`;
        }
      }
      // halfmove clock
      if (piece.toUpperCase() === 'P' || captured) this.halfmoveClock = 0;
      else this.halfmoveClock++;
      // fullmove increment on black move
      if (this.turnToMove === 'b') this.fullmoveNumber++;
      // toggle
      this.turnToMove = this.turnToMove === 'w' ? 'b' : 'w';
      // history & repetition
      this.history.push(moveStr);
      this.recordFenRepetition();
      return { captured, promotion };
    }

    move(obj) {
      let from, to, promotion;
      if (typeof obj === 'string') {
        from = ChessEngine.squareToIndex(obj.slice(0,2));
        to = ChessEngine.squareToIndex(obj.slice(2,4));
        promotion = obj.length > 4 ? obj[4] : undefined;
      } else {
        from = ChessEngine.squareToIndex(obj.from);
        to = ChessEngine.squareToIndex(obj.to);
        promotion = obj.promotion;
      }
      if (from === -1 || to === -1) return null;
      const piece = this.board[from];
      if (!piece) return null;
      if (this.pieceColor(piece) !== this.turnToMove) return null;
      const pseudos = this.generatePseudoLegalMoves();
      const matches = pseudos.filter(m => m.from === from && m.to === to && (promotion ? m.promotion === promotion : true));
      if (matches.length === 0) return null;
      // ensure not leaving king in check
      const clone = this.clone();
      const made = clone.makeMoveInternal(from, to, promotion);
      if (!made) return null;
      const opponent = clone.turnToMove;
      const kingIndex = clone.findKing(opponent === 'w' ? 'b' : 'w');
      if (kingIndex !== -1 && clone.isSquareAttacked(kingIndex, opponent)) {
        return null;
      }
      const res = this.makeMoveInternal(from, to, promotion);
      return { from: ChessEngine.indexToSquare(from), to: ChessEngine.indexToSquare(to), promotion, san: undefined, captured: res ? res.captured : null };
    }

    moves(opts) {
      const pseudos = this.generatePseudoLegalMoves();
      const legal = pseudos.filter(m => this.isLegalMove(m.from, m.to, m.promotion));
      if (opts && opts.verbose) {
        return legal.map(m => ({
          from: ChessEngine.indexToSquare(m.from),
          to: ChessEngine.indexToSquare(m.to),
          promotion: m.promotion || undefined,
          piece: this.board[m.from] ? this.board[m.from] : undefined
        }));
      }
      return legal.map(m => `${ChessEngine.indexToSquare(m.from)}${ChessEngine.indexToSquare(m.to)}${m.promotion ? m.promotion : ''}`);
    }

    turn() { return this.turnToMove; }
    fen() { return this.getFen(); }
    historyUci() { return this.history.slice(); }
    pgn() { return this.history.join(' '); }

    // end conditions helpers
    in_check() {
      const ownColor = this.turnToMove;
      const kingIdx = this.findKing(ownColor);
      if (kingIdx === -1) return false;
      const attacked = this.isSquareAttacked(kingIdx, ownColor === 'w' ? 'b' : 'w');
      return attacked;
    }
    in_checkmate() {
      if (!this.in_check()) return false;
      const pseudos = this.generatePseudoLegalMoves();
      for (const m of pseudos) if (this.isLegalMove(m.from, m.to, m.promotion)) return false;
      return true;
    }
    in_stalemate() {
      if (this.in_check()) return false;
      const pseudos = this.generatePseudoLegalMoves();
      for (const m of pseudos) if (this.isLegalMove(m.from, m.to, m.promotion)) return false;
      return true;
    }
    insufficient_material() {
      const pieces = this.board.filter(Boolean);
      const onlyKings = pieces.every(p => p.toUpperCase() === 'K');
      if (pieces.length === 2 && onlyKings) return true;
      const majors = pieces.filter(p => ['Q','R','P'].includes(p.toUpperCase()));
      if (majors.length > 0) return false;
      if (pieces.length <= 4) return true;
      return false;
    }
    in_threefold_repetition() {
      for (const k of Object.keys(this.repetitionMap)) if (this.repetitionMap[k] >= 3) return true;
      return false;
    }
    isGameOver() {
      if (this.in_checkmate()) return true;
      if (this.in_stalemate()) return true;
      if (this.insufficient_material()) return true;
      if (this.in_threefold_repetition()) return true;
      if (this.halfmoveClock >= 100) return true;
      return false;
    }
  }

  // clientChess will be an instance of ChessEngine
  let clientChess = null;

  // store last legal moves requested from server keyed by 'from'
  const lastLegalMoves = {}; // { from: [{from,to,promotion}], ... }

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

  // compute legal moves — use local clientChess (ChessEngine) or request from server
  function computeLegalMovesFor(fromNotation, callback) {
    if (clientChess && typeof clientChess.moves === 'function') {
      try {
        const verbose = clientChess.moves({ verbose: true }) || [];
        const filtered = verbose.filter(m => m.from === fromNotation);
        lastLegalMoves[fromNotation] = filtered;
        if (callback) callback(filtered);
        return filtered;
      } catch (err) {
        console.warn('computeLegalMovesFor (client) error', err);
      }
    }

    if (lastLegalMoves[fromNotation]) {
      if (callback) callback(lastLegalMoves[fromNotation]);
      return lastLegalMoves[fromNotation];
    }

    sendMessage({
      type: 'requestLegalMoves',
      data: {
        from: fromNotation,
        postId: (gameState && gameState.postId) ? gameState.postId : undefined
      }
    });

    return [];
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
    computeLegalMovesFor(from, (moves) => {
      applyLegalMoves(moves);
    });
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
    if (clientChess && typeof clientChess.move === 'function') {
      try {
        const mv = { from, to }; if (promotion) mv.promotion = promotion;
        const result = clientChess.move(mv);
        if (!result) { if (selectedPiece) animateShake(selectedPiece); clearSelectionHighlights(); return; }
      } catch (err) {
        console.warn('clientChess.move failed', err);
      }
    }

    const destCoords = notationToCoords(to);
    if (!destCoords) { clearSelectionHighlights(); return; }
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
    if (movedPiece) movedPiece.userData.boardRow = destCoords.row, movedPiece.userData.boardCol = destCoords.col;
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

    const legal = lastLegalMoves[fromNotation] || (clientChess && clientChess.moves ? (clientChess.moves({ verbose: true }) || []).filter(m => m.from === fromNotation) : []);
    const match = legal.find(m => m.from === fromNotation && m.to === toNotation);
    if (!match) {
      if (!lastLegalMoves[fromNotation]) {
        computeLegalMovesFor(fromNotation, (moves) => { /* applied when legalMoves arrives */ });
        animateShake(selectedPiece);
        setTimeout(() => clearSelectionHighlights(), 300);
        return;
      }
      animateShake(selectedPiece);
      setTimeout(() => clearSelectionHighlights(), 200);
      return;
    }

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

    if (gameState.chess && gameState.chess.fen) {
      try {
        clientChess = new ChessEngine(gameState.chess.fen);
      } catch (e) {
        console.warn('clientChess sync failed', e);
        try { clientChess = new ChessEngine(DEFAULT_STARTING_FEN); } catch (e2) { console.error(e2); }
      }
      placePiecesFromFEN(gameState.chess.fen);
      highlightLastMove((gameState.chess && gameState.chess.lastMove) ? gameState.chess.lastMove : null);
      for (const k in lastLegalMoves) delete lastLegalMoves[k];
    } else {
      try { clientChess = new ChessEngine(DEFAULT_STARTING_FEN); } catch (e) {}
      placePiecesFromFEN(DEFAULT_STARTING_FEN);
    }

    gameActive = gameState.status === 'active';
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
    if (gameState.turn && typeof gameState.turn === 'string' && gameState.turn.length > 0) return;
    if (gameState.chess && gameState.chess.turn && gameState.chess.playersColor) {
      const sideToMove = gameState.chess.turn;
      const entry = Object.entries(gameState.chess.playersColor).find(([, c]) => c === sideToMove);
      if (entry && entry[0]) { gameState.turn = entry[0]; return; }
    }
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
        break;

      case 'playerJoined':
        if (message.data && message.data.username) {
          addPlayerLocally(message.data.username);
        } else if (message.data && message.data.gameState) {
          gameState = message.data.gameState;
          if (!Array.isArray(gameState.players)) gameState.players = gameState.players || [];
          setPlayersArray(gameState.players || []);
          updateSceneFromGameState();
        }
        break;

      case 'playerLeft':
        if (message.data && message.data.username) {
          removePlayerLocally(message.data.username);
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
        ensureTurnMappingFromChess();
        updateSceneFromGameState();
        updateStatus();
        break;

      case 'moveMade':
      case 'gameUpdate':
        gameState = (message.data && message.data.gameState) || message.data || gameState;
        if (!gameState) break;
        if (!Array.isArray(gameState.players)) gameState.players = gameState.players || [];
        setPlayersArray(gameState.players);
        ensureTurnMappingFromChess();
        updateSceneFromGameState();
        updateStatus();
        break;

      case 'legalMoves':
        if (message.data && message.data.from && Array.isArray(message.data.moves)) {
          lastLegalMoves[message.data.from] = message.data.moves;
          if (selectedPiece) {
            const curFrom = coordsToNotation(selectedPiece.userData.boardRow, selectedPiece.userData.boardCol);
            if (curFrom === message.data.from) applyLegalMoves(message.data.moves);
          }
          if (message.data.fen) {
            try { clientChess = new ChessEngine(message.data.fen); } catch (e) {}
          }
        }
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
        if (selectedPiece) {
          animateShake(selectedPiece);
          setTimeout(() => {
            clearSelectionHighlights();
            updateSceneFromGameState();
          }, 300);
        }
        if (statusElem) {
          const errorMsg = message.message || (message.data && message.data.message) || 'unknown';
          console.log(errorMsg)
          statusElem.textContent = `❌ ${errorMsg}`;
          statusElem.style.background = 'rgba(220,53,69,0.95)'; statusElem.style.color = 'white';
          setTimeout(() => { updateStatus(); }, 3000);
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
      sendMessage({ type: 'requestGameState' });
    }
  }

  if (restartBtn) restartBtn.addEventListener('click', ensureJoinedAndRequestState);

  // --- wire host messages & start ---
  window.addEventListener('message', handleMessage);
  document.addEventListener('DOMContentLoaded', () => sendMessage({ type: 'webViewReady' }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThreeJS);
  else initThreeJS();

  // request authoritative state when tab becomes visible (helps stale clients)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUsername) {
      sendMessage({ type: 'requestGameState' });
    }
  });

  // expose debug helpers
  window.sendMessage = sendMessage;
  window._getGameState = () => gameState;
  // expose engine for debugging
  window._ChessEngine = ChessEngine;

})();
