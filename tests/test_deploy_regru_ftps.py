import ftplib
import posixpath
import unittest

from scripts.deploy_regru_ftps import ftp_mkdirs


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

    def test_creates_nested_path_and_restores_initial_directory(self):
        ftp = FakeFTP()

        ftp_mkdirs(ftp, ".codex-staging/release-1")

        self.assertIn("/.codex-staging/release-1", ftp.directories)
        self.assertEqual("/", ftp.pwd())


if __name__ == "__main__":
    unittest.main()
