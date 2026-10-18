#!/usr/bin/env python3
"""Publish the allowlisted static CRM pages over verified explicit FTPS."""

from __future__ import annotations

import ftplib
import hashlib
import json
import os
import posixpath
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ALLOWLIST = ("index.html", "dispatcher-logistic.html", "master.html", "sw.js")
TARGET_PATH = "/var/www/u3680049/data/www/crm.remontpkspb.ru/candidate"


def require_env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name)
    if not value and default is not None:
        value = default
    if not value:
        raise RuntimeError(f"Required Actions setting is missing: {name}")
    return value


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_child(root: str, *parts: str) -> str:
    path = posixpath.normpath(posixpath.join(root, *parts))
    if path == ".." or path.startswith("../") or path.startswith("/"):
        raise RuntimeError("Remote path escaped the configured FTP home")
    return path


def ftp_mkdirs(ftp: ftplib.FTP_TLS, path: str) -> None:
    """Create each path component and restore the FTP home directory."""
    original_dir = ftp.pwd()
    try:
        for component in path.split("/"):
            if not component or component == ".":
                continue
            try:
                ftp.cwd(component)
            except ftplib.error_perm:
                ftp.mkd(component)
                ftp.cwd(component)
    finally:
        ftp.cwd(original_dir)


def ftp_read(ftp: ftplib.FTP_TLS, path: str) -> bytes:
    chunks: list[bytes] = []
    ftp.retrbinary(f"RETR {path}", chunks.append)
    return b"".join(chunks)


def ftp_write(ftp: ftplib.FTP_TLS, path: str, data: bytes) -> None:
    import io

    ftp.storbinary(f"STOR {path}", io.BytesIO(data))


def public_check(base_url: str, name: str, expected_hash: str) -> None:
    url = f"{base_url.rstrip('/')}/{name}?release_check={expected_hash[:16]}"
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            actual = sha256(response.read())
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Public smoke check failed for {name}: {exc}") from exc
    if actual != expected_hash:
        raise RuntimeError(f"Public file hash mismatch after upload: {name}")


def main() -> None:
    host = require_env("REG_RU_FTP_HOST")
    port = int(require_env("REG_RU_FTP_PORT", "21"))
    user = require_env("REG_RU_FTP_USER")
    password = require_env("REG_RU_FTP_PASSWORD")
    root = require_env("REG_RU_FTP_ROOT", ".").strip("/") or "."
    release_dir = Path(require_env("RELEASE_DIR", "release"))
    backup_dir = Path(require_env("BACKUP_DIR", "production-backup"))
    live_base_url = require_env("LIVE_BASE_URL", "https://crm.remontpkspb.ru/candidate")

    manifests = list(release_dir.rglob("RELEASE-MANIFEST.json"))
    if len(manifests) != 1:
        raise RuntimeError("Release artifact must contain exactly one RELEASE-MANIFEST.json")
    release_dir = manifests[0].parent
    manifest_path = release_dir / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("productionTarget") != TARGET_PATH:
        raise RuntimeError("Release manifest target does not match the fixed REG.RU target")
    if tuple(manifest.get("productionReplaceAllowlist", [])) != ALLOWLIST:
        raise RuntimeError("Release manifest changed the fixed production allowlist")

    payloads: dict[str, bytes] = {}
    hashes: dict[str, str] = {}
    for name in ALLOWLIST:
        record = manifest.get("files", {}).get(name)
        if not record:
            raise RuntimeError(f"Release manifest is missing {name}")
        content = (release_dir / name).read_bytes()
        actual = sha256(content)
        if len(content) != record.get("size") or actual != record.get("sha256"):
            raise RuntimeError(f"Local release file does not match its manifest: {name}")
        payloads[name] = content
        hashes[name] = actual

    # Backups are kept in the private GitHub Actions artifact, outside the website.
    backup_dir.mkdir(parents=True, exist_ok=True)
    changed: list[str] = []
    remote_backup: str | None = None
    remote_stage: str | None = None

    context = ssl.create_default_context()
    with ftplib.FTP_TLS(context=context, timeout=30) as ftp:
        ftp.connect(host, port)
        ftp.login(user, password)
        ftp.prot_p()
        ftp.cwd(root)

        release_id = str(manifest["releaseId"])
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        stage_rel = safe_child(root, ".codex-staging", release_id)
        backup_rel = safe_child(root, ".codex-staging", f"rollback-{stamp}-{release_id}")
        ftp_mkdirs(ftp, stage_rel)
        ftp_mkdirs(ftp, backup_rel)
        remote_stage = stage_rel
        remote_backup = backup_rel

        # Save and hash-check the old production files before any production mutation.
        old_files: dict[str, bytes] = {}
        for name in ALLOWLIST:
            old = ftp_read(ftp, safe_child(root, name))
            old_files[name] = old
            (backup_dir / name).write_bytes(old)
        (backup_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "releaseId": release_id,
                    "target": TARGET_PATH,
                    "capturedAt": datetime.now(timezone.utc).isoformat(),
                    "files": {name: {"size": len(data), "sha256": sha256(data)} for name, data in old_files.items()},
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        # Upload into a hidden staging directory and verify bytes by downloading them back.
        for name, content in payloads.items():
            staged = safe_child(stage_rel, name)
            ftp_write(ftp, staged, content)
            if sha256(ftp_read(ftp, staged)) != hashes[name]:
                raise RuntimeError(f"FTPS staging checksum mismatch: {name}")

        try:
            # The service worker is promoted last so it cannot advertise a new
            # shell before the role pages have been replaced.
            for name in ("index.html", "dispatcher-logistic.html", "master.html", "sw.js"):
                live = safe_child(root, name)
                backup = safe_child(backup_rel, name)
                staged = safe_child(stage_rel, name)
                ftp.rename(live, backup)
                try:
                    ftp.rename(staged, live)
                except Exception:
                    ftp.rename(backup, live)
                    raise
                changed.append(name)

            for name in ALLOWLIST:
                public_check(live_base_url, name, hashes[name])

        except Exception as deploy_error:
            rollback_errors: list[str] = []
            for name in reversed(changed):
                try:
                    live = safe_child(root, name)
                    backup = safe_child(backup_rel, name)
                    try:
                        ftp.delete(live)
                    except ftplib.error_perm:
                        pass
                    ftp.rename(backup, live)
                except Exception as rollback_error:  # report the specific failures
                    rollback_errors.append(f"{name}: {rollback_error}")
            if rollback_errors:
                raise RuntimeError(
                    f"Deploy failed ({deploy_error}); automatic rollback also failed: {'; '.join(rollback_errors)}"
                ) from deploy_error
            for name in ALLOWLIST:
                for temporary_path in (safe_child(stage_rel, name), safe_child(backup_rel, name)):
                    try:
                        ftp.delete(temporary_path)
                    except ftplib.error_perm:
                        pass
            for directory in (stage_rel, backup_rel):
                try:
                    ftp.rmd(directory)
                except ftplib.error_perm:
                    pass
            raise RuntimeError(f"Deploy failed; previous production files were restored: {deploy_error}") from deploy_error

        # The verified pre-image is stored as an Actions artifact; remove temporary public-tree copies.
        for name in ALLOWLIST:
            try:
                ftp.delete(safe_child(backup_rel, name))
            except ftplib.error_perm as exc:
                print(f"::warning::Could not remove temporary backup {name}: {exc}", file=sys.stderr)
        for name in ALLOWLIST:
            try:
                ftp.delete(safe_child(stage_rel, name))
            except ftplib.error_perm:
                pass
        for directory in (stage_rel, backup_rel):
            try:
                ftp.rmd(directory)
            except ftplib.error_perm as exc:
                print(f"::warning::Temporary FTP directory remains at {directory}: {exc}", file=sys.stderr)

    print(json.dumps({"status": "published", "releaseId": manifest["releaseId"], "files": hashes}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"::error::{exc}", file=sys.stderr)
        raise
