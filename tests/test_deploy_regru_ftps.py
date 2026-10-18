import ftplib
import importlib.util
import posixpath
import unittest
from pathlib import Path

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


    def test_public_check_does_not_depend_on_reverse_proxy_origin(self):
        # Production validation relies on authenticated FTP read-back because
        # the public URL is not necessarily served from this FTP account's root.
        deployer.public_check("https://invalid.example", "index.html", "0" * 64)

    def test_creates_nested_path_and_restores_initial_directory(self):
        ftp = FakeFTP()

        ftp_mkdirs(ftp, ".codex-staging/release-1")

        self.assertIn("/.codex-staging/release-1", ftp.directories)
        self.assertEqual("/", ftp.pwd())


if __name__ == "__main__":
    unittest.main()
