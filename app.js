const STORAGE_KEY = 'academic-os-v1';
const BACKUP_STORAGE_KEY = 'academic-os-last-backup-v1';
const CURRENT_SCHEMA_VERSION = 3;
const PLANNING_START = '2026-10-01';
const VALID_CATEGORIES = ['gate', 'dsa', 'project', 'internship', 'college', 'wellbeing', 'admin'];
let storageStatus = { ok: true, lastSavedAt: null, error: null };
let loadFailure = null;
let lastFocusedElement = null;
let modalFocusTimeout = null;

const categoryLabels = {
  gate: 'GATE', dsa: 'DSA', project: 'Project', internship: 'Internship',
  college: 'College', wellbeing: 'Wellbeing', admin: 'Admin'
};
const categoryIcons = { gate: '◆', dsa: '◇', project: '▣', internship: '↗', college: '▤', wellbeing: '♥', admin: '•' };
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let state;
let currentView = 'today';
let currentTrack = 'gate';
let timerInterval = null;
let toastTimeout = null;

function id(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad(value) { return String(value).padStart(2, '0'); }
function dateKey(date) { return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function parseDate(value) { const [y, m, d] = value.split('-').map(Number); const date = new Date(0); date.setFullYear(y, m - 1, d); date.setHours(12, 0, 0, 0); return date; }
function shiftDate(value, amount) { const date = parseDate(value); date.setDate(date.getDate() + amount); return dateKey(date); }
function getWeekStart(value) { const date = parseDate(value); const day = date.getDay(); date.setDate(date.getDate() - (day === 0 ? 6 : day - 1)); return dateKey(date); }
function getWeekDates(value) { const start = getWeekStart(value); return Array.from({ length: 7 }, (_, index) => shiftDate(start, index)); }
function weekday(value) { return parseDate(value).getDay(); }
function formatLongDate(value) { const date = parseDate(value); return `${dayNames[date.getDay()]}, ${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`; }
function formatShortDate(value) { const date = parseDate(value); return `${shortDays[date.getDay()]} ${date.getDate()} ${monthNames[date.getMonth()].slice(0, 3)}`; }
function todayLabel(value) { return value === PLANNING_START ? 'Planning baseline' : value === dateKey(new Date()) ? 'Today' : formatShortDate(value); }
function timeToMinutes(value) { if (!value) return 9999; const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function formatMinutes(total) { const minutes = Math.max(0, Math.round(total)); if (minutes < 60) return `${minutes}m`; const hours = Math.floor(minutes / 60); const remainder = minutes % 60; return remainder ? `${hours}h ${remainder}m` : `${hours}h`; }
function formatClock(value) { if (!value) return 'Flexible'; const [h, m] = value.split(':').map(Number); const suffix = h >= 12 ? 'PM' : 'AM'; const hour = h % 12 || 12; return `${hour}:${pad(m)} ${suffix}`; }
function formatRange(task) { if (!task.start && !task.end) return 'Flexible block'; if (task.start && task.end) return `${formatClock(task.start)}–${formatClock(task.end)}`; return formatClock(task.start || task.end); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = parseDate(value);
  return date.getFullYear() >= 1 && dateKey(date) === value;
}
function isValidTimeString(value) { return value === '' || (typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)); }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireString(value, path) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string.`); }
function requireDate(value, path) { if (!isValidDateString(value)) throw new Error(`${path} must be a valid YYYY-MM-DD date.`); }
function requireDuration(value, path) { if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error(`${path} must be an integer from 1 to 1440 minutes.`); }

function validateImportedData(raw) {
  if (!isPlainObject(raw)) throw new Error('Imported planner data must be a JSON object.');
  if (raw.version !== undefined && (!Number.isInteger(raw.version) || raw.version < 1)) throw new Error('Imported version must be a positive integer.');
  // Validate shapes before migrations: a migration must never turn bad input into an empty list.
  const arrays = ['tasks', 'recurring', 'gate', 'dsa', 'projects', 'applications', 'reviews'];
  arrays.forEach(name => {
    if (!Array.isArray(raw[name])) throw new Error(`${name} must be an array.`);
    raw[name].forEach((row, index) => { if (!isPlainObject(row)) throw new Error(`${name}[${index}] must be an object.`); });
  });
  const data = migrateData(raw);
  requireDate(data.selectedDate, 'selectedDate');
  if (data.lastSavedAt !== undefined && (typeof data.lastSavedAt !== 'string' || !Number.isFinite(Date.parse(data.lastSavedAt)))) throw new Error('lastSavedAt must be a valid timestamp string.');
  const ids = new Set();
  const rememberId = (value, path) => {
    requireString(value, `${path}.id`);
    if (ids.has(value)) throw new Error(`Duplicate id: ${value}.`);
    ids.add(value);
  };
  data.tasks.forEach((task, index) => {
    const path = `tasks[${index}]`;
    if (!isPlainObject(task)) throw new Error(`${path} must be an object.`);
    rememberId(task.id, path); requireString(task.title, `${path}.title`); requireDate(task.date, `${path}.date`);
    if (!VALID_CATEGORIES.includes(task.category)) throw new Error(`${path}.category is invalid.`);
    requireDuration(task.duration, `${path}.duration`);
    if (typeof task.actualSeconds !== 'number' || !Number.isFinite(task.actualSeconds) || task.actualSeconds < 0) throw new Error(`${path}.actualSeconds must be a non-negative number.`);
    if (typeof task.done !== 'boolean') throw new Error(`${path}.done must be boolean.`);
    if (task.skipped !== undefined && typeof task.skipped !== 'boolean') throw new Error(`${path}.skipped must be boolean.`);
    if (!isValidTimeString(task.start === undefined ? '' : task.start) || !isValidTimeString(task.end === undefined ? '' : task.end)) throw new Error(`${path}.start/end must be valid times.`);
    if (task.recurringId !== undefined) requireString(task.recurringId, `${path}.recurringId`);
    if (task.occurrenceDate !== undefined) requireDate(task.occurrenceDate, `${path}.occurrenceDate`);
    validateOptionalFields(task, path, ['output', 'notes', 'kind'], ['mandatory', 'exception']);
  });
  data.recurring.forEach((item, index) => {
    const path = `recurring[${index}]`;
    if (!isPlainObject(item)) throw new Error(`${path} must be an object.`);
    rememberId(item.id, path); requireString(item.title, `${path}.title`);
    if (!VALID_CATEGORIES.includes(item.category)) throw new Error(`${path}.category is invalid.`);
    requireDuration(item.duration, `${path}.duration`);
    if (!Array.isArray(item.days) || !item.days.length || item.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error(`${path}.days must contain weekday numbers 0–6.`);
    if (!isValidTimeString(item.start === undefined ? '' : item.start) || !isValidTimeString(item.end === undefined ? '' : item.end)) throw new Error(`${path}.start/end must be valid times.`);
    if (item.startDate !== null && item.startDate !== undefined) requireDate(item.startDate, `${path}.startDate`);
    if (item.endDate !== null && item.endDate !== undefined) requireDate(item.endDate, `${path}.endDate`);
    if (item.startDate && item.endDate && item.endDate < item.startDate && item.enabled) throw new Error(`${path}.endDate precedes startDate.`);
    if (new Set(item.days).size !== item.days.length) throw new Error(`${path}.days contains duplicates.`);
    validateOptionalFields(item, path, ['output', 'notes', 'kind'], ['mandatory', 'evenSaturday']);
    if (!Array.isArray(item.skippedDates) || item.skippedDates.some(date => !isValidDateString(date))) throw new Error(`${path}.skippedDates must contain valid dates.`);
    if (typeof item.enabled !== 'boolean') throw new Error(`${path}.enabled must be boolean.`);
  });
  // Old versions allowed deleting a template while keeping its task history.
  // These orphan recurringId references are valid and must not discard historical tasks.
  const trackerFields = {
    gate: ['subject', 'completed', 'pyq', 'revision', 'status'],
    dsa: ['topic', 'accuracy', 'weak', 'revision'],
    projects: ['name', 'status', 'milestone', 'next', 'priority'],
    applications: ['company', 'role', 'applied', 'referral', 'status', 'nextAction'],
    reviews: ['date', 'completed', 'missed', 'longer', 'distraction', 'next']
  };
  Object.entries(trackerFields).forEach(([name, fields]) => {
    data[name].forEach((row, index) => {
      const path = `${name}[${index}]`;
      fields.forEach(field => { if (typeof row[field] !== 'string') throw new Error(`${path}.${field} must be a string.`); });
      // Trackers in v1 do not have IDs. Check optional IDs without inventing any.
      if (row.id !== undefined) rememberId(row.id, path);
      if (name === 'dsa' && (!Number.isInteger(row.solved) || row.solved < 0)) throw new Error(`${path}.solved must be a non-negative integer.`);
      if (name === 'reviews') requireDate(row.date, `${path}.date`);
      if (name === 'applications' && row.applied !== '') requireDate(row.applied, `${path}.applied`);
    });
  });
  if (data.timer !== null) {
    if (!isPlainObject(data.timer)) throw new Error('timer must be null or an object.');
    if (typeof data.timer.taskId !== 'string' || !data.tasks.some(task => task.id === data.timer.taskId)) throw new Error('timer.taskId must reference a task.');
    if (typeof data.timer.paused !== 'boolean') throw new Error('timer.paused must be boolean.');
    if (!(data.timer.paused && data.timer.startedAt === null) && (!Number.isSafeInteger(data.timer.startedAt) || data.timer.startedAt < 0)) throw new Error('timer.startedAt must be a non-negative timestamp (or null when paused).');
  }
  return data;
}

function validateOptionalFields(row, path, strings, booleans) {
  strings.forEach(field => { if (row[field] !== undefined && typeof row[field] !== 'string') throw new Error(`${path}.${field} must be a string.`); });
  booleans.forEach(field => { if (row[field] !== undefined && typeof row[field] !== 'boolean') throw new Error(`${path}.${field} must be boolean.`); });
}

function serializeState(data = state) { return JSON.stringify({ ...data, version: CURRENT_SCHEMA_VERSION }, null, 2); }

function createBackup() {
  try {
    if (typeof localStorage === 'undefined') throw new Error('Browser storage is unavailable.');
    if (loadFailure) throw new Error('Cannot back up data that failed to load. Original storage is untouched.');
    localStorage.setItem(BACKUP_STORAGE_KEY, serializeState());
    return true;
  } catch (error) {
    setStorageStatus(false, error);
    showToast(`Backup failed: ${error.message || 'could not save backup'}`);
    return false;
  }
}

function readBackup() {
  try {
    const backup = typeof localStorage === 'undefined' ? null : localStorage.getItem(BACKUP_STORAGE_KEY);
    return backup ? validateImportedData(JSON.parse(backup)) : null;
  } catch (error) {
    throw new Error(`Last backup is invalid: ${error.message || 'could not read backup'}`);
  }
}

function template(title, category, days, start, end, duration, options = {}) {
  return {
    id: id('template'), title, category, days, start: start || '', end: end || '', duration,
    kind: options.kind || 'focus', mandatory: options.mandatory !== false,
    evenSaturday: options.evenSaturday || false, notes: options.notes || '', enabled: true,
    startDate: options.startDate || null, endDate: options.endDate || null, skippedDates: asArray(options.skippedDates)
  };
}

function seedState() {
  const recurring = [
    template('Gym — strength / conditioning', 'wellbeing', [1, 2, 3, 4, 5], '06:30', '07:45', 75, { kind: 'wellbeing', notes: 'Keep this flexible; shorten rather than remove sleep.' }),
    template('CVT Lab', 'college', [1], '09:00', '11:00', 120, { kind: 'fixed', notes: 'Fixed class commitment.' }),
    template('DW', 'college', [1], '11:00', '12:00', 60, { kind: 'fixed' }),
    template('AI', 'college', [1], '14:00', '15:00', 60, { kind: 'fixed' }),
    template('NLP', 'college', [1], '15:00', '16:00', 60, { kind: 'fixed' }),
    template('NLP Lab', 'college', [2], '09:00', '11:00', 120, { kind: 'fixed' }),
    template('DW', 'college', [2], '11:00', '12:00', 60, { kind: 'fixed' }),
    template('CVT', 'college', [2], '13:00', '14:00', 60, { kind: 'fixed' }),
    template('AI', 'college', [2], '14:00', '15:00', 60, { kind: 'fixed' }),
    template('DW', 'college', [3], '12:00', '13:00', 60, { kind: 'fixed' }),
    template('NLP', 'college', [3], '14:00', '15:00', 60, { kind: 'fixed' }),
    template('CN', 'college', [3], '15:00', '16:00', 60, { kind: 'fixed' }),
    template('CVT', 'college', [3], '16:00', '17:00', 60, { kind: 'fixed' }),
    template('AI Lab', 'college', [4], '09:00', '11:00', 120, { kind: 'fixed' }),
    template('CVT', 'college', [4], '13:00', '14:00', 60, { kind: 'fixed' }),
    template('AI', 'college', [4], '14:00', '15:00', 60, { kind: 'fixed' }),
    template('CN', 'college', [4], '15:00', '16:00', 60, { kind: 'fixed' }),
    template('NLP', 'college', [4], '16:00', '17:00', 60, { kind: 'fixed' }),
    template('CN Lab', 'college', [5], '09:00', '11:00', 120, { kind: 'fixed' }),
    template('CN', 'college', [5], '14:00', '15:00', 60, { kind: 'fixed' }),
    template('Table tennis', 'wellbeing', [2, 4, 6], '18:30', '19:30', 60, { kind: 'wellbeing' }),
    template('Coding contest — Wednesday', 'dsa', [3], '20:00', '22:00', 120, { kind: 'fixed', notes: 'Mandatory when scheduled; log rating and mistakes after.' }),
    template('Coding contest — Sunday', 'dsa', [0], '08:00', '10:00', 120, { kind: 'fixed', notes: 'Mandatory when scheduled; log rating and mistakes after.' }),
    template('Coding contest — even Saturday', 'dsa', [6], '20:00', '22:00', 120, { kind: 'fixed', evenSaturday: true, notes: 'Mandatory on even Saturdays.' }),
    template('GATE focus — concept + examples', 'gate', [1], '16:30', '18:00', 90, { notes: 'Finish one subtopic and write a one-page summary.' }),
    template('GATE focus — PYQs', 'gate', [2], '15:30', '17:00', 90, { notes: 'Solve 12–15 topic-wise PYQs and classify mistakes.' }),
    template('GATE focus — concepts', 'gate', [3], '08:30', '10:30', 120, { notes: 'Concept block plus worked examples.' }),
    template('GATE focus — PYQs', 'gate', [4], '11:15', '12:45', 90, { notes: 'Solve 8–12 PYQs and update the error log.' }),
    template('GATE focus — concepts', 'gate', [5], '11:15', '12:45', 90, { notes: 'Complete one concept block.' }),
    template('GATE focus — PYQs', 'gate', [6], '08:30', '10:30', 120, { notes: 'Complete a two-hour PYQ block.' }),
    template('GATE focus — second block', 'gate', [6], '14:30', '16:30', 120, { notes: 'Second concept or PYQ block.' }),
    template('GATE focus — mixed PYQs', 'gate', [0], '11:00', '13:00', 120, { notes: 'Solve 15–20 mixed or topic-wise PYQs.' }),
    template('GATE focus — error review', 'gate', [0], '14:00', '16:00', 120, { notes: 'Review mistakes and repair weak concepts.' }),
    template('DSA progression', 'dsa', [1], '19:30', '20:45', 75, { notes: 'Solve 2 progression-based problems; record outcomes.' }),
    template('DSA progression', 'dsa', [2], '19:30', '20:45', 75, { notes: 'Solve 2 progression-based problems.' }),
    template('C++ / DSA practice', 'dsa', [3], '10:45', '11:45', 60, { notes: 'Solve 2 problems or complete one C++ STL exercise.' }),
    template('DSA progression', 'dsa', [4], '19:45', '21:00', 75, { notes: 'Solve 2 problems.' }),
    template('DSA progression', 'dsa', [5], '18:15', '19:30', 75, { notes: 'Solve 2 problems and review one mistake.' }),
    template('DSA progression', 'dsa', [6], '10:45', '12:15', 90, { notes: 'Solve 2 problems and update the tracker.' }),
    template('Mixed DSA set', 'dsa', [0], '16:30', '17:30', 60, { notes: 'Solve a mixed set of 3 problems.' }),
    template('RAG flagship milestone', 'project', [3], '17:30', '19:00', 90, { notes: 'Complete one defined project deliverable.' }),
    template('RAG flagship milestone', 'project', [4], '21:00', '22:30', 90, { notes: 'Implement or document one small deliverable.' }),
    template('RAG flagship milestone', 'project', [6], '16:45', '18:15', 90, { notes: 'Complete one measurable milestone.' })
  ];

  return {
    version: CURRENT_SCHEMA_VERSION,
    selectedDate: PLANNING_START,
    tasks: [
      { id: id('task'), title: 'GATE — Probability: concept map + 8–10 PYQs', category: 'gate', date: PLANNING_START, duration: 90, actualSeconds: 0, start: '11:15', end: '12:45', output: 'One-page summary, 8–10 attempted PYQs, error log updated.', notes: 'Do not spend the entire day perfecting one micro-topic.', done: false, kind: 'focus' },
      { id: id('task'), title: 'DSA — C++ arrays/hashing: 2 problems', category: 'dsa', date: PLANNING_START, duration: 75, actualSeconds: 0, start: '19:45', end: '21:00', output: '2 attempts logged with independent/hint/fail outcome.', notes: 'Use a consistent C++ template.', done: false, kind: 'focus' },
      { id: id('task'), title: 'RAG — freeze problem statement and evaluation plan', category: 'project', date: PLANNING_START, duration: 60, actualSeconds: 0, start: '21:00', end: '22:00', output: 'Problem statement, success metrics, and 20-query evaluation-set outline.', notes: 'This is the only active flagship project for now.', done: false, kind: 'focus' },
      { id: id('task'), title: 'Daily review', category: 'admin', date: PLANNING_START, duration: 15, actualSeconds: 0, start: '22:30', end: '22:45', output: 'Actual hours, misses, causes, and tomorrow’s first task recorded.', notes: '', done: false, kind: 'admin' }
    ],
    recurring,
    gate: [
      { subject: 'P&C + Combinations', completed: 'Studied', pyq: 'Limited', revision: 'Needed', status: 'Learning' },
      { subject: 'Probability & Statistics', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'Linear Algebra', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'Calculus', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'C Programming', completed: 'College familiarity only', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'DSA + Algorithms', completed: 'College familiarity only', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'DBMS', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'Operating Systems', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'Computer Networks', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'TOC', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'COA', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'Digital Logic', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' },
      { subject: 'Compiler', completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' }
    ],
    dsa: [
      { topic: 'Arrays + strings', solved: 0, accuracy: 'Baseline pending', weak: 'Need measured baseline', revision: 'This week' },
      { topic: 'Hashing + two pointers', solved: 0, accuracy: 'Baseline pending', weak: 'Need measured baseline', revision: 'Next' },
      { topic: 'Binary search', solved: 0, accuracy: 'Baseline pending', weak: 'Need measured baseline', revision: 'Next' },
      { topic: 'Linked lists, stacks, queues', solved: 0, accuracy: 'Not measured', weak: 'Pending', revision: 'Later' },
      { topic: 'Trees + BST + heaps', solved: 0, accuracy: 'Weak', weak: 'Core gap', revision: 'Priority' },
      { topic: 'Graphs', solved: 0, accuracy: 'Weak', weak: 'Core gap', revision: 'Priority' },
      { topic: 'Greedy + backtracking + DP', solved: 0, accuracy: 'Weak', weak: 'Core gap', revision: 'Later' }
    ],
    projects: [
      { name: 'Advanced RAG / agentic system', status: 'Active', milestone: 'Freeze evaluation plan, then benchmark retrieval.', next: 'Define 20–50 representative queries and metrics.', priority: 'NOW' },
      { name: 'Shipment notification automation', status: 'In progress', milestone: 'Backend setup and existing implementation.', next: 'Promote only after RAG completion gate.', priority: 'NEXT' },
      { name: 'Segmentation benchmark', status: 'In progress', milestone: 'DeepGlobe / U-Net experiments.', next: 'Keep parked until a clear benchmark scope is chosen.', priority: 'LATER' },
      { name: 'DDPM / Mamba / Slot Retention', status: 'Backlog', milestone: 'Exploratory work only.', next: 'Do not start during the current runway.', priority: 'LATER' }
    ],
    applications: [],
    reviews: [],
    timer: null
  };
}

function migrateV1ToV2(data) {
  const next = { ...data, version: 2 };
  next.timer = isPlainObject(data.timer) ? { paused: false, ...data.timer } : data.timer === undefined ? null : data.timer;
  next.recurring = data.recurring.map(item => ({ endDate: null, skippedDates: [], ...item }));
  return next;
}

function migrateV2ToV3(data) {
  const next = { ...data, version: 3 };
  next.tasks = data.tasks.map(task => ({ actualSeconds: 0, done: false, kind: 'focus', ...task }));
  next.recurring = data.recurring.map(item => ({ startDate: null, endDate: null, skippedDates: [], enabled: true, ...item }));
  return next;
}

const migrations = { 1: migrateV1ToV2, 2: migrateV2ToV3 };

function migrateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Planner data must be an object.');
  let data = { ...raw };
  let version = data.version === undefined ? 1 : data.version;
  if (!Number.isInteger(version) || version < 1) throw new Error('Planner version must be a positive integer.');
  if (version > CURRENT_SCHEMA_VERSION) throw new Error(`Planner data version ${version} is newer than this app supports.`);
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`No migration exists for version ${version}.`);
    data = migrate(data);
    version = data.version;
  }
  data.version = CURRENT_SCHEMA_VERSION;
  return data;
}

function normalizeState(raw) {
  const migrated = migrateData(raw);
  const base = seedState();
  const merged = { ...base, ...migrated };
  merged.tasks = asArray(migrated.tasks);
  merged.recurring = asArray(migrated.recurring);
  merged.gate = asArray(migrated.gate);
  merged.dsa = asArray(migrated.dsa);
  merged.projects = asArray(migrated.projects);
  merged.applications = asArray(migrated.applications);
  merged.reviews = asArray(migrated.reviews);
  merged.selectedDate = migrated.selectedDate || PLANNING_START;
  merged.timer = migrated.timer ? { paused: false, ...migrated.timer } : null;
  return merged;
}

function loadState() {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const loaded = stored === null ? seedState() : normalizeState(validateImportedData(JSON.parse(stored)));
    storageStatus.lastSavedAt = loaded.lastSavedAt || null;
    return loaded;
  } catch (error) {
    // Never overwrite unreadable/newer stored data with the starter plan on the next render.
    loadFailure = `Saved data could not be loaded: ${error.message}. Original storage is untouched.`;
    storageStatus.ok = false; storageStatus.error = loadFailure;
    return seedState();
  }
}

function storageStatusText() {
  return storageStatus.ok
    ? `Last saved: ${storageStatus.lastSavedAt ? new Date(storageStatus.lastSavedAt).toLocaleString() : 'not yet saved'}`
    : `Storage error: ${storageStatus.error}. Changes remain in memory. Export before closing.`;
}

function setStorageStatus(ok, error = null) {
  storageStatus.ok = ok;
  storageStatus.error = error ? String(error.message || error) : null;
  if (typeof document === 'undefined') return;
  const indicator = document.getElementById('save-indicator');
  if (indicator) indicator.textContent = ok ? 'Saved' : 'Storage error';
  const detail = document.getElementById('storage-status');
  if (detail) detail.textContent = storageStatusText();
  const banner = document.getElementById('storage-error');
  if (banner) { banner.textContent = ok ? '' : storageStatusText(); banner.classList.toggle('hidden', ok); }
}

function saveState(message = 'Saved') {
  try {
    if (loadFailure) throw new Error(loadFailure);
    if (typeof localStorage === 'undefined') throw new Error('Browser storage is unavailable.');
    const lastSavedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, lastSavedAt }));
    state.lastSavedAt = lastSavedAt;
    storageStatus.lastSavedAt = lastSavedAt;
    setStorageStatus(true);
    const indicator = typeof document === 'undefined' ? null : document.getElementById('save-indicator');
    if (indicator) {
      indicator.textContent = message;
      window.clearTimeout(saveState.indicatorTimeout);
      saveState.indicatorTimeout = window.setTimeout(() => { if (storageStatus.ok) indicator.textContent = 'Saved'; }, 1300);
    }
    return true;
  } catch (error) {
    setStorageStatus(false, error);
    showToast('Storage error: changes remain in memory. Export before closing.');
    return false;
  }
}

function matchesRecurring(item, dateValue) {
  if (!item.enabled || (item.startDate && dateValue < item.startDate) || (item.endDate && dateValue > item.endDate) || asArray(item.skippedDates).includes(dateValue)) return false;
  const day = weekday(dateValue);
  if (!asArray(item.days).includes(day)) return false;
  if (item.evenSaturday && !(day === 6 && parseDate(dateValue).getDate() % 2 === 0)) return false;
  return true;
}

function createRecurringTask(item, dateValue) {
  return {
    id: id('task'), recurringId: item.id, title: item.title, category: item.category, date: dateValue,
    duration: item.duration, actualSeconds: 0, start: item.start, end: item.end, output: item.output || '',
    notes: item.notes, done: false, kind: item.kind, mandatory: item.mandatory, skipped: false
  };
}

function instantiateRecurringForDate(dateValue) {
  let changed = false;
  state.recurring.filter(item => matchesRecurring(item, dateValue)).forEach(item => {
    const exists = state.tasks.some(task => task.recurringId === item.id && (task.occurrenceDate || task.date) === dateValue);
    if (exists) return;
    // Only match the original starter-day blocks; never absorb a new one-off task.
    const baselineMatch = state.tasks.find(task => dateValue === PLANNING_START && !item.startDate && task.date === dateValue && !task.recurringId && !task.exception && task.category === item.category && task.start === item.start && task.kind === item.kind);
    if (baselineMatch) baselineMatch.recurringId = item.id;
    else state.tasks.push(createRecurringTask(item, dateValue));
    changed = true;
  });
  return changed;
}

function ensureDates(dates) {
  let changed = false;
  dates.forEach(dateValue => { if (instantiateRecurringForDate(dateValue)) changed = true; });
  if (changed) saveState();
}

function tasksForDate(dateValue) {
  ensureDates([dateValue]);
  return state.tasks.filter(task => task.date === dateValue).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start) || a.title.localeCompare(b.title));
}

function allTaskSeconds(tasks) {
  return tasks.reduce((sum, task) => sum + taskProgress(task), 0);
}
function doneCount(tasks) { return tasks.filter(task => !task.skipped && task.done).length; }
function categoryClass(category) { return `category-${category || 'admin'}`; }
function timerElapsed(timer, now = Date.now()) {
  return timer && !timer.paused ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0;
}
function taskProgress(task) {
  const live = state.timer?.taskId === task.id ? timerElapsed(state.timer) : 0;
  return (task.actualSeconds || 0) + live;
}

function taskCard(task) {
  const category = task.category || 'admin';
  const actual = taskProgress(task);
  const running = state.timer && state.timer.taskId === task.id;
  const recurringLabel = task.recurringId ? 'Repeats' : task.kind === 'fixed' ? 'Fixed' : 'One-off';
  return `<article class="task-card ${task.done ? 'completed' : ''} ${task.skipped ? 'skipped' : ''}" data-task-id="${escapeHtml(task.id)}">
    <button class="task-check" ${task.skipped ? 'disabled' : ''} data-action="toggle-task" data-id="${escapeHtml(task.id)}" aria-label="${task.done ? 'Mark incomplete' : 'Mark complete'}">${task.done ? '✓' : ''}</button>
    <div class="task-main">
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.output ? `<div class="task-output">Output: ${escapeHtml(task.output)}</div>` : ''}
      <div class="task-meta">
        <span class="category-pill ${categoryClass(category)}">${categoryIcons[category] || '•'} ${categoryLabels[category] || category}</span>
        <span>${escapeHtml(formatRange(task))}</span>
        <span>${formatMinutes(task.duration || 0)}</span>
        <span>${recurringLabel}</span>
      </div>
      ${task.notes ? `<div class="task-output">${escapeHtml(task.notes)}</div>` : ''}
      ${task.skipped ? '<div class="task-output">Skipped for this day.</div>' : category !== 'college' || task.kind !== 'fixed' ? `<div class="timer-row"><button class="timer-button ${running ? 'running' : ''}" data-action="toggle-timer" data-id="${escapeHtml(task.id)}">${running ? '■ Stop timer' : '▶ Start timer'}</button>${running ? `<button class="timer-button" data-action="pause-timer" data-id="${escapeHtml(task.id)}">${state.timer.paused ? '▶ Resume' : 'Ⅱ Pause'}</button>` : ''}<span class="actual-time">Tracked ${formatMinutes(actual / 60)}${task.done ? ' · complete' : ''}</span></div>` : ''}
    </div>
    <div class="task-actions"><button class="small-icon" data-action="edit-task" data-id="${escapeHtml(task.id)}" title="Edit task" aria-label="Edit task">✎</button>${state.recurring.some(item => item.id === task.recurringId) ? `<button class="small-icon" data-action="${task.skipped ? 'unskip-task' : 'skip-task'}" data-id="${escapeHtml(task.id)}" title="${task.skipped ? 'Undo skip' : 'Skip this day'}" aria-label="${task.skipped ? 'Undo skip' : 'Skip this day'}">${task.skipped ? '↶' : '⤼'}</button>` : ''}<button class="small-icon delete" data-action="delete-task" data-id="${escapeHtml(task.id)}" title="Delete task" aria-label="Delete task">×</button></div>
  </article>`;
}

function renderToday() {
  const dateValue = state.selectedDate;
  const tasks = tasksForDate(dateValue);
  const activeTasks = tasks.filter(task => !task.skipped);
  const focusTasks = activeTasks.filter(task => ['gate', 'dsa', 'project', 'internship'].includes(task.category));
  const complete = doneCount(activeTasks);
  const percentage = activeTasks.length ? Math.round((complete / activeTasks.length) * 100) : 0;
  const plannedMinutes = activeTasks.reduce((sum, task) => sum + (task.duration || 0), 0);
  const actualMinutes = allTaskSeconds(tasks) / 60;
  const next = activeTasks.find(task => !task.done && ['gate', 'dsa', 'project', 'internship'].includes(task.category)) || activeTasks.find(task => !task.done && task.kind !== 'fixed');
  const activeProject = state.projects.find(project => project.priority === 'NOW');
  return `<div class="page-heading"><div><div class="eyebrow">${escapeHtml(todayLabel(dateValue))}</div><h1>Make progress visible.</h1><p class="subtitle">A flexible plan for ${escapeHtml(formatLongDate(dateValue))}. Finish the output, not just the block.</p></div><div class="page-heading-actions"><button class="secondary-button" data-action="review-date">Daily review</button><button class="primary-button" data-action="add-task">+ Add task</button></div></div>
    <section class="hero-grid">
      <div class="hero-card"><div class="eyebrow">Decision rule</div><h1>${next ? `Next: ${escapeHtml(next.title)}` : 'Your day is clear.'}</h1><p class="subtitle">${next ? 'Start the next incomplete non-fixed task. If energy is low, do the smallest measurable version and log the reason.' : 'Add one task with a measurable output or use the weekly view to plan ahead.'}</p><div class="hero-meta"><span class="hero-chip">${complete}/${activeTasks.length} tasks complete</span><span class="hero-chip">${formatMinutes(plannedMinutes)} planned</span><span class="hero-chip">Active project: ${escapeHtml(activeProject ? activeProject.name : 'none')}</span></div></div>
      <div class="score-card"><div class="score-top"><div><div class="eyebrow">Today’s execution</div><div class="score-number">${percentage}%</div><div class="score-label">task completion</div></div><div class="ring-placeholder" data-progress="${percentage}"><span>${percentage}%</span></div></div><div class="progress-track"><div class="progress-fill" data-progress="${percentage}"></div></div><div class="score-footer"><span>${formatMinutes(actualMinutes)} tracked</span><span>${formatMinutes(Math.max(0, plannedMinutes - actualMinutes))} remaining</span></div></div>
    </section>
    <div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>Today’s map</h2><p>Fixed commitments and focus blocks are shown together. Delete or edit anything that no longer fits.</p></div><button class="text-button" data-action="show-focus">${focusTasks.length} focus items</button></div><div class="task-list">${tasks.length ? tasks.map(taskCard).join('') : `<div class="empty-state"><strong>No tasks for this date</strong>Add a task, or choose a different date.</div>`}</div></section><div class="side-stack"><section class="panel"><div class="panel-header"><div><h2>Quick capture</h2><p>Use a small action instead of reshaping the whole plan.</p></div></div><div class="quick-list"><button class="quick-action" data-action="quick-task" data-category="gate" data-title="GATE — focused PYQ set" data-duration="90"><span><strong>GATE PYQ set</strong><span>8–15 attempted questions + error log</span></span><b>+</b></button><button class="quick-action" data-action="quick-task" data-category="dsa" data-title="DSA — progression problems" data-duration="75"><span><strong>DSA progression</strong><span>2 problems, outcome recorded</span></span><b>+</b></button><button class="quick-action" data-action="quick-task" data-category="project" data-title="RAG — next small deliverable" data-duration="60"><span><strong>RAG milestone</strong><span>One implementation or evaluation output</span></span><b>+</b></button></div></section><section class="panel"><div class="panel-header"><div><h2>This week</h2><p>Actual tracked time, not aspirational hours.</p></div><button class="text-button" data-view-target="week">Open week</button></div><div class="mini-stats"><div class="mini-stat"><strong>${formatMinutes(weekActualMinutes())}</strong><span>tracked focus</span></div><div class="mini-stat"><strong>${weekCompletion()}%</strong><span>task completion</span></div></div><div class="callout top-gap">Protect sleep first. If a day overloads, remove optional project work before cutting GATE consistency or recovery.</div></section></div></div>`;
}

function weekActualMinutes() { const dates = getWeekDates(state.selectedDate); ensureDates(dates); return dates.reduce((sum, date) => sum + allTaskSeconds(state.tasks.filter(task => task.date === date)), 0) / 60; }
function weekCompletion() { const dates = getWeekDates(state.selectedDate); ensureDates(dates); const tasks = state.tasks.filter(task => dates.includes(task.date) && task.kind !== 'fixed' && !task.skipped); return tasks.length ? Math.round((doneCount(tasks) / tasks.length) * 100) : 0; }

function renderWeek() {
  const dates = getWeekDates(state.selectedDate);
  ensureDates(dates);
  return `<div class="page-heading"><div><div class="eyebrow">Weekly map</div><h1>Plan the week, adjust the day.</h1><p class="subtitle">${escapeHtml(formatShortDate(dates[0]))} – ${escapeHtml(formatShortDate(dates[6]))}. Recurring activities are generated automatically and can be removed or edited.</p></div><div class="page-heading-actions"><button class="secondary-button" data-action="review-date">Review selected day</button><button class="primary-button" data-action="add-task">+ Add task</button></div></div><section class="panel"><div class="panel-header"><div><h2>Seven-day view</h2><p>Click any task to open that date. Use the selected date controls above to move the week.</p></div><span class="metric-chip">${formatMinutes(weekActualMinutes())} tracked</span></div><div class="week-grid">${dates.map(date => { const tasks = tasksForDate(date).filter(task => !task.skipped); const focus = tasks.filter(task => task.kind !== 'fixed'); const pct = focus.length ? Math.round(doneCount(focus) / focus.length * 100) : 0; return `<div class="week-day ${date === state.selectedDate ? 'selected' : ''}"><div class="week-day-header"><div><div class="week-day-name">${shortDays[weekday(date)]}</div><div class="week-day-date">${parseDate(date).getDate()}</div></div><div class="week-day-progress">${pct}%</div></div>${tasks.length ? tasks.map(task => `<div class="week-task ${task.category || 'admin'} ${task.done ? 'done' : ''}" data-action="select-date" data-date="${date}"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(formatRange(task))} · ${formatMinutes(task.duration || 0)}</span></div>`).join('') : `<div class="empty-state compact-empty">Clear</div>`}</div>`; }).join('')}</div></section>`;
}

function renderTracks() {
  const tabs = [['gate', 'GATE'], ['dsa', 'DSA'], ['projects', 'Projects'], ['applications', 'Internships']];
  let content = '';
  if (currentTrack === 'gate') content = renderGateTrack();
  if (currentTrack === 'dsa') content = renderDsaTrack();
  if (currentTrack === 'projects') content = renderProjectsTrack();
  if (currentTrack === 'applications') content = renderApplicationsTrack();
  return `<div class="page-heading"><div><div class="eyebrow">Progress systems</div><h1>Track evidence, not intention.</h1><p class="subtitle">Update the fields as you work. These tables deliberately keep unknowns visible instead of inventing progress.</p></div><button class="primary-button" data-action="add-task">+ Add task</button></div><div class="tabs">${tabs.map(([key, label]) => `<button class="tab-button ${currentTrack === key ? 'active' : ''}" data-action="switch-track" data-track="${key}">${label}</button>`).join('')}</div>${content}`;
}

function renderGateTrack() {
  return `<section class="panel"><div class="panel-header"><div><h2>GATE tracker</h2><p>Studied means concept + examples + PYQs + mistakes + revision. Lectures alone do not change status.</p></div><button class="secondary-button" data-action="add-gate">+ Subject</button></div><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Topics completed</th><th>PYQ % / note</th><th>Revision</th><th>Status</th><th></th></tr></thead><tbody>${state.gate.map((row, index) => `<tr><td><input data-track-field="gate" data-index="${index}" data-field="subject" value="${escapeHtml(row.subject)}" /></td><td><input data-track-field="gate" data-index="${index}" data-field="completed" value="${escapeHtml(row.completed)}" /></td><td><input data-track-field="gate" data-index="${index}" data-field="pyq" value="${escapeHtml(row.pyq)}" /></td><td><input data-track-field="gate" data-index="${index}" data-field="revision" value="${escapeHtml(row.revision)}" /></td><td><select data-track-field="gate" data-index="${index}" data-field="status">${['Not started', 'Learning', 'PYQs', 'Revision', 'Strong'].map(value => `<option ${row.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></td><td><button class="small-icon delete" data-action="delete-gate" data-index="${index}" aria-label="Delete subject">×</button></td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderDsaTrack() {
  return `<section class="panel"><div class="panel-header"><div><h2>DSA tracker</h2><p>Begin measuring from now. Solved independently, hints, failures, time, and repeated mistakes matter more than raw volume.</p></div><button class="secondary-button" data-action="add-dsa">+ Topic</button></div><div class="track-grid">${state.dsa.map((row, index) => `<div class="track-card"><div class="track-card-header"><div><h3>${escapeHtml(row.topic)}</h3><p>Weak area: ${escapeHtml(row.weak)}</p></div><button class="small-icon delete" data-action="delete-dsa" data-index="${index}" aria-label="Delete topic">×</button></div><div class="track-row"><div><strong>Problems solved</strong><small>Update after independently solved problems.</small></div><input type="number" min="0" data-track-field="dsa" data-index="${index}" data-field="solved" value="${Number(row.solved) || 0}" /></div><div class="track-row"><div><strong>Accuracy</strong><small>Independent solve rate or a note if not measured.</small></div><input data-track-field="dsa" data-index="${index}" data-field="accuracy" value="${escapeHtml(row.accuracy)}" /></div><div class="track-row"><div><strong>Weak areas</strong><small>Repeated mistakes or prerequisite gaps.</small></div><input data-track-field="dsa" data-index="${index}" data-field="weak" value="${escapeHtml(row.weak)}" /></div><div class="track-row"><div><strong>Revision</strong></div><input data-track-field="dsa" data-index="${index}" data-field="revision" value="${escapeHtml(row.revision)}" /></div></div>`).join('')}</div></section>`;
}

function renderProjectsTrack() {
  return `<section class="panel"><div class="panel-header"><div><h2>Project portfolio</h2><p>Only mark a project complete after the appropriate evaluation, documentation, demo, and interview evidence exists.</p></div><button class="secondary-button" data-action="add-project">+ Project</button></div><div class="track-grid">${state.projects.map((row, index) => `<div class="track-card"><div class="track-card-header"><div><h3>${escapeHtml(row.name)}</h3><p>${escapeHtml(row.status)}</p></div><span class="metric-chip">${escapeHtml(row.priority)}</span></div><div class="track-row"><div><strong>Current milestone</strong></div><input data-track-field="projects" data-index="${index}" data-field="milestone" value="${escapeHtml(row.milestone)}" /></div><div class="track-row"><div><strong>Next deliverable</strong></div><input data-track-field="projects" data-index="${index}" data-field="next" value="${escapeHtml(row.next)}" /></div><div class="track-row"><div><strong>Status</strong></div><select data-track-field="projects" data-index="${index}" data-field="status">${['Backlog', 'In progress', 'Evaluated', 'Deployed', 'Documented', 'Complete'].map(value => `<option ${row.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="track-row"><div><strong>Priority</strong></div><select data-track-field="projects" data-index="${index}" data-field="priority">${['NOW', 'NEXT', 'LATER', 'IGNORE'].map(value => `<option ${row.priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="track-delete"><button class="small-icon delete" data-action="delete-project" data-index="${index}">Delete</button></div></div>`).join('')}</div></section>`;
}

function renderApplicationsTrack() {
  return `<section class="panel"><div class="panel-header"><div><h2>Internship pipeline</h2><p>Keep applications small and systematic: two suitable applications and one networking action per week.</p></div><button class="secondary-button" data-action="add-application">+ Application</button></div>${state.applications.length ? `<div class="table-wrap"><table><thead><tr><th>Company</th><th>Role</th><th>Applied</th><th>Referral</th><th>Status</th><th>Next action</th><th></th></tr></thead><tbody>${state.applications.map((row, index) => `<tr><td><input data-track-field="applications" data-index="${index}" data-field="company" value="${escapeHtml(row.company)}" /></td><td><input data-track-field="applications" data-index="${index}" data-field="role" value="${escapeHtml(row.role)}" /></td><td><input data-track-field="applications" data-index="${index}" data-field="applied" type="date" value="${escapeHtml(row.applied)}" /></td><td><input data-track-field="applications" data-index="${index}" data-field="referral" value="${escapeHtml(row.referral)}" /></td><td><select data-track-field="applications" data-index="${index}" data-field="status">${['Shortlisted', 'To apply', 'Applied', 'OA', 'Interview', 'Rejected', 'Offer'].map(value => `<option ${row.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></td><td><input data-track-field="applications" data-index="${index}" data-field="nextAction" value="${escapeHtml(row.nextAction)}" /></td><td><button class="small-icon delete" data-action="delete-application" data-index="${index}" aria-label="Delete application">×</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><strong>No applications logged</strong>Add a real target when one appears. Do not wait until you feel fully ready.</div>`}</section>`;
}

function renderReview() {
  const review = state.reviews.find(item => item.date === state.selectedDate) || {};
  const tasks = tasksForDate(state.selectedDate);
  const weekTasks = state.tasks.filter(task => getWeekDates(state.selectedDate).includes(task.date));
  return `<div class="page-heading"><div><div class="eyebrow">Close the loop</div><h1>Review, then adjust.</h1><p class="subtitle">A missed task is feedback. Record the cause before moving anything.</p></div><button class="primary-button" data-action="save-review">Save review</button></div><div class="review-grid"><section class="panel"><div class="panel-header"><div><h2>${escapeHtml(formatLongDate(state.selectedDate))}</h2><p>${doneCount(tasks)}/${tasks.filter(task => !task.skipped).length} tasks complete · ${formatMinutes(allTaskSeconds(tasks) / 60)} tracked</p></div></div><form class="review-form" id="review-form"><label>What did you complete?<textarea name="completed" rows="3" placeholder="Outputs, not just subjects...">${escapeHtml(review.completed || '')}</textarea></label><label>What did you not complete, and why?<textarea name="missed" rows="3" placeholder="Too large, low energy, unclear prerequisite, distraction, wrong priority...">${escapeHtml(review.missed || '')}</textarea></label><label>What took longer than expected?<textarea name="longer" rows="2">${escapeHtml(review.longer || '')}</textarea></label><label>What distracted you?<textarea name="distraction" rows="2">${escapeHtml(review.distraction || '')}</textarea></label><label>Tomorrow’s first task<textarea name="next" rows="2" placeholder="One concrete next action">${escapeHtml(review.next || '')}</textarea></label><button type="submit" class="primary-button">Save daily review</button></form></section><section class="panel"><div class="panel-header"><div><h2>Week evidence</h2><p>Use actuals to rebalance instead of carrying every unfinished task forward.</p></div></div><div class="mini-stats"><div class="mini-stat"><strong>${formatMinutes(allTaskSeconds(weekTasks) / 60)}</strong><span>tracked this week</span></div><div class="mini-stat"><strong>${weekCompletion()}%</strong><span>focus completion</span></div><div class="mini-stat"><strong>${weekTasks.filter(task => task.done).length}</strong><span>tasks finished</span></div><div class="mini-stat"><strong>${weekTasks.length}</strong><span>tasks mapped</span></div></div><div class="callout top-gap-large"><strong>Rule:</strong> Missed once means adjust. Missed twice means split. Missed three times means diagnose the priority, prerequisite, or avoidance pattern.</div><div class="panel-header top-gap-panel"><div><h2>Past reviews</h2><p>Recent notes stay searchable in this browser.</p></div></div><div class="review-list">${state.reviews.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(item => `<div class="review-item"><strong>${escapeHtml(formatShortDate(item.date))}</strong><p>${escapeHtml(item.next || item.missed || item.completed || 'No notes')}</p></div>`).join('') || '<div class="empty-state">No saved reviews yet.</div>'}</div></section></div>`;
}

function renderSettings() {
  const storageMessage = storageStatusText();
  let backupAvailable = false;
  try { backupAvailable = Boolean(typeof localStorage !== 'undefined' && localStorage.getItem(BACKUP_STORAGE_KEY)); } catch { backupAvailable = false; }
  return `<div class="page-heading"><div><div class="eyebrow">Control panel</div><h1>Make the system fit you.</h1><p class="subtitle">Your data stays in this browser. Export a backup before changing machines or clearing browser data.</p></div></div><div class="settings-grid"><section class="panel"><div class="panel-header"><div><h2>Data</h2><p>Automatic local saving with explicit backup controls.</p></div></div><div class="settings-list"><div class="setting-row"><div><strong>Storage status</strong><span id="storage-status" role="status">${escapeHtml(storageMessage)}</span></div></div><div class="setting-row"><div><strong>Export planner backup</strong><span>Download tasks, recurring activities, trackers, and reviews as JSON.</span></div><button class="secondary-button" data-action="export">Export</button></div><div class="setting-row"><div><strong>Import planner backup</strong><span>A backup is saved before the selected file is validated or applied.</span></div><button class="secondary-button" data-action="import">Import</button></div><div class="setting-row"><div><strong>Restore last backup</strong><span>${backupAvailable ? 'Restore the backup created before the last import.' : 'No import backup exists yet.'}</span></div><button class="secondary-button" data-action="restore-backup" ${backupAvailable ? '' : 'disabled'}>Restore</button></div><div class="setting-row"><div><strong>Restore starter plan</strong><span>Deletes local changes and restores the 1 October planning baseline.</span></div><button class="danger-button" data-action="reset">Reset</button></div></div></section><section class="panel"><div class="panel-header"><div><h2>Recurring activities</h2><p>Disable or remove templates without deleting your historical task records.</p></div></div><div>${state.recurring.map((item, index) => `<div class="template-row"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(recurringDescription(item))}</small></div><div class="row-actions"><button class="small-icon" data-action="toggle-template" data-index="${index}" title="${item.enabled ? 'Disable' : 'Enable'}">${item.enabled ? '✓' : '○'}</button><button class="small-icon delete" data-action="delete-template" data-index="${index}" title="Delete template">×</button></div></div>`).join('')}</div></section></div>`;
}

function recurringDescription(item) {
  const days = asArray(item.days).sort((a, b) => a - b).map(day => shortDays[day]).join(', ');
  return `${days}${item.evenSaturday ? ' · even Saturdays only' : ''}${item.endDate ? ` · until ${item.endDate}` : ''} · ${item.enabled ? 'enabled' : 'disabled'} · ${formatMinutes(item.duration)}`;
}

function render() {
  ensureDates([state.selectedDate]);
  document.getElementById('selected-date').value = state.selectedDate;
  const app = document.getElementById('app');
  if (currentView === 'today') app.innerHTML = renderToday();
  if (currentView === 'week') app.innerHTML = renderWeek();
  if (currentView === 'tracks') app.innerHTML = renderTracks();
  if (currentView === 'review') app.innerHTML = renderReview();
  if (currentView === 'settings') app.innerHTML = renderSettings();
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === currentView));
  // CSSOM property assignment works under style-src 'self'; no inline style markup is needed.
  document.querySelectorAll('[data-progress]').forEach(element => {
    const value = Math.max(0, Math.min(100, Number(element.dataset.progress))) + '%';
    if (element.classList.contains('progress-fill')) element.style.width = value;
    else element.style.setProperty('--progress', value);
  });
  updateTimerDisplays();
}

function showToast(message) {
  if (typeof document === 'undefined') return;
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div'); element.className = 'toast'; element.textContent = message; document.body.appendChild(element);
  window.clearTimeout(toastTimeout); toastTimeout = window.setTimeout(() => element.remove(), 2400);
}

function updateRepeatFields() {
  const editing = Boolean(document.getElementById('task-id').value);
  const recurring = Boolean(document.getElementById('task-form').dataset.editingRecurring);
  const future = recurring && document.getElementById('task-edit-scope').value === 'future';
  const repeat = document.getElementById('task-repeat');
  repeat.disabled = editing && !future;
  repeat.querySelector('[value="none"]').disabled = future;
  const repeating = repeat.value !== 'none' && !repeat.disabled;
  document.getElementById('repeat-until-label').classList.toggle('hidden', !repeating);
  document.getElementById('weekday-picker').classList.toggle('hidden', !repeating || repeat.value !== 'weekly');
  document.getElementById('task-date').readOnly = future;
  if (future) {
    const task = state.tasks.find(item => item.id === document.getElementById('task-id').value);
    document.getElementById('task-date').value = task.occurrenceDate || task.date;
  }
}

function openTaskModal(taskId = null, preset = {}) {
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const task = taskId ? state.tasks.find(item => item.id === taskId) : null;
  const recurring = task?.recurringId ? state.recurring.find(item => item.id === task.recurringId) : null;
  lastFocusedElement = document.activeElement;
  document.getElementById('task-modal-title').textContent = task ? 'Edit task' : 'Add a task';
  document.getElementById('task-id').value = task?.id || '';
  document.getElementById('task-title').value = task?.title || preset.title || '';
  document.getElementById('task-category').value = task?.category || preset.category || 'gate';
  document.getElementById('task-date').value = task?.date || preset.date || state.selectedDate;
  document.getElementById('task-duration').value = task?.duration || preset.duration || 60;
  document.getElementById('task-start').value = task?.start || preset.start || '';
  document.getElementById('task-end').value = task?.end || preset.end || '';
  document.getElementById('task-output').value = task?.output || preset.output || '';
  document.getElementById('task-notes').value = task?.notes || preset.notes || '';
  document.getElementById('task-repeat').value = recurring ? 'weekly' : 'none';
  document.getElementById('task-repeat-until').value = recurring?.endDate || '';
  document.getElementById('task-edit-scope').value = 'day';
  document.getElementById('edit-scope-label').classList.toggle('hidden', !recurring);
  document.querySelectorAll('#weekday-picker input').forEach(input => { input.checked = recurring ? recurring.days.includes(Number(input.value)) : false; });
  form.dataset.editingRecurring = recurring?.id || '';
  updateRepeatFields();
  modal.classList.remove('hidden');
  window.clearTimeout(modalFocusTimeout);
  modalFocusTimeout = window.setTimeout(() => document.getElementById('task-title').focus(), 30);
}
function closeTaskModal() {
  const modal = document.getElementById('task-modal');
  modal.classList.add('hidden');
  window.clearTimeout(modalFocusTimeout);
  const target = lastFocusedElement && document.contains(lastFocusedElement) ? lastFocusedElement : document.getElementById('quick-add-button');
  target?.focus();
  lastFocusedElement = null;
}

function applyTaskFields(target, taskData) {
  Object.assign(target, {
    title: taskData.title, category: taskData.category, duration: taskData.duration,
    start: taskData.start, end: taskData.end, output: taskData.output, notes: taskData.notes
  });
}

function editRecurringTask(taskId, taskData, scope, days, endDate) {
  const task = state.tasks.find(item => item.id === taskId);
  const recurring = task && state.recurring.find(item => item.id === task.recurringId);
  if (!task || !recurring) throw new Error('Recurring template no longer exists.');
  const boundary = task.occurrenceDate || task.date;
  if (scope === 'day') {
    task.occurrenceDate = boundary;
    task.exception = true;
    applyTaskFields(task, taskData);
    task.date = taskData.date;
    return;
  }
  // Split the series, so viewing an ungenerated earlier date still uses the old plan.
  const next = { ...recurring, id: id('template'), startDate: boundary, endDate,
    days: [...days], skippedDates: asArray(recurring.skippedDates).filter(date => date >= boundary) };
  applyTaskFields(next, taskData);
  const previousEnd = shiftDate(boundary, -1);
  recurring.endDate = recurring.endDate && recurring.endDate < previousEnd ? recurring.endDate : previousEnd;
  if (recurring.startDate && recurring.endDate < recurring.startDate) recurring.enabled = false;
  state.recurring.push(next);
  state.tasks = state.tasks.filter(item => {
    const occurrence = item.occurrenceDate || item.date;
    if (item.recurringId !== recurring.id || occurrence < boundary) return true;
    // Keep progress and explicit day exceptions, even outside a shortened series.
    const preserve = item.done || item.actualSeconds > 0 || item.exception || item.skipped || state.timer?.taskId === item.id;
    if (!preserve && !matchesRecurring(next, occurrence)) return false;
    item.recurringId = next.id;
    if (!preserve) applyTaskFields(item, taskData);
    return true;
  });
}

function saveTaskFromForm(event) {
  event.preventDefault();
  const editingId = document.getElementById('task-id').value;
  const taskData = {
    title: document.getElementById('task-title').value.trim(), category: document.getElementById('task-category').value,
    date: document.getElementById('task-date').value, duration: Number(document.getElementById('task-duration').value) || 60,
    start: document.getElementById('task-start').value, end: document.getElementById('task-end').value,
    output: document.getElementById('task-output').value.trim(), notes: document.getElementById('task-notes').value.trim(),
    endDate: document.getElementById('task-repeat-until').value || null
  };
  if (!taskData.title || !isValidDateString(taskData.date)) return;
  const repeat = document.getElementById('task-repeat').value;
  const scope = document.getElementById('task-edit-scope').value;
  const changesSeries = (!editingId && repeat !== 'none') || (editingId && scope === 'future');
  if (changesSeries && taskData.endDate && (!isValidDateString(taskData.endDate) || taskData.endDate < taskData.date)) {
    showToast('Repeat-until date must be a valid date on or after the task date.');
    return;
  }
  let days = repeat === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : repeat === 'weekdays' ? [1, 2, 3, 4, 5] : [...document.querySelectorAll('#weekday-picker input:checked')].map(input => Number(input.value));
  if (changesSeries && !days.length) { showToast('Select at least one weekday.'); return; }
  if (editingId) {
    const task = state.tasks.find(item => item.id === editingId);
    if (!task) return;
    if (state.recurring.some(item => item.id === task.recurringId)) {
      editRecurringTask(task.id, taskData, scope, days, taskData.endDate);
    } else {
      applyTaskFields(task, taskData);
      task.date = taskData.date;
    }
    showToast('Task updated');
  } else if (repeat === 'none') {
    state.tasks.push({ id: id('task'), ...taskData, actualSeconds: 0, done: false, skipped: false, kind: 'focus' });
    showToast('Task added');
  } else {
    const recurrence = template(taskData.title, taskData.category, days, taskData.start, taskData.end, taskData.duration, { notes: taskData.notes, startDate: taskData.date, endDate: taskData.endDate });
    recurrence.output = taskData.output;
    state.recurring.push(recurrence);
    instantiateRecurringForDate(taskData.date);
    showToast('Recurring task added');
  }
  saveState(); render(); closeTaskModal();
}

function toggleTask(taskId) {
  const task = state.tasks.find(item => item.id === taskId); if (!task || task.skipped) return;
  task.done = !task.done;
  if (task.done && state.timer?.taskId === taskId) stopTimer();
  saveState(task.done ? 'Completed' : 'Reopened'); render();
}
function skipTask(taskId) {
  const task = state.tasks.find(item => item.id === taskId);
  const recurring = task && state.recurring.find(item => item.id === task.recurringId);
  if (!task || !recurring) return;
  recurring.skippedDates = [...new Set([...asArray(recurring.skippedDates), task.occurrenceDate || task.date])];
  task.skipped = true;
  if (state.timer?.taskId === taskId) stopTimer();
  saveState(); render(); showToast('Skipped for this day');
}
function unskipTask(taskId) {
  const task = state.tasks.find(item => item.id === taskId);
  const recurring = task && state.recurring.find(item => item.id === task.recurringId);
  if (!task || !recurring) return;
  recurring.skippedDates = asArray(recurring.skippedDates).filter(date => date !== (task.occurrenceDate || task.date));
  task.skipped = false;
  saveState(); render(); showToast('Task restored for this day');
}
function deleteTask(taskId) {
  const task = state.tasks.find(item => item.id === taskId); if (!task) return;
  if (state.recurring.some(item => item.id === task.recurringId)) {
    if (window.confirm('This is a recurring task. Delete it only for this day?')) skipTask(taskId);
    return;
  }
  if (!window.confirm(`Delete “${task.title}” from ${formatShortDate(task.date)}?`)) return;
  if (state.timer?.taskId === taskId) stopTimer();
  state.tasks = state.tasks.filter(item => item.id !== taskId); saveState(); render(); showToast('Task deleted');
}
function toggleTimer(taskId) {
  if (state.timer?.taskId === taskId) { stopTimer(); render(); return; }
  if (state.timer) stopTimer();
  if (!state.tasks.some(task => task.id === taskId)) return;
  state.timer = { taskId, startedAt: Date.now(), paused: false };
  saveState('Timer running'); syncTimerInterval(); render();
}
function pauseResumeTimer() {
  if (!state.timer) return;
  const task = state.tasks.find(item => item.id === state.timer.taskId);
  if (!task) return;
  if (state.timer.paused) {
    state.timer.startedAt = Date.now();
    state.timer.paused = false;
  } else {
    task.actualSeconds = taskProgress(task);
    state.timer.startedAt = null;
    state.timer.paused = true;
  }
  saveState(); syncTimerInterval(); render();
}
function syncTimerInterval() {
  window.clearInterval(timerInterval);
  timerInterval = state.timer && !state.timer.paused ? window.setInterval(updateTimerDisplays, 1000) : null;
}
function stopTimer() {
  if (!state.timer) return;
  const task = state.tasks.find(item => item.id === state.timer.taskId);
  if (task) task.actualSeconds = taskProgress(task);
  state.timer = null; saveState('Timer saved'); syncTimerInterval();
}
function updateTimerDisplays() {
  if (!state.timer) return;
  const task = state.tasks.find(item => item.id === state.timer.taskId); if (!task) return;
  const card = [...document.querySelectorAll('[data-task-id]')].find(item => item.dataset.taskId === task.id);
  const label = card?.querySelector('.actual-time');
  if (label) label.textContent = `Tracked ${formatMinutes(taskProgress(task) / 60)}${task.done ? ' · complete' : ''}`;
}

function handleTrackField(target) {
  const section = target.dataset.trackField; const index = Number(target.dataset.index); const field = target.dataset.field;
  const rows = state[section]; if (!rows?.[index]) return;
  rows[index][field] = target.type === 'number' ? Number(target.value) : target.value;
  saveState();
}

function promptAdd(kind) {
  if (kind === 'gate') { const subject = window.prompt('Subject name'); if (subject?.trim()) { state.gate.push({ subject: subject.trim(), completed: 'Not started', pyq: '0%', revision: 'Not started', status: 'Not started' }); saveState(); render(); } }
  if (kind === 'dsa') { const topic = window.prompt('DSA topic'); if (topic?.trim()) { state.dsa.push({ topic: topic.trim(), solved: 0, accuracy: 'Not measured', weak: 'Pending', revision: 'Later' }); saveState(); render(); } }
  if (kind === 'project') { const name = window.prompt('Project name'); if (name?.trim()) { state.projects.push({ name: name.trim(), status: 'Backlog', milestone: 'Define scope', next: 'Write the next deliverable', priority: 'LATER' }); saveState(); render(); } }
  if (kind === 'application') { const company = window.prompt('Company name'); if (company?.trim()) { state.applications.push({ company: company.trim(), role: '', applied: '', referral: 'Not asked', status: 'To apply', nextAction: 'Review role and tailor resume' }); saveState(); render(); } }
}

function saveReview(event) {
  event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form).entries());
  const existing = state.reviews.find(item => item.date === state.selectedDate);
  if (existing) Object.assign(existing, data); else state.reviews.push({ date: state.selectedDate, ...data });
  saveState(); showToast('Daily review saved'); render();
}

function exportData() {
  const blob = new Blob([serializeState()], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `academic-os-${state.selectedDate}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('Backup exported');
}
function importText(text) {
  // Snapshot immediately before replacement, including edits made while the file was reading.
  if (!createBackup()) return false;
  try {
    const imported = validateImportedData(JSON.parse(text));
    state = normalizeState(imported);
    const saved = saveState(); syncTimerInterval(); render();
    showToast(saved ? 'Planner backup imported' : 'Imported in memory only. Storage error: export before closing.');
    return true;
  } catch (error) {
    showToast(`Import rejected: ${error.message || 'invalid planner data'}`);
    return false;
  }
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => importText(reader.result);
  reader.onerror = () => showToast('Import rejected: could not read the selected file.');
  reader.readAsText(file);
}
function restoreLastBackup() {
  try {
    const backup = readBackup();
    if (!backup) { showToast('No last backup is available.'); return false; }
    state = normalizeState(backup); loadFailure = null;
    const saved = saveState(); syncTimerInterval(); render();
    showToast(saved ? 'Last backup restored' : 'Restored in memory only. Storage error: export before closing.');
    return true;
  } catch (error) { showToast(error.message); return false; }
}

function handleAction(element) {
  const action = element.dataset.action;
  if (action === 'add-task') openTaskModal();
  if (action === 'edit-task') openTaskModal(element.dataset.id);
  if (action === 'delete-task') deleteTask(element.dataset.id);
  if (action === 'toggle-task') toggleTask(element.dataset.id);
  if (action === 'toggle-timer') toggleTimer(element.dataset.id);
  if (action === 'pause-timer') pauseResumeTimer();
  if (action === 'skip-task') skipTask(element.dataset.id);
  if (action === 'unskip-task') unskipTask(element.dataset.id);
  if (action === 'review-date') { currentView = 'review'; render(); }
  if (action === 'show-focus') { showToast('Focus items are mixed into today’s map; fixed classes remain visible for context.'); }
  if (action === 'quick-task') openTaskModal(null, { title: element.dataset.title, category: element.dataset.category, duration: element.dataset.duration, date: state.selectedDate });
  if (action === 'select-date') { state.selectedDate = element.dataset.date; currentView = 'today'; saveState(); render(); }
  if (action === 'switch-track') { currentTrack = element.dataset.track; render(); }
  if (action === 'add-gate') promptAdd('gate');
  if (action === 'delete-gate') { state.gate.splice(Number(element.dataset.index), 1); saveState(); render(); }
  if (action === 'add-dsa') promptAdd('dsa');
  if (action === 'delete-dsa') { state.dsa.splice(Number(element.dataset.index), 1); saveState(); render(); }
  if (action === 'add-project') promptAdd('project');
  if (action === 'delete-project') { state.projects.splice(Number(element.dataset.index), 1); saveState(); render(); }
  if (action === 'add-application') promptAdd('application');
  if (action === 'delete-application') { state.applications.splice(Number(element.dataset.index), 1); saveState(); render(); }
  if (action === 'save-review') { document.getElementById('review-form')?.requestSubmit(); }
  if (action === 'export') exportData();
  if (action === 'import') document.getElementById('import-file').click();
  if (action === 'restore-backup' && window.confirm('Replace current data with the last pre-import backup?')) restoreLastBackup();
  if (action === 'reset' && window.confirm('Reset all local planner data to the starter plan? This cannot be undone unless you exported a backup.')) { state = seedState(); loadFailure = null; saveState(); syncTimerInterval(); render(); showToast('Starter plan restored'); }
  if (action === 'toggle-template') { const item = state.recurring[Number(element.dataset.index)]; if (item) item.enabled = !item.enabled; saveState(); render(); }
  if (action === 'delete-template') { if (window.confirm('Delete this recurring template? Existing task history will remain.')) { state.recurring.splice(Number(element.dataset.index), 1); saveState(); render(); } }
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => { currentView = item.dataset.view; render(); }));
  document.getElementById('previous-day').addEventListener('click', () => { state.selectedDate = shiftDate(state.selectedDate, -1); saveState(); render(); });
  document.getElementById('next-day').addEventListener('click', () => { state.selectedDate = shiftDate(state.selectedDate, 1); saveState(); render(); });
  document.getElementById('today-button').addEventListener('click', () => { state.selectedDate = dateKey(new Date()); saveState(); render(); });
  document.getElementById('selected-date').addEventListener('change', event => { if (event.target.value) { state.selectedDate = event.target.value; saveState(); render(); } });
  document.getElementById('quick-add-button').addEventListener('click', () => openTaskModal());
  document.getElementById('close-task-modal').addEventListener('click', closeTaskModal);
  document.getElementById('cancel-task').addEventListener('click', closeTaskModal);
  document.getElementById('task-form').addEventListener('submit', saveTaskFromForm);
  document.getElementById('task-repeat').addEventListener('change', updateRepeatFields);
  document.getElementById('task-edit-scope').addEventListener('change', updateRepeatFields);
  document.getElementById('task-modal').addEventListener('click', event => { if (event.target.id === 'task-modal') closeTaskModal(); });
  document.getElementById('import-file').addEventListener('change', event => { if (event.target.files[0]) importData(event.target.files[0]); event.target.value = ''; });
  document.getElementById('app').addEventListener('click', event => { const actionElement = event.target.closest('[data-action]'); if (actionElement) handleAction(actionElement); const targetView = event.target.closest('[data-view-target]')?.dataset.viewTarget; if (targetView) { currentView = targetView; render(); } });
  document.getElementById('app').addEventListener('change', event => { if (event.target.matches('[data-track-field]')) handleTrackField(event.target); });
  document.getElementById('app').addEventListener('submit', event => { if (event.target.id === 'review-form') saveReview(event); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.getElementById('task-modal').classList.contains('hidden')) closeTaskModal(); });
}

function setupServiceWorkerUpdates() {
  if (!('serviceWorker' in navigator)) return;
  let refreshRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshRequested) window.location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(registration => {
    const showUpdate = () => document.getElementById('update-banner')?.classList.remove('hidden');
    const watch = worker => worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
    });
    if (registration.waiting) showUpdate();
    watch(registration.installing);
    registration.addEventListener('updatefound', () => watch(registration.installing));
    document.getElementById('refresh-version')?.addEventListener('click', () => {
      // The waiting worker, not the current controller, must receive this message.
      if (!registration.waiting) { window.location.reload(); return; }
      if (!document.getElementById('task-modal').classList.contains('hidden') || currentView === 'review') {
        if (!window.confirm('Refresh will discard any unsaved form text. Continue?')) return;
      }
      document.activeElement?.blur();
      if (!saveState()) return;
      refreshRequested = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  }).catch(error => showToast(`Offline cache unavailable: ${error.message}`));
}

function boot() {
  ensureDates([state.selectedDate]);
  bindEvents();
  render();
  syncTimerInterval();
  setStorageStatus(storageStatus.ok, storageStatus.error);
  setupServiceWorkerUpdates();
}

state = loadState();
if (typeof document !== 'undefined') boot();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEY, CURRENT_SCHEMA_VERSION, PLANNING_START, getWeekDates, getWeekStart, shiftDate,
    timerElapsed, matchesRecurring, createRecurringTask, migrateData, normalizeState,
    validateImportedData, serializeState, seedState, isValidDateString
  };
}
