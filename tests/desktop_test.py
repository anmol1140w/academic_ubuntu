"""Headless wrapper boundary tests; these do NOT claim a confined GUI launch."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('planner', ROOT / 'desktop/planner.py')
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


class DesktopBoundaryTests(unittest.TestCase):
    def test_desktop_entry_uses_native_launcher(self):
        desktop_entry = (ROOT / 'academic-os.desktop').read_text(encoding='utf-8')
        self.assertIn('Exec=/home/anmol/academic-planner/desktop/academic-planner', desktop_entry)
        self.assertNotIn('launch-planner.sh', desktop_entry)

    def test_local_asset_allowlist(self):
        self.assertEqual(planner.asset_name(planner.APP_URI), 'index.html')
        for name in planner.ASSETS:
            self.assertEqual(planner.asset_name('planner://app/' + name), name)
            self.assertTrue((ROOT / name).is_file())

    def test_rejects_remote_and_filesystem_urls(self):
        for uri in ('https://example.com/', 'file:///etc/passwd', 'planner://evil/index.html',
                    'planner://app/../README.md', 'planner://app/%2e%2e%2fREADME.md',
                    'planner://app/index.html?path=/etc/passwd', 'planner://app/desktop/planner.py',
                    'planner://app/sw.js', 'planner://app@evil/index.html'):
            with self.subTest(uri=uri), self.assertRaises(ValueError):
                planner.asset_name(uri)

    def test_snap_data_is_common_not_revision_specific(self):
        with patch.dict(os.environ, {'SNAP_USER_COMMON': '/example/common', 'SNAP_USER_DATA': '/example/42',
                                    'ACADEMIC_PLANNER_DATA_DIR': '/ignored'}):
            self.assertEqual(planner.data_directory(), Path('/example/common/com.anmol.academicplanner'))

    def test_development_data_override_is_separate(self):
        with patch.dict(os.environ, {'ACADEMIC_PLANNER_DATA_DIR': '/tmp/desktop-boundary-test'}, clear=True):
            self.assertEqual(planner.data_directory(), Path('/tmp/desktop-boundary-test'))

    def test_atomic_window_preferences_replace_not_append(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'window.json'
            planner.atomic_json(path, {'width': 1000, 'height': 700})
            planner.atomic_json(path, {'width': 1200, 'height': 800})
            self.assertEqual(json.loads(path.read_text()), {'width': 1200, 'height': 800})
            self.assertFalse(path.with_suffix('.tmp').exists())

    def test_payload_has_one_core_and_no_tests_or_native_bridge(self):
        staged = ROOT / 'build/snap/share/academic-planner'
        self.assertTrue(staged.is_dir(), 'Run desktop/build.py first')
        for name in ('index.html', 'app.js', 'styles.css', 'icon.svg', 'manifest.webmanifest'):
            self.assertEqual((ROOT / name).read_bytes(), (staged / name).read_bytes())
        self.assertFalse((staged / 'tests').exists())
        self.assertFalse((staged / '.git').exists())
        self.assertFalse((staged / 'sw.js').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
