import './createPost.js';
import { Devvit, useState, useWebView } from '@devvit/public-api';
import type { DevvitMessage, WebViewMessage } from './messages';
import { GameAPI } from './api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// Track active webview connections per post and game type
// Structure: Map<postId, Map<gameType, Set<webView>>>
const activeConnections = new Map<string, Map<string, Set<any>>>();

// Broadcast game state to all connected webviews for a post and game type
function broadcastGameState(postId: string, gameType: string, gameState: any, excludeWebView?: any) {
  const postMap = activeConnections.get(postId);
  const gameSet = postMap?.get(gameType);
  if (!gameSet) return;

  // iterate using array copy to allow removal during iteration
  for (const webView of Array.from(gameSet)) {
    if (webView === excludeWebView) continue;
    try {
      webView.postMessage({ type: 'gameState', data: gameState });
    } catch (err) {
      // remove dead webviews
      gameSet.delete(webView);
    }
  }

  // cleanup empty nested maps
  if (gameSet.size === 0) {
    postMap!.delete(gameType);
    if (postMap!.size === 0) activeConnections.delete(postId);
  }
}

// Register webview connection
function registerConnection(postId: string, gameType: string, webView: any) {
  if (!activeConnections.has(postId)) activeConnections.set(postId, new Map());
  const postMap = activeConnections.get(postId)!;
  if (!postMap.has(gameType)) postMap.set(gameType, new Set());
  postMap.get(gameType)!.add(webView);
}

// Unregister webview connection
function unregisterConnection(postId: string, gameType: string, webView: any) {
  const postMap = activeConnections.get(postId);
  if (!postMap) return;
  const gameSet = postMap.get(gameType);
  if (!gameSet) return;
  gameSet.delete(webView);
  if (gameSet.size === 0) postMap.delete(gameType);
  if (postMap.size === 0) activeConnections.delete(postId);
}

// Clean up old sessions periodically
async function cleanupOldSessions(redis: any, postId: string) {
  try {
    const sessionKeys: string[] = await redis.keys(`session:*:${postId}`) ?? [];
    const now = Date.now();
    for (const key of sessionKeys) {
      try {
        const sessionData = await redis.get(key);
        if (!sessionData) continue;
        const parsed = JSON.parse(sessionData);
        const lastActivity = parsed?.lastActivity;
        if (typeof lastActivity === 'number' && now - lastActivity > 24 * 60 * 60 * 1000) {
          await redis.del(key);
        }
      } catch (e) {
        // ignore per-key JSON parse issues
      }
    }
  } catch (error) {
    console.error('Error cleaning up old sessions:', error);
  }
}

// Add a custom post type for Multiplayer Games.
Devvit.addCustomPostType({
  name: 'SocialGrid Games',
  height: 'tall',
  render: (context) => {
    const theme = context.ui.theme;
    const isDark = theme === 'dark';

    const colors = {
      background: isDark ? '#1A1A1B' : '#F6F7F8',
      text: isDark ? '#FFFFFF' : '#1A1A1B',
      cardBg: isDark ? '#272729' : '#FFFFFF',
      border: isDark ? '#343536' : '#EDEFF1',
      primary: '#FF4500',
      secondary: isDark ? '#DAE0E6' : '#878A8C'
    };

    // lazy get username
    const [username] = useState(async () => {
      const name = await context.reddit.getCurrentUsername();
      return name ?? 'anon';
    });

    const [counter, setCounter] = useState(async () => {
      const redisCount = await context.redis.get(`counter_${context.postId}`);
      return Number(redisCount ?? 0);
    });

    const [selectedGame, setSelectedGame] = useState<string | null>(null);

    const getSessionId = (gameType: string): string => {
      return `session:${context.postId}:${gameType}`;
    };

    const getWebViewUrl = (game?: string): string => {
      const g = game ?? selectedGame ?? 'tictactoe';
      switch (g) {
        case 'tictactoe': return 'index_tictactoe.html';
        case 'gomoku': return 'index_gomoku.html';
        case 'dots': return 'index_dots.html';
        case 'connect4': return 'index_connect4.html';
        case 'chess': return 'index_chess.html';
        case 'reaction': return 'index_reaction.html';
        default: return 'index_tictactoe.html';
      }
    };

    const webView = selectedGame
      ? useWebView<WebViewMessage, DevvitMessage>({
          url: getWebViewUrl(),
          async onMessage(message, webViewInstance) {
            // use explicit names to avoid confusion with captured `selectedGame`
            const redis = context.redis;
            const postId = context.postId!;
            
            // Extract gameType and sessionId from message data
            const incomingGameType = message?.data?.gameType as string | undefined;
            const gameType = incomingGameType ?? selectedGame ?? 'tictactoe';
            const sessionIdFromMsg = message?.data?.sessionId as string | undefined;
            const sessionId = sessionIdFromMsg ?? getSessionId(gameType);

            // Update session activity
            try {
              await redis.set(sessionId, JSON.stringify({
                gameType,
                lastActivity: Date.now(),
                postId
              }));
            } catch (e) {
              // not fatal
            }

            // occasional cleanup
            if (Math.random() < 0.1) cleanupOldSessions(redis, postId);

            try {
              switch (message.type) {
                case 'webViewReady': {
                  registerConnection(postId, gameType, webViewInstance);
                  webViewInstance.postMessage({
                    type: 'initialData',
                    data: {
                      username,
                      currentCounter: counter,
                      postId,
                      sessionId,
                      theme: isDark ? 'dark' : 'light',
                    },
                  });
                  break;
                }

                case 'initializeGame': {
                  try {
                    let gameState = await GameAPI.getGameState(redis, sessionId);
                    if (!gameState.currentGame || gameState.currentGame !== gameType) {
                      const maxPlayers = gameType === 'reaction' ? 10 : 2;
                      await GameAPI.initializeGame(redis, sessionId, gameType as any, maxPlayers);
                      gameState = await GameAPI.getGameState(redis, sessionId);
                    }
                    webViewInstance.postMessage({ type: 'gameState', data: gameState });
                    broadcastGameState(postId, gameType, gameState, webViewInstance);
                  } catch (err) {
                    webViewInstance.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to initialize game: ${err instanceof Error ? err.message : String(err)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'joinGame': {
                  try {
                    let gameState = await GameAPI.getGameState(redis, sessionId);
                    const playerName = message?.data?.username ?? username;
                    if (gameState.players.includes(playerName)) {
                      webViewInstance.postMessage({ type: 'gameState', data: gameState });
                      webViewInstance.postMessage({
                        type: 'playerJoined',
                        data: {
                          username: playerName,
                          playerCount: gameState.players.length,
                          maxPlayers: gameState.maxPlayers,
                          gameState,
                        },
                      });
                      broadcastGameState(postId, gameType, gameState, webViewInstance);
                      return;
                    }

                    if (gameState.players.length >= gameState.maxPlayers) {
                      webViewInstance.postMessage({
                        type: 'error',
                        code: 400,
                        message: 'Game is full',
                        recoverable: false,
                      });
                      return;
                    }

                    gameState = await GameAPI.joinGame(redis, sessionId, playerName);

                    webViewInstance.postMessage({
                      type: 'playerJoined',
                      data: {
                        username: playerName,
                        playerCount: gameState.players.length,
                        maxPlayers: gameState.maxPlayers,
                        gameState,
                      },
                    });

                    if (gameState.status === 'active') {
                      webViewInstance.postMessage({
                        type: 'gameStarted',
                        data: {
                          players: gameState.players,
                          currentTurn: gameState.turn,
                          gameState,
                        },
                      });
                    }

                    broadcastGameState(postId, gameType, gameState, webViewInstance);
                  } catch (err) {
                    webViewInstance.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to join game: ${err instanceof Error ? err.message : String(err)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'makeMove': {
                  try {
                    const payload = message.data ?? {};
                    // prefer explicit username passed in payload, otherwise use current reddit user
                    const moveUsername = payload.username ?? username;
                    const position = payload.position;
                    const payloadGameType = payload.gameType ?? gameType;
                    const payloadSessionId = payload.sessionId ?? sessionId;

                    // CRITICAL: Validate gameType matches stored session
                    const storedGameState = await GameAPI.getGameState(redis, payloadSessionId);
                    if (storedGameState.currentGame !== payloadGameType) {
                      webViewInstance.postMessage({
                        type: 'error',
                        code: 400,
                        message: `Action game "${payloadGameType}" does not match stored session game "${storedGameState.currentGame}". Make sure you use the sessionId for the correct game type.`,
                        recoverable: false,
                      });
                      return;
                    }

                    // validate
                    if (!position) {
                      webViewInstance.postMessage({
                        type: 'error',
                        code: 400,
                        message: 'Invalid move payload: missing position',
                        recoverable: false,
                      });
                      return;
                    }

                    // For chess specifically, ensure from/to are provided
                    if (payloadGameType === 'chess') {
                      if (!position.from || !position.to) {
                        webViewInstance.postMessage({
                          type: 'error',
                          code: 400,
                          message: 'Invalid chess move: "from" and "to" are required',
                          recoverable: false,
                        });
                        return;
                      }
                    }

                    // fetch latest state
                    let gameState = await GameAPI.getGameState(redis, payloadSessionId);

                    if (!gameState.players.includes(moveUsername)) {
                      webViewInstance.postMessage({
                        type: 'error',
                        code: 403,
                        message: 'You are not in this game',
                        recoverable: false,
                      });
                      return;
                    }

                    if (gameState.currentGame !== 'reaction' && gameState.turn !== moveUsername) {
                      webViewInstance.postMessage({
                        type: 'error',
                        code: 403,
                        message: `It's not your turn. Current turn: ${gameState.turn}`,
                        recoverable: false,
                      });
                      return;
                    }

                    if (gameState.status !== 'active') {
                      webViewInstance.postMessage({
                        type: 'error',
                        code: 400,
                        message: 'Game is not active',
                        recoverable: false,
                      });
                      return;
                    }

                    const action = {
                      type: 'move' as const,
                      game: payloadGameType,
                      data: {
                        playerId: moveUsername,
                        position,
                        timestamp: Date.now(),
                      },
                    };

                    // Process move via GameAPI
                    const newState = await GameAPI.processMove(redis, payloadSessionId, action);

                    webViewInstance.postMessage({ type: 'gameUpdate', data: newState });
                    webViewInstance.postMessage({
                      type: 'moveMade',
                      data: {
                        player: moveUsername,
                        position,
                        gameState: newState,
                      },
                    });

                    if (newState.status === 'active') {
                      webViewInstance.postMessage({
                        type: 'turnChanged',
                        data: {
                          currentTurn: newState.turn,
                          nextPlayer: newState.turn,
                        },
                      });
                    }

                    if (newState.status === 'finished' || newState.status === 'draw') {
                      webViewInstance.postMessage({
                        type: 'gameEnded',
                        data: {
                          winner: newState.winner,
                          isDraw: newState.status === 'draw',
                          finalState: newState,
                        },
                      });
                    }

                    // broadcast to other webviews
                    broadcastGameState(postId, payloadGameType, newState, webViewInstance);
                  } catch (err) {
                    // provide stack if available for debugging
                    const messageText = err instanceof Error ? `${err.message} ${err.stack ? '\n' + err.stack : ''}` : String(err);
                    webViewInstance.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to make move: ${messageText}`,
                      recoverable: true,
                    });
                    console.error('makeMove error:', err);
                  }
                  break;
                }

                case 'checkTurnTimer': {
                  try {
                    let gameState = await GameAPI.getGameState(redis, sessionId);
                    if (gameState.currentGame === 'reaction' || gameState.status !== 'active' || gameState.players.length < 2 || !gameState.firstMoveMade) return;

                    const currentTime = Date.now();
                    const turnStartTime = gameState.turnStartTime || currentTime;
                    const timeElapsed = currentTime - turnStartTime;
                    const timeRemaining = Math.max(0, 30000 - timeElapsed);

                    if (timeElapsed >= 30000) {
                      const currentPlayerIndex = gameState.players.indexOf(gameState.turn);
                      const otherIndex = currentPlayerIndex === 0 ? 1 : 0;
                      const winner = gameState.players[otherIndex] ?? null;

                      if (winner) {
                        gameState.winner = winner;
                        gameState.status = 'finished';
                        await GameAPI.saveGameState(redis, sessionId, gameState);
                        webViewInstance.postMessage({
                          type: 'gameEnded',
                          data: {
                            winner,
                            isDraw: false,
                            finalState: gameState,
                            reason: 'timeout'
                          },
                        });
                        broadcastGameState(postId, gameType, gameState, webViewInstance);
                      }
                    } else {
                      webViewInstance.postMessage({
                        type: 'timerUpdate',
                        data: {
                          timeRemaining: Math.ceil(timeRemaining / 1000),
                          currentTurn: gameState.turn
                        },
                      });
                    }
                  } catch (err) {
                    // non-fatal
                    console.warn('checkTurnTimer error', err);
                  }
                  break;
                }

                case 'restartGame': {
                  try {
                    const gType = message?.data?.gameType ?? gameType;
                    const maxPlayers = gType === 'reaction' ? 10 : 2;
                    await GameAPI.initializeGame(redis, sessionId, gType, maxPlayers);
                    const newState = await GameAPI.getGameState(redis, sessionId);
                    webViewInstance.postMessage({ type: 'gameState', data: newState });
                    broadcastGameState(postId, gType, newState, webViewInstance);
                  } catch (err) {
                    webViewInstance.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to restart game: ${err instanceof Error ? err.message : String(err)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'requestGameState': {
                  try {
                    const sId = message?.data?.sessionId ?? sessionId;
                    const gs = await GameAPI.getGameState(redis, sId);
                    webViewInstance.postMessage({ type: 'gameState', data: gs });
                  } catch (err) {
                    webViewInstance.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to get game state: ${err instanceof Error ? err.message : String(err)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'updateScore': {
                  try {
                    const { score, avgTime, medianTime } = message.data ?? {};
                    const scoreData = { username, score, avgTime, medianTime, timestamp: Date.now() };
                    const existing = await redis.get(`reaction_scores_${sessionId}`);
                    const scores = existing ? JSON.parse(existing) : [];
                    scores.push(scoreData);
                    if (scores.length > 100) scores.splice(0, scores.length - 100);
                    await redis.set(`reaction_scores_${sessionId}`, JSON.stringify(scores));
                    webViewInstance.postMessage({ type: 'scoreUpdate', data: { scores, newScore: scoreData } });

                    const otherSet = activeConnections.get(postId)?.get('reaction');
                    if (otherSet) {
                      for (const otherView of Array.from(otherSet)) {
                        if (otherView === webViewInstance) continue;
                        try {
                          otherView.postMessage({ type: 'scoreUpdate', data: { scores, newScore: scoreData } });
                        } catch (err) {
                          otherSet.delete(otherView);
                        }
                      }
                    }
                  } catch (err) {
                    webViewInstance.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to update score: ${err instanceof Error ? err.message : String(err)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'getReactionScores': {
                  try {
                    const existing = await redis.get(`reaction_scores_${sessionId}`);
                    const scores = existing ? JSON.parse(existing) : [];
                    webViewInstance.postMessage({ type: 'scoreUpdate', data: { scores, newScore: null } });
                  } catch (err) {
                    // ignore
                  }
                  break;
                }

                case 'setCounter': {
                  try {
                    const newCounter = Number(message.data?.newCounter ?? 0);
                    await context.redis.set(`counter_${context.postId}`, String(newCounter));
                    setCounter(newCounter);
                    webViewInstance.postMessage({ type: 'updateCounter', data: { currentCounter: newCounter } });
                  } catch (err) {
                    webViewInstance.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to set counter: ${err instanceof Error ? err.message : String(err)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'unmount': {
                  try {
                    // Use the gameType from the message data if available, otherwise fall back to selectedGame
                    const unmountGameType = message?.data?.gameType ?? selectedGame ?? gameType;
                    unregisterConnection(postId, unmountGameType, webViewInstance);
                    webViewInstance.unmount();
                  } catch (err) { /* ignore */ }
                  break;
                }

                default:
                  console.warn('Unknown message type:', message?.type);
              }
            } catch (err) {
              // any unexpected server error
              const messageText = err instanceof Error ? `${err.message} ${err.stack ? '\n' + err.stack : ''}` : String(err);
              webViewInstance.postMessage({
                type: 'error',
                code: 500,
                message: `Server error: ${messageText}`,
                recoverable: true,
              });
              console.error('onMessage error:', err);
            }
          },
          onUnmount() {
            // on unmount we might not know which gameType this instance used; try to remove from all sets for this post
            const postMap = activeConnections.get(context.postId!);
            if (postMap) {
              for (const [gType, setOfViews] of postMap.entries()) {
                if (setOfViews.has(webView)) setOfViews.delete(webView);
                if (setOfViews.size === 0) postMap.delete(gType);
              }
              if (postMap.size === 0) activeConnections.delete(context.postId!);
            }
            context.ui.showToast('Web view closed!');
          },
        })
      : null;

    // Render UI (kept largely the same, with the Back button fixed)
    return (
      <blocks>
        <vstack grow padding="small" backgroundColor={colors.background}>
          <vstack grow alignment="middle center">
            <text size="xlarge" weight="bold" color={colors.text} fontFamily="Roboto">
              🎮 SocialGrid Games 🎮
            </text>
            <text size="medium" color={colors.secondary} fontFamily="Open Sans">
              Multiplayer Games for Reddit
            </text>
            <spacer />

            <vstack backgroundColor={colors.cardBg} padding="medium" cornerRadius="medium" border={`1px solid ${colors.border}`}>
              <hstack gap="small" alignment="center middle">
                <text size="medium" fontFamily="Open Sans" color={colors.secondary}>🧑‍💻 Player:</text>
                <text size="medium" weight="bold" fontFamily="Open Sans" color={colors.primary}>{username ?? ''}</text>
              </hstack>
              <hstack gap="small" alignment="center middle">
                <text size="medium" fontFamily="Open Sans" color={colors.secondary}>📊 Interactions:</text>
                <text size="medium" weight="bold" fontFamily="Open Sans" color={colors.primary}>{counter ?? ''}</text>
              </hstack>
            </vstack>

            <spacer />

            {!selectedGame ? (
              <vstack alignment="middle center" gap="large">
                <text size="large" weight="bold" fontFamily="Roboto" color={colors.text}>
                  🎯 Choose Your Game
                </text>
                <text size="medium" fontFamily="Open Sans" color={colors.secondary} textAlign="center">
                  Select a game to challenge other Reddit users!
                </text>

                <vstack gap="medium" width="100%">
                  <hstack gap="medium" width="100%" alignment="center middle">
                    <button appearance="primary" onPress={() => setSelectedGame('tictactoe')} size="large" textColor="#ffffff" backgroundColor="#FF6B6B" cornerRadius="medium">⭕ Tic Tac Toe (2P)</button>
                    <button appearance="primary" onPress={() => setSelectedGame('gomoku')} size="large" textColor="#ffffff" backgroundColor="#4ECDC4" cornerRadius="medium">⚫ Gomoku (2P)</button>
                  </hstack>
                  <hstack gap="medium" width="100%" alignment="center middle">
                    <button appearance="primary" onPress={() => setSelectedGame('connect4')} size="large" textColor="#ffffff" backgroundColor="#45B7D1" cornerRadius="medium">🔴 Connect Four (2P)</button>
                    <button appearance="primary" onPress={() => setSelectedGame('dots')} size="large" textColor="#ffffff" backgroundColor="#9B59B6" cornerRadius="medium">📦 Dots & Boxes (2P)</button>
                  </hstack>
                  <hstack gap="medium" width="100%" alignment="center middle">
                    <button appearance="primary" onPress={() => setSelectedGame('chess')} size="large" textColor="#ffffff" backgroundColor="#8B4513" cornerRadius="medium">♛ Chess (2P)</button>
                    <button appearance="primary" onPress={() => setSelectedGame('reaction')} size="large" textColor="#ffffff" backgroundColor="#F7DC6F" cornerRadius="medium">⚡ Reaction Speed</button>
                  </hstack>
                </vstack>

                <vstack gap="none" alignment="center middle">
                  <text size="small" fontFamily="Open Sans" color={colors.secondary} textAlign="center">
                    💡 Tip: 30 seconds per turn after first move!
                  </text>
                  <text size="small" fontFamily="Open Sans" color={colors.secondary} textAlign="center">
                    Reaction game: 20 seconds per game!
                  </text>
                </vstack>
              </vstack>
            ) : (
              <vstack alignment="middle center" gap="medium" backgroundColor={colors.cardBg} padding="large" cornerRadius="medium" border={`2px solid ${colors.primary}`}>
                <text size="large" weight="bold" fontFamily="Roboto" color={colors.text}>
                  🎮 {selectedGame.charAt(0).toUpperCase() + selectedGame.slice(1)}
                </text>
                <text size="medium" fontFamily="Open Sans" color={colors.secondary} textAlign="center">
                  {selectedGame === 'reaction' ? 'Click to start playing!' : 'Join to play - Wait for another player to join'}
                </text>
                <text size="small" fontFamily="Open Sans" color={colors.secondary} textAlign="center">
                  {selectedGame === 'reaction' ? '⏱️ 20 seconds per game' : '⏱️ 30 seconds per turn after first move'}
                </text>
                <hstack gap="medium">
                  <button appearance="primary" onPress={() => webView?.mount()} size="large" textColor="#ffffff" backgroundColor="#28a745" cornerRadius="medium">🚀 Join Game</button>
                  <button appearance="secondary" onPress={() => setSelectedGame(null)} size="large" textColor="#ffffff" backgroundColor="#dc3545" cornerRadius="medium">⬅️ Back</button>
                </hstack>
              </vstack>
            )}
          </vstack>
        </vstack>
      </blocks>
    );
  },
});

export default Devvit;