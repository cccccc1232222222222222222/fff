const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Add this for environment-based CORS
const frontendUrl = process.env.FRONTEND_URL;

const allowedOrigins = [
  frontendUrl,
  'http://localhost:3000',
  'https://thornyphonyorigin.onrender.com',
  'https://*.onrender.com'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Configure Socket.IO with proper CORS
const io = socketIO(server, {
  cors: {
    origin: ["http://localhost:8080", "http://localhost:3000", "https://thornyphonyorigin.onrender.com", "https://*.onrender.com"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// Route handler
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Add this at the top with other constants
const GRID_WIDTH = 100; // Total width of your grid
const INITIAL_OFFSET = GRID_WIDTH * 5; // 50% of grid width
const USER_SPACING = GRID_WIDTH * 2; // 25% spacing

// Socket.IO logic
const users = {};

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // Modify the register handler to calculate positions in a line
  socket.on('register', (username) => {
    // Validate username
    if (!username || username.length < 3 || username.length > 20) {
      socket.emit('registration_failed', 'Username must be 3-20 characters');
      return;
    }
    
    // Check if username is taken
    if (users[username]) {
      socket.emit('registration_failed', 'Username already taken');
      return;
    }
    
    let newPosition;
    ///
    if (users[socket.username]?.mode === 'world') {
      // Dynamic spacing based on avatar widths
      let offset = -3; // First user starts at -2 in world mode
      for (let id in users) {
        const other = users[id];
        if (other.mode === 'world') {
          offset += (other.width || 2) + 0.5; // Use stored width or default 2, add 0.5 gap
        }
      }
      newPosition = { x: offset, y: 0, z: 0 };
    } else {
      // Single mode - always at (0,0,0)
      newPosition = { x: 0, y: 0, z: 0 };
    }

    // Register user with calculated position
    users[username] = {
      id: socket.id,
      animation: null,
      position: newPosition,
      mode: users[socket.username]?.mode || 'single', // Default to single mode
      width: 2 // Default width until measured
    };

    // Send updates
    updateAllUserPositions();
    
    socket.username = username;
    
    // Send success response
    socket.emit('registration_success');
    
    // Send world state to new user
    const worldState = {};
    Object.keys(users).forEach(username => {
      if (username !== socket.username) {
        worldState[username] = {
          animation: users[username].animation,
          position: users[username].position
        };
      }
    });
    socket.emit('world_state', worldState);
    
    // Notify all users of the new user list
    updateUserList();
    
    console.log(`User registered: ${username}`);
  });
  
  // Add new event for mode changes
  socket.on('set_mode', (mode) => {
    if (!socket.username || !users[socket.username]) return;
    
    users[socket.username].mode = mode;
    
    // Broadcast mode change
    io.emit('user_mode_changed', {
      username: socket.username,
      mode: mode
    });
    
    // Handle position updates based on mode
    if (mode === 'world') {
      // Recalculate world mode positions and broadcast
      recalculateWorldModePositions();
    } else {
      // Single mode - set position to (0,0,0) and broadcast to the user
      users[socket.username].position = { x: 0, y: 0, z: 0 };
      socket.emit('avatar_position_update', {
        username: socket.username,
        position: { x: 0, y: 0, z: 0 }
      });
    }
  });
  
  // Add new event to request world state
  socket.on('request_world_state', () => {
    if (!socket.username || !users[socket.username]) return;
    
    const worldState = {};
    Object.keys(users).forEach(username => {
      // Include ALL users in world mode
      if (users[username].mode === 'world') {
        worldState[username] = {
          animation: users[username].animation,
          position: users[username].position
        };
      }
    });
    
    socket.emit('world_state', worldState);
  });
  
  // Add handler for position requests
  socket.on('request_user_position', (username) => {
    if (users[username] && users[username].mode === 'world') {
      socket.emit('user_position_response', {
        username: username,
        position: users[username].position
      });
    }
  });
  
  // Add handler for avatar width updates
  socket.on('avatar_width', (data) => {
    if (!socket.username || !users[socket.username]) return;
    
    // Update the user's width
    users[socket.username].width = data.width;
    
    // Recalculate positions for all world mode users
    recalculateWorldModePositions();
  });
  
  // Handle animation changes
  socket.on('change_animation', (animationFile) => {
    if (!socket.username || !users[socket.username]) return;
    
    users[socket.username].animation = animationFile;
    
    // Broadcast only if user is in world mode
    if (users[socket.username].mode === 'world') {
      io.emit('avatar_updated', {
        username: socket.username,
        animation: animationFile
      });
    }
    
    // Special effect for chicken dance
    if (animationFile === 'Chicken Dance.fbx') {
      io.emit('special_effect', {
        type: 'disco',
        intensity: 0.8
      });
    }
  });
  
  // Add this new event handler
  socket.on('special_effect', (data) => {
    // This will trigger effects on all clients
    io.emit('special_effect', data);
  });
  
  // Handle chat messages
  socket.on('chat_message', (data) => {
    if (!socket.username || !users[socket.username]) return;
    
    // Broadcast the message to all users
    io.emit('chat_message', {
      username: socket.username,
      message: data.message
    });
  });
  
  // Handle position updates
  socket.on('avatar_position', (position) => {
    if (!socket.username || !users[socket.username]) return;
    
    // Update user's position
    users[socket.username].position = position;
    
    // Broadcast only if user is in world mode
    if (users[socket.username].mode === 'world') {
      socket.broadcast.emit('avatar_position_update', {
        username: socket.username,
        position: position
      });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    if (socket.username) {
      // Notify all users about disconnection
      io.emit('user_disconnected', socket.username);
      
      delete users[socket.username];
      updateUserList();
      console.log(`User disconnected: ${socket.username}`);
    }
  });
  
  // Update all clients with current user list
  function updateUserList() {
    io.emit('user_list', Object.keys(users));
  }
  
  // Add this helper function
  function updateAllUserPositions() {
    Object.keys(users).forEach(uname => {
      io.emit('avatar_position_update', {
        username: uname,
        position: users[uname].position
      });
    });
  }
  
  // Add function to recalculate world mode positions
  function recalculateWorldModePositions() {
    const worldUsers = Object.keys(users).filter(username => users[username].mode === 'world');
    let offset = -3; // First user starts at -2 in world mode
    
    worldUsers.forEach(username => {
      users[username].position.x = offset;
      offset += (users[username].width || 2) + 0.5; // Add gap of 0.5
    });
    
    // Broadcast updated positions to all clients
    updateAllUserPositions();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});