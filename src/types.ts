export type GameType = 'tictactoe' | 'gomoku' | 'dots' | 'connect4' | 'chess' | 'reaction';

export type GameAction =
  | {
      type: 'move';
      game: GameType;
      data: {
        playerId: string;
        position: number | [number, number] | string | { face: number; cell: number } | { from: string; to: string; promotion?: string };
        timestamp: number;
      };
    }
  | {
      type: 'changeGame';
      game: GameType;
      sessionId: string;
    }
  | {
      type: 'joinGame';
      playerId: string;
    };

export type GameState = {
  currentGame: GameType;
  // A list of players (their usernames)
  players: string[];
  maxPlayers: number;
  // The current turn's playerId
  turn: string;
  status: 'waiting' | 'active' | 'finished' | 'draw';
  winner?: string;
  // Turn timer for 2-player games
  turnStartTime?: number;
  // Flag to track if first move has been made (for timer)
  firstMoveMade?: boolean;
  // Optional global username (if needed, e.g. for Reaction game or display purposes)
  username?: string;
  // Boards for specific games
  tictactoe: {
    faces: (string | null)[][]; // 6 faces, each with 9 cells
    facesWon: Record<string, number>; // player -> number of faces won
    cubeRotation: { x: number; y: number; z: number };
  };
  gomoku: (string | null)[];
  dots: {
    lines: string[];
    boxes: Record<string, string>;
    gridSize: number;
    scores: Record<string, number>;
  };
  connect4: (string | null)[][];
  chess?: {
    fen: string; // FEN notation for chess position
    gameOver: boolean;
    inCheck: boolean;
    turn: 'white' | 'black';
    history: string[];
  };
  reaction?: {
    // Array of score entries (one per player) for Reaction game
    scores: Array<{ player: string; score: number; avgTime: number; medianTime: number }>;
  };
};