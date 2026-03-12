'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const db        = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const ADMIN_SESSIONS = new Map();
const ADMIN_COOKIE = 'cbc_admin_session';
const PHOTO_MIN_BYTES = 50 * 1024;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const MIN_WEEKS_BEFORE_BIRTH_FOR_SUBMISSION = 6;

// ── Static files & body parsing ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

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
  limits: { fileSize: PHOTO_MAX_BYTES },
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

function parseCookies(headerValue = '') {
  return headerValue.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) return acc;
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isTitleCaseName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return false;
  return parts.every((part) => /^[A-Z][a-zA-Z'-]*$/.test(part));
}

function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function cleanupUploadedFile(file) {
  if (file?.path) {
    try { fs.unlinkSync(file.path); } catch (_) { /* noop */ }
  }
}

function toUTCDateOnly(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getNextBirthdayOccurrence(birthdate, submissionDate = new Date()) {
  const [, m, d] = birthdate.split('-');
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  const submitDay = toUTCDateOnly(submissionDate);

  let candidate = new Date(Date.UTC(submitDay.getUTCFullYear(), month - 1, day));
  if (candidate <= submitDay) {
    candidate = new Date(Date.UTC(submitDay.getUTCFullYear() + 1, month - 1, day));
  }
  return candidate;
}

function isBirthdayWindowAllowedForSubmission(birthdate, submissionDate = new Date()) {
  const submitDay = toUTCDateOnly(submissionDate);
  const nextBirthday = getNextBirthdayOccurrence(birthdate, submissionDate);

  const earliest = new Date(submitDay);
  earliest.setUTCDate(earliest.getUTCDate() + (MIN_WEEKS_BEFORE_BIRTH_FOR_SUBMISSION * 7));

  const latest = new Date(submitDay);
  latest.setUTCFullYear(latest.getUTCFullYear() + 1);

  return nextBirthday >= earliest && nextBirthday <= latest;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE];
  if (!token || !ADMIN_SESSIONS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Serve the submission form
app.get('/', generalLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the slideshow page
app.get('/slideshow', generalLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'slideshow.html'));
});

app.get('/admin', generalLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/admin/login', authLimiter, (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  ADMIN_SESSIONS.set(token, Date.now());
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`);
  return res.json({ success: true });
});

app.post('/admin/logout', requireAdmin, (_req, res) => {
  const cookies = parseCookies(_req.headers.cookie);
  const token = cookies[ADMIN_COOKIE];
  if (token) {
    ADMIN_SESSIONS.delete(token);
  }
  return res
    .setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
    .json({ success: true });
});

// Submit a new child record
app.post('/submit', submitLimiter, upload.single('photo'), (req, res) => {
  const {
    child_name,
    age,
    town,
    parent_email,
    parent_email_confirm,
    birthdate,
    high_five_message
  } = req.body;

  if (!child_name || !age || !town || !parent_email || !parent_email_confirm || !birthdate) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (parent_email !== parent_email_confirm) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Email and confirm email must match.' });
  }

  if (!isValidEmail(parent_email.trim())) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Please enter a valid parent email.' });
  }

  if (!isTitleCaseName(child_name)) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Name must include first and last name, each starting with a capital letter.' });
  }

  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 0 || ageNum > 18) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Age must be a number between 0 and 18.' });
  }

  if (!isISODate(birthdate)) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Birthdate must be a valid date in YYYY-MM-DD format.' });
  }

  if (!isBirthdayWindowAllowedForSubmission(birthdate)) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Application denied: birthday (month/day) must be between 6 weeks and 1 year ahead of submission date.' });
  }

  if (req.file && req.file.size < PHOTO_MIN_BYTES) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Photo is too small. Minimum size is 50 KB.' });
  }

  const photo = req.file ? `/uploads/${req.file.filename}` : null;
  const safeMessage = typeof high_five_message === 'string' ? high_five_message.trim().slice(0, 500) : null;

  const stmt = db.prepare(
    'INSERT INTO children (child_name, age, town, photo, parent_email, birthdate, high_five_message) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const info = stmt.run(
    child_name.trim(),
    ageNum,
    town.trim(),
    photo,
    parent_email.trim(),
    birthdate,
    safeMessage
  );

  return res.json({ success: true, id: info.lastInsertRowid });
});

// Retrieve children, optionally filtered by birthday (month/day only, year ignored).
app.get('/children', generalLimiter, (req, res) => {
  const { date } = req.query;

  let rows;
  if (date) {
    rows = db
      .prepare(`
        SELECT id, child_name, age, town, photo, birthdate, parent_email, high_five_message
        FROM children
        WHERE strftime('%m-%d', birthdate) = strftime('%m-%d', ?)
        ORDER BY id ASC
      `)
      .all(date);
  } else {
    rows = db
      .prepare(`
        SELECT id, child_name, age, town, photo, birthdate, parent_email, high_five_message
        FROM children
        ORDER BY id ASC
      `)
      .all();
  }

  return res.json(rows);
});

app.get('/admin/children', generalLimiter, requireAdmin, (_req, res) => {
  const rows = db
    .prepare(`
      SELECT id, child_name, age, town, photo, parent_email, birthdate,
             high_five_message, created_at
      FROM children
      ORDER BY id DESC
    `)
    .all();
  return res.json(rows);
});

app.put('/admin/children/:id', generalLimiter, requireAdmin, upload.single('photo'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Invalid id.' });
  }

  const existing = db.prepare('SELECT id, photo FROM children WHERE id = ?').get(id);
  if (!existing) {
    cleanupUploadedFile(req.file);
    return res.status(404).json({ error: 'Child not found.' });
  }

  const { child_name, age, town, parent_email, birthdate, high_five_message } = req.body;

  if (!child_name || !age || !town || !parent_email || !birthdate) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Required fields are missing.' });
  }

  if (!isTitleCaseName(child_name)) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Name must include first and last name with capital initials.' });
  }

  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 0 || ageNum > 18) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Age must be a number between 0 and 18.' });
  }

  if (!isValidEmail(parent_email.trim())) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Please enter a valid parent email.' });
  }

  if (!isISODate(birthdate)) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Birthdate must be valid YYYY-MM-DD.' });
  }

  if (req.file && req.file.size < PHOTO_MIN_BYTES) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Photo is too small. Minimum size is 50 KB.' });
  }

  let nextPhoto = existing.photo;
  if (req.body.remove_photo === 'true') {
    nextPhoto = null;
  }
  if (req.file) {
    nextPhoto = `/uploads/${req.file.filename}`;
  }

  if ((req.body.remove_photo === 'true' || req.file) && existing.photo) {
    const oldPath = path.join(__dirname, 'public', existing.photo.replace(/^\//, ''));
    try { fs.unlinkSync(oldPath); } catch (_) { /* noop */ }
  }

  const safeMessage = typeof high_five_message === 'string' ? high_five_message.trim().slice(0, 500) : null;

  db.prepare(
    `UPDATE children
     SET child_name = ?, age = ?, town = ?, photo = ?, parent_email = ?, birthdate = ?, high_five_message = ?
     WHERE id = ?`
  ).run(
    child_name.trim(),
    ageNum,
    town.trim(),
    nextPhoto,
    parent_email.trim(),
    birthdate,
    safeMessage,
    id
  );

  return res.json({ success: true });
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
