'use strict';

// Basic integration tests using Node's built-in test runner (Node ≥ 18)
// and the built-in fetch API (Node ≥ 18).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');

// Use an in-memory / temp DB so tests don't pollute production data.
process.env.DB_PATH = path.join(require('node:os').tmpdir(), `test-${Date.now()}.db`);

const app = require('../server');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let server;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // Clean up the temp DB file.
  try { fs.unlinkSync(process.env.DB_PATH); } catch (_) { /* ignore */ }
});

test('GET / returns 200 with HTML', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('<form'), 'Should contain a form element');
});

test('GET /slideshow returns 200 with HTML', async () => {
  const res = await fetch(`${BASE}/slideshow`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('Slideshow'), 'Should reference slideshow');
});

test('GET /children returns empty array initially', async () => {
  const res = await fetch(`${BASE}/children`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json), 'Should be an array');
  assert.equal(json.length, 0);
});

test('POST /submit rejects missing fields', async () => {
  const form = new FormData();
  form.append('child_name', 'Alice');
  // deliberately omit other fields
  const res = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error, 'Should return an error message');
});

test('POST /submit stores a record and GET /children returns it', async () => {
  const form = new FormData();
  form.append('child_name', 'Emma');
  form.append('age', '7');
  form.append('town', 'Springfield');
  form.append('parent_email', 'parent@example.com');
  form.append('birthdate', '2017-03-10');

  const postRes = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.ok(postJson.success, 'Should confirm success');

  const getRes = await fetch(`${BASE}/children`);
  const children = await getRes.json();
  assert.equal(children.length, 1);
  assert.equal(children[0].child_name, 'Emma');
  assert.equal(children[0].age, 7);
  assert.equal(children[0].town, 'Springfield');
  assert.equal(children[0].birthdate, '2017-03-10');
});

test('GET /children?date= filters by birthdate', async () => {
  // Add a second child with a different birthdate
  const form = new FormData();
  form.append('child_name', 'Liam');
  form.append('age', '5');
  form.append('town', 'Shelbyville');
  form.append('parent_email', 'other@example.com');
  form.append('birthdate', '2019-06-15');
  await fetch(`${BASE}/submit`, { method: 'POST', body: form });

  const res = await fetch(`${BASE}/children?date=2017-03-10`);
  const kids = await res.json();
  assert.equal(kids.length, 1);
  assert.equal(kids[0].child_name, 'Emma');
});

test('POST /submit rejects invalid age', async () => {
  const form = new FormData();
  form.append('child_name', 'Too Old');
  form.append('age', '25');
  form.append('town', 'Somewhere');
  form.append('parent_email', 'a@b.com');
  form.append('birthdate', '2000-01-01');
  const res = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});
