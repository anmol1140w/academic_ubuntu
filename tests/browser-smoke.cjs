const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
// Browser regression harness only: temporary HTTP server and isolated Chrome profile.
// The installed desktop application uses neither this server nor Chrome.
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'academic-os-check-'));
let upgraded = false, chrome, socket;
const errors = [];
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json'};
const server = http.createServer((req,res) => {
  const name = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    let body = fs.readFileSync(path.join(root, name));
    if (name === '/sw.js' && upgraded) body = Buffer.from(body.toString().replace("const CACHE_VERSION = '2';", "const CACHE_VERSION = '3-smoke';"));
    res.setHeader('Content-Type', types[path.extname(name)] || 'text/plain'); res.setHeader('Cache-Control', 'no-store'); res.end(body);
  } catch { res.statusCode = 404; res.end('not found'); }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label) { for (let i=0;i<150;i++) { try { if(await fn()) return; } catch {} await sleep(100); } throw Error(`Timed out: ${label}`); }
(async () => {
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], {stdio:'ignore',detached:true});
    await until(() => fs.existsSync(path.join(profile,'DevToolsActivePort')), 'Chrome startup');
    const port = fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page => page.type === 'page' && page.url === 'about:blank').webSocketDebuggerUrl);
    await new Promise((r,j) => {socket.onopen=r;socket.onerror=j;});
    let serial=0; const waiting = new Map();
    socket.onmessage = event => {
      const data=JSON.parse(event.data);
      if (data.id) {const p=waiting.get(data.id);waiting.delete(data.id); data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result);}
      if(data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text + ': ' + data.params.exceptionDetails.exception?.description);
      if(data.method === 'Log.entryAdded' && data.params.entry.level === 'error') errors.push(data.params.entry.text);
    };
    const call = (method,params={}) => new Promise((resolve,reject) => {const id=++serial;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const ev = async expression => {const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);return result.result.value;};
    await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
    await call('Page.navigate',{url});
    await until(() => ev("typeof state !== 'undefined' && !!document.querySelector('.task-card')"), 'planner');
    await ev('navigator.serviceWorker.ready');
    await call('Page.reload');
    await until(() => ev("!!navigator.serviceWorker.controller && !!document.querySelector('.task-card')"), 'controlled page');
    await ev(`document.getElementById('quick-add-button').click(); document.getElementById('task-title').value='Browser check task'; document.getElementById('task-output').value='One measurable result'; document.getElementById('task-form').requestSubmit();`);
    assert.equal(await ev("state.tasks.filter(t=>t.title==='Browser check task').length"),1);
    await ev(`window.checkId=state.tasks.find(t=>t.title==='Browser check task').id; document.querySelector('[data-action="edit-task"][data-id="'+checkId+'"]').focus(); document.activeElement.click();`);
    await sleep(50);
    await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await ev("document.getElementById('task-modal').classList.contains('hidden') && document.activeElement.dataset.id === checkId"),true);
    console.log('ok - browser task creation, CSP rendering and Escape focus restoration');

    await ev(`document.querySelector('[data-action="toggle-timer"][data-id="'+checkId+'"]').click(); state.timer.startedAt -= 65000; saveState();`);
    await call('Page.reload');
    await until(() => ev("!!state.timer && !!document.querySelector('[data-action=\"pause-timer\"]')"), 'restored timer');
    assert.ok(await ev('taskProgress(state.tasks.find(t=>t.id===state.timer.taskId))') >= 65);
    await ev("document.querySelector('[data-action=\"pause-timer\"]').click()");
    assert.equal(await ev('state.timer.paused'),true);
    await call('Page.reload');
    await until(() => ev("document.querySelector('[data-action=\"pause-timer\"]')?.textContent.includes('Resume')"), 'paused resume UI');
    await ev("document.querySelector('[data-action=\"pause-timer\"]').click()");
    assert.equal(await ev('state.timer.paused'),false);
    await ev("document.querySelector('[data-action=\"toggle-timer\"].running').click()");
    console.log('ok - browser timer reload, pause, persisted pause, resume and stop');

    await ev(`document.getElementById('quick-add-button').click(); document.getElementById('task-title').value='Browser recurring'; document.getElementById('task-repeat').value='daily'; document.getElementById('task-repeat').dispatchEvent(new Event('change')); document.getElementById('task-repeat-until').value='2026-10-03'; document.getElementById('task-form').requestSubmit();
      window.seriesId=state.recurring.find(r=>r.title==='Browser recurring').id; instantiateRecurringForDate('2026-10-03'); window.seriesTask=state.tasks.find(t=>t.recurringId===seriesId && t.date==='2026-10-01').id;
      document.querySelector('[data-action="edit-task"][data-id="'+seriesTask+'"]').click(); document.getElementById('task-edit-scope').value='future'; document.getElementById('task-edit-scope').dispatchEvent(new Event('change')); document.getElementById('task-title').value='Edited future'; document.getElementById('task-repeat-until').value='2026-10-02'; document.getElementById('task-form').requestSubmit();`);
    assert.equal(await ev("state.tasks.some(t=>t.title==='Browser recurring' && t.date==='2026-10-03')"),false);
    await ev(`document.querySelector('[data-action="skip-task"][data-id="'+seriesTask+'"]').click()`);
    assert.equal(await ev("state.tasks.find(t=>t.id===seriesTask).skipped"),true);
    await call('Page.reload');
    await until(() => ev("!!document.querySelector('[data-action=\"unskip-task\"]')"), 'persisted skip');
    console.log('ok - browser recurrence end date, future edit and persistent skip');

    await ev(`window.originalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new Error('Simulated quota')}; document.getElementById('quick-add-button').click(); document.getElementById('task-title').value='Unsaved browser task'; document.getElementById('task-form').requestSubmit(); document.querySelector('[data-view="settings"]').click();`);
    assert.equal(await ev("document.getElementById('storage-status').textContent.includes('Storage error')"),true);
    assert.equal(await ev("!document.getElementById('storage-error').classList.contains('hidden')"),true);
    assert.equal(await ev("state.tasks.some(t=>t.title==='Unsaved browser task')"),true);
    await ev('Storage.prototype.setItem=originalSetItem; saveState()');
    assert.equal(await ev("document.getElementById('storage-error').classList.contains('hidden')"),true);
    console.log('ok - browser storage-error banner, in-memory retention and recovery');

    await ev(`window.originalTitle=state.tasks[0].title; window.incoming=JSON.parse(serializeState()); incoming.tasks[0].title='Imported browser task'; importText(JSON.stringify(incoming));`);
    assert.equal(await ev("state.tasks[0].title"),'Imported browser task');
    await ev('restoreLastBackup()');
    assert.equal(await ev('state.tasks[0].title===originalTitle'),true);
    console.log('ok - browser import backup and restore');

    await ev("caches.open('unrelated-smoke')");
    upgraded = true;
    await ev('(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();})()');
    await until(() => ev("!document.getElementById('update-banner').classList.contains('hidden')"), 'update prompt');
    await ev("document.getElementById('refresh-version').click()");
    await until(() => ev("(async()=>{const keys=await caches.keys();return keys.includes('academic-os-v3-smoke') && !keys.includes('academic-os-v2') && keys.includes('unrelated-smoke') && !!document.querySelector('.task-card');})()"), 'new worker activation and reload');
    console.log('ok - browser waiting-worker prompt, refresh, old-cache cleanup and unrelated-cache preservation');
    const offline = await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await call('Page.reload');
    await until(() => ev("!!document.querySelector('.task-card')"), 'offline cached reload');
    console.log('ok - browser offline reload');
    const significant=errors.filter(e=>!e.includes('favicon.ico'));
    assert.deepEqual(significant,[]);
    console.log('7/7 browser checks passed; no runtime or CSP errors');
  } finally {
    if(errors.length) console.error('Browser errors:', errors);
    socket?.close(); if(chrome) {try {process.kill(-chrome.pid,'SIGTERM');}catch{}}
    await new Promise(r=>server.close(r));
    await sleep(300); fs.rmSync(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
