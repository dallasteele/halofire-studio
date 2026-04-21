"""Tests for download_openscad.py — no network, no writes of real binaries."""
from __future__ import annotations

import json
from pathlib import Path
from unittest import mock

import pytest

import download_openscad as dl


def test_target_triple_detection_matches_platform(monkeypatch):
    monkeypatch.setattr(dl.platform, "system", lambda: "Windows")
    monkeypatch.setattr(dl.platform, "machine", lambda: "AMD64")
    assert dl.detect_target_triple() == "x86_64-pc-windows-msvc"

    monkeypatch.setattr(dl.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(dl.platform, "machine", lambda: "arm64")
    assert dl.detect_target_triple() == "aarch64-apple-darwin"

    monkeypatch.setattr(dl.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(dl.platform, "machine", lambda: "x86_64")
    assert dl.detect_target_triple() == "x86_64-apple-darwin"

    monkeypatch.setattr(dl.platform, "system", lambda: "Linux")
    monkeypatch.setattr(dl.platform, "machine", lambda: "x86_64")
    assert dl.detect_target_triple() == "x86_64-unknown-linux-gnu"


def test_manifest_parses_into_expected_shape():
    manifest = dl.load_manifest()
    assert "openscad_version" in manifest
    assert "source" in manifest
    assert "checksums" in manifest
    expected = {
        "x86_64-pc-windows-msvc",
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
        "x86_64-unknown-linux-gnu",
    }
    assert set(manifest["checksums"].keys()) == expected
    for triple, entry in manifest["checksums"].items():
        assert entry["url"].startswith("https://")
        assert "sha256" in entry
        assert "binary_path_in_archive" in entry


def test_target_binary_path_per_triple(tmp_path):
    bin_dir = tmp_path / "bin"
    assert (
        dl.target_binary_path("x86_64-pc-windows-msvc", bin_dir)
        == bin_dir / "openscad-x86_64-pc-windows-msvc.exe"
    )
    assert (
        dl.target_binary_path("aarch64-apple-darwin", bin_dir)
        == bin_dir / "openscad-aarch64-apple-darwin"
    )
    assert (
        dl.target_binary_path("x86_64-unknown-linux-gnu", bin_dir)
        == bin_dir / "openscad-x86_64-unknown-linux-gnu"
    )
    assert (
        dl.target_binary_path("x86_64-apple-darwin", bin_dir)
        == bin_dir / "openscad-x86_64-apple-darwin"
    )


def test_dry_run_makes_no_network_or_writes(tmp_path, monkeypatch):
    manifest = {
        "checksums": {
            "x86_64-pc-windows-msvc": {
                "url": "https://example.invalid/openscad.zip",
                "sha256": "deadbeef",
                "binary_path_in_archive": "openscad.exe",
            }
        }
    }

    # Fail loud if any network or extract happens.
    def _boom(*a, **kw):
        raise AssertionError("network call attempted during --dry-run")

    monkeypatch.setattr(dl, "_download", _boom)
    monkeypatch.setattr(dl, "extract_binary", _boom)
    monkeypatch.setattr(dl.urllib.request, "urlopen", _boom)

    bin_dir = tmp_path / "bin"
    out = dl.fetch_for_triple(
        "x86_64-pc-windows-msvc",
        manifest,
        bin_dir=bin_dir,
        skip_verify=True,
        dry_run=True,
    )
    # Nothing written.
    assert not out.exists()
    assert not bin_dir.exists() or not any(bin_dir.iterdir())
