#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./release-tag.sh <version>"
  echo "Example: ./release-tag.sh v1.0.1"
  exit 1
fi

TAG="$1"

git tag "$TAG"
git push origin "$TAG"

echo "Tag $TAG pushed. Check: https://github.com/SSDFDFDF/ProxyAPI/actions"
