import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerTracker, logToCSV } from '../js/tracker.js';

const worker = (x, missing = [], unseen = []) => ({ box: [x, 0, x + 100, 300], missing, unseen, worn: new Set(), status: '' });
const shift = (w, dx) => ({ ...w, box: [w.box[0] + dx, w.box[1], w.box[2] + dx, w.box[3]] });

test('ids stay with the same worker as they move, even when order changes', () => {
  const t = new WorkerTracker();
  const a = t.update([worker(0), worker(500)]).workers;
  assert.deepEqual(a.map((w) => w.id), [1, 2]);
  const b = t.update([shift(worker(500), 10), shift(worker(0), 10)]).workers;
  assert.deepEqual(b.map((w) => w.id), [2, 1]);
});

test('a new worker gets a new id; a lost worker is forgotten after maxMissed frames', () => {
  const t = new WorkerTracker({ maxMissed: 2 });
  t.update([worker(0)]);
  assert.equal(t.update([worker(0), worker(500)]).workers[1].id, 2);
  t.update([]);
  t.update([]);
  assert.equal(t.update([worker(0)]).workers[0].id, 1, 'still remembered after 2 missed frames');
  t.update([]);
  t.update([]);
  t.update([]);
  assert.equal(t.update([worker(0)]).workers[0].id, 3, 'forgotten after 3 missed frames');
});

test('a single noisy frame does not flag a violation', () => {
  const t = new WorkerTracker();
  assert.equal(t.update([worker(0, ['helmet'])]).workers[0].status, 'SAFE');
  assert.equal(t.update([worker(0)]).workers[0].status, 'SAFE');
  assert.equal(t.update([worker(0)]).workers[0].status, 'SAFE');
});

test('a steady violation is flagged and logged once per item', () => {
  const t = new WorkerTracker();
  const first = t.update([worker(0, ['helmet'])]);
  assert.equal(first.workers[0].status, 'SAFE');
  assert.deepEqual(first.events, []);

  const second = t.update([worker(0, ['helmet'])]);
  assert.equal(second.workers[0].status, 'VIOLATION');
  assert.deepEqual(second.workers[0].missing, ['helmet']);
  assert.deepEqual(second.events.map((e) => [e.id, e.items]), [[1, ['helmet']]]);

  assert.deepEqual(t.update([worker(0, ['helmet'])]).events, [], 'not logged again');
  // with 3 helmet-only frames in the window, vest needs 60% of the (up to 8) frames: 5 frames
  const vest = Array.from({ length: 6 }, () => t.update([worker(0, ['helmet', 'vest'])]));
  assert.deepEqual(vest.map((r) => r.events.map((e) => e.items)), [[], [], [], [], [['vest']], []], 'a new item is logged once');
});

test('verdict calms down once the violation stops', () => {
  const t = new WorkerTracker({ window: 4 });
  for (let i = 0; i < 4; i++) t.update([worker(0, ['helmet'])]);
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push(t.update([worker(0)]).workers[0].status);
  assert.deepEqual(statuses, ['VIOLATION', 'SAFE', 'SAFE']);
});

test('unclear items are smoothed too, and never pass through safe on the way to a violation', () => {
  const t = new WorkerTracker();
  t.update([worker(0, [], ['vest'])]);
  assert.equal(t.update([worker(0, [], ['vest'])]).workers[0].status, 'UNCLEAR');
  const statuses = Array.from({ length: 6 }, () => t.update([worker(0, ['vest'])]).workers[0]);
  assert.ok(statuses.every((w) => w.status !== 'SAFE'), statuses.map((w) => w.status).join());
  const last = statuses.at(-1);
  assert.deepEqual([last.status, last.unseen], ['VIOLATION', []]);
});

test('logToCSV writes header, local time, id and quoted items', () => {
  const csv = logToCSV([{ time: new Date(2026, 9, 24, 7, 5, 9), id: 3, items: ['Tanpa helm', 'Tanpa rompi'] }]);
  assert.equal(csv, 'waktu,pekerja,pelanggaran\n2026-10-24 07:05:09,#3,"Tanpa helm, Tanpa rompi"\n');
});
