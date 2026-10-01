# Academic Planner

Academic Planner is a local-first planning dashboard for students preparing for **GATE**, practising **DSA**, building projects, applying for internships, and managing college commitments.

It works offline, stores data on the device, and does not require an account, backend, or subscription. The same planner can run in a browser/PWA or inside a native Ubuntu GTK window.

> **Project status:** The browser version is usable and automated browser/core checks pass. The native Ubuntu/Snap delivery is a working candidate build, but installed Snap and real WebKit restart testing still need to be completed on a host where the required sandbox permissions are available.

## What It Includes

- Today, Week, Tracks, Review, and Settings views
- One-off tasks with category, date, duration, time range, notes, and measurable output
- Daily, weekday, and custom-weekday recurring tasks
- Inclusive recurrence end dates
- Per-day skips and “only this day” or “all future days” editing
- Focus timers that survive reloads and count elapsed time while the app is closed
- GATE, DSA, project, internship, and daily-review trackers
- JSON export/import with validation
- Automatic pre-import backup and “Restore last backup”
- Responsive browser UI and a native GTK desktop wrapper
- Browser PWA support with offline asset caching

The planner focuses on recurring activity and manual execution. It does not currently implement XP, levels, coins, bosses, or automatic dynamic rescheduling.

## Quick Start

### Run in a browser

Requirements: Python 3 and a modern browser.

```bash
git clone https://github.com/anmol1140w/academic_ubuntu.git
cd academic_ubuntu
chmod +x launch-planner.sh
./launch-planner.sh
```

The launcher starts a local server at:

```text
http://127.0.0.1:4173/index.html
```

Use `ACADEMIC_PLANNER_PORT` to select another port:

```bash
ACADEMIC_PLANNER_PORT=5050 ./launch-planner.sh
```

The browser launcher is the recommended way to try the project. Planner data is stored in that browser profile using local storage.

### Install a desktop launcher

The repository includes an application entry file for Ubuntu. It launches the
native GTK desktop application, not the browser server:

```bash
cp academic-os.desktop ~/.local/share/applications/
chmod +x ~/.local/share/applications/academic-os.desktop
```

For an optional desktop shortcut:

```bash
cp academic-os.desktop ~/Desktop/
chmod +x ~/Desktop/academic-os.desktop
```

To remove a manually installed launcher:

```bash
rm -f ~/.local/share/applications/academic-os.desktop
rm -f ~/Desktop/academic-os.desktop
```

## Desktop Application

The native version uses Python 3, GTK3, PyGObject, and WebKitGTK 4.1. It reuses the browser application rather than maintaining a second planner implementation.

The wrapper provides:

- Native GTK window and header bar
- Remembered window dimensions
- Single-instance activation
- Native import and export file choosers
- Desktop-specific light/dark styling
- Keyboard shortcuts

Shortcuts:

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New task |
| `Ctrl+1` | Today |
| `Ctrl+2` | Week |
| `Ctrl+E` | Export backup |
| `Ctrl+O` | Import backup |
| `Ctrl+Q` | Quit |

The desktop application serves bundled resources through the private `planner://app/` URI scheme. It does not start an HTTP server, load remote content, or expose a general JavaScript-to-filesystem bridge.

## Build the Snap

The desktop package currently targets **amd64** and uses `snap pack`, not Snapcraft. Build dependencies are expected to be installed already.

```bash
/usr/bin/python3 desktop/build.py
./snap/build.sh
snap pack --check-skeleton build/snap
```

The generated package is written to `dist/`. The application payload is small, but a fresh system also needs the shared `core24`, GNOME, Mesa, and GTK content snaps.

Install or reinstall the locally built Snap with:

```bash
sudo snap remove academic-planner
sudo snap install --dangerous dist/academic-planner_0.2.0_amd64.snap
```

Installing a Snap with the same name does not automatically replace the existing
installation, so remove it first. A normal `snap remove` preserves the Snap's
common data; use `sudo snap remove --purge academic-planner` only when that data
should also be deleted.

The Snap requests no general network, home-directory, system-file, or network-bind access. Native file access is provided through desktop file chooser portals.

## Data and Backups

All planner data is local. The browser uses the storage key `academic-os-v1`; the current schema is version 3, with sequential migrations from v1 to v3.

The main state includes:

```text
tasks, recurring, gate, dsa, projects, applications,
reviews, timer, selectedDate
```

The application validates loaded and imported data and protects against corrupt storage, unsupported newer data, and failed writes. If storage cannot be safely read, it avoids replacing the original data with a starter plan.

Use **Settings → Export** regularly. Browser and desktop profiles are separate, so data is not copied automatically between them. Clearing browser storage, changing browser profiles, removing the Snap, or moving to another machine does not preserve planner data.

There is one automatic pre-import backup slot. A new import attempt replaces the previous automatic backup. For archival backups, pause a running timer before exporting so restored data does not continue counting wall-clock time unexpectedly.

## Project Structure

| Path | Purpose |
| --- | --- |
| `index.html` | Browser entry point and application shell |
| `app.js` | State, migrations, scheduling, timers, rendering, and event handling |
| `styles.css` | Browser UI and responsive layout |
| `sw.js` | Browser service worker and asset cache |
| `manifest.webmanifest` | PWA metadata |
| `desktop/planner.py` | GTK/WebKit native wrapper |
| `desktop/theme.css` | Desktop-only presentation overrides |
| `desktop/build.py` | Whitelisted payload and icon generation |
| `snap/snap.yaml` | Snap runtime manifest |
| `snap/build.sh` | Snap packaging script |
| `tests/academic-os.test.js` | Core logic and persistence tests |
| `tests/browser-smoke.cjs` | Isolated browser smoke tests |
| `tests/desktop_test.py` | Desktop boundary and packaging tests |
| `tests/desktop_smoke.py` | Real WebKit restart/persistence harness |

## Testing

Run the core tests:

```bash
node tests/academic-os.test.js
```

Run browser smoke tests:

```bash
node tests/browser-smoke.cjs
```

Run desktop boundary tests:

```bash
/usr/bin/python3 tests/desktop_test.py
```

Run syntax and whitespace checks:

```bash
node --check app.js
node --check sw.js
git diff --check
```

The real desktop smoke test can be run with:

```bash
dbus-run-session -- xvfb-run -a /usr/bin/python3 tests/desktop_smoke.py
```

On the development host used for this project, that test is blocked by the WebKit sandbox error `bwrap: setting up uid map: Permission denied`. It should not be treated as a passing desktop verification.

## Security and Privacy

- No account or remote service is required.
- Browser content uses a restrictive Content Security Policy.
- The desktop wrapper has a fixed resource allowlist.
- Remote navigation and unexpected popups are denied by the desktop wrapper.
- WebKit permission requests are denied unless explicitly handled by the application.
- Snap confinement limits the packaged application’s system access.
- Import and export use user-selected files through native file choosers.

The desktop WebKit process relies on the outer Snap confinement boundary. This is documented because it is not equivalent to Chromium’s independent renderer sandbox. The project does not disable sandboxing through global host settings or hidden environment workarounds.

## Known Limitations

- No cloud sync or multi-device synchronization
- No multi-tab conflict resolution
- Browser and desktop data stores are independent
- Only one automatic pre-import backup is retained
- Native Snap installation and portal behavior are not yet verified here
- Real desktop restart persistence is blocked on the current host
- Snap packaging is amd64-only
- Git history restores source code, not browser or WebKit storage

## License

No license file is currently included in the repository. Add the project’s intended license before treating the repository as a reusable open-source package.