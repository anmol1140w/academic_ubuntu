# Academic OS

A local Ubuntu-friendly planner for GATE, DSA, projects, internships, fixed college commitments, exercise, contests, and daily review.

## Features

- Today view with a measurable task output for every block.
- Week view with automatically generated recurring activities.
- Add, edit, complete, time, postpone by editing the date, or delete tasks.
- Daily recurring templates, weekday templates, and custom weekly templates.
- Timer-based actual focus measurement; the app distinguishes planned minutes from tracked minutes.
- GATE, DSA, project, internship, and daily-review trackers.
- JSON export/import for backups.
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

This first version is local-first. Clearing browser storage, using a different browser profile, or moving to another machine will not carry data automatically. Use **Settings → Export** regularly.
