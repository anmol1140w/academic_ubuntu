// No packages or build step: node tests/academic-os.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const clone = value => JSON.parse(JSON.stringify(value));

function storage() {
  const values = new Map();
  return {
    values, failReads: false, failWrites: false, failKey: null,
    getItem(key) { if (this.failReads) throw Error('Storage denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (this.failWrites || this.failKey === key) throw Error('Quota exceeded'); values.set(key, value); }
  };
}
function app(saved = storage()) {
  let now = Date.UTC(2026, 9, 1, 12);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  let serial = 0;
  const intervals = new Map();
  const context = vm.createContext({
    console, localStorage: saved, Date: Clock, module: { exports: {} },
    window: { setInterval: fn => { intervals.set(++serial, fn); return serial; }, clearInterval: id => intervals.delete(id),
      setTimeout: () => ++serial, clearTimeout() {}, confirm: () => true }
  });
  vm.runInContext(source, context);
  // UI rendering is not the subject of these unit/integration tests. All data functions remain real.
  vm.runInContext('render = () => {};', context);
  const run = code => vm.runInContext(code, context);
  return { context, run, saved, intervals, advance: ms => { now += ms; }, value: code => clone(run(code)) };
}
function legacy() {
  const data = app().value('seedState()');
  data.version = 1;
  data.recurring.forEach(item => { delete item.startDate; delete item.endDate; delete item.skippedDates; });
  data.tasks[0].done = true; data.tasks[0].actualSeconds = 125;
  data.tasks[1].recurringId = 'template-deleted-in-v1';
  data.timer = { taskId: data.tasks[2].id, startedAt: Date.UTC(2026, 9, 1, 11) };
  data.reviews.push({ date: '2026-10-01', completed: 'PYQs', missed: '', longer: '', distraction: '', next: 'Revision' });
  data.applications.push({ company: 'Example', role: 'Intern', applied: '', referral: '', status: 'To apply', nextAction: '' });
  data.extraNote = 'Keep unknown fields too';
  return data;
}
function rejects(mutator, expected) {
  const instance = app(); const data = instance.value('seedState()');
  mutator(data); instance.context.input = data;
  assert.throws(() => instance.run('validateImportedData(input)'), error => expected.test(error.message));
}
function recurrenceApp() {
  const a = app();
  a.run(`state.tasks = []; state.recurring = [template('Old title', 'gate', [4], '10:00', '11:00', 60)];
    state.recurring[0].id = 'series'; state.timer = null;
    instantiateRecurringForDate('2026-10-01'); instantiateRecurringForDate('2026-10-08'); instantiateRecurringForDate('2026-10-15');
    const changes = { title: 'New title', category: 'gate', date: '2026-10-08', duration: 90, start: '10:00', end: '11:30', output: '8 PYQs', notes: '' };`);
  return a;
}

test('dates: Monday weeks, leap days, month/year boundaries and DST-safe shifts', () => {
  const a = app();
  assert.deepEqual(a.value("getWeekDates('2026-10-04')"), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(a.run("shiftDate('2026-12-31', 1)"), '2027-01-01');
  assert.equal(a.run("shiftDate('2024-02-28', 1)"), '2024-02-29');
  assert.equal(a.run("shiftDate('2026-03-08', 1)"), '2026-03-09');
  assert.equal(a.run("isValidDateString('2026-02-30')"), false);
});

test('migration: real v1 startup preserves every record, unknown fields, orphan history and timer', () => {
  const data = legacy(), saved = storage(); saved.setItem('academic-os-v1', JSON.stringify(data));
  const a = app(saved), loaded = a.value('state');
  assert.equal(loaded.version, 3); assert.equal(a.run('loadFailure'), null);
  for (const name of ['tasks', 'gate', 'dsa', 'projects', 'applications', 'reviews']) assert.deepEqual(loaded[name], data[name]);
  assert.equal(loaded.extraNote, data.extraNote);
  assert.deepEqual(loaded.timer, { paused: false, ...data.timer });
  data.recurring.forEach((item, index) => Object.keys(item).forEach(key => assert.deepEqual(loaded.recurring[index][key], item[key])));
  assert.equal(a.run('saveState()'), true);
  assert.deepEqual(app(saved).value('state.tasks'), data.tasks);
});

test('migration: versionless v1, v2 and current data upgrade without mutating input', () => {
  const a = app(), data = legacy(); delete data.version; a.context.input = data;
  const before = clone(data); assert.equal(a.run('migrateData(input).version'), 3); assert.deepEqual(data, before);
  a.run('input = migrateV1ToV2(input)'); assert.equal(a.run('migrateData(input).version'), 3);
  const current = a.value('seedState()'); a.context.input = current;
  assert.deepEqual(a.value('migrateData(input)'), current);
});

test('saving: quota errors keep memory and previous disk state; recovery records last saved', () => {
  const a = app(); assert.equal(a.run('saveState()'), true);
  const disk = a.saved.getItem('academic-os-v1'); a.saved.failWrites = true;
  a.run("state.tasks[0].title = 'Unsaved work'");
  assert.equal(a.run('saveState()'), false); assert.equal(a.run('storageStatus.ok'), false);
  assert.equal(a.saved.getItem('academic-os-v1'), disk); assert.equal(a.run('state.tasks[0].title'), 'Unsaved work');
  assert.match(a.run('renderSettings()'), /Storage error/);
  a.saved.failWrites = false; assert.equal(a.run('saveState()'), true);
  assert.match(a.run('renderSettings()'), /Last saved:/); assert.equal(app(a.saved).run('state.tasks[0].title'), 'Unsaved work');
});

test('saving: corrupt, unsupported and inaccessible storage is never overwritten on startup', () => {
  for (const raw of ['{bad json', JSON.stringify({ ...legacy(), version: 99 })]) {
    const saved = storage(); saved.setItem('academic-os-v1', raw); const a = app(saved);
    a.run("ensureDates(['2026-10-01'])"); assert.equal(a.run('saveState()'), false);
    assert.equal(saved.getItem('academic-os-v1'), raw); assert.ok(a.run('loadFailure'));
  }
  const saved = storage(); saved.failReads = true;
  const a = app(saved); assert.equal(a.run('saveState()'), false); assert.equal(saved.values.size, 0);
});

test('timer: start is persisted; reload counts closed-page time without double counting', () => {
  const a = app(); a.run('toggleTimer(state.tasks[1].id)'); a.advance(65000);
  const resumed = app(a.saved); resumed.advance(65000);
  assert.equal(resumed.run('taskProgress(state.tasks[1])'), 65);
  resumed.run('stopTimer()'); assert.equal(resumed.run('state.tasks[1].actualSeconds'), 65);
  assert.equal(app(a.saved).run('state.tasks[1].actualSeconds'), 65);
});

test('timer: pause/reload/resume excludes paused time; stop and switch settle once', () => {
  const a = app(); a.run('toggleTimer(state.tasks[1].id)'); a.advance(61000); a.run('pauseResumeTimer()');
  assert.equal(a.run('state.tasks[1].actualSeconds'), 61); assert.equal(a.intervals.size, 0);
  const b = app(a.saved); b.advance(3600000); b.run('syncTimerInterval()');
  assert.equal(b.run('taskProgress(state.tasks[1])'), 61); assert.equal(b.intervals.size, 0);
  b.run('pauseResumeTimer()'); b.advance(19000); b.run('toggleTimer(state.tasks[2].id)');
  assert.equal(b.run('state.tasks[1].actualSeconds'), 80); assert.equal(b.intervals.size, 1);
  b.advance(5000); b.run('stopTimer(); stopTimer()'); assert.equal(b.run('state.tasks[2].actualSeconds'), 5);
  assert.equal(b.run('timerElapsed({startedAt: Date.now() + 1000}, Date.now())'), 0);
});

test('recurrence: generation is idempotent, copies output and respects inclusive start/end dates', () => {
  const a = recurrenceApp();
  a.run(`state.tasks = []; Object.assign(state.recurring[0], {startDate: '2026-10-08', endDate: '2026-10-15', output: '8 PYQs'});
    ['2026-10-01','2026-10-08','2026-10-08','2026-10-15','2026-10-22'].forEach(instantiateRecurringForDate)`);
  assert.deepEqual(a.value('state.tasks.map(t => t.date)'), ['2026-10-08', '2026-10-15']);
  assert.equal(a.run('state.tasks[0].output'), '8 PYQs');
});

test('recurrence: skip/deletion survives regeneration, reload and undo without losing recorded time', () => {
  const a = recurrenceApp(); a.run('state.tasks[0].actualSeconds = 17; skipTask(state.tasks[0].id)');
  const b = app(a.saved); b.run("instantiateRecurringForDate('2026-10-01')");
  assert.equal(b.run('state.tasks.filter(t => t.date === "2026-10-01").length'), 1);
  assert.equal(b.run('state.tasks[0].skipped'), true); assert.equal(b.run('state.tasks[0].actualSeconds'), 17);
  b.run('unskipTask(state.tasks[0].id)'); assert.equal(b.run('state.tasks[0].skipped'), false);
  b.run('deleteTask(state.tasks[0].id)'); b.run("instantiateRecurringForDate('2026-10-01')");
  assert.equal(b.run('state.tasks.length'), 3); assert.equal(b.run('state.tasks[0].skipped'), true);
});

test('recurrence: only-this-day move does not regenerate the original or block another occurrence', () => {
  const a = recurrenceApp();
  a.run(`editRecurringTask(state.tasks[1].id, {...changes, date: '2026-10-15'}, 'day', [4], null);
    instantiateRecurringForDate('2026-10-08'); instantiateRecurringForDate('2026-10-15')`);
  assert.equal(a.run('state.tasks.length'), 3);
  assert.equal(a.run('state.tasks[1].title'), 'New title'); assert.equal(a.run('state.recurring[0].title'), 'Old title');
  assert.equal(a.run('state.tasks[1].occurrenceDate'), '2026-10-08');
  a.run('saveState()'); assert.equal(app(a.saved).run('state.tasks[1].date'), '2026-10-15');
});

test('recurrence: all-future split preserves generated and ungenerated past plus completed records', () => {
  const a = recurrenceApp(); a.run(`state.tasks[2].done = true; state.tasks[2].actualSeconds = 42;
    editRecurringTask(state.tasks[1].id, changes, 'future', [4], '2026-10-22');
    instantiateRecurringForDate('2026-09-24'); instantiateRecurringForDate('2026-10-22'); instantiateRecurringForDate('2026-10-29')`);
  assert.equal(a.run('state.tasks[0].title'), 'Old title'); assert.equal(a.run('state.tasks[1].title'), 'New title');
  assert.equal(a.run('state.tasks[2].title'), 'Old title'); assert.equal(a.run('state.tasks[2].actualSeconds'), 42);
  assert.equal(a.run("state.tasks.find(t => t.date === '2026-09-24').title"), 'Old title');
  assert.equal(a.run("state.tasks.find(t => t.date === '2026-10-22').title"), 'New title');
  assert.equal(a.run("state.tasks.some(t => t.date === '2026-10-29')"), false);
});

test('recurrence: shortening removes already-generated future plans but retains worked history', () => {
  const a = recurrenceApp(); a.run(`instantiateRecurringForDate('2026-10-22'); state.tasks[3].actualSeconds = 9;
    editRecurringTask(state.tasks[1].id, changes, 'future', [4], '2026-10-08')`);
  assert.equal(a.run("state.tasks.some(t => t.date === '2026-10-15')"), false);
  assert.equal(a.run("state.tasks.find(t => t.date === '2026-10-22').actualSeconds"), 9);
  a.run('validateImportedData(JSON.parse(serializeState()))');
});

test('export/import: full round trip preserves all records, extensions and paused timer', () => {
  const a = app(); a.run('toggleTimer(state.tasks[1].id)'); a.advance(6000); a.run('pauseResumeTimer()');
  const before = a.value('state'); a.context.text = a.run('serializeState()');
  assert.equal(a.run('importText(text)'), true);
  const after = a.value('state'); delete before.lastSavedAt; delete after.lastSavedAt; assert.deepEqual(after, before);
  assert.equal(a.run('state.timer.paused'), true);
});

test('import: saves exact current backup first and restore persists it across reload', () => {
  const a = app(); const old = a.value('state'); a.run("const incoming = seedState(); incoming.tasks[0].title = 'Imported';");
  assert.equal(a.run('importText(JSON.stringify(incoming))'), true);
  assert.deepEqual(JSON.parse(a.saved.getItem('academic-os-last-backup-v1')), old);
  assert.equal(a.run('state.tasks[0].title'), 'Imported'); assert.equal(a.run('restoreLastBackup()'), true);
  assert.equal(app(a.saved).run('state.tasks[0].title'), old.tasks[0].title);
});

test('import: malformed JSON or validation failure leaves state unchanged and keeps backup', () => {
  const a = app(), before = a.value('state');
  for (const text of ['{', '{}', 'null']) { a.context.text = text; assert.equal(a.run('importText(text)'), false); assert.deepEqual(a.value('state'), before); }
  assert.deepEqual(JSON.parse(a.saved.getItem('academic-os-last-backup-v1')), before);
});

test('import: backup write failure aborts replacement; main save failure keeps imported data in memory', () => {
  const a = app(), before = a.value('state'); a.run("const incoming = seedState(); incoming.tasks[0].title = 'Incoming'");
  a.saved.failKey = 'academic-os-last-backup-v1'; assert.equal(a.run('importText(JSON.stringify(incoming))'), false);
  assert.deepEqual(a.value('state'), before);
  a.saved.failKey = 'academic-os-v1'; assert.equal(a.run('importText(JSON.stringify(incoming))'), true);
  assert.equal(a.run('state.tasks[0].title'), 'Incoming'); assert.equal(a.run('storageStatus.ok'), false);
  assert.deepEqual(JSON.parse(a.saved.getItem('academic-os-last-backup-v1')), before);
});

test('validation: rejects impossible dates, wrong times, durations, categories, missing/duplicate IDs', () => {
  rejects(d => { d.tasks[0].date = '2026-02-30'; }, /date/);
  rejects(d => { d.tasks[0].start = '25:00'; }, /times/);
  rejects(d => { d.tasks[0].end = 0; }, /times/);
  for (const duration of ['90', -1, 0, 0.5, 1441]) rejects(d => { d.tasks[0].duration = duration; }, /duration/);
  rejects(d => { d.tasks[0].category = 'unknown'; }, /category/);
  rejects(d => { delete d.tasks[0].id; }, /id/);
  rejects(d => { d.recurring[0].id = d.tasks[0].id; }, /Duplicate id/);
  rejects(d => { d.tasks[1].id = d.tasks[0].id; }, /Duplicate id/);
});

test('validation: rejects bad nested types in both v1 and current backups before migration', () => {
  for (const version of [1, 3]) {
    rejects(d => { d.version = version; d.tasks = {}; }, /tasks must be an array/);
    rejects(d => { d.version = version; d.recurring[0] = null; }, /object/);
    rejects(d => { d.version = version; d.recurring[0].skippedDates = 'bad'; }, /skippedDates/);
    rejects(d => { d.version = version; d.tasks[0].done = 'false'; }, /done/);
    rejects(d => { d.version = version; d.tasks[0].notes = {}; }, /notes/);
    rejects(d => { d.version = version; d.gate[0].status = {}; }, /status/);
    rejects(d => { d.version = version; d.dsa[0].solved = '3'; }, /solved/);
  }
  rejects(d => { d.recurring[0].days = [1, 1]; }, /duplicates/);
  rejects(d => { d.recurring[0].days = [7]; }, /weekday/);
  rejects(d => { d.recurring[0].evenSaturday = 'true'; }, /boolean/);
  rejects(d => { d.timer = { taskId: d.tasks[0].id, paused: false, startedAt: null }; }, /startedAt/);
  rejects(d => { d.timer = { taskId: 'missing', paused: false, startedAt: 12 }; }, /taskId/);
  rejects(d => { d.version = 99; }, /newer/);
  rejects(d => { d.version = '1'; }, /version/);
});

test('service worker: waiting activation is explicit and only old planner caches are deleted', async () => {
  const events = {}, deleted = []; let skipped = 0, claimed = 0, cached = 0;
  const context = vm.createContext({ Request, URL,
    self: { addEventListener: (name, fn) => { events[name] = fn; }, skipWaiting: () => { skipped++; return Promise.resolve(); }, clients: { claim: () => { claimed++; } } },
    caches: { open: async () => ({ addAll: async () => { cached++; } }), keys: async () => ['academic-os-v1', 'academic-os-v2', 'another-app'], delete: async key => { deleted.push(key); } }
  });
  // Node Request requires absolute URLs; emulate the browser's relative URL resolution only.
  context.Request = class extends Request { constructor(url, options) { super(new URL(url, 'http://localhost/'), options); } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), context);
  let job; const waitUntil = promise => { job = promise; };
  events.install({ waitUntil }); await job; assert.equal(cached, 1); assert.equal(skipped, 0);
  events.activate({ waitUntil }); await job; assert.deepEqual(deleted, ['academic-os-v1']); assert.equal(claimed, 1);
  events.message({ data: { type: 'SKIP_WAITING' }, waitUntil }); await job; assert.equal(skipped, 1);
});

test('service worker UI: Refresh messages waiting worker, reloads only after controllerchange', async () => {
  const a = app(), listeners = {}, buttons = {}; let reloads = 0, sent = 0, visible = false;
  const registration = { waiting: { postMessage: message => { assert.equal(message.type, 'SKIP_WAITING'); sent++; } }, addEventListener() {} };
  a.context.navigator = { serviceWorker: { controller: { postMessage() { throw Error('Wrong worker'); } },
    register: async () => registration, addEventListener: (name, fn) => { listeners[name] = fn; } } };
  a.context.document = { activeElement: { blur() {} }, getElementById: id => ({
    classList: { remove: () => { visible = true; }, contains: () => true, toggle() {} },
    addEventListener: (name, fn) => { buttons[id] = fn; }
  }) };
  a.context.window.location = { reload: () => { reloads++; } };
  a.run('setupServiceWorkerUpdates()'); await Promise.resolve();
  assert.equal(visible, true); buttons['refresh-version'](); assert.equal(sent, 1); assert.equal(reloads, 0);
  listeners.controllerchange(); assert.equal(reloads, 1);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); passed++; }
    catch (error) { console.error(`not ok - ${name}`); console.error(error); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} tests passed`);
})();
