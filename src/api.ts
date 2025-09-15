import type { RedisClient } from '@devvit/public-api';
import { Chess } from 'chess.js';


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
  history: string[]; // SAN moves
  uciHistory?: string[]; // optional
  lastMove?: { from: string; to: string; san?: string; promotion?: string };
  turn: 'white' | 'black';
  result?: string;
  reason?: string;
  gameOver: boolean;
  playersColor?: { [playerId: string]: 'white' | 'black' };
  clocks?: { white?: number; black?: number };
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


/* -------------------------
   GameAPI
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

  // -----------------------
  // Compatibility helpers
  // -----------------------

  // Safely detect if chess.js instance reports "game over" using multiple API names:
  private static isChessGameOver(chessInstance: any): boolean {
    try {
      if (!chessInstance) return false;
      if (typeof chessInstance.game_over === 'function') return chessInstance.game_over();
      if (typeof chessInstance.gameOver === 'function') return chessInstance.gameOver();
      if (typeof chessInstance.isGameOver === 'function') return chessInstance.isGameOver();

      // Fallback: evaluate via specific end-condition queries if available:
      if (typeof chessInstance.in_checkmate === 'function' && chessInstance.in_checkmate()) return true;
      if (typeof chessInstance.in_stalemate === 'function' && chessInstance.in_stalemate()) return true;
      if (typeof chessInstance.insufficient_material === 'function' && chessInstance.insufficient_material()) return true;
      if (typeof chessInstance.in_threefold_repetition === 'function' && chessInstance.in_threefold_repetition()) return true;

      // If there is an `in_draw` method on some versions:
      if (typeof chessInstance.in_draw === 'function' && chessInstance.in_draw()) return true;

      return false;
    } catch (e) {
      console.warn('isChessGameOver: error while probing chess instance', e);
      return false;
    }
  }

  // Safe wrappers for optional methods
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
    const lineKey = action.data.position as string;
    if (!state.dots) throw new Error('Dots not initialized');
    if (state.dots.lines.includes(lineKey)) throw new Error('Line already exists');
    state.dots.lines.push(lineKey);
    let boxesCompleted = 0;
    const gridSize = state.dots.gridSize;
    if (!state.dots.scores[action.data.playerId]) state.dots.scores[action.data.playerId] = 0;
    for (let x=0;x<gridSize-1;x++){
      for (let y=0;y<gridSize-1;y++){
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

  // --- CHESS integration (server-side authoritative via chess.js) --------------

  private static async processChessMove(state: GameState, action: GameAction): Promise<void> {
    if (!state.chess) throw new Error('Chess game not initialized');
    const chessStored = state.chess as ChessStateStored;

    // create chess.js instance from stored fen
    const chess = new Chess(chessStored.fen);

    const moveData = action.data.position as { from: string; to: string; promotion?: string };
    if (!moveData || !moveData.from || !moveData.to) throw new Error('Invalid move payload');

    // Check legality using chess.js (server authoritative)
    const verboseMoves = (typeof chess.moves === 'function') ? chess.moves({ verbose: true }) : [];
    const legal = Array.isArray(verboseMoves) && verboseMoves.some((m: any) =>
      m.from === moveData.from && m.to === moveData.to && (moveData.promotion ? m.promotion === moveData.promotion : true)
    );
    if (!legal) throw new Error('Illegal chess move');

    const result = chess.move({ from: moveData.from, to: moveData.to, promotion: moveData.promotion });
    if (!result) throw new Error('Move failed');

    // Update stored state safely
    chessStored.fen = typeof chess.fen === 'function' ? chess.fen() : chessStored.fen;
    chessStored.history = typeof chess.history === 'function' ? chess.history() : chessStored.history || [];
    chessStored.uciHistory = chessStored.uciHistory || [];
    chessStored.uciHistory.push(`${moveData.from}${moveData.to}${moveData.promotion ? moveData.promotion : ''}`);
    chessStored.lastMove = { from: result.from, to: result.to, san: result.san, promotion: result.promotion };
    chessStored.pgn = typeof chess.pgn === 'function' ? chess.pgn() : chessStored.pgn;
    chessStored.turn = typeof chess.turn === 'function' ? (chess.turn() === 'w' ? 'white' : 'black') : chessStored.turn;

    // Map top-level turn to player id if mapping exists
    if (chessStored.playersColor) {
      const currentColor = chessStored.turn;
      const playerForColor = Object.entries(chessStored.playersColor).find(([, c]) => c === currentColor);
      state.turn = playerForColor ? playerForColor[0] : '';
    } else {
      state.turn = '';
    }

    // end conditions - use compatibility helper
    chessStored.gameOver = GameAPI.isChessGameOver(chess);

    if (GameAPI.safeInCheckmate(chess)) {
      chessStored.result = chessStored.turn === 'white' ? '1-0' : '0-1';
      // after the move `chess.turn()` is side to move, the loser was the side that was just mated
      // determine winner by inverting the side to move
      state.winner = GameAPI.findPlayerByColor(chessStored, chessStored.turn === 'white' ? 'black' : 'white');
      chessStored.reason = 'checkmate';
      state.status = 'finished';
    } else if (GameAPI.safeInStalemate(chess)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'stalemate'; state.status = 'draw';
    } else if (GameAPI.safeInsufficientMaterial(chess)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'insufficient material'; state.status = 'draw';
    } else if (GameAPI.safeInThreefoldRepetition(chess)) {
      chessStored.result = '1/2-1/2'; chessStored.reason = 'threefold repetition'; state.status = 'draw';
    } else {
      // 50-move rule: versions differ; attempt to inspect common properties
      try {
        const halfMoves = (chess as any).half_moves ?? (chess as any).halfmove ?? (chess as any).halfMoveClock;
        if (typeof halfMoves === 'number') {
          if (halfMoves >= 100) {
            chessStored.result = '1/2-1/2';
            chessStored.reason = '50-move rule';
            state.status = 'draw';
          } else {
            state.status = 'active';
          }
        } else {
          state.status = 'active';
        }
      } catch (e) {
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

  // Undo last move (optional)
  static async undoChessMove(redis: RedisClient, postId: string): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    if (!state.chess) throw new Error('Chess not initialized');
    const chessState = JSON.parse(JSON.stringify(state.chess)) as ChessStateStored;
    const chess = new Chess(chessState.fen);
    const last = typeof chess.undo === 'function' ? chess.undo() : null;
    if (!last) throw new Error('No move to undo');
    chessState.fen = typeof chess.fen === 'function' ? chess.fen() : chessState.fen;
    chessState.history = typeof chess.history === 'function' ? chess.history() : chessState.history || [];
    chessState.pgn = typeof chess.pgn === 'function' ? chess.pgn() : chessState.pgn;
    if (chessState.uciHistory) chessState.uciHistory.pop();
    chessState.gameOver = GameAPI.isChessGameOver(chess);
    state.chess = chessState;
    state.turn = this.findPlayerByColor(chessState, chessState.turn);
    await this.saveGameState(redis, postId, state);
    return state;
  }

  // Return legal chess moves (verbose) for UI / spectators
  static async getLegalChessMoves(redis: RedisClient, postId: string, from?: string): Promise<{ from?: string; moves: any[]; fen?: string }> {
    const state = await this.getGameState(redis, postId);
    if (!state.chess) throw new Error('Chess game not initialized');
    const chessState = state.chess as ChessStateStored;
    const chess = new Chess(chessState.fen);
    const verboseMoves = typeof chess.moves === 'function' ? chess.moves({ verbose: true }) as any[] : [];
    if (from) {
      const filtered = verboseMoves.filter(m => m.from === from);
      return { from, moves: filtered, fen: typeof chess.fen === 'function' ? chess.fen() : chessState.fen };
    }
    return { moves: verboseMoves, fen: typeof chess.fen === 'function' ? chess.fen() : chessState.fen };
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
          clocks: {}
        } as ChessStateStored;
      }
      const chessState = newState.chess as ChessStateStored;
      if (!chessState.playersColor) chessState.playersColor = {};
      if (!Object.values(chessState.playersColor).includes('white')) chessState.playersColor[playerId] = 'white';
      else if (!Object.values(chessState.playersColor).includes('black')) chessState.playersColor[playerId] = 'black';
      const whitePlayer = Object.entries(chessState.playersColor).find(([p,c]) => c === 'white');
      if (whitePlayer) {
        newState.status = newState.players.length >= newState.maxPlayers ? 'active' : newState.status;
        newState.turn = whitePlayer[0];
        newState.turnStartTime = Date.now();
      }
      newState.turn = this.findPlayerByColor(newState.chess as ChessStateStored, (newState.chess as ChessStateStored).turn) || newState.turn || newState.players[0];

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
