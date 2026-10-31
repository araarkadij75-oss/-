import ftplib
import importlib.util
import posixpath
import unittest
from pathlib import Path
from unittest import mock

module_path = Path(__file__).resolve().parents[1] / "scripts" / "deploy-regru-ftps.py"
spec = importlib.util.spec_from_file_location("deploy_regru_ftps", module_path)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load {module_path}")
deployer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployer)
ftp_mkdirs = deployer.ftp_mkdirs


class FakeFTP:
    def __init__(self, directories=()):
        self.directories = {"/", *directories}
        self.current = "/"

    def pwd(self):
        return self.current

    def _resolve(self, path):
        return posixpath.normpath(path if path.startswith("/") else posixpath.join(self.current, path))

    def cwd(self, path):
        target = self._resolve(path)
        if target not in self.directories:
            raise ftplib.error_perm(f"550 {path}: No such directory")
        self.current = target

    def mkd(self, path):
        target = self._resolve(path)
        parent = posixpath.dirname(target)
        if target in self.directories or parent not in self.directories:
            raise ftplib.error_perm(f"550 {path}: Cannot create directory")
        self.directories.add(target)


class FtpMkdirsTests(unittest.TestCase):
    def test_creates_rollback_sibling_when_staging_parent_already_exists(self):
        ftp = FakeFTP({"/.codex-staging"})

        ftp_mkdirs(ftp, ".codex-staging/rollback-release-1")

        self.assertIn("/.codex-staging/rollback-release-1", ftp.directories)
        self.assertNotIn("/.codex-staging/.codex-staging", ftp.directories)
        self.assertEqual("/", ftp.pwd())


    def test_public_check_requires_the_published_bytes_to_be_served(self):
        payload = b"<!doctype html><script>window.MASTER_AI_BUILD='test'</script>"
        digest = deployer.sha256(payload)
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = payload

        with mock.patch.object(deployer.urllib.request, "urlopen", return_value=response) as urlopen:
            deployer.public_check("https://crm.example/candidate", "index.html", digest)

        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            f"https://crm.example/candidate/index.html?codex_release_check={digest[:16]}",
        )
        self.assertEqual(request.get_header("Cache-control"), "no-cache, no-store, max-age=0")

    def test_public_check_rejects_stale_content(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"old release"

        with mock.patch.object(deployer.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "Public URL is serving different content"):
                deployer.public_check("https://crm.example/candidate", "index.html", "0" * 64)

    def test_public_method_check_accepts_expected_endpoint_status_without_reading_source(self):
        response = mock.MagicMock()
        response.code = 405
        with mock.patch.object(deployer.urllib.request, "urlopen", side_effect=deployer.urllib.error.HTTPError(
            "https://crm.example/candidate/crm-api/telegram.php", 405, "method", {}, None
        )) as urlopen:
            deployer.public_method_check("https://crm.example/candidate", "crm-api/telegram.php", 405)
        self.assertIn("/crm-api/telegram.php?codex_release_check=1", urlopen.call_args.args[0].full_url)

    def test_public_method_check_rejects_unexpected_status(self):
        response = mock.MagicMock()
        response.status = 200
        response.__enter__.return_value = response
        with mock.patch.object(deployer.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "expected HTTP 405, got 200"):
                deployer.public_method_check("https://crm.example/candidate", "crm-api/telegram.php", 405)

    def test_creates_nested_path_and_restores_initial_directory(self):
        ftp = FakeFTP()

        ftp_mkdirs(ftp, ".codex-staging/release-1")

        self.assertIn("/.codex-staging/release-1", ftp.directories)
        self.assertEqual("/", ftp.pwd())



class FirstDeploymentTests(unittest.TestCase):
    def test_new_asset_absence_requires_successful_listing(self):
        ftp = mock.Mock()
        ftp.retrbinary.side_effect = ftplib.error_perm("550 not found or denied")
        ftp.nlst.return_value = ["/site/index.html"]
        self.assertIsNone(deployer.ftp_read_existing(ftp, "/site/profit-ui.js", True))
        ftp.nlst.assert_called_once_with("/site")
        ftp.nlst.return_value = ["profit-ui.js"]
        with self.assertRaises(ftplib.error_perm):
            deployer.ftp_read_existing(ftp, "/site/profit-ui.js", True)
        ftp.nlst.side_effect = ftplib.error_perm("550 permission denied")
        with self.assertRaises(ftplib.error_perm):
            deployer.ftp_read_existing(ftp, "/site/profit-ui.js", True)

    def test_existing_role_file_is_required_even_if_listing_says_absent(self):
        ftp = mock.Mock()
        ftp.retrbinary.side_effect = ftplib.error_perm("550 missing")
        with self.assertRaises(ftplib.error_perm):
            deployer.ftp_read_existing(ftp, "/site/index.html")
        ftp.nlst.assert_not_called()

    def test_first_deploy_rollback_restores_old_files_and_removes_new_only(self):
        files = {"stage/new.js": b"new", "live/index.html": b"old", "stage/index.html": b"updated"}
        class MemoryFTP:
            def rename(self, source, target):
                if source not in files or target in files:
                    raise ftplib.error_perm("550 invalid rename")
                files[target] = files.pop(source)
            def delete(self, name):
                if name not in files:
                    raise ftplib.error_perm("550 absent")
                del files[name]
        ftp = MemoryFTP()
        deployer.ftp_promote(ftp, "live/new.js", "stage/new.js", "backup/new.js", False)
        deployer.ftp_promote(ftp, "live/index.html", "stage/index.html", "backup/index.html", True)
        self.assertNotIn("backup/new.js", files)
        deployer.ftp_restore(ftp, "live/index.html", "backup/index.html", True)
        deployer.ftp_restore(ftp, "live/new.js", "backup/new.js", False)
        self.assertEqual(files, {"live/index.html": b"old"})

    def test_failed_new_promotion_does_not_restore_nonexistent_backup(self):
        ftp = mock.Mock()
        ftp.rename.side_effect = ftplib.error_perm("550 failed")
        with self.assertRaises(ftplib.error_perm):
            deployer.ftp_promote(ftp, "live/new.js", "stage/new.js", "backup/new.js", False)
        ftp.rename.assert_called_once_with("stage/new.js", "live/new.js")

    def test_failed_existing_promotion_restores_previous_file(self):
        ftp = mock.Mock()
        ftp.rename.side_effect = [None, ftplib.error_perm("550 failed"), None]
        with self.assertRaises(ftplib.error_perm):
            deployer.ftp_promote(ftp, "live/index.html", "stage/index.html", "backup/index.html", True)
        self.assertEqual(ftp.rename.call_args_list[-1], mock.call("backup/index.html", "live/index.html"))

if __name__ == "__main__":
    unittest.main()
