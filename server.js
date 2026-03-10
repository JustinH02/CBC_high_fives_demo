'use strict';

const express   = require('express');
const path      = require('path');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const db        = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Static files & body parsing ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── File upload (photos) ─────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'public', 'uploads'),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, png, gif, webp) are allowed.'));
    }
  },
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

// ── Routes ───────────────────────────────────────────────────────────────────

// Serve the submission form
app.get('/', generalLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the slideshow page
app.get('/slideshow', generalLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'slideshow.html'));
});

// Submit a new child record
app.post('/submit', submitLimiter, upload.single('photo'), (req, res) => {
  const { child_name, age, town, parent_email, birthdate } = req.body;

  if (!child_name || !age || !town || !parent_email || !birthdate) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 0 || ageNum > 18) {
    return res.status(400).json({ error: 'Age must be a number between 0 and 18.' });
  }

  // Validate birthdate is a real calendar date in YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(birthdate)) {
    return res.status(400).json({ error: 'Birthdate must be in YYYY-MM-DD format.' });
  }
  const parsedDate = new Date(birthdate);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'Birthdate is not a valid date.' });
  }
  if (parsedDate > new Date()) {
    return res.status(400).json({ error: 'Birthdate cannot be in the future.' });
  }

  const photo = req.file ? `/uploads/${req.file.filename}` : null;

  const stmt = db.prepare(
    'INSERT INTO children (child_name, age, town, photo, parent_email, birthdate) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const info = stmt.run(child_name.trim(), ageNum, town.trim(), photo, parent_email.trim(), birthdate);

  return res.json({ success: true, id: info.lastInsertRowid });
});

// Retrieve children, optionally filtered by birthdate
app.get('/children', generalLimiter, (req, res) => {
  const { date } = req.query;

  let rows;
  if (date) {
    rows = db
      .prepare('SELECT id, child_name, age, town, photo, birthdate FROM children WHERE birthdate = ? ORDER BY id ASC')
      .all(date);
  } else {
    rows = db
      .prepare('SELECT id, child_name, age, town, photo, birthdate FROM children ORDER BY id ASC')
      .all();
  }

  return res.json(rows);
});

// ── Error handling ───────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error.' });
});

// ── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CBC High Fives app running on http://localhost:${PORT}`);
  });
}

module.exports = app; // exported for testing
