# Academic OS

A local Ubuntu-friendly planner for GATE, DSA, projects, internships, fixed college commitments, exercise, contests, and daily review.

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
- PWA manifest, service worker, and `.desktop` launcher for Ubuntu.

## Launch on Ubuntu

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

The single Node test file covers real v1 startup, migrations, date boundaries, recurrence generation/edits/skips, timer reload/pause/resume, storage failure recovery, import/export/restore, validation, and service-worker activation/update messaging. It uses in-memory browser-boundary stubs, not your real saved data.
