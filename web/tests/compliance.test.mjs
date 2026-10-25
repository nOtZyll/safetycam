import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, assessWorkers, ruleThresholds, summaryText, workerText } from '../js/compliance.js';

const det = (name, box = [0, 0, 1, 1], score = 0.9) => ({ name, score, box });
// A worker 400 px tall in a 1000 px image, with gear boxes placed inside them.
const person = (x = 0) => det('Person', [x, 100, x + 100, 500]);
const head = (name, x = 0) => det(name, [x + 30, 90, x + 70, 140]);
const torso = (name, x = 0) => det(name, [x + 20, 180, x + 80, 300]);
const RULES = {
  helmet: { method: 'absen', worn_conf: 0.15, min_h: 0.3 },
  vest: { method: 'absen', worn_conf: 0.15, min_h: 0.0 },
  gloves: { method: 'absen', worn_conf: 0.15, min_h: 0.3 },
  goggles: { method: 'detektor' },
};
const opts = { imgH: 1000, rules: RULES };

test('worker with helmet and vest is safe', () => {
  const r = assess([person(), head('helmet'), torso('vest')], opts);
  assert.equal(r.status, 'SAFE');
  assert.equal(r.workerList[0].status, 'SAFE');
  assert.equal(summaryText(r), '1 pekerja terdeteksi, semua memakai APD wajib.');
});

test('absence rule: tall worker without a helmet box is a violation', () => {
  const r = assess([person(), torso('vest')], opts);
  assert.equal(r.status, 'VIOLATION');
  assert.deepEqual(r.workerList[0].missing, ['helmet']);
  assert.equal(workerText(r.workerList[0]), 'tanpa helm');
  assert.equal(summaryText(r), '1 dari 1 pekerja melanggar: 1 tanpa helm.');
});

test('absence rule skips small workers: missing helmet is only unclear', () => {
  const small = det('Person', [0, 100, 50, 300]); // 200 px < 0.3 * 1000
  const r = assess([small, det('vest', [5, 150, 45, 220])], opts);
  assert.equal(r.status, 'UNCLEAR');
  assert.deepEqual(r.workerList[0].unseen, ['helmet']);
  assert.equal(workerText(r.workerList[0]), 'helm tidak terlihat');
});

test('small worker with a no_helmet box is still a violation', () => {
  const small = det('Person', [0, 100, 50, 300]);
  const r = assess([small, det('vest', [5, 150, 45, 220]), det('no_helmet', [10, 95, 40, 130])], opts);
  assert.equal(r.status, 'VIOLATION');
  assert.deepEqual(r.workerList[0].missing, ['helmet']);
});

test('without rules every item falls back to the no_* detector', () => {
  const r = assess([person(), torso('vest')], { imgH: 1000 });
  assert.equal(r.status, 'UNCLEAR');
  assert.equal(assess([person(), torso('vest'), head('no_helmet')], { imgH: 1000 }).status, 'VIOLATION');
});

test('optional items are judged by the detector only, not by absence', () => {
  // gloves has an absence rule, but gloves are not required, so a bare-handed worker is fine
  const r = assess([person(), head('helmet'), torso('vest')], opts);
  assert.deepEqual(r.workerList[0].missing, []);
  const g = assess([person(), head('helmet'), torso('vest'), det('no_gloves', [0, 300, 20, 330])], opts);
  assert.deepEqual(g.workerList[0].missing, ['gloves']);
});

test('"none" box counts as a missing vest', () => {
  const r = assess([person(), head('helmet'), torso('none')], { imgH: 1000 });
  assert.equal(r.status, 'VIOLATION');
  assert.equal(summaryText(r), '1 dari 1 pekerja melanggar: 1 tanpa rompi.');
});

test('worn detection beats a conflicting no_* box, which is reported as overridden', () => {
  const noHelmet = head('no_helmet');
  const r = assess([person(), head('helmet'), noHelmet, torso('vest')], opts);
  assert.equal(r.status, 'SAFE');
  assert.deepEqual(r.overridden, [noHelmet]);
  assert.deepEqual(assess([person(), torso('vest'), head('no_helmet')], opts).overridden, []);
});

test('gear is assigned to the right worker, workers numbered left to right', () => {
  const dets = [person(300), head('helmet', 300), torso('vest', 300), person(0), torso('vest', 0)];
  const { workers } = assessWorkers(dets, opts);
  assert.deepEqual(workers.map((w) => w.box[0]), [0, 300]);
  assert.deepEqual(workers.map((w) => w.status), ['VIOLATION', 'SAFE']);
  const r = assess(dets, opts);
  assert.equal(summaryText(r), '1 dari 2 pekerja melanggar: 1 tanpa helm.');
  assert.deepEqual(r.violations.map((v) => [v.name, v.count]), [['helmet', 1]]);
});

test('helmet sticking out above the person box is still assigned (box expansion)', () => {
  const r = assess([person(), det('helmet', [30, 70, 70, 115]), torso('vest')], opts);
  assert.equal(r.workerList[0].status, 'SAFE');
});

test('missing-PPE box outside every worker still makes the image a violation', () => {
  const r = assess([person(), head('helmet'), torso('vest'), det('no_helmet', [700, 100, 750, 150])], opts);
  assert.equal(r.status, 'VIOLATION');
  assert.equal(r.workerList[0].status, 'SAFE');
  assert.equal(summaryText(r), '1 tanpa helm');
});

test('PPE without any person box is safe; nothing at all is no worker', () => {
  assert.equal(assess([det('helmet')], opts).status, 'SAFE');
  assert.equal(assess([], opts).status, 'NO_WORKER');
});

test('required list is configurable', () => {
  const dets = [person(), head('helmet'), torso('vest')];
  // gloves required and judged by absence: bare hands on a tall worker are a violation
  const g = assess(dets, { ...opts, required: ['helmet', 'vest', 'gloves'] });
  assert.equal(g.status, 'VIOLATION');
  assert.deepEqual(g.workerList[0].missing, ['gloves']);
  // goggles use the detector rule: not seen and not reported missing means unclear
  const k = assess(dets, { ...opts, required: ['helmet', 'goggles'] });
  assert.equal(k.status, 'UNCLEAR');
  assert.deepEqual(k.workerList[0].unseen, ['goggles']);
  // nothing required: a bare-headed worker is only flagged by a no_* box
  assert.equal(assess([person()], { ...opts, required: [] }).status, 'SAFE');
  assert.equal(assess([person(), head('no_helmet')], { ...opts, required: [] }).status, 'VIOLATION');
});

test('ruleThresholds lowers the worn threshold only for required absence items', () => {
  const names = ['helmet', 'gloves'];
  const base = { helmet: 0.544, gloves: 0.4 };
  const thr = (required) => ruleThresholds(names, base, RULES, { required }).map((v) => +v.toFixed(3));
  assert.deepEqual(thr(['helmet']), [0.15, 0.4]);
  assert.deepEqual(thr(['helmet', 'gloves']), [0.15, 0.15]);
  assert.deepEqual(thr([]), [0.544, 0.4]);
});

test('ruleThresholds uses worn_conf for required absence items, offset moves it the other way', () => {
  const names = ['helmet', 'vest', 'gloves', 'goggles', 'no_helmet'];
  const base = { helmet: 0.544, vest: 0.4, gloves: 0.4, goggles: 0.474, no_helmet: 0.1 };
  const r = (offset) => ruleThresholds(names, base, RULES, { offset }).map((v) => +v.toFixed(3));
  assert.deepEqual(r(0), [0.15, 0.15, 0.4, 0.474, 0.1]);
  assert.deepEqual(r(0.1), [0.25, 0.25, 0.3, 0.374, 0.05]);
  assert.deepEqual(ruleThresholds(names, base, {}).map((v) => +v.toFixed(3)), [0.544, 0.4, 0.4, 0.474, 0.1]);
});
