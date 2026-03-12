'use strict';

// Basic integration tests using Node's built-in test runner (Node ≥ 18)
// and the built-in fetch API (Node ≥ 18).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');

// Use an in-memory / temp DB so tests don't pollute production data.
process.env.DB_PATH = path.join(require('node:os').tmpdir(), `test-${Date.now()}.db`);
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';

const app = require('../server');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let server;

function isoDatePlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addYearsToISODate(isoDate, yearsToAdd) {
  const [y, m, d] = isoDate.split('-').map((part) => parseInt(part, 10));
  const date = new Date(Date.UTC(y + yearsToAdd, m - 1, d));
  const ny = date.getUTCFullYear();
  const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(date.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

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
  form.append('child_name', 'Alice Smith');
  // deliberately omit other fields
  const res = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error, 'Should return an error message');
});

test('POST /submit stores a record and GET /children returns it', async () => {
  const birthdate = isoDatePlusDays(85);

  const form = new FormData();
  form.append('child_name', 'Emma Stone');
  form.append('age', '7');
  form.append('town', 'Springfield');
  form.append('parent_email', 'parent@example.com');
  form.append('parent_email_confirm', 'parent@example.com');
  form.append('birthdate', birthdate);
  form.append('high_five_message', 'So proud!');

  const postRes = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.ok(postJson.success, 'Should confirm success');

  const getRes = await fetch(`${BASE}/children`);
  const children = await getRes.json();
  assert.equal(children.length, 1);
  assert.equal(children[0].child_name, 'Emma Stone');
  assert.equal(children[0].age, 7);
  assert.equal(children[0].town, 'Springfield');
  assert.equal(children[0].birthdate, birthdate);
  assert.equal(children[0].parent_email, 'parent@example.com');
  assert.equal(children[0].high_five_message, 'So proud!');
});

test('GET /children?date= filters by birthdate', async () => {
  const firstBirthdate = isoDatePlusDays(85);
  const secondBirthdate = isoDatePlusDays(90);

  // Add a second child with a different high five date
  const form = new FormData();
  form.append('child_name', 'Liam Carter');
  form.append('age', '5');
  form.append('town', 'Shelbyville');
  form.append('parent_email', 'other@example.com');
  form.append('parent_email_confirm', 'other@example.com');
  form.append('birthdate', secondBirthdate);
  await fetch(`${BASE}/submit`, { method: 'POST', body: form });

  const res = await fetch(`${BASE}/children?date=${encodeURIComponent(firstBirthdate)}`);
  const kids = await res.json();
  assert.equal(kids.length, 1);
  assert.equal(kids[0].child_name, 'Emma Stone');
});

test('GET /children?date= matches birthdays ignoring year', async () => {
  const baseBirthdate = isoDatePlusDays(85);
  const sameBirthdayDifferentYear = addYearsToISODate(baseBirthdate, 1);

  // Querying with a different year but same month/day should still match.
  const res = await fetch(`${BASE}/children?date=${encodeURIComponent(sameBirthdayDifferentYear)}`);
  const kids = await res.json();
  assert.ok(kids.some((kid) => kid.child_name === 'Emma Stone'));
});

test('POST /submit rejects invalid age', async () => {
  const form = new FormData();
  form.append('child_name', 'Too Old');
  form.append('age', '25');
  form.append('town', 'Somewhere');
  form.append('parent_email', 'a@b.com');
  form.append('parent_email_confirm', 'a@b.com');
  form.append('birthdate', '2000-01-01');
  const res = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test('POST /submit rejects non-title-case first and last name', async () => {
  const form = new FormData();
  form.append('child_name', 'emma stone');
  form.append('age', '7');
  form.append('town', 'Toronto');
  form.append('parent_email', 'parent2@example.com');
  form.append('parent_email_confirm', 'parent2@example.com');
  form.append('birthdate', isoDatePlusDays(85));

  const res = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes('capital letter'));
});

test('Admin can login, view, and edit a child record', async () => {
  const loginRes = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });
  assert.equal(loginRes.status, 200);

  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie, 'Login should set session cookie');

  const rowsRes = await fetch(`${BASE}/admin/children`, {
    headers: { cookie }
  });
  assert.equal(rowsRes.status, 200);
  const rows = await rowsRes.json();
  assert.ok(rows.length >= 1);

  const targetId = rows[0].id;
  const editForm = new FormData();
  editForm.append('child_name', 'Emma Stone');
  editForm.append('age', '8');
  editForm.append('town', 'Toronto');
  editForm.append('parent_email', 'parent@example.com');
  editForm.append('birthdate', isoDatePlusDays(95));
  editForm.append('high_five_message', 'Updated by admin');
  editForm.append('remove_photo', 'false');

  const putRes = await fetch(`${BASE}/admin/children/${targetId}`, {
    method: 'PUT',
    headers: { cookie },
    body: editForm
  });
  assert.equal(putRes.status, 200);

  const rowsAfterRes = await fetch(`${BASE}/admin/children`, {
    headers: { cookie }
  });
  const rowsAfter = await rowsAfterRes.json();
  const edited = rowsAfter.find((r) => r.id === targetId);
  assert.equal(edited.age, 8);
  assert.equal(edited.town, 'Toronto');
  assert.equal(edited.birthdate, isoDatePlusDays(95));
});

test('POST /submit rejects submission made less than 6 weeks before birthdate', async () => {
  const form = new FormData();
  form.append('child_name', 'Noah Miles');
  form.append('age', '1');
  form.append('town', 'Ottawa');
  form.append('parent_email', 'parent3@example.com');
  form.append('parent_email_confirm', 'parent3@example.com');
  form.append('birthdate', isoDatePlusDays(20));

  const res = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes('submission date'));
});

test('POST /submit rejects birthday that is more than one year ahead', async () => {
  const farBirthdate = isoDatePlusDays(370);

  const form = new FormData();
  form.append('child_name', 'Tara Bloom');
  form.append('age', '1');
  form.append('town', 'Montreal');
  form.append('parent_email', 'tara@example.com');
  form.append('parent_email_confirm', 'tara@example.com');
  form.append('birthdate', farBirthdate);

  const res = await fetch(`${BASE}/submit`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes('between 6 weeks and 1 year'));
});
