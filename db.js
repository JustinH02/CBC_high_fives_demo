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
    birthdate   TEXT    NOT NULL,
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`);

module.exports = db;
