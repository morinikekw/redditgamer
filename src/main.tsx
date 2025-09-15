import './createPost.js';
import { Devvit, useState, useWebView } from '@devvit/public-api';
import type { DevvitMessage, WebViewMessage } from './messages';
import { GameAPI } from './api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// Track active webview connections per post
const activeConnections = new Map<string, Set<any>>();

// Broadcast game state to all connected webviews for a post
function broadcastGameState(postId: string, gameState: any, excludeWebView?: any) {
  const connections = activeConnections.get(postId);
  if (connections) {
    connections.forEach(webView => {
      if (webView !== excludeWebView) {
        try {
          webView.postMessage({
            type: 'gameState',
            data: gameState,
          });
        } catch (error) {
          // Remove dead connections
          connections.delete(webView);
        }
      }
    });
  }
}

// Register webview connection
function registerConnection(postId: string, webView: any) {
  if (!activeConnections.has(postId)) {
    activeConnections.set(postId, new Set());
  }
  activeConnections.get(postId)!.add(webView);
}

// Unregister webview connection
function unregisterConnection(postId: string, webView: any) {
  const connections = activeConnections.get(postId);
  if (connections) {
    connections.delete(webView);
    if (connections.size === 0) {
      activeConnections.delete(postId);
    }
  }
}

// Add a custom post type for Multiplayer Games.
Devvit.addCustomPostType({
  name: 'SocialGrid Games',
  height: 'tall',
  render: (context) => {
    const theme = context.ui.theme; // Get current theme
    const isDark = theme === 'dark';
    
    // Theme-aware colors
    const colors = {
      background: isDark ? '#1A1A1B' : '#F6F7F8',
      text: isDark ? '#FFFFFF' : '#1A1A1B',
      cardBg: isDark ? '#272729' : '#FFFFFF',
      border: isDark ? '#343536' : '#EDEFF1',
      primary: '#FF4500', // Reddit orange works in both themes
      secondary: isDark ? '#DAE0E6' : '#878A8C'
    };

    // Load the actual Reddit username once.
    const [username] = useState(async () => {
      const name = await context.reddit.getCurrentUsername();
      return name ?? 'anon';
    });

    // Load a counter (or other state) from Redis.
    const [counter, setCounter] = useState(async () => {
      const redisCount = await context.redis.get(`counter_${context.postId}`);
      return Number(redisCount ?? 0);
    });

    // Local state for which game is selected.
    const [selectedGame, setSelectedGame] = useState<string | null>(null);

    // Map the selected game to its dedicated web view HTML file.
    const getWebViewUrl = (): string => {
      switch (selectedGame) {
        case 'tictactoe':
          return 'index_tictactoe.html';
        case 'gomoku':
          return 'index_gomoku.html';
        case 'dots':
          return 'index_dots.html';
        case 'connect4':
          return 'index_connect4.html';
        case 'chess':
          return 'index_chess.html';
        case 'reaction':
          return 'index_reaction.html';
        default:
          return 'index_tictactoe.html';
      }
    };

    // Create the web view only after a game is selected.
    const webView = selectedGame
      ? useWebView<WebViewMessage, DevvitMessage>({
          url: getWebViewUrl(),
          async onMessage(message, webView) {
            const { redis } = context;
            const postId = context.postId!;

            // console.log('Received message:', message.type, message);

            try {
              switch (message.type) {
                case 'webViewReady':
                  // console.log('WebView ready, sending initial data...');
                  
                  // Register this webview connection
                  registerConnection(postId, webView);
                  
                  // Send initial data to webview
                  webView.postMessage({
                    type: 'initialData',
                    data: {
                      username,
                      currentCounter: counter,
                      postId,
                      theme: isDark ? 'dark' : 'light' // Pass theme to webview
                    },
                  });
                  break;

                case 'initializeGame': {
                  // console.log(`Initializing ${selectedGame} game...`);
                  
                  try {
                    // Always get fresh game state from Redis
                    let gameState = await GameAPI.getGameState(redis, postId);
                    
                    // If no game exists or wrong game type, initialize new game
                    if (!gameState.currentGame || gameState.currentGame !== selectedGame) {
                      const gameType = selectedGame as any;
                      const maxPlayers = gameType === 'reaction' ? 10 : 2;
                      await GameAPI.initializeGame(redis, postId, gameType, maxPlayers);
                      gameState = await GameAPI.getGameState(redis, postId);
                      // console.log('Game initialized:', gameState);
                    }

                    // Send current game state to this webview
                    webView.postMessage({
                      type: 'gameState',
                      data: gameState,
                    });
                    
                    // Broadcast to other connected webviews
                    broadcastGameState(postId, gameState, webView);
                  } catch (error) {
                    // console.error('Error initializing game:', error);
                    webView.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to initialize game: ${error instanceof Error ? error.message : String(error)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'joinGame': {
                  console.log(`Player ${username} attempting to join game`);
                  
                  try {
                    // Always get fresh game state from Redis before processing join
                    let gameState = await GameAPI.getGameState(redis, postId);
                    
                    // Check if player is already in the game
                    if (gameState.players.includes(username)) {
                      // console.log(`Player ${username} already in game`);
                      
                      // Send updated game state to confirm they're in the game
                      webView.postMessage({
                        type: 'gameState',
                        data: gameState,
                      });
                      
                      // Also send playerJoined confirmation
                      webView.postMessage({
                        type: 'playerJoined',
                        data: {
                          username,
                          playerCount: gameState.players.length,
                          maxPlayers: gameState.maxPlayers,
                          gameState,
                        },
                      });
                      
                      // Broadcast to other connected webviews
                      broadcastGameState(postId, gameState, webView);
                      return;
                    }

                    // Check if game is full
                    if (gameState.players.length >= gameState.maxPlayers) {
                      webView.postMessage({
                        type: 'error',
                        code: 400,
                        message: 'Game is full',
                        recoverable: false,
                      });
                      return;
                    }

                    // Use GameAPI.joinGame for proper state management
                    gameState = await GameAPI.joinGame(redis, postId, username);

                    // console.log(`Player ${username} joined. Players: ${gameState.players.length}/${gameState.maxPlayers}`);

                    // Send updated game state to this webview
                    webView.postMessage({
                      type: 'playerJoined',
                      data: {
                        username,
                        playerCount: gameState.players.length,
                        maxPlayers: gameState.maxPlayers,
                        gameState,
                      },
                    });

                    // Send game started message if applicable
                    if (gameState.status === 'active') {
                      webView.postMessage({
                        type: 'gameStarted',
                        data: {
                          players: gameState.players,
                          currentTurn: gameState.turn,
                          gameState,
                        },
                      });
                    }
                    
                    // Broadcast to all connected webviews
                    broadcastGameState(postId, gameState, webView);
                  } catch (error) {
                    console.error('Error joining game:', error);
                    webView.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to join game: ${error instanceof Error ? error.message : String(error)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'makeMove': {
                  // console.log(`Move attempt by ${username}:`, message.data);
                  
                  try {
                    const { position, gameType, username: moveUsername } = message.data;
                    // Always get fresh game state from Redis
                    let gameState = await GameAPI.getGameState(redis, postId);

                    // Validate player is in the game
                    if (!gameState.players.includes(moveUsername || username)) {
                      webView.postMessage({
                        type: 'error',
                        code: 403,
                        message: 'You are not in this game',
                        recoverable: false,
                      });
                      return;
                    }

                    // Validate it's the player's turn (except for reaction game)
                    if (gameState.currentGame !== 'reaction' && gameState.turn !== (moveUsername || username)) {
                      webView.postMessage({
                        type: 'error',
                        code: 403,
                        message: `It's not your turn. Current turn: ${gameState.turn}`,
                        recoverable: false,
                      });
                      return;
                    }

                    // Validate game is active
                    if (gameState.status !== 'active') {
                      webView.postMessage({
                        type: 'error',
                        code: 400,
                        message: 'Game is not active',
                        recoverable: false,
                      });
                      return;
                    }

                    // Process the move
                    const action = {
                      type: 'move' as const,
                      game: gameType,
                      data: {
                        playerId: moveUsername || username,
                        position,
                        timestamp: Date.now(),
                      },
                    };

                    gameState = await GameAPI.processMove(redis, postId, action);
                    

                    /* console.log(`Move processed. New state:`, {
                      turn: gameState.turn,
                      status: gameState.status,
                      winner: gameState.winner
                    });
*/
                    // Send updated game state to this webview
                    webView.postMessage({
                      type: 'gameUpdate',
                      data: gameState,
                    });

                    // Send move notification to this webview
                    webView.postMessage({
                      type: 'moveMade',
                      data: {
                        player: moveUsername || username,
                        position,
                        gameState: gameState,
                      },
                    });

                    // Notify about turn change if game is still active
                    if (gameState.status === 'active') {
                      webView.postMessage({
                        type: 'turnChanged',
                        data: {
                          currentTurn: gameState.turn,
                          nextPlayer: gameState.turn,
                        },
                      });
                    }

                    // Notify if game ended
                    if (gameState.status === 'finished' || gameState.status === 'draw') {
                      webView.postMessage({
                        type: 'gameEnded',
                        data: {
                          winner: gameState.winner,
                          isDraw: gameState.status === 'draw',
                          finalState: gameState,
                        },
                      });
                    }
                    
                    // Broadcast to all connected webviews
                    broadcastGameState(postId, gameState, webView);
                  } catch (error) {
                    // console.error('Error making move:', error);
                    webView.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to make move: ${error instanceof Error ? error.message : String(error)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'checkTurnTimer': {
                  try {
                    // Always get fresh game state from Redis
                    let gameState = await GameAPI.getGameState(redis, postId);
                    
                    // Only check timer for 2-player games that are active and first move made
                    if (gameState.currentGame === 'reaction' || gameState.status !== 'active' || gameState.players.length < 2 || !gameState.firstMoveMade) {
                      return;
                    }

                    const currentTime = Date.now();
                    const turnStartTime = gameState.turnStartTime || currentTime;
                    const timeElapsed = currentTime - turnStartTime;
                    const timeRemaining = Math.max(0, 30000 - timeElapsed); // 30 seconds

                    // If time is up, declare the other player as winner
                    if (timeElapsed >= 30000) {
                      const currentPlayerIndex = gameState.players.indexOf(gameState.turn);
                      const otherPlayerIndex = currentPlayerIndex === 0 ? 1 : 0;
                      const winner = gameState.players[otherPlayerIndex];
                      
                      gameState.winner = winner;
                      gameState.status = 'finished';
                      
                      await GameAPI.saveGameState(redis, postId, gameState);
                      
                      // Send to this webview
                      webView.postMessage({
                        type: 'gameEnded',
                        data: {
                          winner,
                          isDraw: false,
                          finalState: gameState,
                          reason: 'timeout'
                        },
                      });
                      
                      // Broadcast to all connected webviews
                      broadcastGameState(postId, gameState, webView);
                    } else {
                      // Send timer update
                      webView.postMessage({
                        type: 'timerUpdate',
                        data: {
                          timeRemaining: Math.ceil(timeRemaining / 1000),
                          currentTurn: gameState.turn
                        },
                      });
                    }
                  } catch (error) {
                    // console.error('Error checking turn timer:', error);
                  }
                  break;
                }

                case 'restartGame': {
                  try {
                    // console.log(`Restarting ${selectedGame} game...`);
                    
                    // Initialize new game state
                    const gameType = selectedGame as any;
                    const maxPlayers = gameType === 'reaction' ? 10 : 2;
                    await GameAPI.initializeGame(redis, postId, gameType, maxPlayers);
                    let gameState = await GameAPI.getGameState(redis, postId);
                    
                    // Send new game state to this webview
                    webView.postMessage({
                      type: 'gameState',
                      data: gameState,
                    });
                    
                    // Broadcast to all connected webviews
                    broadcastGameState(postId, gameState, webView);
                  } catch (error) {
                    // console.error('Error restarting game:', error);
                    webView.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to restart game: ${error instanceof Error ? error.message : String(error)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'requestGameState': {
                  try {
                    // Always get fresh game state from Redis
                    let gameState = await GameAPI.getGameState(redis, postId);
                    webView.postMessage({
                      type: 'gameState',
                      data: gameState,
                    });
                  } catch (error) {
                    // console.error('Error requesting game state:', error);
                    webView.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to get game state: ${error instanceof Error ? error.message : String(error)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'updateScore': {
                  try {
                    // For Reaction game, update scores in Redis
                    const { score, avgTime, medianTime } = message.data;
                    const scoreData = { username, score, avgTime, medianTime, timestamp: Date.now() };
                    
                    // Get existing scores
                    const existingScores = await redis.get(`reaction_scores_${postId}`);
                    const scores = existingScores ? JSON.parse(existingScores) : [];
                    
                    // Add new score
                    scores.push(scoreData);
                    
                    // Keep only last 100 scores to prevent unlimited growth
                    if (scores.length > 100) {
                      scores.splice(0, scores.length - 100);
                    }
                    
                    await redis.set(`reaction_scores_${postId}`, JSON.stringify(scores));
                    
                    // Send score update to this webview
                    webView.postMessage({
                      type: 'scoreUpdate',
                      data: { 
                        scores,
                        newScore: scoreData,
                      },
                    });
                    
                    // Broadcast score update to other connected webviews
                    const connections = activeConnections.get(postId);
                    if (connections) {
                      connections.forEach(otherWebView => {
                        if (otherWebView !== webView) {
                          try {
                            otherWebView.postMessage({
                              type: 'scoreUpdate',
                              data: { 
                                scores,
                                newScore: scoreData,
                              },
                            });
                          } catch (error) {
                            connections.delete(otherWebView);
                          }
                        }
                      });
                    }
                  } catch (error) {
                    // console.error('Error updating score:', error);
                    webView.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to update score: ${error instanceof Error ? error.message : String(error)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'getReactionScores': {
                  try {
                    // Get existing scores for reaction game
                    const existingScores = await redis.get(`reaction_scores_${postId}`);
                    const scores = existingScores ? JSON.parse(existingScores) : [];
                    
                    webView.postMessage({
                      type: 'scoreUpdate',
                      data: { 
                        scores,
                        newScore: null,
                      },
                    });
                  } catch (error) {
                    // console.error('Error getting reaction scores:', error);
                  }
                  break;
                }

                case 'setCounter': {
                  try {
                    await context.redis.set(`counter_${context.postId}`, message.data.newCounter.toString());
                    setCounter(message.data.newCounter);
                    webView.postMessage({
                      type: 'updateCounter',
                      data: { currentCounter: message.data.newCounter },
                    });
                  } catch (error) {
                    // console.error('Error setting counter:', error);
                    webView.postMessage({
                      type: 'error',
                      code: 500,
                      message: `Failed to set counter: ${error instanceof Error ? error.message : String(error)}`,
                      recoverable: true,
                    });
                  }
                  break;
                }

                case 'unmount':
                  // Unregister this webview connection
                  unregisterConnection(postId, webView);
                  webView.unmount();
                  break;

                default:
                  // console.warn(`Unknown message type:`, message);
              }
            } catch (error) {
              // console.error('Error handling message:', error);
              webView.postMessage({
                type: 'error',
                code: 500,
                message: `Server error: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true,
              });
            }
          },
          onUnmount() {
            // Unregister this webview connection
            unregisterConnection(context.postId!, webView);
            context.ui.showToast('Web view closed!');
          },
        })
      : null;

    return (
      <blocks>
        <vstack
          grow
          padding="small"
          backgroundColor={colors.background}
        >
          <vstack grow alignment="middle center">
            {/* Enhanced Title */}
            <text
              size="xlarge"
              weight="bold"
              color={colors.text}
              textShadow={isDark ? "2px 2px 4px rgba(0, 0, 0, 0.5)" : "2px 2px 4px rgba(0, 0, 0, 0.2)"}
              fontFamily="Roboto"
            >
              🎮 SocialGrid Games 🎮
            </text>
            <text
              size="medium"
              color={colors.secondary}
              fontFamily="Open Sans"
            >
              Multiplayer Games for Reddit
            </text>
            <spacer />
            
            {/* Enhanced User Info Card */}
            <vstack
              backgroundColor={colors.cardBg}
              padding="medium"
              cornerRadius="medium"
              shadow={isDark ? "0px 4px 12px rgba(0, 0, 0, 0.3)" : "0px 4px 12px rgba(0, 0, 0, 0.15)"}
              border={`1px solid ${colors.border}`}
            >
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
                
                {/* Enhanced Game Selection Grid */}
                <vstack gap="medium" width="100%">
                  <hstack gap="medium" width="100%" alignment="center middle">
                    <button
                      appearance="primary"
                      onPress={() => setSelectedGame('tictactoe')}
                      size="large"
                      textColor="#ffffff"
                      backgroundColor="#FF6B6B"
                      cornerRadius="medium"
                      shadow="0px 3px 8px rgba(255, 107, 107, 0.3)"
                    >
                      ⭕ Tic Tac Toe (2P)
                    </button>
                    <button
                      appearance="primary"
                      onPress={() => setSelectedGame('gomoku')}
                      size="large"
                      textColor="#ffffff"
                      backgroundColor="#4ECDC4"
                      cornerRadius="medium"
                      shadow="0px 3px 8px rgba(78, 205, 196, 0.3)"
                    >
                      ⚫ Gomoku (2P)
                    </button>
                  </hstack>
                  <hstack gap="medium" width="100%" alignment="center middle">
                    <button
                      appearance="primary"
                      onPress={() => setSelectedGame('connect4')}
                      size="large"
                      textColor="#ffffff"
                      backgroundColor="#45B7D1"
                      cornerRadius="medium"
                      shadow="0px 3px 8px rgba(69, 183, 209, 0.3)"
                    >
                      🔴 Connect Four (2P)
                    </button>
                    <button
                      appearance="primary"
                      onPress={() => setSelectedGame('dots')}
                      size="large"
                      textColor="#ffffff"
                      backgroundColor="#9B59B6"
                      cornerRadius="medium"
                      shadow="0px 3px 8px rgba(155, 89, 182, 0.3)"
                    >
                      📦 Dots & Boxes (2P)
                    </button>
                  </hstack>
                  <hstack gap="medium" width="100%" alignment="center middle">
                    <button
                      appearance="primary"
                      onPress={() => setSelectedGame('chess')}
                      size="large"
                      textColor="#ffffff"
                      backgroundColor="#8B4513"
                      cornerRadius="medium"
                      shadow="0px 3px 8px rgba(139, 69, 19, 0.3)"
                    >
                      ♛ Chess (2P)
                    </button>
                    <button
                      appearance="primary"
                      onPress={() => setSelectedGame('reaction')}
                      size="large"
                      textColor="#ffffff"
                      backgroundColor="#F7DC6F"
                      cornerRadius="medium"
                      shadow="0px 3px 8px rgba(247, 220, 111, 0.3)"
                    >
                      ⚡ Reaction Speed
                    </button>
                  </hstack>
                </vstack>
                
                {/* Improved responsive tip text */}
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
              <vstack
                alignment="middle center"
                gap="medium"
                backgroundColor={colors.cardBg}
                padding="large"
                cornerRadius="medium"
                border={`2px solid ${colors.primary}`}
                shadow={isDark ? "0px 6px 16px rgba(0, 0, 0, 0.3)" : "0px 6px 16px rgba(0, 0, 0, 0.2)"}
              >
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
                  <button 
                    appearance="primary" 
                    onPress={() => webView?.mount()}
                    size="large"
                    textColor="#ffffff"
                    backgroundColor="#28a745"
                    cornerRadius="medium"
                    shadow="0px 3px 8px rgba(40, 167, 69, 0.3)"
                  >
                    🚀 Join Game
                  </button>
                  <button
                    appearance="secondary"
                    onPress={() => setSelectedGame(null)}
                    size="large"
                    textColor="#ffffff"
                    backgroundColor="#dc3545"
                    cornerRadius="medium"
                    shadow="0px 3px 8px rgba(220, 53, 69, 0.3)"
                  >
                    ⬅️ Back
                  </button>
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
