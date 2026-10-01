#!/usr/bin/env python3
"""Native window for the unchanged local planner. No server and no JS/native bridge."""
import json
import mimetypes
import os
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gio, GLib, Gtk, WebKit2

APP_ID = 'com.anmol.academicplanner'
APP_NAME = 'Academic Planner'
ROOT = Path(__file__).resolve().parent.parent
APP_URI = 'planner://app/index.html'
ASSETS = {'index.html', 'app.js', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'desktop/theme.css'}


def data_directory():
    # Common survives Snap revisions. Never use the revision-specific SNAP_USER_DATA.
    if os.environ.get('SNAP_USER_COMMON'):
        return Path(os.environ['SNAP_USER_COMMON']) / APP_ID
    if os.environ.get('ACADEMIC_PLANNER_DATA_DIR'):
        return Path(os.environ['ACADEMIC_PLANNER_DATA_DIR']).resolve()
    return Path(GLib.get_user_data_dir()) / APP_ID


def asset_name(uri):
    parsed = urlsplit(uri)
    if parsed.scheme != 'planner' or parsed.netloc != 'app' or parsed.query:
        raise ValueError('Only bundled planner resources are allowed')
    name = unquote(parsed.path).lstrip('/') or 'index.html'
    if name not in ASSETS:
        raise ValueError('Resource is not in the packaged asset allowlist')
    return name


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf-8')
    temporary.replace(path)


class Planner(Gtk.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.window = None
        self.webview = None
        self.dialogs = set()
        self.data_dir = data_directory()
        self.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.window_file = self.data_dir / 'window.json'
        self.window_size = (1180, 820)
        GLib.set_application_name(APP_NAME)
        GLib.set_prgname(APP_ID)

    def do_startup(self):
        Gtk.Application.do_startup(self)
        Gtk.IconTheme.get_default().append_search_path(str(ROOT / 'desktop/icons'))
        Gtk.Window.set_default_icon_name(APP_ID)
        actions = {
            'new-task': "openTaskModal()",
            'today': "document.getElementById('today-button').click(); currentView = 'today'; render()",
            'week': "currentView = 'week'; render()",
            'export': "exportData()",
            'import': "document.getElementById('import-file').click()",
        }
        for name, script in actions.items():
            action = Gio.SimpleAction.new(name, None)
            action.connect('activate', lambda _a, _p, code=script: self.run_ui(code))
            self.add_action(action)
        close = Gio.SimpleAction.new('quit', None)
        close.connect('activate', lambda *_: self.webview.try_close() if self.webview else self.quit())
        self.add_action(close)
        for action, shortcut in {'new-task': '<Primary>n', 'today': '<Primary>1', 'week': '<Primary>2',
                                 'export': '<Primary>e', 'import': '<Primary>o', 'quit': '<Primary>q'}.items():
            self.set_accels_for_action('app.' + action, [shortcut])

    def run_ui(self, script):
        if self.webview and self.webview.get_uri() == APP_URI:
            # Only fixed, developer-defined shortcuts enter this method; never user data.
            self.webview.evaluate_javascript(script, -1, None, None, None, self.on_script_finished)

    def on_script_finished(self, view, result):
        try:
            view.evaluate_javascript_finish(result)
        except GLib.Error as error:
            self.show_error('Action unavailable', str(error))

    def do_activate(self):
        if self.window:
            self.window.present()
            return
        self.window = Gtk.ApplicationWindow(application=self, title=APP_NAME)
        self.window.set_icon_name(APP_ID)
        self.window.set_role(APP_ID)
        self.window.set_position(Gtk.WindowPosition.CENTER)
        self.window.set_size_request(640, 480)
        maximized = False
        try:
            config = json.loads(self.window_file.read_text(encoding='utf-8'))
            width, height = int(config['width']), int(config['height'])
            self.window_size = (max(640, min(width, 2560)), max(480, min(height, 1600)))
            maximized = config.get('maximized') is True
        except (OSError, ValueError, TypeError, KeyError):
            pass
        self.window.set_default_size(*self.window_size)
        header = Gtk.HeaderBar(title=APP_NAME, show_close_button=True)
        header.set_decoration_layout('menu:minimize,maximize,close')
        self.window.set_titlebar(header)
        menu = Gio.Menu()
        for title, action in [('New task', 'new-task'), ('Today', 'today'), ('Week', 'week'),
                              ('Export backup…', 'export'), ('Import backup…', 'import'), ('Quit', 'quit')]:
            menu.append(title, 'app.' + action)
        menu_button = Gtk.MenuButton(menu_model=menu)
        menu_button.set_image(Gtk.Image.new_from_icon_name('open-menu-symbolic', Gtk.IconSize.BUTTON))
        menu_button.set_tooltip_text('Planner actions and keyboard shortcuts')
        header.pack_end(menu_button)

        manager = WebKit2.WebsiteDataManager(base_data_directory=str(self.data_dir / 'webkit'),
                                             base_cache_directory=str(self.data_dir / 'cache'))
        self.context = WebKit2.WebContext.new_with_website_data_manager(manager)
        self.context.set_sandbox_enabled(True)
        self.context.register_uri_scheme('planner', self.on_uri_request)
        security = self.context.get_security_manager()
        security.register_uri_scheme_as_local('planner')
        security.register_uri_scheme_as_secure('planner')
        security.register_uri_scheme_as_cors_enabled('planner')
        settings = WebKit2.Settings()
        settings.set_enable_html5_local_storage(True)
        settings.set_enable_developer_extras(False)
        settings.set_allow_file_access_from_file_urls(False)
        settings.set_allow_universal_access_from_file_urls(False)
        settings.set_javascript_can_open_windows_automatically(False)
        settings.set_enable_write_console_messages_to_stdout(True)
        self.webview = WebKit2.WebView(web_context=self.context, settings=settings)
        self.webview.connect('decide-policy', self.on_policy)
        self.webview.connect('create', lambda *_: None)
        self.webview.connect('permission-request', lambda _v, request: (request.deny(), True)[1])
        self.webview.connect('run-file-chooser', self.on_file_chooser)
        self.webview.connect('close', self.on_web_close)
        self.webview.connect('web-process-terminated', self.on_web_failure)
        self.context.connect('download-started', self.on_download)
        self.window.connect('delete-event', self.on_delete)
        self.window.connect('configure-event', self.on_configure)
        self.window.add(self.webview)
        self.webview.load_uri(APP_URI)
        if maximized:
            self.window.maximize()
        self.window.show_all()

    def on_uri_request(self, request):
        try:
            name = asset_name(request.get_uri())
            body = (ROOT / name).read_bytes()
            if name == 'index.html':
                # Desktop-only presentation, not a second planner implementation.
                body = body.replace(b'</head>', b'<link rel="stylesheet" href="desktop/theme.css" /></head>')
            content_type = {'.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}.get(
                Path(name).suffix, mimetypes.guess_type(name)[0] or 'application/octet-stream')
            stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(body))
            request.finish(stream, len(body), content_type)
        except (ValueError, OSError) as error:
            request.finish_error(GLib.Error.new_literal(Gio.io_error_quark(), str(error), Gio.IOErrorEnum.NOT_FOUND))

    def on_policy(self, view, decision, kind):
        if kind in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            uri = decision.get_navigation_action().get_request().get_uri()
            if uri == APP_URI and kind != WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION:
                decision.use()
            elif uri.startswith('blob:planner://app/'):
                decision.download()
            else:
                decision.ignore()
            return True
        return False

    def on_file_chooser(self, _view, request):
        chooser = Gtk.FileChooserNative.new('Import planner backup', self.window,
                                            Gtk.FileChooserAction.OPEN, '_Open', '_Cancel')
        file_filter = Gtk.FileFilter()
        file_filter.set_name('Planner JSON backups')
        file_filter.add_pattern('*.json')
        chooser.add_filter(file_filter)
        self.dialogs.add(chooser)
        def selected(dialog, response):
            filename = dialog.get_filename()
            if response == Gtk.ResponseType.ACCEPT and filename:
                request.select_files([filename])
            else:
                request.cancel()
            self.dialogs.discard(dialog)
            dialog.destroy()
        chooser.connect('response', selected)
        chooser.show()
        return True

    def on_download(self, _context, download):
        if not download.get_request().get_uri().startswith('blob:planner://app/'):
            download.cancel()
            return
        download.connect('decide-destination', self.choose_destination)
        download.connect('failed', self.download_failed)

    def choose_destination(self, download, suggested):
        chooser = Gtk.FileChooserNative.new('Export planner backup', self.window,
                                            Gtk.FileChooserAction.SAVE, '_Save', '_Cancel')
        chooser.set_current_name(Path(suggested).name or 'academic-planner.json')
        chooser.set_do_overwrite_confirmation(True)
        self.dialogs.add(chooser)
        def selected(dialog, response):
            uri = dialog.get_uri()
            if response == Gtk.ResponseType.ACCEPT and uri:
                download.set_allow_overwrite(True)
                download.set_destination(uri)
            else:
                download.cancel()
            self.dialogs.discard(dialog)
            dialog.destroy()
        chooser.connect('response', selected)
        chooser.show()
        return True

    def download_failed(self, _download, error):
        if not error.matches(WebKit2.download_error_quark(), WebKit2.DownloadError.CANCELLED_BY_USER):
            self.show_error('Export failed', str(error))

    def show_error(self, title, message):
        dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.ERROR,
                                   buttons=Gtk.ButtonsType.CLOSE, text=title)
        dialog.format_secondary_text(message)
        dialog.connect('response', lambda widget, _response: widget.destroy())
        dialog.show()

    def on_configure(self, window, _event):
        if not window.is_maximized():
            self.window_size = window.get_size()
        return False

    def on_delete(self, *_):
        self.webview.try_close()
        return True

    def on_web_close(self, *_):
        try:
            atomic_json(self.window_file, {'width': self.window_size[0], 'height': self.window_size[1],
                                          'maximized': self.window.is_maximized()})
        except OSError as error:
            print(f'Could not save window size: {error}', file=sys.stderr)
        self.window.destroy()
        self.window = None
        self.quit()

    def on_web_failure(self, _view, reason):
        self.show_error('Planner web process stopped',
                        f'The saved planner data has not been deleted. Close and reopen the app. Reason: {reason.value_nick}')


if __name__ == '__main__':
    raise SystemExit(Planner().run(sys.argv))
