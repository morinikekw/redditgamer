# SocialGrid Games - Multiplayer Reddit Games

A comprehensive multiplayer gaming platform built for Reddit using Devvit. Play classic games with other Reddit users in real-time!

## 🎮 Available Games

### 1. **Tic Tac Toe** ⭕
- **Players:** 2
- **Objective:** Get three in a row (horizontal, vertical, or diagonal)
- **How to Play:** Click on empty squares to place your symbol (X or O)
- **Timer:** 30 seconds per turn after first move

### 2. **Gomoku** ⚫
- **Players:** 2  
- **Objective:** Get five stones in a row on a 15×15 board
- **How to Play:** Click on intersections to place your stone (Black or White)
- **Timer:** 30 seconds per turn after first move

### 3. **Connect Four** 🔴
- **Players:** 2
- **Objective:** Connect four discs in a row (horizontal, vertical, or diagonal)
- **How to Play:** Click on columns to drop your disc (Red or Yellow)
- **Timer:** 30 seconds per turn after first move

### 4. **Chess** ♛
- **Players:** 2
- **Objective:** Checkmate your opponent's king
- **How to Play:** Drag and drop pieces to make moves (White moves first)
- **Timer:** 30 seconds per turn after first move

### 5. **Reaction Speed** ⚡
- **Players:** Unlimited (individual scores)
- **Objective:** Click highlighted squares as fast as possible
- **How to Play:** Click "Start Game" and tap green squares for 20 seconds
- **Leaderboard:** Compete with other Reddit users for the fastest reaction times

## 🚀 How to Play

### Getting Started
1. **Find a SocialGrid Games post** on Reddit
2. **Choose your game** from the main menu
3. **Click "Join Game"** to enter the game lobby
4. **Wait for another player** (for 2-player games) or start immediately (Reaction Speed)
5. **Play and have fun!**

### Game Features
- ✅ **Real-time multiplayer** - Play with other Reddit users
- ✅ **Auto-refresh** - Games update every 3 seconds automatically
- ✅ **Turn timers** - 30-second countdown per turn (after first move)
- ✅ **Win/Loss celebrations** - Beautiful popups for game endings
- ✅ **Mobile responsive** - Perfect on all devices
- ✅ **Live leaderboards** - For Reaction Speed game

### Navigation Tips
- **Main Menu:** Shows all available games with player counts
- **Game Lobby:** Displays current players and game status
- **In-Game:** Shows whose turn it is and remaining time
- **After Game:** Option to play again or return to menu

## 🎯 Game Rules & Tips

### Tic Tac Toe
- First player gets X, second player gets O
- Make strategic moves to block your opponent
- Center square is often the best opening move

### Gomoku
- Black stones move first
- No restrictions on moves (freestyle rules)
- Think several moves ahead to create multiple threats

### Connect Four
- Red discs move first
- Discs fall to the lowest available position
- Look for opportunities to create multiple winning threats

### Chess
- Standard chess rules apply
- White pieces move first
- Pieces move according to traditional chess rules
- Game ends with checkmate, stalemate, or timeout

### Reaction Speed
- Click only the highlighted green squares
- Ignore non-highlighted squares
- Try to maintain consistent fast reactions
- F1 drivers typically have sub-300ms reaction times!

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
- **Connection Resilience:** Automatic WebSocket reconnection with HTTP polling fallback
- **Mobile App Support:** Works reliably in Reddit native mobile apps
- **Error Handling:** Comprehensive error messages and recovery
- **State Persistence:** Games continue even if you refresh
- **Cross-Platform:** Works on all devices and browsers

### Connection Technology

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

## 🎨 User Interface

- **Modern Design:** Beautiful gradients and animations
- **Intuitive Controls:** Easy-to-use game interfaces
- **Visual Feedback:** Clear indicators for turns, wins, and errors
- **Celebration Effects:** Animated popups for game endings
- **Professional Typography:** Clean, readable fonts throughout
- **Connection Awareness:** Real-time connection status and quality indicators

## 🤝 Multiplayer Experience

- **Seamless Joining:** Automatic game joining and matchmaking
- **Player Information:** See opponent usernames and game status
- **Turn Indicators:** Clear visual feedback for whose turn it is
- **Game Restart:** Easy option to play again after games end
- **Fair Play:** Turn timers ensure games don't stall
- **Reliable Connectivity:** Multiple connection methods ensure games work everywhere

---

**Ready to play?** Find a SocialGrid Games post on Reddit and challenge other users to epic gaming battles! 🎮🏆