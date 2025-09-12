import type { RedisClient } from '@devvit/public-api';
import type { GameState, GameAction, GameType } from './types';

export class GameAPI {
  static async getGameState(redis: RedisClient, postId: string): Promise<GameState> {
    try {
      const state = await redis.get(`gameState:${postId}`);
      return state ? JSON.parse(state) : this.createInitialState();
    } catch (error) {
      console.error('Error getting game state:', error);
      return this.createInitialState();
    }
  }

  static async saveGameState(redis: RedisClient, postId: string, state: GameState): Promise<void> {
    try {
      await redis.set(`gameState:${postId}`, JSON.stringify(state));
    } catch (error) {
      throw new Error(`Failed to save game state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static async initializeGame(
    redis: RedisClient,
    postId: string,
    gameType: GameType,
    maxPlayers: number
  ): Promise<void> {
    const initialState = this.createGameSpecificState(gameType, maxPlayers);
    await this.saveGameState(redis, postId, initialState);
  }

  private static createGameSpecificState(gameType: GameType, maxPlayers: number): GameState {
    const baseState = {
      currentGame: gameType,
      players: [],
      maxPlayers,
      turn: '',
      status: 'waiting' as const,
      winner: undefined,
      firstMoveMade: false,
      turnStartTime: Date.now(),
    };

    switch (gameType) {
      case 'tictactoe':
        return {
          ...baseState,
          tictactoe: Array(9).fill(null),
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5 },
          connect4: [],
          chess: undefined,
          reaction: undefined,
        };
      
      case 'gomoku':
        return {
          ...baseState,
          tictactoe: [],
          gomoku: Array(225).fill(null),
          dots: { lines: [], boxes: {}, gridSize: 5 },
          connect4: [],
          chess: undefined,
          reaction: undefined,
        };
      
      case 'dots':
        return {
          ...baseState,
          tictactoe: [],
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5 },
          connect4: [],
          chess: undefined,
          reaction: undefined,
        };
      
      case 'connect4':
        return {
          ...baseState,
          tictactoe: [],
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5 },
          connect4: Array.from({ length: 7 }, () => Array(6).fill(null)),
          chess: undefined,
          reaction: undefined,
        };
      
      case 'chess':
        const initialChessBoard = [
          ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
          ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
          ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
        ];
        
        return {
          ...baseState,
          tictactoe: [],
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5 },
          connect4: [],
          chess: { 
            board: JSON.parse(JSON.stringify(initialChessBoard)),
            history: [],
            turn: 'white',
            castling: { white: { king: true, queen: true }, black: { king: true, queen: true } },
            enPassant: null,
            halfMoveClock: 0,
            fullMoveNumber: 1
          },
          reaction: undefined,
        };
      
      case 'reaction':
        return {
          ...baseState,
          tictactoe: [],
          gomoku: [],
          dots: { lines: [], boxes: {}, gridSize: 5 },
          connect4: [],
          chess: undefined,
          reaction: { scores: [] },
        };
      
      default:
        return this.createInitialState();
    }
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
      tictactoe: Array(9).fill(null),
      gomoku: Array(225).fill(null),
      dots: { lines: [], boxes: {}, gridSize: 5 },
      connect4: Array.from({ length: 7 }, () => Array(6).fill(null)),
      chess: undefined,
      reaction: undefined,
    };
  }

  static async processMove(redis: RedisClient, postId: string, action: GameAction): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    
    if (state.status === 'finished') {
      throw new Error('Game has already ended');
    }
    
    if (!state.players.includes(action.data.playerId)) {
      throw new Error('Player not registered in this game');
    }
    
    if (state.turn !== action.data.playerId && state.currentGame !== 'reaction') {
      throw new Error('Not your turn');
    }

    // Create a deep copy of the state to avoid mutations
    const newState = JSON.parse(JSON.stringify(state));
    
    // Mark first move if not already done
    if (!newState.firstMoveMade) {
      newState.firstMoveMade = true;
      newState.turnStartTime = Date.now();
    }

    // Handle different game types
    switch (state.currentGame) {
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
        this.processChessMove(newState, action);
        break;
      case 'reaction':
        // Reaction game handles scoring differently
        // The move is just for tracking, not for board state
        break;
      default:
        throw new Error(`Unsupported game type: ${state.currentGame}`);
    }

    // Save updated state
    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  static async updateReactionScore(
    redis: RedisClient, 
    postId: string, 
    playerId: string, 
    score: number, 
    avgTime: number,
    medianTime: number
  ): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    const newState = JSON.parse(JSON.stringify(state));
    
    if (!newState.reaction) {
      newState.reaction = { scores: [] };
    }
    
    // Update or add player score
    const existingIndex = newState.reaction.scores.findIndex((s: any) => s.player === playerId);
    if (existingIndex >= 0) {
      newState.reaction.scores[existingIndex] = { player: playerId, score, avgTime, medianTime };
    } else {
      newState.reaction.scores.push({ player: playerId, score, avgTime, medianTime });
    }
    
    // Sort scores by score descending
    newState.reaction.scores.sort((a: any, b: any) => b.score - a.score);
    
    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  private static getNextPlayer(state: GameState, currentPlayer: string): string {
    const currentIndex = state.players.indexOf(currentPlayer);
    const nextIndex = (currentIndex + 1) % state.players.length;
    return state.players[nextIndex];
  }

  private static processTicTacToeMove(state: GameState, action: GameAction): void {
    const position = action.data.position as number;
    if (position < 0 || position > 8 || state.tictactoe[position]) {
      throw new Error('Invalid move');
    }
    
    // Use the player's username as the symbol
    state.tictactoe[position] = action.data.playerId;
    
    // Check for win
    const winPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
      [0, 4, 8], [2, 4, 6] // diagonals
    ];
    
    for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (
        state.tictactoe[a] &&
        state.tictactoe[a] === state.tictactoe[b] &&
        state.tictactoe[a] === state.tictactoe[c]
      ) {
        state.winner = action.data.playerId;
        state.status = 'finished';
        return;
      }
    }
    
    // Check for draw
    if (state.tictactoe.every(cell => cell !== null)) {
      state.status = 'draw';
      return;
    }
    
    // Switch to next player
    state.turn = this.getNextPlayer(state, action.data.playerId);
    state.turnStartTime = Date.now();
  }

  private static processConnect4Move(state: GameState, action: GameAction): void {
    const column = action.data.position as number;
    if (column < 0 || column >= 7) throw new Error('Invalid column');
    
    // Find the lowest empty row in the column (bottom-up)
    const colArray = state.connect4[column];
    let row = -1;
    for (let r = 5; r >= 0; r--) {
      if (colArray[r] === null) {
        row = r;
        break;
      }
    }
    
    if (row === -1) throw new Error('Column full');
    
    // Place the disc at the lowest available position
    state.connect4[column][row] = action.data.playerId;
    
    // Check for win (4 in a row)
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]]; // horizontal, vertical, diagonal
    for (const [dx, dy] of directions) {
      let count = 1;
      
      // Check positive direction
      for (let i = 1; i < 4; i++) {
        const x = column + dx * i;
        const y = row + dy * i;
        if (x < 0 || x >= 7 || y < 0 || y >= 6) break;
        if (state.connect4[x][y] === action.data.playerId) count++;
        else break;
      }
      
      // Check negative direction
      for (let i = 1; i < 4; i++) {
        const x = column - dx * i;
        const y = row - dy * i;
        if (x < 0 || x >= 7 || y < 0 || y >= 6) break;
        if (state.connect4[x][y] === action.data.playerId) count++;
        else break;
      }
      
      if (count >= 4) {
        state.winner = action.data.playerId;
        state.status = 'finished';
        return;
      }
    }
    
    // Check for draw (board full)
    if (state.connect4.every(col => col.every(cell => cell !== null))) {
      state.status = 'draw';
      return;
    }
    
    // Switch to next player
    state.turn = this.getNextPlayer(state, action.data.playerId);
    state.turnStartTime = Date.now();
  }

  private static processDotsMove(state: GameState, action: GameAction): void {
    const lineKey = action.data.position as string;
    if (state.dots.lines.includes(lineKey)) {
      throw new Error('Line already exists');
    }
    
    state.dots.lines.push(lineKey);
    let boxesCompleted = 0;
    const gridSize = state.dots.gridSize;
    
    // Check for completed boxes
    for (let x = 0; x < gridSize - 1; x++) {
      for (let y = 0; y < gridSize - 1; y++) {
        const top = `${x},${y},${x + 1},${y}`;
        const bottom = `${x},${y + 1},${x + 1},${y + 1}`;
        const left = `${x},${y},${x},${y + 1}`;
        const right = `${x + 1},${y},${x + 1},${y + 1}`;
        
        if ([top, bottom, left, right].every(l => state.dots.lines.includes(l))) {
          const boxKey = `${x},${y}`;
          if (!state.dots.boxes[boxKey]) {
            state.dots.boxes[boxKey] = action.data.playerId;
            boxesCompleted++;
          }
        }
      }
    }
    
    // If player completed boxes, they get another turn
    state.turn = boxesCompleted > 0 
      ? action.data.playerId 
      : this.getNextPlayer(state, action.data.playerId);
    
    // Check if game is finished
    if (Object.keys(state.dots.boxes).length === Math.pow(gridSize - 1, 2)) {
      const scores: Record<string, number> = {};
      for (const player of Object.values(state.dots.boxes)) {
        scores[player] = (scores[player] || 0) + 1;
      }
      state.winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
      state.status = 'finished';
    }
    
    state.turnStartTime = Date.now();
  }

  private static processGomokuMove(state: GameState, action: GameAction): void {
    const [x, y] = action.data.position as [number, number];
    const index = y * 15 + x;
    
    if (x < 0 || x >= 15 || y < 0 || y >= 15 || state.gomoku[index]) {
      throw new Error('Invalid position');
    }
    
    state.gomoku[index] = action.data.playerId;
    
    // Check for win (5 in a row)
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dx, dy] of directions) {
      let count = 1;
      
      // Check positive direction
      for (let i = 1; i < 5; i++) {
        const nx = x + dx * i;
        const ny = y + dy * i;
        if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15) break;
        if (state.gomoku[ny * 15 + nx] === action.data.playerId) count++;
        else break;
      }
      
      // Check negative direction
      for (let i = 1; i < 5; i++) {
        const nx = x - dx * i;
        const ny = y - dy * i;
        if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15) break;
        if (state.gomoku[ny * 15 + nx] === action.data.playerId) count++;
        else break;
      }
      
      if (count >= 5) {
        state.winner = action.data.playerId;
        state.status = 'finished';
        return;
      }
    }
    
    // Check for draw (board full)
    if (state.gomoku.every(cell => cell !== null)) {
      state.status = 'draw';
      return;
    }
    
    // Switch to next player
    state.turn = this.getNextPlayer(state, action.data.playerId);
    state.turnStartTime = Date.now();
  }

  private static processChessMove(state: GameState, action: GameAction): void {
    if (!state.chess) {
      throw new Error('Chess game not initialized');
    }
    
    const moveData = action.data.position as { from: string; to: string; board: any[][] };
    
    // Update the chess state
    state.chess.board = moveData.board;
    state.chess.history.push(`${moveData.from}-${moveData.to}`);
    state.chess.turn = state.chess.turn === 'white' ? 'black' : 'white';
    
    // Check for basic checkmate/stalemate conditions
    // This is a simplified version - a real implementation would need proper chess logic
    const kings = { white: false, black: false };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = moveData.board[row][col];
        if (piece === 'k') kings.black = true;
        if (piece === 'K') kings.white = true;
      }
    }
    
    if (!kings.white) {
      state.winner = state.players.find(p => p !== action.data.playerId);
      state.status = 'finished';
      return;
    }
    
    if (!kings.black) {
      state.winner = action.data.playerId;
      state.status = 'finished';
      return;
    }
    
    // Switch to next player
    state.turn = this.getNextPlayer(state, action.data.playerId);
    state.turnStartTime = Date.now();
  }

  static async joinGame(redis: RedisClient, postId: string, playerId: string): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    const newState = JSON.parse(JSON.stringify(state));
    
    if (newState.players.includes(playerId)) {
      return newState; // Player already joined
    }
    
    if (newState.players.length >= newState.maxPlayers) {
      throw new Error('Game is full');
    }
    
    newState.players.push(playerId);
    
    // If we have enough players, start the game
    if (newState.players.length === newState.maxPlayers) {
      newState.status = 'active';
      newState.turn = newState.players[0]; // First player starts
      newState.turnStartTime = Date.now();
    }
    
    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  static async changeGame(
    redis: RedisClient,
    postId: string,
    gameType: GameType,
    sessionId: string
  ): Promise<GameState> {
    const state = await this.getGameState(redis, postId);
    const newState = this.createGameSpecificState(gameType, state.maxPlayers);
    
    // Preserve players and session info
    newState.players = state.players;
    newState.username = state.username;
    
    await this.saveGameState(redis, postId, newState);
    return newState;
  }

  static async checkTurnTimer(redis: RedisClient, postId: string): Promise<{ timeRemaining: number, currentTurn: string }> {
    const state = await this.getGameState(redis, postId);
    
    if (state.status !== 'active' || !state.firstMoveMade) {
      return { timeRemaining: 30, currentTurn: state.turn };
    }
    
    const timeElapsed = (Date.now() - state.turnStartTime) / 1000;
    const timeRemaining = Math.max(0, 30 - timeElapsed);
    
    // If time runs out, end the turn and give win to other player
    if (timeRemaining <= 0 && state.players.length === 2) {
      const newState = JSON.parse(JSON.stringify(state));
      newState.winner = state.players.find(p => p !== state.turn);
      newState.status = 'finished';
      await this.saveGameState(redis, postId, newState);
    }
    
    return { 
      timeRemaining: Math.round(timeRemaining), 
      currentTurn: state.turn 
    };
  }
}