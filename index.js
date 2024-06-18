const express = require('express');
const nunjucks = require('nunjucks');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo')(session);
const cookieParser = require('cookie-parser');

const User = require('./models/User');
const Timer = require('./models/Timer');

require('dotenv').config();

const app = express();
const server = require('http').createServer(app); // HTTP server for WebSocket

app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));


// Configure Nunjucks
nunjucks.configure('views', {
  autoescape: true,
  express: app,
  tags: {
    blockStart: '[%',
    blockEnd: '%]',
    variableStart: '[[',
    variableEnd: ']]',
    commentStart: '[#',
    commentEnd: '#]',
  },
});

// CORS setup
app.use(cors({
  origin: '*', // Allow requests from any origin
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allow all basic HTTP methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allow Content-Type and Authorization headers
  credentials: true // Allow cookie usage
}));

// Configure cookie-parser
app.use(cookieParser(process.env.SESSION_SECRET));

// Session configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET, // Session secret key for session cookie signing
  resave: false,
  saveUninitialized: false,
  store: new MongoStore({ mongooseConnection: mongoose.connection }), // Correct instantiation of MongoStore
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week in milliseconds
  }
});

// Use session middleware in Express app
app.use(sessionMiddleware);

// JSON and form data parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up Nunjucks as view engine
app.set('view engine', 'njk');
app.set('views', path.join(__dirname, 'views'));

// JWT authentication middleware
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization;
  if (token) {
    jwt.verify(token.split(' ')[1], process.env.ACCESS_TOKEN_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403); // Token verification failed
      }
      req.user = user; // Save user information for later use
      next();
    });
  } else {
    res.sendStatus(401); // No token provided
  }
};

// Registration endpoint
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Check if user with username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).send("User with that username already exists");
    }

    // Hash password and create new user
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();

    // Automatic login after registration
    const token = jwt.sign({ _id: user._id, username: user.username }, process.env.ACCESS_TOKEN_SECRET);
    req.session.user = user; // Save user in session
    res.render('index', { user, userToken: token });

  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).send("An error occurred during user registration");
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (user && await user.comparePassword(password)) {
    const token = jwt.sign({ _id: user._id, username: user.username }, process.env.ACCESS_TOKEN_SECRET);
    req.session.user = user; // Save user in session
    res.render('index', { user: user, userToken: token });
  } else {
    res.redirect("/");
  }
});

// Logout endpoint
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
      res.status(500).send("An error occurred during logout");
    } else {
      res.render('index', { user: null, userToken: null });
    }
  });
});

// Protected route
app.get('/', authenticateJWT, (req, res) => {
  res.render('index', { user: req.user, userToken: req.headers.authorization });
});

// Create new timer
app.post('/timer', authenticateJWT, async (req, res) => {
  const { description } = req.body;

  try {
    const newTimer = new Timer({
      userId: req.user._id, // Use user id from JWT
      description,
      start: new Date(),
      isActive: true,
      durationInSeconds: 0
    });

    await newTimer.save();

    // After saving timer, calculate durationInSeconds
    if (!newTimer.isActive) {
      newTimer.durationInSeconds = Math.floor((newTimer.end - newTimer.start) / 1000);
    } else {
      newTimer.durationInSeconds = 0; // or other logic if timer is active
    }

    // Save updated timer
    await newTimer.save();

    res.status(201).json({
      timer: newTimer,
      durationInSeconds: 0 // Duration is 0 because timer was just created
    });
  } catch (error) {
    console.error('Error creating timer:', error);
    res.status(500).json({ error: 'An error occurred while creating timer' });
  }
});

// Handle stopping timer
app.post('/timer/stop/:id', authenticateJWT, async (req, res) => {
  const timerId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(timerId)) {
    return res.status(400).json({ error: 'Invalid timer ID' });
  }

  try {
    const timer = await Timer.findById(timerId);
    if (!timer) {
      return res.status(404).json({ error: 'Timer not found' });
    }

    if (timer.userId.toString() !== req.user._id) {
      return res.status(403).json({ error: 'Access to this timer is denied' });
    }

    if (!timer.isActive) {
      return res.status(400).json({ error: 'Timer is already stopped' });
    }

    timer.isActive = false;
    timer.end = new Date();
    timer.duration = Math.floor((timer.end - timer.start) / 1000);
    await timer.save();

    res.json({ message: 'Timer stopped successfully', timer });
  } catch (error) {
    console.error('Error stopping timer:', error);
    res.status(500).json({ error: 'An error occurred while stopping timer' });
  }
});

// Endpoint to update timers
app.get('/timer/update', authenticateJWT, async (req, res) => {
  const userId = req.user._id;
  const timers = await Timer.find({ userId });
  timers.forEach(timer => {
    if (timer.isActive) {
      timer.durationInSeconds = Math.floor((new Date() - timer.start) / 1000);
    }
  });
  res.json({ timers });
});

// WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  // Check session or token authorization for WebSocket
  if (req.session.user) {
    console.log('WebSocket connected with user:', req.session.user.username);
    // Your WebSocket connection logic with authorized user
  } else {
    console.log('Unauthorized WebSocket connection');
    ws.close(1000, 'Unauthorized'); // Close connection with error
  }

  ws.on('message', (message) => {
    console.log(`Received message => ${message}`);
  });

  ws.on('close', () => {
    console.log('WebSocket disconnected');
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});


