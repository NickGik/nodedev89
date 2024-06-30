const { ServerApiVersion } = require('mongodb');
const express = require('express');
const nunjucks = require('nunjucks');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');

require('dotenv').config();

const User = require('./models/User');
const Timer = require('./models/Timer');

const app = express();

// HTTPS configuration (replace paths with your SSL certificate and key)
const serverOptions = {
  key: fs.readFileSync(path.resolve(__dirname, 'ssl', 'private.key')),
  cert: fs.readFileSync(path.resolve(__dirname, 'ssl', 'certificate.pem'))
};

const server = https.createServer(serverOptions, app);

app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB using Mongoose
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // Увеличьте время ожидания для выбора сервера
  socketTimeoutMS: 45000, // Увеличьте время ожидания для сокетов
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', function() {
  console.log("Connected to MongoDB via Mongoose");
});

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

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Allow cookie transmission
}));

app.use(cookieParser(process.env.SESSION_SECRET));

// Session configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }), // Обновлено для использования подключения Mongoose
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
});

app.use(sessionMiddleware);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'njk');
app.set('views', path.join(__dirname, 'views'));

// JWT authentication middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('Authorization Header:', authHeader);

  if (authHeader) {
    const token = authHeader.split(' ')[1];
    console.log('Token:', token);

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
      if (err) {
        console.error('JWT verification error:', err);
        return res.sendStatus(403); // Forbidden
      }
      console.log('JWT verification success:', user);
      req.user = user;
      next();
    });
  } else {
    console.error('Authorization header missing');
    res.sendStatus(401); // Unauthorized
  }
};

// Registration endpoint
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).send("User with that username already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ _id: user._id, username: user.username }, process.env.ACCESS_TOKEN_SECRET);
    req.session.user = user;
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
    req.session.user = user;

    // Sending token to the client in Set-Cookie header
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
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

app.get('/', (req, res) => {
  res.render('index');
});

// Create new timer
app.post('/timer', authenticateJWT, async (req, res) => {
  const { description } = req.body;

  try {
    const newTimer = new Timer({
      userId: req.user._id,
      description,
      start: new Date(),
      isActive: true,
      durationInSeconds: 0
    });

    await newTimer.save();

    res.status(201).json({
      timer: newTimer
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

    if (timer.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access to this timer is denied' });
    }

    if (!timer.isActive) {
      return res.status(400).json({ error: 'Timer is already stopped' });
    }

    timer.isActive = false;
    timer.end = new Date();
    timer.durationInSeconds = Math.floor((timer.end - timer.start) / 1000);
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
  try {
    const timers = await Timer.find({ userId }).exec(); // Добавьте exec() для явного выполнения запроса
    timers.forEach(timer => {
      if (timer.isActive) {
        timer.durationInSeconds = Math.floor((new Date() - timer.start) / 1000);
      }
    });
    res.json({ timers });
  } catch (error) {
    console.error('Error fetching timers:', error);
    res.status(500).json({ error: 'An error occurred while fetching timers' });
  }
});

// WebSocket server (WSS)
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  sessionMiddleware(req, {}, () => {
    if (req.session.user) {
      console.log('WebSocket connected with user:', req.session.user.username);

      ws.on('message', (message) => {
        console.log(`Received message => ${message}`);
      });

      ws.on('close', () => {
        console.log('WebSocket disconnected');
      });
    } else {
      console.log('Unauthorized WebSocket connection');
      ws.close(1000, 'Unauthorized');
    }
  });
});

// Function to send timer updates
const sendTimersUpdate = async () => {
  try {
    const timers = await Timer.find({}).exec(); // Добавьте exec() для явного выполнения запроса

    timers.forEach(timer => {
      if (timer.isActive) {
        timer.durationInSeconds = Math.floor((new Date() - timer.start) / 1000);
      }
    });

    const timersData = JSON.stringify(timers);

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(timersData);
      }
    });
  } catch (error) {
    console.error('Error fetching timers:', error);
  }
};

// Start sending timer updates every 1 second
setInterval(sendTimersUpdate, 1000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
