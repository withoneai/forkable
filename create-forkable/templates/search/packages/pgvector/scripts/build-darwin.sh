#!/usr/bin/env bash
# Builds the darwin universal (arm64 + x86_64) pgvector for the embedded
# Postgres 18.4 bundle, into prebuilt/darwin-universal/. Reproducible recipe:
#   1. a headers-only PostgreSQL 18.4 prefix (pg_config + server headers + pgxs),
#   2. pgvector built with PGXS, no -march=native, macOS 13 floor, and the
#      embedded `postgres` as the bundle loader.
# Usage: scripts/build-darwin.sh [--pg-prefix DIR]
# Env: PGVECTOR_VERSION (0.8.7), PG_VERSION (18.4), EMBEDDED_POSTGRES_BIN (auto).
set -euo pipefail

PGVECTOR_VERSION="${PGVECTOR_VERSION:-0.8.7}"
PG_VERSION="${PG_VERSION:-18.4}"
PGVECTOR_SHA256="cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HERE/.build"
OUT="$HERE/prebuilt/darwin-universal"
PG_PREFIX=""
if [[ "${1:-}" == "--pg-prefix" ]]; then PG_PREFIX="$2"; fi

[[ "$(uname)" == "Darwin" ]] || { echo "darwin only" >&2; exit 2; }
mkdir -p "$WORK"

# The embedded postgres executable, used as the bundle loader so server symbols resolve.
if [[ -z "${EMBEDDED_POSTGRES_BIN:-}" ]]; then
  EMBEDDED_POSTGRES_BIN="$(node -e '
    const { createRequire } = require("node:module");
    const r = createRequire(process.argv[1] + "/");
    for (const p of ["@embedded-postgres/darwin-arm64", "@embedded-postgres/darwin-x64"]) {
      try { const d = require("node:path").dirname(r.resolve(p + "/package.json")); console.log(d + "/native/bin/postgres"); process.exit(0); } catch {}
    }
    process.exit(1);' "$(cd "$HERE/../.." && pwd)/node_modules/.pnpm/node_modules")" || true
fi
if [[ -z "${EMBEDDED_POSTGRES_BIN:-}" || ! -x "$EMBEDDED_POSTGRES_BIN" ]]; then
  EMBEDDED_POSTGRES_BIN="$(ls -d "$HERE"/../../node_modules/.pnpm/@embedded-postgres+darwin-*/node_modules/@embedded-postgres/darwin-*/native/bin/postgres 2>/dev/null | head -1)"
fi
[[ -x "$EMBEDDED_POSTGRES_BIN" ]] || { echo "embedded postgres not found; pnpm install first or set EMBEDDED_POSTGRES_BIN" >&2; exit 1; }
echo "bundle loader: $EMBEDDED_POSTGRES_BIN"

# 1. headers-only PostgreSQL prefix
if [[ -z "$PG_PREFIX" ]]; then
  PG_PREFIX="$WORK/pgprefix-$PG_VERSION"
  if [[ ! -x "$PG_PREFIX/bin/pg_config" ]]; then
    cd "$WORK"
    [[ -f "postgresql-$PG_VERSION.tar.bz2" ]] || curl -fsSLO "https://ftp.postgresql.org/pub/source/v$PG_VERSION/postgresql-$PG_VERSION.tar.bz2"
    rm -rf "postgresql-$PG_VERSION" && tar -xjf "postgresql-$PG_VERSION.tar.bz2"
    cd "postgresql-$PG_VERSION"
    ./configure --prefix="$PG_PREFIX" --without-icu --without-readline --without-zlib >/dev/null
    make -C src/include install >/dev/null
    make -C src/port install >/dev/null
    make -C src/common install >/dev/null
    make -C src/bin/pg_config install >/dev/null
    make -C src/makefiles install >/dev/null
    make -C src install-local >/dev/null
  fi
fi
echo "pg_config: $PG_PREFIX/bin/pg_config ($("$PG_PREFIX/bin/pg_config" --version))"

# 2. pgvector
cd "$WORK"
TAR="pgvector-$PGVECTOR_VERSION.tar.gz"
[[ -f "$TAR" ]] || curl -fsSL -o "$TAR" "https://github.com/pgvector/pgvector/archive/refs/tags/v$PGVECTOR_VERSION.tar.gz"
echo "$PGVECTOR_SHA256  $TAR" | shasum -a 256 -c -
rm -rf "pgvector-$PGVECTOR_VERSION" && tar -xzf "$TAR"
cd "pgvector-$PGVECTOR_VERSION"
make PG_CONFIG="$PG_PREFIX/bin/pg_config" OPTFLAGS="" \
  CC="clang -arch arm64 -arch x86_64 -mmacosx-version-min=13.0" \
  BE_DLLLIBS="-bundle_loader $EMBEDDED_POSTGRES_BIN" >/dev/null

rm -rf "$OUT" && mkdir -p "$OUT/lib" "$OUT/share/extension"
cp vector.dylib "$OUT/lib/vector.dylib"
cp vector.control "$OUT/share/extension/"
cp sql/vector--*.sql "$OUT/share/extension/"
# pgvector's Makefile builds the base install script (sql/vector--X.Y.Z.sql) from sql/vector.sql
[[ -f "$OUT/share/extension/vector--$PGVECTOR_VERSION.sql" ]] || cp "sql/vector--$PGVECTOR_VERSION.sql" "$OUT/share/extension/"
lipo -info "$OUT/lib/vector.dylib"
otool -l "$OUT/lib/vector.dylib" | grep -A3 LC_BUILD_VERSION | grep minos | head -2

cd "$HERE"
node scripts/sums.mjs
echo "done: $OUT"
