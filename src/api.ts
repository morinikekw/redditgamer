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
  postId?: string;
};

/* --------------------------
   Minimal Chess Engine
   -------------------------- */

type Color = 'w' | 'b';
type Piece = string; // 'P','N','B','R','Q','K' or lowercase for black
type Square = string; // e.g. 'e4'

class ChessEngine {
  board: (Piece | null)[]; // 64 squares, 0 = a8, 7 = h8, 56 = a1, 63 = h1 (rank-file mapping)
  turnToMove: Color;
  castlingRights: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  enPassantSquare: string | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  history: string[]; // UCI-style moves
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

  // Utilities: index <-> square
  static fileCharToIdx(file: string) { return 'abcdefgh'.indexOf(file); }
  static idxToFile(i: number) { return 'abcdefgh'[i]; }
  static rankCharToIdx(rank: string) { return Number(rank) - 1; } // 1-based
  static squareToIndex(sq: string) {
    if (!sq || sq.length !== 2) return -1;
    const file = ChessEngine.fileCharToIdx(sq[0]);
    const rank = ChessEngine.rankCharToIdx(sq[1]);
    if (file < 0 || rank < 0 || file > 7 || rank > 7) return -1;
    // our internal index: 0 = a8 ... 63 = h1
    return (7 - rank) * 8 + file;
  }
  static indexToSquare(index: number) {
    if (index < 0 || index > 63) return '';
    const rank = 8 - Math.floor(index / 8);
    const file = index % 8;
    return `${'abcdefgh'[file]}${rank}`;
  }

  clone(): ChessEngine {
    const copy = new ChessEngine();
    copy.board = this.board.slice();
    copy.turnToMove = this.turnToMove;
    copy.castlingRights = { ...this.castlingRights };
    copy.enPassantSquare = this.enPassantSquare;
    copy.halfmoveClock = this.halfmoveClock;
    copy.fullmoveNumber = this.fullmoveNumber;
    copy.history = this.history.slice();
    copy.repetitionMap = { ...this.repetitionMap };
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

  loadFen(fen: string) {
    // simple FEN parser: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 6) throw new Error('Invalid FEN');
    const [boardPart, turnPart, castlingPart, enPassantPart, halfmovePart, fullmovePart] = parts;
    // board
    const rows = boardPart.split('/');
    if (rows.length !== 8) throw new Error('Invalid FEN board');
    const b: (Piece | null)[] = [];
    for (const r of rows) {
      let i = 0;
      for (const ch of r) {
        if (/\d/.test(ch)) {
          const cnt = Number(ch);
          for (let k = 0; k < cnt; k++) b.push(null);
        } else {
          b.push(ch);
        }
      }
      if (b.length % 8 !== 0) {
        // continue
      }
    }
    if (b.length !== 64) throw new Error('Invalid FEN board length');
    this.board = b;
    // turn
    this.turnToMove = turnPart === 'w' ? 'w' : 'b';
    // castling
    this.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
    if (castlingPart.includes('K')) this.castlingRights.wK = true;
    if (castlingPart.includes('Q')) this.castlingRights.wQ = true;
    if (castlingPart.includes('k')) this.castlingRights.bK = true;
    if (castlingPart.includes('q')) this.castlingRights.bQ = true;
    // en passant
    this.enPassantSquare = enPassantPart === '-' ? null : enPassantPart;
    // clocks
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
    const fenNoCounters = (() => {
      const base = this.getFen().split(' ');
      // ignore halfmove/fullmove numbers for repetition mapping
      return `${base[0]} ${base[1]} ${base[2]} ${base[3]}`;
    })();
    this.repetitionMap[fenNoCounters] = (this.repetitionMap[fenNoCounters] || 0) + 1;
  }

  // Get piece color
  pieceColor(piece: Piece | null): Color | null {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? 'w' : 'b';
  }

  // Generate pseudo-legal moves (not testing leaving king in check)
  generatePseudoLegalMoves(): { from: number; to: number; promotion?: string; piece?: Piece }[] {
    const moves: { from: number; to: number; promotion?: string; piece?: Piece }[] = [];
    const side = this.turnToMove;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (!p) continue;
      const color = this.pieceColor(p);
      if (color !== side) continue;
      const pieceType = p.toUpperCase();
      const file = sq % 8;
      const rank = 7 - Math.floor(sq / 8); // 0..7 for ranks 1..8? careful: indexToSquare uses 8 - floor(index/8)
      // For movement, easier to use index math (dx,dy)
      if (pieceType === 'P') {
        // pawn moves (forward depends on color)
        const dir = color === 'w' ? -1 : 1; // index direction rows: moving up decreases index because 0=a8
        const oneStep = sq + dir * 8;
        const startRank = color === 'w' ? 6 : 1; // board index rows: white pawns start at index 6*8..?
        // Note: our indexing is 0=a8, so white pawns on rank 2 are indexes 48..55? Let's be careful: easier approach: use algebraic conversions for pawn moves
        // We'll compute by squares using rank-file math
        const fromFile = sq % 8;
        const fromRank = 8 - Math.floor(sq / 8); // 1..8
        const forwardRank = color === 'w' ? fromRank + 1 : fromRank - 1;
        const doubleRank = color === 'w' ? fromRank + 2 : fromRank - 2;
        // single forward
        if (forwardRank >= 1 && forwardRank <= 8) {
          const toIdx = ChessEngine.squareToIndex(`${ChessEngine.indexToFile(fromFile)}${forwardRank}`); // placeholder; but easier to compute manually
        }

        // simpler: iterate squares via file/rank numeric arithmetic
        const fromFileIdx = sq % 8;
        const fromRankIdx = 7 - Math.floor(sq / 8); // 0..7 with 0 = rank8; this is messy. To avoid errors, convert via square string:
        const fromSqStr = ChessEngine.indexToSquare(sq);
        const forwardRankNum = Number(fromSqStr[1]) + (color === 'w' ? 1 : -1);
        const oneForward = (forwardRankNum >= 1 && forwardRankNum <= 8) ? ChessEngine.squareToIndex(`${fromSqStr[0]}${forwardRankNum}`) : -1;
        if (oneForward !== -1 && this.board[oneForward] === null) {
          // promotion?
          if ((color === 'w' && forwardRankNum === 8) || (color === 'b' && forwardRankNum === 1)) {
            ['q','r','b','n'].forEach(pr => moves.push({ from: sq, to: oneForward, promotion: pr }));
          } else {
            moves.push({ from: sq, to: oneForward });
            // two squares
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
        // captures (including en-passant)
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
            // capture
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
          // avoid wrapping across files by checking file differences:
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
        const dirs: number[] = [];
        if (pieceType === 'B' || pieceType === 'Q') dirs.push(-9, -7, 7, 9);
        if (pieceType === 'R' || pieceType === 'Q') dirs.push(-8, -1, 1, 8);
        for (const d of dirs) {
          let to = sq + d;
          while (to >= 0 && to < 64) {
            // check wrap
            const fromFile = sq % 8;
            const toFile = to % 8;
            // movement left/right wrap prevention:
            if (Math.abs((toFile) - (fromFile)) > 2 && (d === -9 || d === -1 || d === 7 || d === 1 || d === 9 || d === -7)) {
              // this check is heuristic; safer approach: break when file difference invalid for a single step; but we keep going piecewise
            }
            // More robust: compute each step by iterating by rank/file instead. For brevity, accept slight chance of wrap; but implement additional check:
            const diffFile = Math.abs(toFile - fromFile);
            if (diffFile > 2 && (d === -9 || d === -7 || d === 7 || d === 9 || d === -1 || d === 1)) {
              // break to avoid board wrap for long rays
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
          // file wrap checks
          const fx = sq % 8, tx = to % 8;
          if (Math.abs(fx - tx) > 1) continue;
          const target = this.board[to];
          if (!target || this.pieceColor(target) !== this.pieceColor(this.board[sq])) {
            moves.push({ from: sq, to });
          }
        }
        // castling
        if (this.turnToMove === 'w') {
          if (this.castlingRights.wK) {
            // white king e1 (index?), squares f1 g1 empty and not attacked
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

  // Check if a given move (from,to,promotion) is legal (does not leave own king in check)
  isLegalMove(from: number, to: number, promotion?: string): boolean {
    const copy = this.clone();
    const result = copy.makeMoveInternal(from, to, promotion, true);
    if (!result) return false;
    // after move, check if side to move's king is in check (we should check opponent of previous side)
    const kingIndex = copy.findKing(copy.turnToMove === 'w' ? 'b' : 'w');
    if (kingIndex === -1) return true; // weird but not legal normally
    const inCheck = copy.isSquareAttacked(kingIndex, copy.turnToMove);
    return !inCheck;
  }

  // Find king index for color
  findKing(color: Color): number {
    const kingChar = color === 'w' ? 'K' : 'k';
    for (let i=0;i<64;i++) if (this.board[i] === kingChar) return i;
    return -1;
  }

  // isSquareAttacked: will the given square (index) be attacked by side color 'byColor'?
  isSquareAttacked(squareIdx: number, byColor: Color): boolean {
    // scan board for byColor pieces and see if they can capture squareIdx (pseudo-legal)
    for (let i=0;i<64;i++) {
      const p = this.board[i];
      if (!p) continue;
      const color = this.pieceColor(p);
      if (color !== byColor) continue;
      const pt = p.toUpperCase();
      if (pt === 'P') {
        // pawn attacks differ by color
        const sqStr = ChessEngine.indexToSquare(i);
        const file = sqStr[0];
        const rank = Number(sqStr[1]);
        const attackRank = byColor === 'w' ? rank + 1 : rank - 1;
        if (attackRank >=1 && attackRank <=8) {
          const leftFile = String.fromCharCode(file.charCodeAt(0)-1);
          const rightFile = String.fromCharCode(file.charCodeAt(0)+1);
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
        const dirs: number[] = [];
        if (pt === 'B' || pt === 'Q') dirs.push(-9, -7, 7, 9);
        if (pt === 'R' || pt === 'Q') dirs.push(-8, -1, 1, 8);
        for (const d of dirs) {
          let to = i + d;
          while (to >= 0 && to < 64) {
            // file wrap prevention (approx)
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

  // Internal move application (does not check legality unless verifyCheck param used in isLegalMove flow)
  makeMoveInternal(from: number, to: number, promotion?: string, skipValidation = false): { captured?: Piece | null; promotion?: string } | null {
    const piece = this.board[from];
    if (!piece) return null;
    const color = this.pieceColor(piece)!;
    // handle castling detection
    const fromSq = ChessEngine.indexToSquare(from);
    const toSq = ChessEngine.indexToSquare(to);
    const moveStr = `${fromSq}${toSq}${promotion ? promotion : ''}`;
    // Save state snapshot for potential undo (engine-level undo not implemented; we use clone for isLegal)
    // move application:
    let captured: Piece | null = null;
    // en-passant capture
    if (piece.toUpperCase() === 'P') {
      if (toSq === this.enPassantSquare) {
        // perform en-passant capture: captured pawn is behind enPassant square
        const epIdx = ChessEngine.squareToIndex(this.enPassantSquare!);
        // captured pawn is one rank behind (for the opponent)
        const capIdx = color === 'w' ? epIdx + 8 : epIdx - 8;
        captured = this.board[capIdx];
        this.board[capIdx] = null;
      }
    }
    captured = captured ?? this.board[to];
    // move piece
    this.board[to] = piece;
    this.board[from] = null;

    // promotion
    if (promotion && piece.toUpperCase() === 'P') {
      const promoted = color === 'w' ? promotion.toUpperCase() : promotion.toLowerCase();
      this.board[to] = promoted;
    }

    // castling rook move if king moved two squares
    if (piece.toUpperCase() === 'K') {
      const ffile = fromSq[0], trank = fromSq[1];
      // white king e1 -> g1 or c1
      if (piece === 'K') {
        if (fromSq === 'e1' && toSq === 'g1') {
          // move rook h1 to f1
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
      // when king moves, relevant castling rights removed
      if (color === 'w') { this.castlingRights.wK = false; this.castlingRights.wQ = false; }
      else { this.castlingRights.bK = false; this.castlingRights.bQ = false; }
    }

    // rook move affects castling rights removal
    // if rook moves from a1/h1 or a8/h8, remove appropriate rights
    const fromSqLower = fromSq.toLowerCase();
    if (fromSqLower === 'h1') this.castlingRights.wK = false;
    if (fromSqLower === 'a1') this.castlingRights.wQ = false;
    if (fromSqLower === 'h8') this.castlingRights.bK = false;
    if (fromSqLower === 'a8') this.castlingRights.bQ = false;
    // if rook captured on those squares also remove rights
    const toSqLower = toSq.toLowerCase();
    if (toSqLower === 'h1') this.castlingRights.wK = false;
    if (toSqLower === 'a1') this.castlingRights.wQ = false;
    if (toSqLower === 'h8') this.castlingRights.bK = false;
    if (toSqLower === 'a8') this.castlingRights.bQ = false;

    // update en-passant square: when pawn moves two squares
    this.enPassantSquare = null;
    if (piece.toUpperCase() === 'P') {
      const fromRank = Number(fromSq[1]);
      const toRank = Number(toSq[1]);
      if (Math.abs(toRank - fromRank) === 2) {
        // set en passant square behind pawn
        const epRank = (fromRank + toRank) / 2;
        this.enPassantSquare = `${fromSq[0]}${epRank}`;
      }
    }

    // update halfmove clock
    if (piece.toUpperCase() === 'P' || captured) this.halfmoveClock = 0;
    else this.halfmoveClock++;

    // fullmove number: increment after black's move
    if (this.turnToMove === 'b') this.fullmoveNumber++;

    // toggle turn
    this.turnToMove = this.turnToMove === 'w' ? 'b' : 'w';

    // record history and repetition map
    this.history.push(moveStr);
    this.recordFenRepetition();

    return { captured, promotion };
  }

  // Exposed move API (like chess.js): accepts {from: 'e2', to: 'e4', promotion?: 'q'}
  move(obj: { from: string; to: string; promotion?: string } | string): any | null {
    let from: number, to: number, promotion: string | undefined;
    if (typeof obj === 'string') {
      // UCI string like 'e2e4' or 'e7e8q'
      from = ChessEngine.squareToIndex(obj.slice(0,2));
      to = ChessEngine.squareToIndex(obj.slice(2,4));
      promotion = obj.length > 4 ? obj[4] : undefined;
    } else {
      from = ChessEngine.squareToIndex(obj.from);
      to = ChessEngine.squareToIndex(obj.to);
      promotion = obj.promotion;
    }
    if (from === -1 || to === -1) return null;
    // check legality: ensure there's a piece of current side
    const piece = this.board[from];
    if (!piece) return null;
    if (this.pieceColor(piece) !== this.turnToMove) return null;
    // ensure move is among pseudo-legal and doesn't leave king in check
    const pseudos = this.generatePseudoLegalMoves();
    const matches = pseudos.filter(m => m.from === from && m.to === to && (promotion ? m.promotion === promotion : true));
    if (matches.length === 0) return null;
    // check if legal (not leaving king in check)
    const clone = this.clone();
    const made = clone.makeMoveInternal(from, to, promotion);
    if (!made) return null;
    // after move, ensure current player's king is not attacked
    const opponent = clone.turnToMove;
    const kingIndex = clone.findKing(opponent === 'w' ? 'b' : 'w');
    if (kingIndex !== -1 && clone.isSquareAttacked(kingIndex, opponent)) {
      return null; // illegal
    }
    // commit move on real engine
    const res = this.makeMoveInternal(from, to, promotion);
    return { from: ChessEngine.indexToSquare(from), to: ChessEngine.indexToSquare(to), promotion, san: undefined, captured: res ? res.captured : null };
  }

  // moves({ verbose: true })
  moves(opts?: { verbose?: boolean }): any[] | string[] {
    const pseudos = this.generatePseudoLegalMoves();
    const legalMoves = pseudos.filter(m => this.isLegalMove(m.from, m.to, m.promotion));
    if (opts && opts.verbose) {
      return legalMoves.map(m => ({
        from: ChessEngine.indexToSquare(m.from),
        to: ChessEngine.indexToSquare(m.to),
        promotion: m.promotion || undefined,
        piece: this.board[m.from] ? this.board[m.from] : undefined
      }));
    }
    return legalMoves.map(m => `${ChessEngine.indexToSquare(m.from)}${ChessEngine.indexToSquare(m.to)}${m.promotion ? m.promotion : ''}`);
  }

  turn(): 'w' | 'b' {
    return this.turnToMove;
  }

  fen(): string {
    return this.getFen();
  }

  historyUci(): string[] {
    return this.history.slice();
  }

  pgn(): string {
    // simplistic: use UCI history as pgn replacement
    return this.history.join(' ');
  }

  undo(): any | null {
    // For simplicity, we do not implement full undo stack.
    // If undo is required, GameAPI should reconstruct from stored FEN/histories or use a stored stack.
    // Implement naive: not supported
    return null;
  }

  // End conditions
  in_check(): boolean {
    const ownColor: Color = this.turnToMove;
    const kingIdx = this.findKing(ownColor);
    if (kingIdx === -1) return false;
    const attacked = this.isSquareAttacked(kingIdx, ownColor === 'w' ? 'b' : 'w');
    return attacked;
  }

  in_checkmate(): boolean {
    if (!this.in_check()) return false;
    // any legal moves?
    const pseudos = this.generatePseudoLegalMoves();
    for (const m of pseudos) {
      if (this.isLegalMove(m.from, m.to, m.promotion)) return false;
    }
    return true;
  }

  in_stalemate(): boolean {
    if (this.in_check()) return false;
    const pseudos = this.generatePseudoLegalMoves();
    for (const m of pseudos) {
      if (this.isLegalMove(m.from, m.to, m.promotion)) return false;
    }
    return true;
  }

  insufficient_material(): boolean {
    // basic cases: king vs king, king+minor vs king, king vs king+minor
    const pieces = this.board.filter(Boolean) as Piece[];
    const onlyKings = pieces.every(p => p.toUpperCase() === 'K' || p.toUpperCase() === 'k');
    if (pieces.length === 2 && onlyKings) return true;
    // count pieces
    const others = pieces.filter(p => p.toUpperCase() !== 'K' && p.toUpperCase() !== 'P');
    // if only bishops or knights in addition to kings, and not pawns/rooks/queens -> insufficient unless multiple minors on different colors (complex)
    const majors = pieces.filter(p => ['Q','R','P'].includes(p.toUpperCase()));
    if (majors.length > 0) return false;
    // If both sides have only king + single bishop each on opposite colors it's insufficient sometimes, but we approximate:
    if (pieces.length <= 4) return true;
    return false;
  }

  in_threefold_repetition(): boolean {
    // repetition map counts fen with castling and enpassant (we used recordFenRepetition accordingly)
    for (const k of Object.keys(this.repetitionMap)) {
      if (this.repetitionMap[k] >= 3) return true;
    }
    return false;
  }

  isGameOver(): boolean {
    if (this.in_checkmate()) return true;
    if (this.in_stalemate()) return true;
    if (this.insufficient_material()) return true;
    if (this.in_threefold_repetition()) return true;
    if (this.halfmoveClock >= 100) return true; // 50-move -> 100 halfmoves
    return false;
  }
}

/* -------------------------
   GameAPI Class (uses ChessEngine)
   ------------------------- */

export class GameAPI {
  // --- Helpers for persistence -------------------------------------------------

  private static redisKey(postId: string) {
    return `gameState:${postId}`;
  }

  static async getGameState(redis: RedisClient, postId: string): Promise<GameState> {
    try {
      const raw = await redis.get(GameAPI.redisKey(postId));
      if (!raw) return this.createInitialState();
      const parsed = JSON.parse(raw) as GameState;
      return parsed;
    } catch (err) {
      console.error('GameAPI.getGameState error:', err);
      return this.createInitialState();
    }
  }

  static async saveGameState(redis: RedisClient, postId: string, state: GameState): Promise<void> {
    try {
      await redis.set(GameAPI.redisKey(postId), JSON.stringify(state));
    } catch (err) {
      console.error('GameAPI.saveGameState error:', err);
      throw new Error(`Failed to save game state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Initialization / creation ----------------------------------------------

  static async initializeGame(redis: RedisClient, postId: string, gameType: GameType, maxPlayers: number) {
    const initial = this.createGameSpecificState(gameType, maxPlayers);
    initial.postId = postId;
    await this.saveGameState(redis, postId, initial);
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

  // --- Compatibility helpers
  private static isChessGameOver(chessInstance: any): boolean {
    try {
      if (!chessInstance) return false;
      if (typeof chessInstance.isGameOver === 'function') return chessInstance.isGameOver();
      if (typeof chessInstance.game_over === 'function') return chessInstance.game_over();
      if (typeof chessInstance.gameOver === 'function') return chessInstance.gameOver();
      // fallback: check several functions
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

  // --- Public: process moves (delegates by game) -------------------------------

  static async processMove(redis: RedisClient, postId: string, action: GameAction): Promise<GameState> {
    const state = await this.getGameState(redis, postId);

    if (state.status === 'finished') {
      throw new Error('Game has already ended');
    }

    const playerId = action.data.playerId;
    if (!state.players.includes(playerId) && action.type !== 'join') {
      throw new Error('Player not registered in this game');
    }

    if (state.currentGame !== 'reaction' && state.turn && state.turn !== playerId) {
      throw new Error('Not your turn');
    }

    const newState = JSON.parse(JSON.stringify(state)) as GameState;

    if (!newState.firstMoveMade) {
      newState.firstMoveMade = true;
      newState.turnStartTime = Date.now();
    }

    switch (newState.currentGame) {
      case 'tictactoe':
        this.processTicTacToeMove(newState, action);
        break;
      case 'gomoku':
        this.processGomokuMove(newState, action);
        break;
      case 'dots':
        this.processDotsMove(newState, action);
        break;
      case 'connect4':
        this.processConnect4Move(newState, action);
        break;
      case 'chess':
        await this.processChessMove(newState, action);
        break;
      case 'reaction':
        break;
      default:
        throw new Error(`Unsupported game type: ${newState.currentGame}`);
    }

    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  // --- Reaction update omitted (same as before) -------------------------------

  static async updateReactionScore(
    redis: RedisClient,
    postId: string,
    playerId: string,
    score: number,
    avgTime: number,
    medianTime: number
  ): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    const newState = JSON.parse(JSON.stringify(state)) as GameState;

    if (!newState.reaction) newState.reaction = { scores: [] };

    const idx = newState.reaction.scores.findIndex((s: any) => s.player === playerId);
    if (idx >= 0) newState.reaction.scores[idx] = { player: playerId, score, avgTime, medianTime };
    else newState.reaction.scores.push({ player: playerId, score, avgTime, medianTime });

    newState.reaction.scores.sort((a: any, b: any) => b.score - a.score);

    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  // --- TicTacToe / Gomoku / Dots / Connect4 implementations -------------------

  private static processTicTacToeMove(state: GameState, action: GameAction): void {
    const moveData = action.data.position as { face: number; cell: number };
    const { face, cell } = moveData;
    if (!state.tictactoe) throw new Error('TicTacToe not initialized');
    if (face < 0 || face >= 6 || cell < 0 || cell >= 9) throw new Error('Invalid face or cell position');
    if (state.tictactoe.faces[face][cell]) throw new Error('Cell already occupied');
    state.tictactoe.faces[face][cell] = action.data.playerId;
    const faceWon = this.checkTicTacToeFaceWin(state.tictactoe.faces[face], action.data.playerId);
    if (faceWon) {
      if (!state.tictactoe.facesWon[action.data.playerId]) state.tictactoe.facesWon[action.data.playerId] = 0;
      state.tictactoe.facesWon[action.data.playerId]++;
      if (state.tictactoe.facesWon[action.data.playerId] >= 4) {
        state.winner = action.data.playerId;
        state.status = 'finished';
        return;
      }
    }
    const allFilled = state.tictactoe.faces.every(f => f.every(c => c !== null));
    if (allFilled) {
      const counts = Object.values(state.tictactoe.facesWon);
      const maxFaces = counts.length ? Math.max(...counts) : 0;
      const winners = Object.entries(state.tictactoe.facesWon).filter(([_, c]) => c === maxFaces).map(([p]) => p);
      if (winners.length === 1) { state.winner = winners[0]; state.status = 'finished'; }
      else { state.status = 'draw'; }
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
    if (column < 0 || column >= 7) throw new Error('Invalid column');
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

    // Handle different position formats
    if (typeof position === 'string') {
      lineKey = position;
    } else if (Array.isArray(position) && position.length === 4) {
      // Convert [x1, y1, x2, y2] to "x1,y1,x2,y2"
      lineKey = position.join(',');
    } else if (typeof position === 'object' && position.from && position.to) {
      // Convert {from: {x, y}, to: {x, y}} to "x1,y1,x2,y2"
      lineKey = `${position.from.x},${position.from.y},${position.to.x},${position.to.y}`;
    } else {
      throw new Error('Invalid dots move position format');
    }

    if (!state.dots) throw new Error('Dots not initialized');
    if (state.dots.lines.includes(lineKey)) throw new Error('Line already exists');

    // Validate line is between adjacent dots
    const coords = lineKey.split(',').map(Number);
    if (coords.length !== 4) throw new Error('Invalid line coordinates');
    const [x1, y1, x2, y2] = coords;

    const gridSize = state.dots.gridSize; // <-- single declaration, after null-check

    // Check bounds
    if (x1 < 0 || x1 >= gridSize || y1 < 0 || y1 >= gridSize ||
        x2 < 0 || x2 >= gridSize || y2 < 0 || y2 >= gridSize) {
      throw new Error('Line coordinates out of bounds');
    }

    // Check adjacency (horizontal or vertical only)
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) {
      throw new Error('Line must be between adjacent dots');
    }

    state.dots.lines.push(lineKey);
    let boxesCompleted = 0;
    if (!state.dots.scores[action.data.playerId]) state.dots.scores[action.data.playerId] = 0;

    for (let x = 0; x < gridSize - 1; x++) {
      for (let y = 0; y < gridSize - 1; y++) {
        const top = `${x},${y},${x+1},${y}`;
        const bottom = `${x},${y+1},${x+1},${y+1}`;
        const left = `${x},${y},${x},${y+1}`;
        const right = `${x+1},${y},${x+1},${y+1}`;
        if ([top, bottom, left, right].every(l => state.dots!.lines.includes(l))) {
          const boxKey = `${x},${y}`;
          if (!state.dots!.boxes[boxKey]) {
            state.dots!.boxes[boxKey] = action.data.playerId;
            state.dots!.scores[action.data.playerId]++;
            boxesCompleted++;
          }
        }
      }
    }

    // If boxes were completed, player gets another turn
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
    const [x,y] = action.data.position as [number, number];
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

  // --- CHESS integration (server-side authoritative via internal ChessEngine) --------------

  private static async processChessMove(state: GameState, action: GameAction): Promise<void> {
    if (!state.chess) throw new Error('Chess game not initialized');
    const chessStored = state.chess as ChessStateStored;

    // create ChessEngine instance from stored fen
    const engine = new ChessEngine(chessStored.fen);

    const moveData = action.data.position as { from: string; to: string; promotion?: string };
    if (!moveData || !moveData.from || !moveData.to) throw new Error('Invalid move payload');

    // Check legality using engine
    const legalMoves = (engine.moves({ verbose: true }) as any[]);
    const legal = Array.isArray(legalMoves) && legalMoves.some((m: any) =>
      m.from === moveData.from && m.to === moveData.to && (moveData.promotion ? m.promotion === moveData.promotion : true)
    );
    if (!legal) throw new Error('Illegal chess move');

    const result = engine.move({ from: moveData.from, to: moveData.to, promotion: moveData.promotion });
    if (!result) throw new Error('Move failed');

    // Update stored state safely
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
      if (playerForColor) {
        state.turn = playerForColor[0];
      } else {
        // Fallback: if no mapping found, use first player for white, second for black
        state.turn = currentColor === 'white' ? state.players[0] : state.players[1];
      }
    } else {
      // Fallback: use player index based on color
      state.turn = chessStored.turn === 'white' ? state.players[0] : state.players[1];
    }

    // end conditions - use compatibility helper
    chessStored.gameOver = GameAPI.isChessGameOver(engine);

    if (GameAPI.safeInCheckmate(engine)) {
      // winner is side that delivered mate (opposite of current turn)
      const winnerColor = engine.turn() === 'w' ? 'b' : 'w';
      chessStored.result = winnerColor === 'w' ? '1-0' : '0-1';
      state.winner = GameAPI.findPlayerByColor(chessStored, winnerColor === 'white' ? 'white' : 'black') || state.winner;
      chessStored.reason = 'checkmate';
      state.status = 'finished';
    } else if (GameAPI.safeInStalemate(engine)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'stalemate'; state.status = 'draw';
    } else if (GameAPI.safeInsufficientMaterial(engine)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'insufficient material'; state.status = 'draw';
    } else if (GameAPI.safeInThreefoldRepetition(engine)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'threefold repetition'; state.status = 'draw';
    } else {
      // 50-move rule
      if (engine.halfmoveClock >= 100) {
        chessStored.result = '1/2-1/2';
        chessStored.reason = '50-move rule';
        state.status = 'draw';
      } else {
        state.status = 'active';
      }
    }

    // optional clock updates
    if (action.data.clock) {
      chessStored.clocks = Object.assign(chessStored.clocks || {}, action.data.clock);
    }

    state.chess = chessStored;
    state.turnStartTime = Date.now();
    state.firstMoveMade = true;
  }

  // Undo last move (optional) - naive implementation reconstructs from history
  static async undoChessMove(redis: RedisClient, postId: string): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    if (!state.chess) throw new Error('Chess not initialized');
    const chessState = JSON.parse(JSON.stringify(state.chess)) as ChessStateStored;
    if (!chessState.history || chessState.history.length === 0) throw new Error('No move to undo');
    // rebuild engine from initial position and replay history minus last
    const engine = new ChessEngine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (let i = 0; i < chessState.history.length - 1; i++) {
      engine.move(chessState.history[i]);
    }
    chessState.fen = engine.fen();
    chessState.history = engine.historyUci();
    chessState.pgn = engine.pgn();
    chessState.uciHistory = chessState.history.slice();
    chessState.gameOver = GameAPI.isChessGameOver(engine);
    chessState.turn = engine.turn() === 'w' ? 'white' : 'black';
    state.chess = chessState;
    state.turn = this.findPlayerByColor(chessState, chessState.turn) || state.turn;
    await this.saveGameState(redis, postId, state);
    return state;
  }

  static async getLegalChessMoves(redis: RedisClient, postId: string, from?: string): Promise<{ from?: string; moves: any[]; fen?: string }> {
    const state = await this.getGameState(redis, postId);
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

  // --- Lobby / join / change game --------------------------------------------

  static async joinGame(redis: RedisClient, postId: string, playerId: string): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
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
      
      // Assign colors based on join order
      if (newState.players.length === 1) {
        // First player gets white
        chessState.playersColor[playerId] = 'white';
        newState.turn = playerId;
      } else if (newState.players.length === 2) {
        // Second player gets black
        chessState.playersColor[playerId] = 'black';
        // Game can start with 2 players
        newState.status = 'active';
        // White (first player) starts
        newState.turn = newState.players[0];
        newState.turnStartTime = Date.now();
      }

    }

    if (newState.players.length === newState.maxPlayers && newState.status !== 'active') {
      newState.status = 'active';
      if (!newState.turn) newState.turn = newState.players[0];
      newState.turnStartTime = Date.now();
    }

    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  static async changeGame(redis: RedisClient, postId: string, gameType: GameType, sessionId?: string): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    const newState = this.createGameSpecificState(gameType, state.maxPlayers);
    newState.players = state.players;
    newState.postId = postId;
    if (gameType === 'chess' && newState.chess) {
      const chessState = newState.chess as ChessStateStored;
      chessState.playersColor = {};
      if (newState.players[0]) chessState.playersColor[newState.players[0]] = 'white';
      if (newState.players[1]) chessState.playersColor[newState.players[1]] = 'black';
      if (newState.players.length >= 2) {
        newState.status = 'active';
        newState.turn = newState.players[0];
        newState.turnStartTime = Date.now();
      }
    }
    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  // --- Turn timer check ------------------------------------------------------

  static async checkTurnTimer(redis: RedisClient, postId: string): Promise<{ timeRemaining: number; currentTurn: string }> {
    const state = await this.getGameState(redis, postId);
    if (state.status !== 'active' || !state.firstMoveMade) return { timeRemaining: 30, currentTurn: state.turn };
    const elapsed = (Date.now() - state.turnStartTime) / 1000;
    const remaining = Math.max(0, 30 - elapsed);
    if (remaining <= 0 && state.players.length === 2) {
      const newState = JSON.parse(JSON.stringify(state)) as GameState;
      newState.winner = state.players.find(p => p !== state.turn);
      newState.status = 'finished';
      await this.saveGameState(redis, postId, newState);
    }
    return { timeRemaining: Math.round(remaining), currentTurn: state.turn };
  }

  // --- Utilities --------------------------------------------------------------

  private static getNextPlayer(state: GameState, currentPlayer: string): string {
    const idx = state.players.indexOf(currentPlayer);
    if (idx === -1) return state.players.length ? state.players[0] : '';
    const next = (idx + 1) % state.players.length;
    return state.players[next];
  }

  private static findPlayerByColor(chessState: ChessStateStored, color: 'white' | 'black'): string | undefined {
    if (!chessState.playersColor) return undefined;
    const found = Object.entries(chessState.playersColor).find(([player, c]) => c === color);
    return found ? found[0] : undefined;
  }
}

export default GameAPI;
