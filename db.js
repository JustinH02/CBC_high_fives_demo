const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'children.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS children (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    child_name  TEXT    NOT NULL,
    age         INTEGER NOT NULL,
    town        TEXT    NOT NULL,
    photo       TEXT,
    parent_email TEXT   NOT NULL,
    birthdate   TEXT,
    high_five_date TEXT NOT NULL DEFAULT '',
    high_five_message TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`);

// Apply additive migrations for existing local databases.
const columns = db.prepare('PRAGMA table_info(children)').all();
const hasHighFiveDate = columns.some((col) => col.name === 'high_five_date');
const hasHighFiveMessage = columns.some((col) => col.name === 'high_five_message');

if (!hasHighFiveDate) {
  db.exec("ALTER TABLE children ADD COLUMN high_five_date TEXT NOT NULL DEFAULT ''");
}

if (!hasHighFiveMessage) {
  db.exec("ALTER TABLE children ADD COLUMN high_five_message TEXT");
}

// Backfill legacy rows so slideshow metadata always has a date.
db.exec(`
  UPDATE children
  SET high_five_date = birthdate
  WHERE (high_five_date IS NULL OR high_five_date = '')
    AND birthdate IS NOT NULL
    AND birthdate != ''
`);

module.exports = db;
