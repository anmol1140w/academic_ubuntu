# Academic Planner

A local planner for GATE, DSA, projects, internships, fixed college commitments, exercise, contests, and daily review.

**Desktop delivery status: candidate built, not yet a verified installed Snap.** The native wrapper and a 60 KiB `.snap` have been created. Installation was denied without administrator authorization; unpackaged WebKit startup was blocked by this host's AppArmor user-namespace policy. Do not treat the desktop/Snap as production-ready until the installed launch and persistence checks below pass. The browser version remains usable and its regressions pass.

## Features

- Today view with a measurable task output for every block.
- Week view with automatically generated recurring activities.
- Add, edit, complete, time, postpone by editing the date, or delete tasks.
- Daily recurring templates, weekday templates, and custom weekly templates.
- Timer-based actual focus measurement; running timers survive reloads and include time while the page is closed. Pause/Resume excludes paused time.
- GATE, DSA, project, internship, and daily-review trackers.
- Validated JSON export/import, an automatic pre-import backup, and **Settings → Restore last backup**.
- Recurring tasks support an inclusive end date, **Skip this day**, and **Only this day / All future days** editing. Future edits preserve earlier history and completed/timed occurrences.
- All data is stored locally in the browser; there is no server or account.
- Browser PWA/service worker, plus a native GTK/WebKit wrapper and strict Snap packaging candidate.

## Desktop application

**Runtime:** GTK3 + maintained WebKitGTK 4.1, driven by a thin Python/PyGObject wrapper. It reuses the installed GNOME content runtime instead of bundling Electron/Chromium. See [desktop/ARCHITECTURE.md](desktop/ARCHITECTURE.md) for the runtime comparison, offline origin, security limits, and references.

- Application identity: **Academic Planner**, `com.anmol.academicplanner`.
- Dedicated native window/header bar, minimize/maximize/close, resizable layout, remembered dimensions, single-instance activation, local icon and desktop-specific light/dark styling.
- Native menu bindings: Ctrl+N (task), Ctrl+1 (Today), Ctrl+2 (Week), Ctrl+E (export), Ctrl+O (import), Ctrl+Q (quit). These are implemented, but interactive desktop verification is blocked here.
- Loads packaged resources at `planner://app/index.html`. No web server, external browser, remote content or renderer-to-filesystem bridge.
- Core `app.js`, scheduling, migrations, storage and timers remain shared with the browser. Only service-worker registration is skipped for the packaged `planner:` origin.
- Current core scheduling is recurring-task mapping and manual task management—not a dynamic rescheduling engine. **XP/levels/coins/bosses/game state are not implemented.** No fake counters or game-persistence claims have been added.

### Tested build and launch commands

From `/home/anmol/academic-planner`:

| Exact command executed | Actual result on this machine |
| --- | --- |
| `/usr/bin/python3 desktop/build.py` | Builds the whitelisted payload and SVG/PNG icons in 32, 48, 64, 128, 256 and 512 sizes. |
| `./snap/build.sh` | Success; produces `dist/academic-planner_0.2.0_amd64.snap`. Uses `snap pack`, not Snapcraft. |
| `snap pack --check-skeleton build/snap` | Success. |
| `desktop/academic-planner` (with a temporary data directory, Xvfb and a timeout) | Attempted; WebKit failed with `bwrap: setting up uid map: Permission denied`. |
| `snap install dist/academic-planner_0.2.0_amd64.snap --dangerous` | Attempted; `access denied (try with sudo)`. |
| `snap run academic-planner` | Attempted; snap is not installed. |
| `academic-planner --help` | Attempted; command not found because installation did not occur. |
| `snap remove academic-planner` | Attempted; administrator authorization required. No package was removed. |

No privileged install/removal success is claimed. An administrator must authorize installation before the remaining checks can run. No sandbox-disabling environment variables, root workarounds or global AppArmor/sysctl changes were applied to the desktop application. The source launcher does not work around the host's user-namespace policy.

Build dependencies were **already installed**: Python3, PyGObject, librsvg/cairo (icon generation), `desktop-file-validate`, `snap` and its squashfs packing tools. No packages or global tools were installed. The build currently targets **amd64** only.

The small app snap reuses `core24`, `gnome-46-2404`, `mesa-2404`, and `gtk-common-themes`. Those are sizeable shared dependencies on a fresh system, not included in the 60 KiB figure. Installation/content connections and portal behavior remain unverified. The package requests no `home`, `system-files`, `network` or `network-bind` access.

### Packaging structure

```text
desktop/planner.py                  native window and WebKit host
desktop/academic-planner            source/development launcher
desktop/theme.css                   desktop-only presentation
desktop/build.py                    payload/icon generation
snap/snap.yaml                     real runtime manifest for snap pack
snap/launcher                      GNOME/Mesa runtime startup
snap/gui/com.anmol.academicplanner.desktop
build/snap/                        generated package filesystem
dist/academic-planner_0.2.0_amd64.snap
```

A Snapcraft parts recipe is intentionally unnecessary: this app has no compilation or package-download stage. `snap pack` consumes the generated `meta/snap.yaml` directly.

### Desktop data safety

- Schema remains **v3** and the key remains **`academic-os-v1`**; this work does not introduce another migration.
- WebKit's data manager uses `$SNAP_USER_COMMON/com.anmol.academicplanner/webkit/` in Snap, not a revision-specific directory. Source development uses `~/.local/share/com.anmol.academicplanner/` unless explicitly overridden for testing.
- Snap and browser profiles are separate. Existing browser data is **not automatically copied or deleted**. Transfer it with Export/Import after desktop persistence is verified.
- Native GTK file choosers handle import/export; in Snap they are configured to use desktop portals. Native file-dialog and round-trip behavior has not yet been certified under confinement.
- `SNAP_USER_COMMON` persists across refreshes, but is not rolled back with a Snap revert. Download backups before removal/refresh; a Git checkout does not restore browser or WebKit data.
- The shared stock WebKit engine intentionally relies on outer Snap confinement rather than its nested Bubblewrap sandbox inside Snap. This security tradeoff is documented, not hidden.

### Verification record — Ubuntu 24.04.4 LTS, amd64

| Check | Result |
| --- | --- |
| Snap file builds; metadata and desktop entry validation | PASS |
| Core Node regressions | 21/21 PASS |
| Isolated Chrome browser checks including offline/CSP/import/timers | 7/7 PASS |
| Wrapper asset/data-path/packaging boundary tests | 6/6 PASS |
| Real WebKit desktop restart/persistence smoke test | BLOCKED/FAILED at sandbox startup, not a pass |
| Snap installation | BLOCKED by administrator authorization |
| Installed launcher/search/desktop icon, dedicated window, resizing | NOT VERIFIED |
| Tasks, completion and timers survive actual desktop/Snap restart | NOT VERIFIED |
| Native/Snap export/import and file portals | NOT VERIFIED |
| Actual desktop/Snap offline operation and runtime/CSP errors | NOT VERIFIED |
| XP and game-state persistence | NOT APPLICABLE: feature absent |

The core browser tests do not substitute for WebKit or Snap tests. The wrapper tests do not launch WebKit. `tests/desktop_smoke.py` is a real restart/file-round-trip harness for a temporary unpackaged profile; it leaves sandboxing enabled and currently fails visibly on this host. Its automated chooser responses would not certify desktop portals even on a successful run.

## Existing browser version — launch on Ubuntu

```bash
cd /home/anmol/academic-planner
chmod +x launch-planner.sh
./launch-planner.sh
```

To add a launcher to the desktop/applications menu:

```bash
cp academic-os.desktop ~/.local/share/applications/
# Optional desktop shortcut:
cp academic-os.desktop ~/Desktop/
chmod +x ~/Desktop/academic-os.desktop
```

If Ubuntu shows an untrusted launcher warning, right-click it and choose **Allow Launching**.

The launcher starts a local Python HTTP server on `127.0.0.1:4173` and opens the app in the default browser. Set `ACADEMIC_PLANNER_PORT` if that port is already in use.

## Important limitation

This app is local-first. Clearing browser storage, using a different browser profile, or moving to another machine will not carry data automatically. Use **Settings → Export** regularly. The local pre-import backup is not a substitute for a downloaded backup.

## Reliability and compatibility

- The storage key remains `academic-os-v1`. Schema migrations run sequentially: v1 → v2 → v3. Existing task IDs, times, trackers, reviews, and historical tasks whose templates were deleted are preserved.
- Saving errors leave changes in memory and show a persistent warning plus **Settings → Storage status**. Export before closing if storage is unavailable. If startup data cannot be read or is from a newer version, automatic writes are blocked so the original stored value is not replaced with a starter plan.
- Imports reject invalid dates/times, durations, categories, IDs, and field types. A backup is written immediately before every import attempt; if that write fails, import is cancelled. Restore last backup replaces the current planner. There is one backup slot, overwritten by the next import attempt.
- Timers remain running across import/restore as well as reload. **Pause before exporting an archival backup** if you do not want elapsed wall-clock time counted when restoring it later.
- To edit a recurring series, open an occurrence and choose **All future days**. The selected occurrence is the boundary. Earlier occurrences and completed/timed history are preserved; unworked generated tasks outside the new schedule are removed. **Only this day** does not change the series. A moved occurrence does not regenerate on its original day.
- Service-worker updates display **New version available, refresh** and activate on request. Only older Academic OS caches are deleted; localStorage is not cleared. When upgrading from the original cached app (which had no update prompt), close all planner tabs/windows and reopen once so the waiting update can activate. Do not clear site data.
- The app has no multi-tab conflict resolution. Use one planner tab/window when editing or timing work.
- Git rollback restores code, not browser data. Export first; the original app does not understand the new pause/recurrence behavior.

## Checks (no dependencies or build tools)

```bash
cd /home/anmol/academic-planner
node tests/academic-os.test.js
node --check app.js
node --check sw.js
git diff --check
```

The Node test file covers real v1 startup, migrations, date boundaries, recurrence generation/edits/skips, timer reload/pause/resume, storage failure recovery, import/export/restore, validation, and browser/desktop service-worker handling. It uses in-memory browser-boundary stubs, not your real saved data.

Additional commands actually executed:

```bash
/usr/bin/python3 desktop/build.py
/usr/bin/python3 tests/desktop_test.py
node tests/browser-smoke.cjs
```

The browser harness uses an isolated Chrome profile and a temporary HTTP server **only for browser tests**. Node 22 and Google Chrome are required for that harness; neither is a runtime dependency of the desktop Snap.

The following real desktop smoke command was also executed, but **failed** at the host's WebKit sandbox startup. It remains a useful pending verification step, not a passed check:

```bash
dbus-run-session -- xvfb-run -a /usr/bin/python3 tests/desktop_smoke.py
```
