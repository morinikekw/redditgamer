/** Message from Devvit to the web view. */
export type DevvitMessage =
  | { type: 'initialData'; data: { username: string; currentCounter: number; postId: string; sessionId: string; theme?: string } }
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
  | { type: 'webViewReady'; data?: { gameType?: string; sessionId?: string } }
  | { type: 'unmount'; data?: { gameType?: string; sessionId?: string } }
  | { type: 'setCounter'; data: { newCounter: number; gameType?: string; sessionId?: string } }
  | { type: 'initializeGame'; data?: { gameType?: string; sessionId?: string } }
  | { type: 'joinGame'; data: { username: string; gameType?: string; sessionId?: string } }
  | { type: 'makeMove'; data: { username: string; position: any; gameType: string; sessionId?: string; promotion?: string } }
  | { type: 'leaveGame'; data: { username: string; gameType?: string; sessionId?: string } }
  | { type: 'requestGameState'; data?: { gameType?: string; sessionId?: string } }
  | { type: 'restartGame'; data?: { gameType?: string; sessionId?: string } }
  | { type: 'checkTurnTimer'; data?: { gameType?: string; sessionId?: string } }
  | { type: 'updateScore'; data: { username: string; score: number; avgTime: number; medianTime: number; gameType?: string; sessionId?: string } }
  | { type: 'getReactionScores'; data?: { gameType?: string; sessionId?: string } };

/**
 * Devvit system message wrapper.
 */
export type DevvitSystemMessage = {
  data: { message: DevvitMessage };
  type?: 'devvit-message' | string;
};