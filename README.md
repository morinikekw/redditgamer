# SocialGrid Games - Multiplayer Reddit Games

A comprehensive multiplayer gaming platform built for Reddit using Devvit. Play classic games with other Reddit users in real-time!

## 🎮 Available Games

### 1. **Tic Tac Toe** ⭕
- **Players:** 2
- **Objective:** Get three in a row (horizontal, vertical, or diagonal)
- **How to Play:** Click on empty squares to place your symbol (X or O)
- **Timer:** 30 seconds per turn after first move
- **3D Experience:** Interactive 3D cube with 6 faces - win by conquering 4 out of 6 faces! Drag to rotate camera, Shift+Drag to rotate cube.

### 2. **Gomoku** ⚫
- **Players:** 2  
- **Objective:** Get five stones in a row on a 15×15 board
- **How to Play:** Click on intersections to place your stone (Black or White)
- **Timer:** 30 seconds per turn after first move
- **3D Experience:** Beautiful 3D board with glass-like stones. Drag-and-drop stones or tap to place. Camera orbits automatically when idle.

### 3. **Connect Four** 🔴
- **Players:** 2
- **Objective:** Connect four discs in a row (horizontal, vertical, or diagonal)
- **How to Play:** Click on columns to drop your disc (Red or Yellow)
- **Timer:** 30 seconds per turn after first move
- **3D Experience:** Stunning glass board with glowing discs that drop with realistic physics and particle effects.

### 4. **Chess** ♛
- **Players:** 2
- **Objective:** Checkmate your opponent's king
- **How to Play:** Drag and drop pieces to make moves (White moves first)
- **Timer:** 30 seconds per turn after first move
- **3D Experience:** Elegant 3D chess set with detailed piece models. Click to select pieces and see legal moves highlighted.

### 5. **Dots & Boxes** 📦
- **Players:** 2
- **Objective:** Complete more boxes than your opponent by drawing lines between dots
- **How to Play:** Click two adjacent dots to draw a line. Complete a box to score and get another turn!
- **Timer:** 30 seconds per turn after first move
- **3D Experience:** Interactive 3D grid where you select dots to create lines and form boxes with visual feedback.
### 6. **Reaction Speed** ⚡
- **Players:** Unlimited (individual scores)
- **Objective:** Click highlighted squares as fast as possible
- **How to Play:** Click "Start Game" and tap green squares for 20 seconds
- **Leaderboard:** Compete with other Reddit users for the fastest reaction times
- **3D Experience:** Dynamic 3D grid with glowing cubes, particle effects, and smooth camera movements. Cubes pulse and animate when active.

## 🚀 How to Play

### Getting Started
1. **Find a SocialGrid Games post** on Reddit
2. **Choose your game** from the main menu
3. **Click "Join Game"** to enter the game lobby
4. **Wait for another player** (for 2-player games) or start immediately (Reaction Speed)
5. **Play and have fun!**

### Game Features
- ✅ **Real-time multiplayer** - Play with other Reddit users
- ✅ **Live game state synchronization** - All players see moves instantly without refreshing
- ✅ **Auto-refresh** - Games update every 3 seconds automatically
- ✅ **Turn timers** - 30-second countdown per turn (after first move)
- ✅ **Win/Loss celebrations** - Beautiful popups for game endings
- ✅ **Mobile responsive** - Perfect on all devices
- ✅ **Live leaderboards** - For Reaction Speed game
- ✅ **Session persistence** - Rejoin games even after closing the webview
- ✅ **Full 3D immersive experience** - Interactive 3D environments for all games

### Navigation Tips
- **Main Menu:** Shows all available games with player counts
- **Game Lobby:** Displays current players and game status
- **In-Game:** Shows whose turn it is and remaining time
- **After Game:** Option to play again or return to menu

## 🌟 Full 3D Experience Details

### Interactive 3D Elements
- **Camera Controls:** Drag to rotate camera view around the game board
- **Zoom:** Mouse wheel or pinch to zoom in/out for better viewing angles
- **Touch Support:** Full touch controls for mobile devices with tap vs. drag detection
- **Visual Feedback:** Hover effects, selection highlights, and move animations
- **Particle Effects:** Celebration bursts, error ripples, and ambient particles
- **Realistic Physics:** Pieces drop with gravity, bounce effects, and smooth transitions

### Game-Specific 3D Features
- **Tic Tac Toe:** Rotate the cube itself (Shift+Drag) to see all 6 faces
- **Gomoku:** Drag-and-drop stone placement with preview stones
- **Connect Four:** Watch discs fall through glass tubes with glowing effects
- **Chess:** Detailed 3D piece models with legal move highlighting
- **Dots & Boxes:** Click dots to select and create lines with visual feedback
- **Reaction Speed:** Dynamic cube grid with pulsing animations and particle bursts

### Visual Polish
- **Lighting:** Dynamic lighting systems with multiple colored lights
- **Materials:** Glass, metal, and emissive materials for realistic appearance
- **Shadows:** Real-time shadow casting for depth perception
- **Post-Processing:** Fog effects and atmospheric rendering
- **Animations:** Smooth transitions, scaling effects, and celebration sequences
## 🎯 Game Rules & Tips

### Tic Tac Toe
- First player gets X, second player gets O
- Make strategic moves to block your opponent
- Center square is often the best opening move
- **3D Strategy:** Consider all 6 faces - winning 4 faces wins the game!

### Gomoku
- Black stones move first
- No restrictions on moves (freestyle rules)
- Think several moves ahead to create multiple threats
- **3D Tip:** Use drag-and-drop for precise stone placement

### Connect Four
- Red discs move first
- Discs fall to the lowest available position
- Look for opportunities to create multiple winning threats
- **3D Advantage:** Better depth perception helps spot diagonal wins

### Chess
- Standard chess rules apply
- White pieces move first
- Pieces move according to traditional chess rules
- Game ends with checkmate, stalemate, or timeout
- **3D Benefits:** Rotate camera to see the board from your opponent's perspective

### Dots & Boxes
- Players take turns drawing lines between adjacent dots
- Complete a box by drawing its fourth side to score a point
- Get another turn when you complete a box
- Player with the most boxes wins
- **3D Strategy:** Visual depth helps track which boxes are nearly complete
### Reaction Speed
- Click only the highlighted green squares
- Ignore non-highlighted squares
- Try to maintain consistent fast reactions
- F1 drivers typically have sub-300ms reaction times!
- **3D Enhancement:** Immersive environment with particle effects for correct clicks

## ⏱️ Timer System

- **Turn Timer:** 30 seconds per move (starts after first move is made)
- **Visual Countdown:** Timer shows remaining seconds
- **Timeout Rules:** If time runs out, the other player wins automatically
- **Color Coding:** Timer turns red when under 10 seconds remaining

## 🏆 Scoring & Rankings

### Reaction Speed Leaderboard
- **Ranking:** Based on score (clicks), then average reaction time
- **Display:** Shows top players plus your current position
- **Pagination:** Navigate through rankings (max 5 pages)
- **Live Updates:** Refreshes every 5 seconds automatically

## 📱 Device Compatibility

- **Mobile Phones:** Optimized touch controls and responsive design
- **Tablets:** Enhanced layout for larger screens
- **Desktop:** Full-featured experience with mouse controls
- **All Screen Sizes:** From 320px phones to large desktop monitors

## 🔧 Technical Features

- **Auto-Refresh:** Games sync every 3 seconds
- **Real-time Updates:** See opponent moves instantly
- **Live State Synchronization:** Server broadcasts game state changes to all connected players immediately
- **Session Persistence:** Games are stored in Redis, allowing players to rejoin after disconnection
- **Automatic Reconnection:** Players can close and reopen the webview without losing their game session
- **Connection Resilience:** Automatic WebSocket reconnection with HTTP polling fallback
- **Mobile App Support:** Works reliably in Reddit native mobile apps
- **Error Handling:** Comprehensive error messages and recovery
- **State Persistence:** Games continue even if you refresh
- **Cross-Platform:** Works on all devices and browsers

### Connection Technology

**Real-time Multiplayer Architecture:**
- **Server-Side State Management:** All game logic runs on the server using Redis for persistence
- **Live Broadcasting:** When any player makes a move, the updated game state is instantly sent to all connected players
- **Connection Tracking:** The system tracks all active webview connections per game post
- **Automatic Cleanup:** Dead connections are automatically removed to prevent memory leaks

The games use a hybrid connection approach for maximum reliability:

1. **Primary:** Secure WebSocket (WSS) connections for real-time gameplay
2. **Fallback:** HTTP polling when WebSocket connections fail (common in mobile apps)
3. **Auto-Recovery:** Automatic reconnection attempts with exponential backoff
4. **Status Indicators:** Clear visual feedback about connection quality

**Connection Status Indicators:**
- 🟢 **Connected (Real-time)** - WebSocket active, full real-time experience
- 🟠 **Connected (Polling)** - HTTP fallback active, slightly delayed updates
- 🟡 **Connecting...** - Attempting to establish connection
- 🔴 **Disconnected** - No connection available, refresh recommended

### Session Management
- **Persistent Game Sessions:** Games are stored in Redis and persist across browser sessions
- **Rejoin Capability:** Players can close the webview and rejoin the same game later
- **Turn Timer Continuity:** Timers continue running even if players temporarily disconnect
- **State Recovery:** When rejoining, players immediately see the current game state
- **Multi-Device Support:** Play on one device, continue on another (same Reddit account)
## 🎨 User Interface

- **Modern Design:** Beautiful gradients and animations
- **Intuitive Controls:** Easy-to-use game interfaces
- **Visual Feedback:** Clear indicators for turns, wins, and errors
- **Celebration Effects:** Animated popups for game endings
- **Professional Typography:** Clean, readable fonts throughout
- **Connection Awareness:** Real-time connection status and quality indicators
- **3D Immersion:** Full 3D environments with realistic lighting and materials
- **Responsive 3D:** 3D scenes adapt to different screen sizes and orientations
- **Touch Optimization:** Gesture recognition for touch devices (tap vs. drag)
- **Visual Polish:** Particle effects, smooth animations, and atmospheric rendering

## 🤝 Multiplayer Experience

### Real-time Connection Flow
1. **Join Game:** Player clicks "Join Game" and is added to the game lobby
2. **Live Updates:** All connected players immediately see the new player join
3. **Game Start:** When enough players join, the game starts automatically for everyone
4. **Move Synchronization:** Every move is instantly broadcast to all players
5. **Turn Management:** Server enforces turn order and validates all moves
6. **Game End:** Victory/defeat notifications are sent to all players simultaneously

### Connection Reliability
- **Seamless Joining:** Automatic game joining and matchmaking
- **Player Information:** See opponent usernames and game status
- **Turn Indicators:** Clear visual feedback for whose turn it is
- **Game Restart:** Easy option to play again after games end
- **Fair Play:** Turn timers ensure games don't stall
- **Reliable Connectivity:** Multiple connection methods ensure games work everywhere
- **Instant Reconnection:** Rejoin games immediately after network interruptions
- **State Synchronization:** All players always see the same game state
- **Error Recovery:** Graceful handling of connection issues with user feedback
- **Cross-Session Continuity:** Games persist across browser sessions and device switches

### Session Windows
- **Active Sessions:** Games remain active as long as players are engaged
- **Timeout Handling:** Inactive games are cleaned up automatically
- **Turn Timers:** 30-second turn limits keep games moving
- **Rejoin Window:** Players can rejoin games within a reasonable timeframe
- **Fair Play:** Turn timers prevent games from stalling indefinitely
---

**Ready to play?** Find a SocialGrid Games post on Reddit and challenge other users to epic gaming battles! 🎮🏆