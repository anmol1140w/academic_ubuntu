#!/usr/bin/env python3
"""Real WebKit persistence test in a temporary profile. Never disables sandboxing.
Run under a display and isolated session bus, e.g. dbus-run-session -- xvfb-run -a
/usr/bin/python3 tests/desktop_smoke.py. A sandbox startup error is a FAILED test.
Native chooser responses are automated; this does not certify Snap portals.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def worker(phase):
    spec = importlib.util.spec_from_file_location('planner', ROOT / 'desktop/planner.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    Gtk, GLib, WebKit2 = module.Gtk, module.GLib, module.WebKit2
    result = {'ok': False}
    backup = Path(os.environ['ACADEMIC_PLANNER_DATA_DIR']) / 'roundtrip.json'

    class Smoke(module.Planner):
        def do_activate(self):
            super().do_activate()
            self.webview.connect('load-changed', self.loaded)
            self.webview.connect('web-process-terminated', lambda *_: self.fail('WebKit process terminated'))
            GLib.timeout_add_seconds(25, lambda: self.fail('Timed out waiting for WebKit or file I/O'))

        def fail(self, message):
            print('FAIL:', message, file=sys.stderr)
            self.quit()
            return False

        def evaluate(self, script, done):
            def evaluated(view, answer):
                try:
                    value = view.evaluate_javascript_finish(answer)
                    done(value.to_string())
                except Exception as error:
                    self.fail(str(error))
            self.webview.evaluate_javascript(script, -1, None, None, None, evaluated)

        def finish(self, value='OK'):
            if value != 'OK':
                self.fail(value)
                return
            result['ok'] = True
            self.webview.try_close()

        def choose_destination(self, download, _suggested):
            download.set_destination(backup.as_uri())
            download.connect('finished', lambda *_: self.finish())
            return True

        def on_file_chooser(self, _view, request):
            request.select_files([str(backup)])
            GLib.timeout_add(500, self.verify_import)
            return True

        def verify_import(self):
            self.evaluate("state.tasks.some(t => t.title === 'Desktop persistence test' && t.done) ? 'OK' : 'Import did not restore the task'", self.finish)
            return False

        def loaded(self, view, event):
            if event != WebKit2.LoadEvent.FINISHED:
                return
            if phase == 'write':
                self.window.resize(1040, 760)
                self.evaluate("""
                  openTaskModal(null, {title: 'Desktop persistence test', category: 'gate', duration: 60});
                  document.getElementById('task-form').requestSubmit();
                  const record = state.tasks.find(t => t.title === 'Desktop persistence test');
                  toggleTask(record.id);
                  const timed = state.tasks.find(t => !t.done && t.category === 'dsa');
                  toggleTimer(timed.id); state.timer.startedAt -= 65000;
                  saveState(); exportData(); 'OK';
                """, lambda value: None if value == 'OK' else self.fail(value))
            else:
                self.evaluate("""
                  (() => {
                    if (!state.tasks.some(t => t.title === 'Desktop persistence test' && t.done)) return 'Task/completion lost after restart';
                    if (!state.timer || taskProgress(state.tasks.find(t => t.id === state.timer.taskId)) < 65) return 'Running timer lost after restart';
                    return 'OK';
                  })()
                """, self.begin_import)

        def begin_import(self, value):
            if value != 'OK':
                self.fail(value)
                return
            self.evaluate("state.tasks = state.tasks.filter(t => t.title !== 'Desktop persistence test'); saveState(); document.getElementById('import-file').click(); 'OK';", lambda _value: None)

    app = Smoke()
    app.run(['desktop-smoke'])
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--worker':
        raise SystemExit(worker(sys.argv[2]))
    if os.environ.get('SNAP'):
        raise SystemExit('This source smoke runner is not a substitute for installed Snap testing.')
    with tempfile.TemporaryDirectory(prefix='academic-planner-desktop-test-') as directory:
        env = {**os.environ, 'ACADEMIC_PLANNER_DATA_DIR': directory, 'GDK_BACKEND': 'x11', 'LIBGL_ALWAYS_SOFTWARE': '1'}
        for phase in ('write', 'reopen-import'):
            completed = subprocess.run(['/usr/bin/python3', __file__, '--worker', phase], env=env, timeout=35)
            if completed.returncode:
                raise SystemExit(f'Desktop {phase} FAILED (exit {completed.returncode}); persistence is not verified.')
            print(f'PASS desktop {phase}', flush=True)
        config = json.loads((Path(directory) / 'window.json').read_text())
        if config['width'] < 640 or config['height'] < 480:
            raise SystemExit('Window size persistence failed')
        print('PASS window preferences and offline desktop restart/export/import (native choosers automated)')
        print('XP/game-state tests: NOT APPLICABLE; the core has no gamification implementation.')
