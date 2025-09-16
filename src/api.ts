import type { RedisClient } from '@devvit/public-api';

export type GameType =
  | 'tictactoe'
  | 'gomoku'
  | 'dots'
  | 'connect4'
  | 'chess'
  | 'reaction';

export type GameStatus = 'waiting' | 'active' | 'finished' | 'draw';

export type GameAction = {
  type: string;
  game?: GameType; // optional explicit game type coming from client
  data: any;
};

export type ChessStateStored = {
  fen: string;
  pgn: string;
  history: string[]; // UCI-like moves (e2e4, g1f3, etc.)
  uciHistory?: string[]; // alias
  lastMove?: { from: string; to: string; san?: string; promotion?: string };
  turn: 'white' | 'black';
  result?: string;
  reason?: string;
  gameOver: boolean;
  playersColor?: { [playerId: string]: 'white' | 'black' };
  clocks?: { white?: number; black?: number };
  halfmoveClock?: number;
  fullmoveNumber?: number;
  repetitionMap?: { [fen: string]: number };
  enPassant?: string | null;
  castlingRights?: string; // KQkq style
};

export type GameState = {
  currentGame: GameType;
  players: string[];
  maxPlayers: number;
  turn: string; // playerId who has turn (top-level)
  status: GameStatus;
  winner?: string;
  firstMoveMade: boolean;
  turnStartTime: number;
  tictactoe?: {
    faces: (string | null)[][];
    facesWon: { [playerId: string]: number };
    cubeRotation: { x: number; y: number; z: number };
  };
  gomoku?: (string | null)[];
  dots?: {
    lines: string[];
    boxes: { [key: string]: string };
    gridSize: number;
    scores: { [playerId: string]: number };
  };
  connect4?: (string | null)[][];
  chess?: ChessStateStored | undefined;
  reaction?: any;
  sessionId?: string;
};

/* --------------------------
   Minimal Chess Engine
   (kept local & self-contained)
   -------------------------- */

/* NOTE:
   This chess engine is intentionally minimal (pseudo-legal generation + legality check).
   It is the same engine style you've used but cleaned up and with stable method names.
*/

type Color = 'w' | 'b';
type Piece = string;

class ChessEngine {
  board: (Piece | null)[];
  turnToMove: Color;
  castlingRights: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  enPassantSquare: string | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  history: string[];
  repetitionMap: { [fen: string]: number };

  constructor(fen?: string) {
    this.board = Array(64).fill(null);
    this.turnToMove = 'w';
    this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassantSquare = null;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.history = [];
    this.repetitionMap = {};

    if (fen) this.loadFen(fen);
    else this.loadStartingPosition();
  }

  static files = 'abcdefgh';
  static fileCharToIdx(file: string) { return ChessEngine.files.indexOf(file); }
  static idxToFile(i: number) { return ChessEngine.files[i]; }
  static rankCharToIdx(rank: string) { return Number(rank) - 1; }

  static squareToIndex(sq: string | undefined | null): number {
    if (!sq || typeof sq !== 'string' || sq.length < 2) return -1;
    const file = ChessEngine.fileCharToIdx(sq[0]);
    const rank = ChessEngine.rankCharToIdx(sq[1]);
    if (file < 0 || rank < 0 || file > 7 || rank > 7) return -1;
    return (7 - rank) * 8 + file;
  }

  static indexToSquare(index: number): string {
    if (index < 0 || index > 63) return '';
    const file = index % 8;
    const rank = 8 - Math.floor(index / 8);
    return `${ChessEngine.idxToFile(file)}${rank}`;
  }

  clone(): ChessEngine {
    const c = new ChessEngine();
    c.board = this.board.slice();
    c.turnToMove = this.turnToMove;
    c.castlingRights = { ...this.castlingRights };
    c.enPassantSquare = this.enPassantSquare;
    c.halfmoveClock = this.halfmoveClock;
    c.fullmoveNumber = this.fullmoveNumber;
    c.history = this.history.slice();
    c.repetitionMap = { ...this.repetitionMap };
    return c;
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

  loadFen(fen: string) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 6) throw new Error('Invalid FEN');
    const [boardPart, turnPart, castlingPart, enPassantPart, halfmovePart, fullmovePart] = parts;
    const rows = boardPart.split('/');
    if (rows.length !== 8) throw new Error('Invalid FEN board');
    const b: (Piece | null)[] = [];
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

  getFen(): string {
    const rows: string[] = [];
    for (let rank = 0; rank < 8; rank++) {
      let emptyCount = 0;
      let row = '';
      for (let file = 0; file < 8; file++) {
        const idx = rank * 8 + file;
        const piece = this.board[idx];
        if (piece === null) { emptyCount++; }
        else { if (emptyCount > 0) { row += emptyCount.toString(); emptyCount = 0; } row += piece; }
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
    if (!castling) castling = '-';
    const enp = this.enPassantSquare ? this.enPassantSquare : '-';
    return `${boardPart} ${turnPart} ${castling} ${enp} ${this.halfmoveClock} ${this.fullmoveNumber}`;
  }

  recordFenRepetition() {
    const base = this.getFen().split(' ');
    const key = `${base[0]} ${base[1]} ${base[2]} ${base[3]}`;
    this.repetitionMap[key] = (this.repetitionMap[key] || 0) + 1;
  }

  pieceColor(piece: Piece | null): Color | null {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? 'w' : 'b';
  }

  // --- pseudo-legal generation & legality checks (kept similar to your original) ---

  generatePseudoLegalMoves(): { from: number; to: number; promotion?: string }[] {
    const moves: { from: number; to: number; promotion?: string }[] = [];
    const side = this.turnToMove;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (!p) continue;
      const color = this.pieceColor(p);
      if (color !== side) continue;
      const pt = p.toUpperCase();
      const fromSq = ChessEngine.indexToSquare(sq);

      if (pt === 'P') {
        // pawn moves
        const forwardRankNum = Number(fromSq[1]) + (color === 'w' ? 1 : -1);
        const oneForward = (forwardRankNum >= 1 && forwardRankNum <= 8) ? ChessEngine.squareToIndex(`${fromSq[0]}${forwardRankNum}`) : -1;
        if (oneForward !== -1 && this.board[oneForward] === null) {
          if ((color === 'w' && forwardRankNum === 8) || (color === 'b' && forwardRankNum === 1)) {
            ['q','r','b','n'].forEach(pr => moves.push({ from: sq, to: oneForward, promotion: pr }));
          } else {
            moves.push({ from: sq, to: oneForward });
            const startRankNum = color === 'w' ? 2 : 7;
            const fromRankNum = Number(fromSq[1]);
            if (fromRankNum === startRankNum) {
              const twoForwardRank = color === 'w' ? 4 : 5;
              const twoForwardSq = ChessEngine.squareToIndex(`${fromSq[0]}${twoForwardRank}`);
              if (twoForwardSq !== -1 && this.board[twoForwardSq] === null) moves.push({ from: sq, to: twoForwardSq });
            }
          }
        }
        const captureOffsets = [-1, 1];
        for (const off of captureOffsets) {
          const fileIdx = fromSq.charCodeAt(0) + off;
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
            if (enpIdx === targetSq) moves.push({ from: sq, to: targetSq });
          }
        }
      } else if (pt === 'N') {
        const jumps = [ -17, -15, -10, -6, 6, 10, 15, 17 ];
        for (const j of jumps) {
          const to = sq + j;
          if (to < 0 || to >= 64) continue;
          const fx = sq % 8, tx = to % 8;
          const fd = Math.abs(fx - tx);
          if (![1,2].includes(fd)) continue;
          const target = this.board[to];
          if (!target || this.pieceColor(target) !== this.pieceColor(this.board[sq])) moves.push({ from: sq, to });
        }
      } else if (pt === 'B' || pt === 'R' || pt === 'Q') {
        const dirs: number[] = [];
        if (pt === 'B' || pt === 'Q') dirs.push(-9, -7, 7, 9);
        if (pt === 'R' || pt === 'Q') dirs.push(-8, -1, 1, 8);
        for (const d of dirs) {
          let to = sq + d;
          while (to >= 0 && to < 64) {
            const fromFile = sq % 8;
            const toFile = to % 8;
            const diffFile = Math.abs(toFile - fromFile);
            if (diffFile > 2 && (d === -9 || d === -7 || d === 7 || d === 9 || d === -1 || d === 1)) break;
            const target = this.board[to];
            if (!target) { moves.push({ from: sq, to }); to += d; continue; }
            else { if (this.pieceColor(target) !== this.pieceColor(this.board[sq])) moves.push({ from: sq, to }); break; }
          }
        }
      } else if (pt === 'K') {
        const deltas = [-9,-8,-7,-1,1,7,8,9];
        for (const d of deltas) {
          const to = sq + d;
          if (to < 0 || to >= 64) continue;
          const fx = sq % 8, tx = to % 8;
          if (Math.abs(fx - tx) > 1) continue;
          const target = this.board[to];
          if (!target || this.pieceColor(target) !== this.pieceColor(this.board[sq])) moves.push({ from: sq, to });
        }
        // castling (simple pseudo)
        if (this.turnToMove === 'w') {
          if (this.castlingRights.wK) {
            const e1 = ChessEngine.squareToIndex('e1'), f1 = ChessEngine.squareToIndex('f1'), g1 = ChessEngine.squareToIndex('g1'), h1 = ChessEngine.squareToIndex('h1');
            if (this.board[e1] && this.board[h1] && !this.board[f1] && !this.board[g1]) moves.push({ from: e1, to: g1 });
          }
          if (this.castlingRights.wQ) {
            const e1 = ChessEngine.squareToIndex('e1'), d1 = ChessEngine.squareToIndex('d1'), c1 = ChessEngine.squareToIndex('c1'), a1 = ChessEngine.squareToIndex('a1');
            if (this.board[e1] && this.board[a1] && !this.board[d1] && !this.board[c1] && !this.board[ChessEngine.squareToIndex('b1')]) moves.push({ from: e1, to: c1 });
          }
        } else {
          if (this.castlingRights.bK) {
            const e8 = ChessEngine.squareToIndex('e8'), f8 = ChessEngine.squareToIndex('f8'), g8 = ChessEngine.squareToIndex('g8'), h8 = ChessEngine.squareToIndex('h8');
            if (this.board[e8] && this.board[h8] && !this.board[f8] && !this.board[g8]) moves.push({ from: e8, to: g8 });
          }
          if (this.castlingRights.bQ) {
            const e8 = ChessEngine.squareToIndex('e8'), d8 = ChessEngine.squareToIndex('d8'), c8 = ChessEngine.squareToIndex('c8'), a8 = ChessEngine.squareToIndex('a8');
            if (this.board[e8] && this.board[a8] && !this.board[d8] && !this.board[c8] && !this.board[ChessEngine.squareToIndex('b8')]) moves.push({ from: e8, to: c8 });
          }
        }
      }
    }
    return moves;
  }

  findKing(color: Color): number {
    const kingChar = color === 'w' ? 'K' : 'k';
    for (let i=0;i<64;i++) if (this.board[i] === kingChar) return i;
    return -1;
  }

  isSquareAttacked(squareIdx: number, byColor: Color): boolean {
    // simplified: checks pawn, knight, sliding, king attacks (similar to initial version)
    if (squareIdx < 0 || squareIdx > 63) return false;
    // pawn attacks
    const sqStr = ChessEngine.indexToSquare(squareIdx);
    const file = sqStr[0].charCodeAt(0);
    const rank = Number(sqStr[1]);
    const attackRank = byColor === 'w' ? rank - 1 : rank + 1;
    if (attackRank >= 1 && attackRank <= 8) {
      for (const df of [-1, 1]) {
        const f = String.fromCharCode(file + df);
        if (f < 'a' || f > 'h') continue;
        const idx = ChessEngine.squareToIndex(`${f}${attackRank}`);
        if (idx !== -1) {
          const p = this.board[idx];
          if (p && p.toUpperCase() === 'P' && this.pieceColor(p) === byColor) return true;
        }
      }
    }

    // knight
    const knightDeltas = [-17,-15,-10,-6,6,10,15,17];
    for (const d of knightDeltas) {
      const from = squareIdx + d;
      if (from < 0 || from > 63) continue;
      const fx = from % 8, tx = squareIdx % 8;
      if (Math.abs(fx - tx) > 2) continue;
      const p = this.board[from];
      if (p && p.toUpperCase() === 'N' && this.pieceColor(p) === byColor) return true;
    }

    // sliding
    const dirs: {d:number, attackers:string[]}[] = [
      { d:-8, attackers:['R','Q'] }, { d:8, attackers:['R','Q'] },
      { d:-1, attackers:['R','Q'] }, { d:1, attackers:['R','Q'] },
      { d:-9, attackers:['B','Q'] }, { d:-7, attackers:['B','Q'] },
      { d:7, attackers:['B','Q'] }, { d:9, attackers:['B','Q'] }
    ];
    for (const {d, attackers} of dirs) {
      let from = squareIdx + d;
      while (from >= 0 && from < 64) {
        const p = this.board[from];
        if (p) {
          if (this.pieceColor(p) === byColor && attackers.includes(p.toUpperCase())) return true;
          break;
        }
        from += d;
      }
    }

    // king adjacency
    const kingDeltas = [-9,-8,-7,-1,1,7,8,9];
    for (const d of kingDeltas) {
      const from = squareIdx + d;
      if (from < 0 || from > 63) continue;
      const fx = from % 8, tx = squareIdx % 8;
      if (Math.abs(fx - tx) > 1) continue;
      const p = this.board[from];
      if (p && p.toUpperCase() === 'K' && this.pieceColor(p) === byColor) return true;
    }

    return false;
  }

  isLegalMove(from: number, to: number, promotion?: string): boolean {
    if (from < 0 || to < 0 || from > 63 || to > 63) return false;
    const piece = this.board[from];
    if (!piece) return false;
    if (this.pieceColor(piece) !== this.turnToMove) return false;
    const clone = this.clone();
    const made = clone.makeMoveInternal(from, to, promotion);
    if (!made) return false;
    const movingColor: Color = this.turnToMove;
    const kingIdx = clone.findKing(movingColor);
    if (kingIdx === -1) return false;
    const opponent: Color = movingColor === 'w' ? 'b' : 'w';
    return !clone.isSquareAttacked(kingIdx, opponent);
  }

  makeMoveInternal(from: number, to: number, promotion?: string, _skipValidation = false): { captured?: Piece | null; promotion?: string } | null {
    const piece = this.board[from];
    if (!piece) return null;
    const color = this.pieceColor(piece)!;
    let captured: Piece | null = null;
    const fromSq = ChessEngine.indexToSquare(from);
    const toSq = ChessEngine.indexToSquare(to);
    if (!fromSq || !toSq) return null;

    // en-passant
    if (piece.toUpperCase() === 'P' && this.enPassantSquare && this.enPassantSquare === toSq) {
      const epIdx = ChessEngine.squareToIndex(this.enPassantSquare);
      if (epIdx !== -1) {
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
          this.board[f1] = this.board[h1]; this.board[h1] = null;
        } else if (fromSq === 'e1' && toSq === 'c1') {
          const a1 = ChessEngine.squareToIndex('a1'), d1 = ChessEngine.squareToIndex('d1');
          this.board[d1] = this.board[a1]; this.board[a1] = null;
        }
        this.castlingRights.wK = false; this.castlingRights.wQ = false;
      } else {
        if (fromSq === 'e8' && toSq === 'g8') {
          const h8 = ChessEngine.squareToIndex('h8'), f8 = ChessEngine.squareToIndex('f8');
          this.board[f8] = this.board[h8]; this.board[h8] = null;
        } else if (fromSq === 'e8' && toSq === 'c8') {
          const a8 = ChessEngine.squareToIndex('a8'), d8 = ChessEngine.squareToIndex('d8');
          this.board[d8] = this.board[a8]; this.board[a8] = null;
        }
        this.castlingRights.bK = false; this.castlingRights.bQ = false;
      }
    }

    const fromLower = fromSq.toLowerCase();
    const toLower = toSq.toLowerCase();
    if (fromLower === 'h1' || toLower === 'h1') this.castlingRights.wK = false;
    if (fromLower === 'a1' || toLower === 'a1') this.castlingRights.wQ = false;
    if (fromLower === 'h8' || toLower === 'h8') this.castlingRights.bK = false;
    if (fromLower === 'a8' || toLower === 'a8') this.castlingRights.bQ = false;

    this.enPassantSquare = null;
    if (piece.toUpperCase() === 'P') {
      const fromRank = Number(fromSq[1]);
      const toRank = Number(toSq[1]);
      if (Math.abs(toRank - fromRank) === 2) {
        const epRank = (fromRank + toRank) / 2;
        this.enPassantSquare = `${fromSq[0]}${epRank}`;
      }
    }

    if (piece.toUpperCase() === 'P' || captured) this.halfmoveClock = 0;
    else this.halfmoveClock++;
    if (this.turnToMove === 'b') this.fullmoveNumber++;
    this.turnToMove = this.turnToMove === 'w' ? 'b' : 'w';
    const uci = `${fromSq}${toSq}${promotion ? promotion : ''}`;
    this.history.push(uci);
    this.recordFenRepetition();
    return { captured, promotion };
  }

  move(obj: { from: string; to: string; promotion?: string } | string): any | null {
    let fromIdx: number, toIdx: number, promotion: string | undefined;
    if (typeof obj === 'string') {
      fromIdx = ChessEngine.squareToIndex(obj.slice(0,2));
      toIdx = ChessEngine.squareToIndex(obj.slice(2,4));
      promotion = obj.length > 4 ? obj[4] : undefined;
    } else {
      fromIdx = ChessEngine.squareToIndex(obj.from);
      toIdx = ChessEngine.squareToIndex(obj.to);
      promotion = obj.promotion;
    }
    if (fromIdx === -1 || toIdx === -1) return null;
    const piece = this.board[fromIdx];
    if (!piece) return null;
    if (this.pieceColor(piece) !== this.turnToMove) return null;
    const pseudos = this.generatePseudoLegalMoves();
    const found = pseudos.some(m => m.from === fromIdx && m.to === toIdx && (promotion ? m.promotion === promotion : true));
    if (!found) return null;
    if (!this.isLegalMove(fromIdx, toIdx, promotion)) return null;
    const res = this.makeMoveInternal(fromIdx, toIdx, promotion);
    if (!res) return null;
    return { from: ChessEngine.indexToSquare(fromIdx), to: ChessEngine.indexToSquare(toIdx), promotion: res.promotion, san: undefined, captured: res.captured ?? null };
  }

  moves(opts?: { verbose?: boolean }): any[] | string[] {
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

  turn(): 'w' | 'b' { return this.turnToMove; }
  fen(): string { return this.getFen(); }
  historyUci(): string[] { return this.history.slice(); }
  pgn(): string { return this.history.join(' '); }

  in_check(): boolean {
    const ownColor: Color = this.turnToMove;
    const kingIdx = this.findKing(ownColor);
    if (kingIdx === -1) return false;
    const attacked = this.isSquareAttacked(kingIdx, ownColor === 'w' ? 'b' : 'w');
    return attacked;
  }

  in_checkmate(): boolean {
    if (!this.in_check()) return false;
    const pseudos = this.generatePseudoLegalMoves();
    for (const m of pseudos) if (this.isLegalMove(m.from, m.to, m.promotion)) return false;
    return true;
  }

  in_stalemate(): boolean {
    if (this.in_check()) return false;
    const pseudos = this.generatePseudoLegalMoves();
    for (const m of pseudos) if (this.isLegalMove(m.from, m.to, m.promotion)) return false;
    return true;
  }

  insufficient_material(): boolean {
    const pieces = this.board.filter(Boolean) as Piece[];
    if (pieces.length === 2 && pieces.every(p => p.toUpperCase() === 'K')) return true;
    const majors = pieces.filter(p => ['Q','R','P'].includes(p.toUpperCase()));
    if (majors.length > 0) return false;
    if (pieces.length <= 4) return true;
    return false;
  }

  in_threefold_repetition(): boolean {
    for (const k of Object.keys(this.repetitionMap)) if (this.repetitionMap[k] >= 3) return true;
    return false;
  }

  isGameOver(): boolean {
    if (this.in_checkmate()) return true;
    if (this.in_stalemate()) return true;
    if (this.insufficient_material()) return true;
    if (this.in_threefold_repetition()) return true;
    if (this.halfmoveClock >= 100) return true;
    return false;
  }
}

/* -------------------------
   GameAPI Class (uses ChessEngine)
   ------------------------- */

export class GameAPI {
  private static redisKey(sessionId: string) {
    return `gameState:${sessionId}`;
  }

  static async getGameState(redis: RedisClient, sessionId: string): Promise<GameState> {
    try {
      const raw = await redis.get(GameAPI.redisKey(sessionId));
      if (!raw) return this.createInitialState();
      const parsed = JSON.parse(raw) as GameState;
      return parsed;
    } catch (err) {
      console.error('GameAPI.getGameState error:', err);
      return this.createInitialState();
    }
  }

  static async saveGameState(redis: RedisClient, sessionId: string, state: GameState): Promise<void> {
    try {
      await redis.set(GameAPI.redisKey(sessionId), JSON.stringify(state));
    } catch (err) {
      console.error('GameAPI.saveGameState error:', err);
      throw new Error(`Failed to save game state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  static async initializeGame(redis: RedisClient, sessionId: string, gameType: GameType, maxPlayers: number) {
    const initial = this.createGameSpecificState(gameType, maxPlayers);
    initial.sessionId = sessionId;
    await this.saveGameState(redis, sessionId, initial);
  }

  private static createInitialState(): GameState {
    return {
      currentGame: 'tictactoe',
      players: [],
      maxPlayers: 2,
      turn: '',
      status: 'waiting',
      winner: undefined,
      firstMoveMade: false,
      turnStartTime: Date.now(),
      tictactoe: {
        faces: Array(6).fill(null).map(() => Array(9).fill(null)),
        facesWon: {},
        cubeRotation: { x: 0, y: 0, z: 0 }
      },
      gomoku: Array(225).fill(null),
      dots: { lines: [], boxes: {}, gridSize: 5, scores: {} },
      connect4: Array.from({ length: 7 }, () => Array(6).fill(null)),
      chess: undefined,
      reaction: undefined,
    } as GameState;
  }

  private static createGameSpecificState(gameType: GameType, maxPlayers: number): GameState {
    const base = {
      currentGame: gameType,
      players: [] as string[],
      maxPlayers,
      turn: '',
      status: 'waiting' as GameStatus,
      winner: undefined as string | undefined,
      firstMoveMade: false,
      turnStartTime: Date.now(),
    };

    const emptyTic = {
      faces: Array(6).fill(null).map(() => Array(9).fill(null)),
      facesWon: {},
      cubeRotation: { x: 0, y: 0, z: 0 }
    };

    switch (gameType) {
      case 'tictactoe':
        return {
          ...base,
          tictactoe: emptyTic,
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5, scores: {} },
          connect4: [],
          chess: undefined,
          reaction: undefined,
        } as GameState;

      case 'gomoku':
        return {
          ...base,
          tictactoe: emptyTic,
          gomoku: Array(225).fill(null),
          dots: { lines: [], boxes: {}, gridSize: 5, scores: {} },
          connect4: [],
          chess: undefined,
          reaction: undefined,
        } as GameState;

      case 'dots':
        return {
          ...base,
          tictactoe: emptyTic,
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5, scores: {} },
          connect4: [],
          chess: undefined,
          reaction: undefined,
        } as GameState;

      case 'connect4':
        return {
          ...base,
          tictactoe: emptyTic,
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5, scores: {} },
          connect4: Array.from({ length: 7 }, () => Array(6).fill(null)),
          chess: undefined,
          reaction: undefined,
        } as GameState;

      case 'chess': {
        const chessInit: ChessStateStored = {
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          pgn: '',
          history: [],
          uciHistory: [],
          lastMove: undefined,
          turn: 'white',
          result: undefined,
          reason: undefined,
          gameOver: false,
          playersColor: {},
          clocks: {},
          halfmoveClock: 0,
          fullmoveNumber: 1,
          repetitionMap: {}
        };
        return {
          ...base,
          tictactoe: emptyTic,
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5, scores: {} },
          connect4: [],
          chess: chessInit,
          reaction: undefined,
        } as GameState;
      }

      case 'reaction':
        return {
          ...base,
          tictactoe: emptyTic,
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5, scores: {} },
          connect4: [],
          chess: undefined,
          reaction: { scores: [] },
        } as GameState;

      default:
        return this.createInitialState();
    }
  }

  private static isChessGameOver(chessInstance: any): boolean {
    try {
      if (!chessInstance) return false;
      if (typeof chessInstance.isGameOver === 'function') return chessInstance.isGameOver();
      if (typeof chessInstance.game_over === 'function') return chessInstance.game_over();
      if (typeof chessInstance.gameOver === 'function') return chessInstance.gameOver();
      if (typeof chessInstance.in_checkmate === 'function' && chessInstance.in_checkmate()) return true;
      if (typeof chessInstance.in_stalemate === 'function' && chessInstance.in_stalemate()) return true;
      if (typeof chessInstance.insufficient_material === 'function' && chessInstance.insufficient_material()) return true;
      if (typeof chessInstance.in_threefold_repetition === 'function' && chessInstance.in_threefold_repetition()) return true;
      return false;
    } catch (e) {
      console.warn('isChessGameOver: error while probing chess instance', e);
      return false;
    }
  }

  private static safeInCheckmate(chessInstance: any): boolean {
    return typeof chessInstance.in_checkmate === 'function' ? chessInstance.in_checkmate() : false;
  }
  private static safeInStalemate(chessInstance: any): boolean {
    return typeof chessInstance.in_stalemate === 'function' ? chessInstance.in_stalemate() : false;
  }
  private static safeInsufficientMaterial(chessInstance: any): boolean {
    return typeof chessInstance.insufficient_material === 'function' ? chessInstance.insufficient_material() : false;
  }
  private static safeInThreefoldRepetition(chessInstance: any): boolean {
    return typeof chessInstance.in_threefold_repetition === 'function' ? chessInstance.in_threefold_repetition() : false;
  }

  /**
   * Central move processor: routes to the right game handler.
   * - Validates that action.game (if provided) matches stored state.currentGame.
   * - Provides clearer error messages so you can see why a move fails.
   */
  static async processMove(redis: RedisClient, sessionId: string, action: GameAction): Promise<GameState> {
    const state = await this.getGameState(redis, sessionId);

    if (state.status === 'finished') throw new Error('Game has already ended');

    const playerId = action.data?.playerId;
    if (!playerId) throw new Error('Missing playerId in action.data');

    if (!state.players.includes(playerId) && action.type !== 'join') {
      throw new Error('Player not registered in this game');
    }

    if (state.currentGame !== 'reaction' && state.turn && state.turn !== playerId) {
      throw new Error('Not your turn');
    }

    // Validate game type: if action includes explicit game, verify it matches stored game
    const actionGame = (action as any).game ?? action.data?.gameType;
    if (actionGame && actionGame !== state.currentGame) {
      // Clearer message — very likely sessionId mismatch (client should use the session tied to selected game)
      throw new Error(`Action game "${actionGame}" does not match stored session game "${state.currentGame}". Make sure you use the sessionId for the correct game type.`);
    }

    const newState = JSON.parse(JSON.stringify(state)) as GameState;

    if (!newState.firstMoveMade) { newState.firstMoveMade = true; newState.turnStartTime = Date.now(); }

    switch (newState.currentGame) {
      case 'tictactoe':
        // validate position shape for tic-tac-toe
        if (!action.data || !action.data.position) throw new Error('Missing move position for tictactoe');
        this.processTicTacToeMove(newState, action);
        break;
      case 'gomoku':
        if (!action.data || !action.data.position) throw new Error('Missing move position for gomoku');
        this.processGomokuMove(newState, action);
        break;
      case 'dots':
        if (!action.data || !action.data.position) throw new Error('Missing move position for dots');
        this.processDotsMove(newState, action);
        break;
      case 'connect4':
        if (typeof action.data?.position === 'undefined') throw new Error('Missing move position for connect4');
        this.processConnect4Move(newState, action);
        break;
      case 'chess':
        if (!action.data || !action.data.position) throw new Error('Missing move position for chess');
        await this.processChessMove(newState, action);
        break;
      case 'reaction':
        // reaction moves handled elsewhere
        break;
      default:
        throw new Error(`Unsupported game type: ${newState.currentGame}`);
    }

    await this.saveGameState(redis, sessionId, newState);
    return newState;
  }

  // --- Reaction update omitted for brevity (kept as before) ---
  static async updateReactionScore(
    redis: RedisClient,
    sessionId: string,
    playerId: string,
    score: number,
    avgTime: number,
    medianTime: number
  ): Promise<GameState> {
    const state = await this.getGameState(redis, sessionId);
    const newState = JSON.parse(JSON.stringify(state)) as GameState;
    if (!newState.reaction) newState.reaction = { scores: [] };
    const idx = newState.reaction.scores.findIndex((s: any) => s.player === playerId);
    if (idx >= 0) newState.reaction.scores[idx] = { player: playerId, score, avgTime, medianTime };
    else newState.reaction.scores.push({ player: playerId, score, avgTime, medianTime });
    newState.reaction.scores.sort((a: any, b: any) => b.score - a.score);
    await this.saveGameState(redis, sessionId, newState);
    return newState;
  }

  // --- game implementations (safe checks added) ---

  private static processTicTacToeMove(state: GameState, action: GameAction): void {
    if (!action.data?.position) throw new Error('TicTacToe move missing position');
    const moveData = action.data.position as { face: number; cell: number };
    const { face, cell } = moveData;
    if (!state.tictactoe) throw new Error('TicTacToe not initialized');
    if (typeof face !== 'number' || typeof cell !== 'number') throw new Error('Invalid TicTacToe coordinates');
    if (face < 0 || face >= 6 || cell < 0 || cell >= 9) throw new Error('Invalid face or cell position');
    if (state.tictactoe.faces[face][cell]) throw new Error('Cell already occupied');
    state.tictactoe.faces[face][cell] = action.data.playerId;
    const faceWon = this.checkTicTacToeFaceWin(state.tictactoe.faces[face], action.data.playerId);
    if (faceWon) {
      if (!state.tictactoe.facesWon[action.data.playerId]) state.tictactoe.facesWon[action.data.playerId] = 0;
      state.tictactoe.facesWon[action.data.playerId]++;
      if (state.tictactoe.facesWon[action.data.playerId] >= 4) {
        state.winner = action.data.playerId; state.status = 'finished'; return;
      }
    }
    const allFilled = state.tictactoe.faces.every(f => f.every(c => c !== null));
    if (allFilled) {
      const counts = Object.values(state.tictactoe.facesWon);
      const maxFaces = counts.length ? Math.max(...counts) : 0;
      const winners = Object.entries(state.tictactoe.facesWon).filter(([_, c]) => c === maxFaces).map(([p]) => p);
      if (winners.length === 1) { state.winner = winners[0]; state.status = 'finished'; }
      else state.status = 'draw';
      return;
    }
    state.turn = this.getNextPlayer(state, action.data.playerId);
    state.turnStartTime = Date.now();
  }

  private static checkTicTacToeFaceWin(face: (string | null)[], player: string): boolean {
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return wins.some(pattern => pattern.every(i => face[i] === player));
  }

  private static processConnect4Move(state: GameState, action: GameAction): void {
    const column = action.data.position as number;
    if (!state.connect4) throw new Error('Connect4 not initialized');
    if (typeof column !== 'number' || column < 0 || column >= 7) throw new Error('Invalid column');
    const colArray = state.connect4[column];
    let row = -1;
    for (let r = 5; r >= 0; r--) if (colArray[r] === null) { row = r; break; }
    if (row === -1) throw new Error('Column full');
    state.connect4[column][row] = action.data.playerId;
    if (this.checkConnect4Win(state.connect4, column, row, action.data.playerId)) {
      state.winner = action.data.playerId; state.status = 'finished'; return;
    }
    if (state.connect4.every(c => c.every(cell => cell !== null))) { state.status = 'draw'; return; }
    state.turn = this.getNextPlayer(state, action.data.playerId);
    state.turnStartTime = Date.now();
  }

  private static checkConnect4Win(board: (string | null)[][], col: number, row: number, player: string): boolean {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dx,dy] of dirs) {
      let count = 1;
      for (let i=1;i<4;i++){ const x=col+dx*i, y=row+dy*i; if (x<0||x>=7||y<0||y>=6) break; if (board[x][y]===player) count++; else break; }
      for (let i=1;i<4;i++){ const x=col-dx*i, y=row-dy*i; if (x<0||x>=7||y<0||y>=6) break; if (board[x][y]===player) count++; else break; }
      if (count>=4) return true;
    }
    return false;
  }

  private static processDotsMove(state: GameState, action: GameAction): void {
    const position = action.data.position;
    let lineKey: string;
    if (typeof position === 'string') lineKey = position;
    else if (Array.isArray(position) && position.length === 4) lineKey = position.join(',');
    else if (typeof position === 'object' && position.from && position.to) lineKey = `${position.from.x},${position.from.y},${position.to.x},${position.to.y}`;
    else throw new Error('Invalid dots move position format');
    if (!state.dots) throw new Error('Dots not initialized');
    if (state.dots.lines.includes(lineKey)) throw new Error('Line already exists');
    const coords = lineKey.split(',').map(Number);
    if (coords.length !== 4) throw new Error('Invalid line coordinates');
    const [x1,y1,x2,y2] = coords;
    const gridSize = state.dots.gridSize;
    if (x1 < 0 || x1 >= gridSize || y1 < 0 || y1 >= gridSize || x2 < 0 || x2 >= gridSize || y2 < 0 || y2 >= gridSize) throw new Error('Line coordinates out of bounds');
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) throw new Error('Line must be between adjacent dots');
    state.dots.lines.push(lineKey);
    let boxesCompleted = 0;
    if (!state.dots.scores[action.data.playerId]) state.dots.scores[action.data.playerId] = 0;
    for (let x = 0; x < gridSize - 1; x++) {
      for (let y = 0; y < gridSize - 1; y++) {
        const top = `${x},${y},${x+1},${y}`;
        const bottom = `${x},${y+1},${x+1},${y+1}`;
        const left = `${x},${y},${x},${y+1}`;
        const right = `${x+1},${y},${x+1},${y+1}`;
        if ([top,bottom,left,right].every(l => state.dots!.lines.includes(l))) {
          const boxKey = `${x},${y}`;
          if (!state.dots!.boxes[boxKey]) {
            state.dots!.boxes[boxKey] = action.data.playerId;
            state.dots!.scores[action.data.playerId]++;
            boxesCompleted++;
          }
        }
      }
    }
    state.turn = boxesCompleted > 0 ? action.data.playerId : this.getNextPlayer(state, action.data.playerId);
    const totalBoxes = Math.pow(gridSize - 1, 2);
    if (Object.keys(state.dots!.boxes).length === totalBoxes) {
      const maxScore = Math.max(...Object.values(state.dots!.scores));
      const winners = Object.entries(state.dots!.scores).filter(([_, s]) => s === maxScore).map(([p]) => p);
      if (winners.length === 1) { state.winner = winners[0]; state.status = 'finished'; } else { state.status = 'draw'; }
    }
    state.turnStartTime = Date.now();
    state.firstMoveMade = true;
  }

  private static processGomokuMove(state: GameState, action: GameAction): void {
    const pos = action.data.position as [number, number];
    if (!pos || pos.length !== 2) throw new Error('Missing gomoku position');
    const [x,y] = pos;
    if (!state.gomoku) throw new Error('Gomoku not initialized');
    if (x<0||x>=15||y<0||y>=15) throw new Error('Invalid position');
    const index = y * 15 + x;
    if (state.gomoku[index]) throw new Error('Invalid position');
    state.gomoku[index] = action.data.playerId;
    if (this.checkGomokuWin(state.gomoku, x, y, action.data.playerId)) { state.winner = action.data.playerId; state.status = 'finished'; return; }
    if (state.gomoku.every(cell => cell !== null)) { state.status = 'draw'; return; }
    state.turn = this.getNextPlayer(state, action.data.playerId);
    state.turnStartTime = Date.now();
  }

  private static checkGomokuWin(board: (string | null)[], x: number, y: number, player: string): boolean {
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    for (const [dx,dy] of dirs) {
      let count = 1;
      for (let i=1;i<5;i++){ const nx=x+dx*i, ny=y+dy*i; if(nx<0||nx>=15||ny<0||ny>=15) break; if(board[ny*15+nx]===player) count++; else break; }
      for (let i=1;i<5;i++){ const nx=x-dx*i, ny=y-dy*i; if(nx<0||nx>=15||ny<0||ny>=15) break; if(board[ny*15+nx]===player) count++; else break; }
      if (count>=5) return true;
    }
    return false;
  }

  // --- CHESS integration (server-authoritative) ---

  private static async processChessMove(state: GameState, action: GameAction): Promise<void> {
    if (!state.chess) throw new Error('Chess game not initialized');
    const chessStored = state.chess as ChessStateStored;

    // create ChessEngine from the stored FEN
    const engine = new ChessEngine(chessStored.fen);

    const moveData = action.data.position as { from: string; to: string; promotion?: string };
    if (!moveData || !moveData.from || !moveData.to) throw new Error('Invalid move payload');

    // Validate: ensure the moving player matches top-level state.turn (server-enforced)
    const movingPlayer = action.data.playerId;
    if (!movingPlayer) throw new Error('Missing playerId');
    // optional: ensure player is mapped to the correct color
    if (chessStored.playersColor && chessStored.playersColor[movingPlayer]) {
      const colorToMove = engine.turn() === 'w' ? 'white' : 'black';
      const playerColor = chessStored.playersColor[movingPlayer];
      if (playerColor !== colorToMove) {
        throw new Error(`It's ${colorToMove}'s turn, but player ${movingPlayer} is ${playerColor}`);
      }
    }

    // Attempt to make the move; engine.move returns null on illegal/failure
    const result = engine.move({ from: moveData.from, to: moveData.to, promotion: moveData.promotion });
    if (!result) throw new Error('Illegal or failed chess move');

    // Persist engine state back to stored state
    chessStored.fen = engine.fen();
    chessStored.history = engine.historyUci();
    chessStored.uciHistory = chessStored.uciHistory || [];
    chessStored.uciHistory.push(`${moveData.from}${moveData.to}${moveData.promotion ? moveData.promotion : ''}`);
    chessStored.lastMove = { from: moveData.from, to: moveData.to, san: result.san, promotion: result.promotion };
    chessStored.pgn = engine.pgn();
    chessStored.turn = engine.turn() === 'w' ? 'white' : 'black';
    chessStored.halfmoveClock = engine.halfmoveClock;
    chessStored.fullmoveNumber = engine.fullmoveNumber;
    chessStored.enPassant = engine.enPassantSquare;
    chessStored.castlingRights = `${engine.castlingRights.wK ? 'K':''}${engine.castlingRights.wQ?'Q':''}${engine.castlingRights.bK?'k':''}${engine.castlingRights.bQ?'q':''}` || '-';
    chessStored.repetitionMap = engine.repetitionMap;

    // Map top-level turn to player id - this must be correct for multiplayer
    if (chessStored.playersColor) {
      const currentColor = chessStored.turn;
      const playerForColor = Object.entries(chessStored.playersColor).find(([, c]) => c === currentColor);
      if (playerForColor) state.turn = playerForColor[0];
      else state.turn = currentColor === 'white' ? state.players[0] : state.players[1];
    } else {
      state.turn = chessStored.turn === 'white' ? state.players[0] : state.players[1];
    }

    chessStored.gameOver = GameAPI.isChessGameOver(engine);

    if (GameAPI.safeInCheckmate(engine)) {
      const winnerColor = engine.turn() === 'w' ? 'b' : 'w';
      chessStored.result = winnerColor === 'w' ? '1-0' : '0-1';
      state.winner = GameAPI.findPlayerByColor(chessStored, winnerColor === 'w' ? 'white' : 'black') || state.winner;
      chessStored.reason = 'checkmate';
      state.status = 'finished';
    } else if (GameAPI.safeInStalemate(engine)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'stalemate'; state.status = 'draw';
    } else if (GameAPI.safeInsufficientMaterial(engine)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'insufficient material'; state.status = 'draw';
    } else if (GameAPI.safeInThreefoldRepetition(engine)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'threefold repetition'; state.status = 'draw';
    } else {
      if (engine.halfmoveClock >= 100) {
        chessStored.result = '1/2-1/2';
        chessStored.reason = '50-move rule';
        state.status = 'draw';
      } else {
        state.status = 'active';
      }
    }

    if (action.data.clock) {
      chessStored.clocks = Object.assign(chessStored.clocks || {}, action.data.clock);
    }

    state.chess = chessStored;
    state.turnStartTime = Date.now();
    state.firstMoveMade = true;
  }

  // undo, getLegalChessMoves, joinGame, changeGame, checkTurnTimer... (kept same semantics
  // as your original implementation but with defensive checks)

  static async undoChessMove(redis: RedisClient, sessionId: string): Promise<GameState> {
    const state = await this.getGameState(redis, sessionId);
    if (!state.chess) throw new Error('Chess not initialized');
    const chessState = JSON.parse(JSON.stringify(state.chess)) as ChessStateStored;
    if (!chessState.history || chessState.history.length === 0) throw new Error('No move to undo');
    const engine = new ChessEngine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (let i = 0; i < chessState.history.length - 1; i++) engine.move(chessState.history[i]);
    chessState.fen = engine.fen();
    chessState.history = engine.historyUci();
    chessState.pgn = engine.pgn();
    chessState.uciHistory = chessState.history.slice();
    chessState.gameOver = GameAPI.isChessGameOver(engine);
    chessState.turn = engine.turn() === 'w' ? 'white' : 'black';
    state.chess = chessState;
    state.turn = this.findPlayerByColor(chessState, chessState.turn) || state.turn;
    await this.saveGameState(redis, sessionId, state);
    return state;
  }

  static async getLegalChessMoves(redis: RedisClient, sessionId: string, from?: string): Promise<{ from?: string; moves: any[]; fen?: string }> {
    const state = await this.getGameState(redis, sessionId);
    if (!state.chess) throw new Error('Chess game not initialized');
    const chessState = state.chess as ChessStateStored;
    const engine = new ChessEngine(chessState.fen);
    const verboseMoves = engine.moves({ verbose: true }) as any[];
    if (from) {
      const filtered = verboseMoves.filter(m => m.from === from);
      return { from, moves: filtered, fen: engine.fen() };
    }
    return { moves: verboseMoves, fen: engine.fen() };
  }

  static async joinGame(redis: RedisClient, sessionId: string, playerId: string): Promise<GameState> {
    const state = await this.getGameState(redis, sessionId);
    const newState = JSON.parse(JSON.stringify(state)) as GameState;
    if (newState.players.includes(playerId)) return newState;
    if (newState.players.length >= newState.maxPlayers) throw new Error('Game is full');
    newState.players.push(playerId);
    if (newState.currentGame === 'dots') newState.dots!.scores[playerId] = 0;
    if (newState.currentGame === 'tictactoe') newState.tictactoe!.facesWon[playerId] = 0;
    if (newState.currentGame === 'chess') {
      if (!newState.chess) {
        newState.chess = {
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          pgn: '',
          history: [],
          uciHistory: [],
          lastMove: undefined,
          turn: 'white',
          gameOver: false,
          playersColor: {},
          result: undefined,
          reason: undefined,
          clocks: {},
          halfmoveClock: 0,
          fullmoveNumber: 1,
          repetitionMap: {}
        } as ChessStateStored;
      }
      const chessState = newState.chess as ChessStateStored;
      if (!chessState.playersColor) chessState.playersColor = {};
      if (newState.players.length === 1) { chessState.playersColor[playerId] = 'white'; newState.turn = playerId; }
      else if (newState.players.length === 2) { chessState.playersColor[playerId] = 'black'; newState.status = 'active'; newState.turn = newState.players[0]; newState.turnStartTime = Date.now(); }
    }
    if (newState.players.length === newState.maxPlayers && newState.status !== 'active') { newState.status = 'active'; if (!newState.turn) newState.turn = newState.players[0]; newState.turnStartTime = Date.now(); }
    await this.saveGameState(redis, sessionId, newState);
    return newState;
  }

  static async changeGame(redis: RedisClient, sessionId: string, gameType: GameType): Promise<GameState> {
    const state = await this.getGameState(redis, sessionId);
    const newState = this.createGameSpecificState(gameType, state.maxPlayers);
    newState.players = state.players;
    newState.sessionId = sessionId;
    if (gameType === 'chess' && newState.chess) {
      const chessState = newState.chess as ChessStateStored;
      chessState.playersColor = {};
      if (newState.players[0]) chessState.playersColor[newState.players[0]] = 'white';
      if (newState.players[1]) chessState.playersColor[newState.players[1]] = 'black';
      if (newState.players.length >= 2) { newState.status = 'active'; newState.turn = newState.players[0]; newState.turnStartTime = Date.now(); }
    }
    await this.saveGameState(redis, sessionId, newState);
    return newState;
  }

  static async checkTurnTimer(redis: RedisClient, sessionId: string): Promise<{ timeRemaining: number; currentTurn: string }> {
    const state = await this.getGameState(redis, sessionId);
    if (state.status !== 'active' || !state.firstMoveMade) return { timeRemaining: 30, currentTurn: state.turn };
    const elapsed = (Date.now() - state.turnStartTime) / 1000;
    const remaining = Math.max(0, 30 - elapsed);
    if (remaining <= 0 && state.players.length === 2) {
      const newState = JSON.parse(JSON.stringify(state)) as GameState;
      newState.winner = state.players.find(p => p !== state.turn);
      newState.status = 'finished';
      await this.saveGameState(redis, sessionId, newState);
    }
    return { timeRemaining: Math.round(remaining), currentTurn: state.turn };
  }

  private static getNextPlayer(state: GameState, currentPlayer: string): string {
    const idx = state.players.indexOf(currentPlayer);
    if (idx === -1) return state.players.length ? state.players[0] : '';
    return state.players[(idx + 1) % state.players.length];
  }

  private static findPlayerByColor(chessState: ChessStateStored, color: 'white' | 'black'): string | undefined {
    if (!chessState.playersColor) return undefined;
    const found = Object.entries(chessState.playersColor).find(([player, c]) => c === color);
    return found ? found[0] : undefined;
  }
}

export default GameAPI;
