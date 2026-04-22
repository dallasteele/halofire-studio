#!/usr/bin/env bash
# HaloFire Studio release tag script.
#
# Run this when ready to cut a tagged release — pushing the annotated
# tag triggers `.github/workflows/build-desktop.yml` to produce the
# MSI / DMG / AppImage artifact matrix.
#
# Usage:
#   bash scripts/release.sh v0.1.0
#
# Preconditions:
#   - Working tree is clean (no uncommitted or untracked changes).
#   - `origin` remote points at the canonical GitHub repo.
#   - The current HEAD is the commit you want to tag.
set -euo pipefail

VERSION="${1:?usage: release.sh v0.1.0}"

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "error: version must match vMAJOR.MINOR.PATCH[-prerelease], got: $VERSION" >&2
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "error: uncommitted changes — commit or stash first" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "error: untracked changes — clean working tree before tagging" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  echo "error: tag $VERSION already exists" >&2
  exit 1
fi

echo "Tagging $VERSION at $(git rev-parse --short HEAD)..."
git tag -a "$VERSION" -m "HaloFire Studio $VERSION"
git push origin "$VERSION"

echo
echo "Tag $VERSION pushed."
echo "CI will build MSI / DMG / AppImage artifacts at:"
echo "  https://github.com/dallasteele/halofire-studio/actions"
