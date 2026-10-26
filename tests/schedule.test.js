// Draai met: TZ=Europe/Amsterdam node tests/schedule.test.js
const assert = require('assert');
const S = require('../www/js/schedule.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓', name); }
  catch (e) { console.error('✗', name, '\n ', e.message); process.exitCode = 1; }
}
const D = (s) => S.parseDateTime(s);
const fmt = (arr) => arr.map((d) => S.ymd(d) + ' ' + S.hm(d));

test('dagelijks, twee tijden, venster van 2 dagen', () => {
  const med = { id: 'a', schedule: { kind: 'daily', times: ['20:00', '08:00'], startDate: '2026-10-01' } };
  assert.deepStrictEqual(fmt(S.dosesBetween(med, D('2026-10-26T00:00'), D('2026-10-28T00:00'))),
    ['2026-10-26 08:00', '2026-10-26 20:00', '2026-10-27 08:00', '2026-10-27 20:00']);
});

test('dagelijks respecteert startdatum en einddatum (inclusief)', () => {
  const med = { id: 'a', schedule: { kind: 'daily', times: ['09:00'], startDate: '2026-10-27', endDate: '2026-10-28' } };
  assert.deepStrictEqual(fmt(S.dosesBetween(med, D('2026-10-25T00:00'), D('2026-11-01T00:00'))),
    ['2026-10-27 09:00', '2026-10-28 09:00']);
});

test('bepaalde weekdagen (ma/wo/vr)', () => {
  const med = { id: 'a', schedule: { kind: 'weekdays', times: ['09:00'], days: [1, 3, 5], startDate: '2026-10-01' } };
  // 26 okt 2026 is een maandag
  assert.deepStrictEqual(fmt(S.dosesBetween(med, D('2026-10-26T00:00'), D('2026-11-02T00:00'))),
    ['2026-10-26 09:00', '2026-10-28 09:00', '2026-10-30 09:00']);
});

test('interval elke 8 uur, start midden in venster', () => {
  const med = { id: 'a', schedule: { kind: 'interval', everyHours: 8, startTime: '07:00', startDate: '2026-10-26' } };
  assert.deepStrictEqual(fmt(S.dosesBetween(med, D('2026-10-26T10:00'), D('2026-10-27T10:00'))),
    ['2026-10-26 15:00', '2026-10-26 23:00', '2026-10-27 07:00']);
});

test('interval over de wintertijd-wissel telt echte uren', () => {
  // In de nacht van 24 op 25 okt 2026 gaat de klok een uur terug
  const med = { id: 'a', schedule: { kind: 'interval', everyHours: 12, startTime: '20:00', startDate: '2026-10-24' } };
  const r = fmt(S.dosesBetween(med, D('2026-10-24T00:00'), D('2026-10-26T00:00')));
  assert.deepStrictEqual(r, ['2026-10-24 20:00', '2026-10-25 07:00', '2026-10-25 19:00']);
});

test('dagelijks blijft op kloktijd rond de wintertijd-wissel', () => {
  const med = { id: 'a', schedule: { kind: 'daily', times: ['08:00'], startDate: '2026-10-24' } };
  assert.deepStrictEqual(fmt(S.dosesBetween(med, D('2026-10-24T00:00'), D('2026-10-27T00:00'))),
    ['2026-10-24 08:00', '2026-10-25 08:00', '2026-10-26 08:00']);
});

test('kuur stopt na einddatum', () => {
  const med = { id: 'a', schedule: { kind: 'course', times: ['08:00', '20:00'], startDate: '2026-10-26', endDate: '2026-10-27' } };
  assert.strictEqual(S.dosesBetween(med, D('2026-10-20T00:00'), D('2026-11-20T00:00')).length, 4);
});

test('eenmalig', () => {
  const med = { id: 'a', schedule: { kind: 'once', onceAt: '2026-10-27T14:30' } };
  assert.deepStrictEqual(fmt(S.dosesBetween(med, D('2026-10-26T00:00'), D('2026-11-01T00:00'))), ['2026-10-27 14:30']);
  assert.strictEqual(S.dosesBetween(med, D('2026-10-28T00:00'), D('2026-11-01T00:00')).length, 0);
});

test('gepauzeerd medicijn geeft geen innames', () => {
  const med = { id: 'a', active: false, schedule: { kind: 'daily', times: ['08:00'], startDate: '2026-10-01' } };
  assert.strictEqual(S.dosesBetween(med, D('2026-10-26T00:00'), D('2026-10-28T00:00')).length, 0);
});

test('status: gepland, nu, gemist, ingenomen', () => {
  const med = { id: 'a', remind: { every: 10, count: 3 } };
  const due = D('2026-10-26T08:00');
  assert.strictEqual(S.statusOf(med, due, null, D('2026-10-26T07:00')), 'planned');
  assert.strictEqual(S.statusOf(med, due, null, D('2026-10-26T08:20')), 'due');
  assert.strictEqual(S.statusOf(med, due, null, D('2026-10-26T09:30')), 'missed');
  assert.strictEqual(S.statusOf(med, due, { s: 'taken' }, D('2026-10-26T09:30')), 'taken');
});

test('doseKey heen en terug', () => {
  const k = S.doseKey('m_1', D('2026-10-26T08:00'));
  assert.strictEqual(k, 'm_1@2026-10-26T08:00');
  const p = S.parseDoseKey(k);
  assert.strictEqual(p.medId, 'm_1');
  assert.strictEqual(S.hm(p.due), '08:00');
});

test('omschrijvingen', () => {
  assert.strictEqual(S.describe({ schedule: { kind: 'daily', times: ['08:00', '20:00'] } }), 'Elke dag om 08:00 en 20:00');
  assert.strictEqual(S.describe({ schedule: { kind: 'weekdays', times: ['09:00'], days: [1, 3, 5] } }), 'ma, wo, vr om 09:00');
  assert.strictEqual(S.describe({ schedule: { kind: 'interval', everyHours: 6, startTime: '06:00' } }), 'Elke 6 uur vanaf 06:00');
  assert.strictEqual(S.describe({ schedule: { kind: 'once', onceAt: '2026-10-27T14:30' } }), 'Eenmalig op di 27 okt om 14:30');
});

test('validatie', () => {
  assert.deepStrictEqual(S.validate({ name: 'X', schedule: { kind: 'daily', times: ['08:00'] } }), []);
  assert.ok(S.validate({ name: '', schedule: { kind: 'daily', times: ['08:00'] } }).length);
  assert.ok(S.validate({ name: 'X', schedule: { kind: 'course', times: ['08:00'] } }).length);
  assert.ok(S.validate({ name: 'X', schedule: { kind: 'weekdays', times: ['08:00'], days: [] } }).length);
});

console.log(`\n${passed} tests geslaagd`);
