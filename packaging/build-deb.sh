#!/usr/bin/env bash
# build-deb.sh — Builds the vhs-digitizer Debian package.
#
# Prerequisites (on the build machine):
#   - Node.js + npm
#   - uv (https://docs.astral.sh/uv/)
#   - dpkg-deb (install via: apt install dpkg)
#
# Usage:
#   ./packaging/build-deb.sh [version]
#
# Output:
#   packaging/vhs-digitizer_<version>_amd64.deb

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGING_DIR="$REPO_ROOT/packaging"
VERSION="${1:-1.0.0}"
PACKAGE_NAME="vhs-digitizer_${VERSION}_amd64"
BUILD_DIR="$PACKAGING_DIR/build/$PACKAGE_NAME"
APP_DIR="$BUILD_DIR/usr/lib/vhs-digitizer"

echo "==> Building vhs-digitizer $VERSION"

# ── Clean previous build ──────────────────────────────────────────────────────
rm -rf "$PACKAGING_DIR/build"
mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$APP_DIR/backend"
mkdir -p "$BUILD_DIR/lib/systemd/system"

# ── 1. Build the frontend ─────────────────────────────────────────────────────
echo "==> Building React frontend..."
cd "$REPO_ROOT/frontend"
npm ci --silent
npm run build

# ── 2. Export pinned Python requirements via uv ───────────────────────────────
echo "==> Exporting Python requirements..."
cd "$REPO_ROOT/backend"
uv export --no-hashes --no-dev -o "$APP_DIR/requirements.txt"

# ── 3. Copy backend source files ──────────────────────────────────────────────
echo "==> Copying backend..."
cp "$REPO_ROOT/backend/main.py"     "$APP_DIR/backend/"
cp "$REPO_ROOT/backend/obs.py"      "$APP_DIR/backend/"
cp "$REPO_ROOT/backend/database.py" "$APP_DIR/backend/"

# ── 4. Copy pre-built frontend ────────────────────────────────────────────────
echo "==> Copying frontend dist..."
mkdir -p "$APP_DIR/frontend"
cp -r "$REPO_ROOT/frontend/dist" "$APP_DIR/frontend/"

# ── 5. Copy systemd unit file ─────────────────────────────────────────────────
cp "$PACKAGING_DIR/debian/vhs-digitizer.service" \
   "$APP_DIR/vhs-digitizer.service"
cp "$PACKAGING_DIR/debian/vhs-digitizer.service" \
   "$BUILD_DIR/lib/systemd/system/vhs-digitizer.service"

# ── 6. Write the DEBIAN control file (with computed version) ──────────────────
sed "s/^Version: .*/Version: $VERSION/" \
    "$PACKAGING_DIR/debian/control" > "$BUILD_DIR/DEBIAN/control"

# ── 7. Copy maintainer scripts and set permissions ───────────────────────────
for script in postinst prerm postrm; do
    if [ -f "$PACKAGING_DIR/debian/$script" ]; then
        cp "$PACKAGING_DIR/debian/$script" "$BUILD_DIR/DEBIAN/$script"
        chmod 755 "$BUILD_DIR/DEBIAN/$script"
    fi
done

# ── 8. Set file ownership ─────────────────────────────────────────────────────
# All installed files should be owned by root
find "$BUILD_DIR" -not -path "$BUILD_DIR/DEBIAN/*" \
    -exec chmod go-w {} \;

# ── 9. Build the .deb ─────────────────────────────────────────────────────────
echo "==> Building .deb package..."
dpkg-deb --build --root-owner-group "$BUILD_DIR" \
    "$PACKAGING_DIR/${PACKAGE_NAME}.deb"

echo ""
echo "Done: $PACKAGING_DIR/${PACKAGE_NAME}.deb"
echo ""
echo "Install with:"
echo "  sudo apt install ./packaging/${PACKAGE_NAME}.deb"
echo ""
echo "Then access the application at http://$(hostname -I | awk '{print $1}'):8000"
