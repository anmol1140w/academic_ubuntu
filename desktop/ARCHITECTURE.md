# Desktop decision

## Runtime selection

Keep one copy of the plain JavaScript planner. Use Python 3 + PyGObject + GTK3 + WebKitGTK 4.1 to host it. GTK3 provides a native Ubuntu window, header bar, window controls, menus and file choosers. WebKitGTK 4.1 uses the maintained WebKit engine; the 4.1 API name does not mean an obsolete browser engine.

Candidates considered:

| Runtime | Fit and tradeoff |
| --- | --- |
| Electron | Good Chromium compatibility and Snap tooling, but bundles Chromium/Node, increases package size and update burden, and adds privileged renderer-bridge concerns not needed here. |
| GTK4 + WebKitGTK 6 | Good native fit, installed on this host, but the installed GNOME Snap content runtime does not include WebKit6. Would require packaging and maintaining another WebKit build. |
| GTK3 + WebKitGTK 4.1 (selected) | Current WebKit engine already supplied by the installed GNOME content runtime. Native window and portal-capable file dialogs; minimal app payload and no Node runtime. Engine security updates come through the shared runtime. |

The app payload is small, but a fresh machine also downloads `core24`, `gnome-46-2404`, `mesa-2404` and `gtk-common-themes`. Shared-runtime size must not be confused with the app snap size.

## Assets and data

`planner://app/index.html` is a private resource scheme served by a strict filename allowlist. No listening socket, HTTP server, remote URL or browser executable is used. All task/timer/migration/import logic remains in `app.js`. The wrapper has no script-message/native filesystem bridge. Native shortcut actions evaluate only fixed developer-authored JS strings.

Desktop-only CSS is injected as a local stylesheet by the resource handler. The same root HTML/JS/CSS files are packaged, not copied into an independently maintained UI.

Stable data paths:

- Snap: `$SNAP_USER_COMMON/com.anmol.academicplanner/`
- Unpacked development: `$XDG_DATA_HOME/com.anmol.academicplanner/`, normally `~/.local/share/com.anmol.academicplanner/`
- A test-only/development path override `ACADEMIC_PLANNER_DATA_DIR` applies only outside Snap.

WebKit's persistent `WebsiteDataManager` writes localStorage in the `webkit/` subdirectory; its cache is separate. Window dimensions are kept in `window.json`. The origin and storage key `academic-os-v1` do not contain package revision numbers. There is no automatic access to Chromium/Firefox profiles. Move browser data with the existing export/import functions.

## Service workers

Web deployment still uses `sw.js`. Desktop startup skips service-worker registration for `planner:` because every asset is bundled and Snap owns application updates. Desktop persistence never depends on an asset cache. The browser still has its existing update notification flow.

## Permissions and security

- Strict Snap confinement, no `network`, `network-bind`, `home`, `system-files`, `personal-files` or `removable-media` interfaces.
- Only desktop/display/GPU/theme content interfaces and the specific application D-Bus name for single-instance activation.
- GTK native file choosers use desktop portals in Snap (`GTK_USE_PORTAL=1`). Read/write permission comes from the user's selected file, not unrestricted home access.
- Navigation, popups and permissions are denied except the packaged main page and same-origin blob backup downloads. The core CSP remains active.
- WebKit's sandbox is requested. **Stock WebKit intentionally disables its nested Bubblewrap sandbox when running inside Snap**, relying on the outer Snap boundary. This is not equivalent to Chromium's independent renderer sandbox; a compromised renderer shares the application's granted Snap permissions. No sandbox-disabling environment variables or global kernel changes are made by this project.
- Ubuntu 24.04's AppArmor user-namespace restriction can block an unpackaged developer launch (`bwrap: setting up uid map: Permission denied`). A successful source launch on a permissive machine would not prove Snap confinement. Conversely, disabling sandboxing to make a source test pass would not prove security. Installation and confined execution must be tested separately.

## Packaging

`snap/snap.yaml` is the real runtime manifest consumed by the official `snap pack` command. This is a prebuilt Python/web-assets app, so Snapcraft's parts/build environment is unnecessary. `desktop/build.py` whitelists payload files; `snap/build.sh` packs them. This avoids installing Snapcraft/LXD just to copy assets. Only installed build utilities are used.

The launcher chains the Mesa content provider's GPU wrapper and GNOME content provider's desktop launcher before `/usr/bin/python3` from core24. The WebKit helper-process layout points at the mounted GNOME runtime. `meta/gui/com.anmol.academicplanner.desktop` supplies the application menu identity; generated hicolor PNGs and the SVG supply the icon.

Build/install/launch evidence and limitations are tracked in the root README. A built squashfs file alone is not a completed Snap delivery.

## References

- [Canonical GNOME content runtime/extension](https://documentation.ubuntu.com/snapcraft/stable/reference/extensions/gnome-extension/)
- [Canonical GPU content interface](https://mir-server.io/docs/the-gpu-2404-snap-interface)
- [Snap runtime manifest format](https://snapcraft.io/docs/reference/development/yaml-schemas/the-snap-format/)
- [Snap desktop portals](https://snapcraft.io/docs/explanation/snap-development/xdg-desktop-portals/)
- [WebKit sandbox detection, including Snap](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WTF/wtf/glib/Sandbox.cpp)
- [WebKit custom URI scheme registration](https://webkitgtk.org/reference/webkit2gtk/stable/method.WebContext.register_uri_scheme.html)
