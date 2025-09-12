/** Message from Devvit to the web view. */
export type DevvitMessage =
  | { type: 'initialData'; data: { username: string; currentCounter: number; postId: string } }
  | { type: 'updateCounter'; data: { currentCounter: number } }
  | { type: 'gameState'; data: any }
  | { type: 'error'; code: number; message: string; recoverable: boolean }
  | { type: 'playerJoined'; data: { username: string; playerCount: number; maxPlayers: number; gameState: any } }
  | { type: 'gameStarted'; data: { players: string[]; currentTurn: string; gameState: any } }
  | { type: 'gameUpdate'; data: any }
  | { type: 'turnChanged'; data: { currentTurn: string; nextPlayer: string } }
  | { type: 'gameEnded'; data: { winner?: string; isDraw?: boolean; finalState: any; reason?: string } }
  | { type: 'playerLeft'; data: { username: string; remainingPlayers: string[] } }
  | { type: 'waitingForPlayers'; data: { currentPlayers: string[]; needed: number } }
  | { type: 'moveMade'; data: { player: string; position: any; gameState: any } }
  | { type: 'scoreUpdate'; data: { scores: any[]; newScore: any } }
  | { type: 'timerUpdate'; data: { timeRemaining: number; currentTurn: string } };

/** Message from the web view to Devvit. */
export type WebViewMessage =
  | { type: 'webViewReady' }
  | { type: 'unmount' }
  | { type: 'setCounter'; data: { newCounter: number } }
  | { type: 'initializeGame' }
  | { type: 'joinGame'; data: { username: string } }
  | { type: 'makeMove'; data: { username: string; position: any; gameType: string } }
  | { type: 'leaveGame'; data: { username: string } }
  | { type: 'requestGameState' }
  | { type: 'restartGame' }
  | { type: 'checkTurnTimer' }
  | { type: 'updateScore'; data: { username: string; score: number; avgTime: number; medianTime: number } }
  | { type: 'getReactionScores' };

/**
 * Devvit system message wrapper.
 */
export type DevvitSystemMessage = {
  data: { message: DevvitMessage };
  type?: 'devvit-message' | string;
};