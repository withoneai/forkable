# pgvector on the embedded Postgres

Spike run 2026-10-29 on a Mac (darwin arm64, macOS 26, Node 22.23.4), in
`/tmp/search-pgvector-spike` (scratch, outside the repo). Nothing installed
globally; `~/.rill` and the Postgres already listening on 55489 (someone
else's) were not touched. Spike servers ran on port 55589.

## Verdict

- **embedded-postgres does not ship pgvector.** `CREATE EXTENSION vector`
  fails with `extension "vector" is not available`.
- **It can load pgvector.** A pgvector we compile ourselves against PG 18.4
  headers loads into the stock bundle, and so does Homebrew's PG 18 build.
  `CREATE EXTENSION vector`, `<=>`, an HNSW cosine index (used by the
  planner) and a hybrid FTS + vector RRF query all work, and survive a
  restart.
- **No need to touch `node_modules`.** PG 18's new `extension_control_path`
  plus `dynamic_library_path`, passed as `postgresFlags`, load the extension
  from a directory we own (for example `~/.search/pg-ext/vector-0.8.x/`).
  Verified with an untouched bundle.
- **Recommended:** keep embedded-postgres (same as Rill), ship our own
  prebuilt pgvector per platform (built in CI against PG 18 headers), point
  the server at it with two `-c` flags, detect capability at boot, and fall
  back to keyword-only search when it is missing.
- **PGlite + `@electric-sql/pglite-pgvector` also works** (FTS, HNSW,
  Drizzle driver), but it is single-process WASM and about 10x slower to
  build an HNSW index. Keep it as a possible fallback engine, not the default.
- **Supabase supports pgvector**: extension `vector`, enabled in the
  `extensions` schema.

## What Rill does (the baseline)

- Rill's `server/package.json`: `"embedded-postgres": "^18.4.0-beta.17"`;
  installed `embedded-postgres@18.4.0-beta.17` and the
  `@embedded-postgres/<platform>@18.4.0-beta.17` packages. Root
  `package.json` allows build scripts only for the darwin-arm64, darwin-x64,
  linux-x64 and linux-arm64 platform packages.
- Rill's `server/src/boot.ts`: `DATABASE_URL` set means external Postgres,
  migrations, done. Otherwise data dir `<RILL_HOME>/db` (`~/.rill/db`), port
  from `RILL_PG_PORT` (default 55439, first free port at or after it),
  `new EmbeddedPostgres({ databaseDir, user, password, port, persistent:
  true, initdbFlags: ["--encoding=UTF8", "--locale=C"] })`, `initialise()`
  only when `PG_VERSION` is missing, then `start()`. It reuses a live server
  found through `postmaster.pid`, and recreates missing dylib symlinks from
  `native/pg-symlinks.json` because pnpm 10 can skip the postinstall.

## What the bundle ships

`@embedded-postgres/darwin-arm64@18.4.0-beta.17`, `native/`:

- `bin/`: only `initdb`, `pg_ctl`, `postgres`. **No `pg_config`.**
- No `include/` at all. **No server headers.**
- `lib/`: support dylibs (ICU 77, OpenSSL 3, krb5, libxml2, lz4, zstd, ...)
  and `lib/postgresql/` with 90 modules (contrib: `pg_trgm`, `unaccent`,
  `btree_gin`, `fuzzystrmatch`, ..., plus `system_stats` and
  `plugin_debugger`, so the build looks EDB-derived).
- `share/postgresql/extension/`: contrib control and SQL files. No vector.
- `postgres --version`: `PostgreSQL 18.4`. `bin/postgres` is a universal
  Mach-O (x86_64 + arm64), arm64 slice `minos 13.0`. `version()` says
  `x86_64-apple-darwin24.6.0`; that string is from the build host, the arm64
  slice is what runs.

`@embedded-postgres/linux-x64@18.4.0-beta.17` (inspected with `npm pack`,
not run): same layout, `bin/` has only `initdb`, `pg_ctl`, `postgres`, no
`include/`, no vector. Ships `libpgcommon.a`/`libpgport.a`, ICU 60 and
OpenSSL 1.1 (Ubuntu 18.04 era). `postgres` needs glibc 2.27 at most.

## Step 1: stock bundle

```sh
mkdir -p /tmp/search-pgvector-spike/app && cd /tmp/search-pgvector-spike/app
echo '{"name":"spike","private":true,"type":"module"}' > package.json
NODE_ENV=development npm install --include=dev --no-audit --no-fund \
  embedded-postgres@18.4.0-beta.17 pg
node /tmp/search-pgvector-spike/scripts/try.mjs \
  /tmp/search-pgvector-spike/app /tmp/search-pgvector-spike/data1 55589
```

`try.mjs` boots EmbeddedPostgres (same options as Rill) and runs the SQL
below. Result:

```
OK   select name ... from pg_available_extensions where name in ('vector','pg_trgm','unaccent')
     -> unaccent 1.1, pg_trgm 1.6          (no vector)
FAIL create extension if not exists vector -> extension "vector" is not available
```

## Step 2: Homebrew's PG 18 build dropped in (works, not shippable)

This Mac has Homebrew `pgvector 0.8.2`, which carries a PG 18 build.

```sh
N=/tmp/search-pgvector-spike/app/node_modules/@embedded-postgres/darwin-arm64/native
cp /opt/homebrew/opt/pgvector/lib/postgresql@18/vector.dylib $N/lib/postgresql/
cp /opt/homebrew/opt/pgvector/share/postgresql@18/extension/vector* $N/share/postgresql/extension/
```

`otool -L vector.dylib` shows only `libSystem`; it is an arm64 bundle with
`minos 26.0`. Result: everything passes (see step 3 for the SQL). Proves a
PG 18 pgvector built elsewhere loads into this postgres (macOS bundles bind
server symbols to the host executable, and `PG_MODULE_MAGIC` only checks
the major version and a few compile constants). Not shippable: needs
Homebrew, and `minos 26.0` would refuse to load on older macOS.

## Step 3: compile pgvector ourselves (works, the shippable route)

There is no `pg_config` or headers in the bundle, so get them from the
matching PostgreSQL source. A headers-only prefix is enough:

```sh
cd /tmp/search-pgvector-spike/dl
curl -fsSLO https://ftp.postgresql.org/pub/source/v18.4/postgresql-18.4.tar.bz2
curl -fsSL -o pgvector-0.8.2.tar.gz https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.2.tar.gz
tar -xjf postgresql-18.4.tar.bz2 -C ../src && tar -xzf pgvector-0.8.2.tar.gz -C ../src

cd ../src/postgresql-18.4
P=/tmp/search-pgvector-spike/pgprefix
./configure --prefix=$P --without-icu --without-readline --without-zlib
make -C src/include install
make -C src/port install
make -C src/common install
make -C src/bin/pg_config install
make -C src/makefiles install
make -C src install-local          # installs pgxs Makefile.global/shlib
```

(About a minute; no full server build.) Then pgvector, with the embedded
`postgres` as the bundle loader, no `-march=native`, a macOS 13 floor and
both architectures:

```sh
N2=/tmp/search-pgvector-spike/app2/node_modules/@embedded-postgres/darwin-arm64/native
cd /tmp/search-pgvector-spike/build-vector     # copy of pgvector-0.8.2
make PG_CONFIG=$P/bin/pg_config OPTFLAGS="" \
  CC="clang -arch arm64 -arch x86_64 -mmacosx-version-min=13.0" \
  BE_DLLLIBS="-bundle_loader $N2/bin/postgres"
lipo -info vector.dylib      # x86_64 arm64
```

Gotchas found:
- `PG_CFLAGS`/`MACOSX_DEPLOYMENT_TARGET` did not lower `minos`; putting
  `-mmacosx-version-min` in `CC` did.
- `make clean` with no `PG_CONFIG` silently uses Homebrew's PG 17 pgxs;
  always pass `PG_CONFIG` (or delete `*.o`/`*.dylib` by hand).
- The universal dylib is 380 KB.

Installed into a fresh bundle and tested (`try.mjs`, then `hybrid.mjs`):

```
OK   create extension if not exists vector
OK   select '[1,2,3]'::vector <=> '[1,2,4]'::vector -> 0.00853986601633272
OK   create table docs (..., tsv tsvector generated always as (to_tsvector('english', body)) stored, emb vector(3))
OK   create index docs_emb_hnsw on docs using hnsw (emb vector_cosine_ops)
OK   create index docs_tsv_gin on docs using gin (tsv)
OK   explain ... order by emb <=> '[1,0.1,0]' limit 2
     -> Limit -> Index Scan using docs_emb_hnsw on docs, Order By: (emb <=> ...)
OK   select extversion from pg_extension where extname='vector' -> 0.8.2
```

`hybrid.mjs`: 2,001 rows, weighted title/body `tsvector`, `vector(8)`, HNSW
(`m = 16, ef_construction = 64`), GIN, then Reciprocal Rank Fusion of
`websearch_to_tsquery('english', 'acme invoice -offsite')` ranked by
`ts_rank_cd` and the cosine neighbours. The planted "Acme invoice March" row
came first with keyword rank 1 and vector rank 1. Stopped and restarted on
the same data dir: `installed: '0.8.2'`, the HNSW index scan still used.

The query shape that worked:

```sql
with q as (select websearch_to_tsquery('english', $1) as tq, $2::vector as qv),
kw as (select i.id, row_number() over (order by ts_rank_cd(i.tsv, q.tq) desc) as r
       from items i, q where i.tsv @@ q.tq
       order by ts_rank_cd(i.tsv, q.tq) desc limit 50),
vec as (select i.id, row_number() over (order by i.emb <=> q.qv) as r
        from items i, q order by i.emb <=> q.qv limit 50)
select i.id, i.title, kw.r as kw_rank, vec.r as vec_rank,
       coalesce(1.0/(60+kw.r),0) + coalesce(1.0/(60+vec.r),0) as rrf
from kw full outer join vec using (id) join items i on i.id = coalesce(kw.id, vec.id)
order by rrf desc limit 20;
```

## Step 4: load from our own directory, bundle untouched (works)

Writing into `node_modules` is fragile: a reinstall wipes it, pnpm
hardlinks package files from its store, and `npx` caches are shared. PG 18
added `extension_control_path`. With a third, untouched install (`app3`,
zero vector files in the bundle) and the extension in its own directory:

```
~/.search/pg-ext/vector-0.8.2/            (spike used /tmp/.../home/pg-ext/vector-0.8.2)
  lib/vector.dylib
  share/extension/vector.control
  share/extension/vector--*.sql
```

```js
new EmbeddedPostgres({
  ...,
  postgresFlags: [
    "-c", `extension_control_path=$system:${ext}/share`,
    "-c", `dynamic_library_path=$libdir:${ext}/lib`,
  ],
});
```

Result (`extpath.mjs`): `pg_available_extensions` lists vector 0.8.2,
`CREATE EXTENSION`, `<=>`, HNSW all OK. Note `extension_control_path` takes
the directory that **contains** `extension/`, not the `extension/` dir.

Failure mode, tested (`missing.mjs`): create the extension with the flags,
restart **without** them. Plain queries still work; `pg_extension` still
says `0.8.2` but `pg_available_extensions` says 0; any vector value fails
with `could not access file "vector": No such file or directory`. So the
flags must be passed on every boot, and the check below catches it.

Rill-style reuse of a server already running (found via `postmaster.pid`)
is a trap here: that server may have been started without the flags. Check
`show dynamic_library_path` on reuse, or restart it.

## Scale check (10,000 rows x 384 dims, this Mac)

| Engine | Insert | HNSW build | Top-10 query avg |
| --- | --- | --- | --- |
| embedded-postgres 18.4 + our pgvector 0.8.2 | 0.46 s | 0.78 s | 0.54 ms |
| PGlite 0.5.13 + pglite-pgvector (0.8.7) | 2.41 s | 7.87 s | 1.1 ms |

(`bench.mjs`, `maintenance_work_mem=256MB` on native.)

## PGlite as an alternative engine

```sh
npm install --include=dev @electric-sql/pglite @electric-sql/pglite-pgvector drizzle-orm
```

- Versions on 2026-10-29: `@electric-sql/pglite` 0.5.13 (PostgreSQL 18.6
  in WASM), `@electric-sql/pglite-pgvector` 0.0.14 (pgvector 0.8.7; the old
  `@electric-sql/pglite/vector` subpath is gone, vector is its own package
  now), `drizzle-orm` 0.45.4. 26 MB unpacked, no native code, works on any
  OS including Windows.
- `PGlite.create(dir, { extensions: { vector } })` then `drizzle(pg)` from
  `drizzle-orm/pglite`. Verified: `CREATE EXTENSION vector`, `<=>`, HNSW
  index scan, generated `tsvector` with GIN, `websearch_to_tsquery`,
  `ts_rank_cd`. Opens in about 0.7 s.
- Limits: one process owns the data dir (no second `psql`/worker; the
  scheduler and server must share one in-process instance or go through
  `@electric-sql/pglite-socket`), single connection, about 10x slower index
  builds, and a separate data format, so moving to the embedded server or
  Supabase is a dump and restore, not a data-dir copy. Rill's "reuse the
  running server" pattern does not apply.
- Verdict: good fallback where no prebuilt pgvector exists (Windows, odd
  Linux), not the default.

## Supabase (and any external connection string)

Supabase docs (guides/database/extensions/pgvector): the extension is named
`vector`; enable it with

```sql
create extension if not exists vector with schema extensions;
```

The docs' table example uses `extensions.vector(384)` and the query example
uses an unqualified operator. The pgvector page does not say whether
`extensions` is on the `search_path` (not verified here against a live
project), so migrations should not assume it:

- Run `create extension if not exists vector with schema extensions` only
  when an `extensions` schema exists; otherwise plain `create extension if
  not exists vector` (embedded, Neon, RDS all put it in `public` by default).
- Detect where it landed with
  `select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`
  and, if it is not on the `search_path`, set it per connection
  (`options=-c search_path=public,extensions`) rather than schema-qualifying
  every operator.
- The Supabase transaction pooler (port 6543) does not support prepared
  statements; with `postgres-js` use `prepare: false`, or use the session
  pooler / direct connection for migrations and HNSW builds.
- The Supabase docs warn that a filtered HNSW query can return fewer rows
  than the limit; pgvector 0.8's `hnsw.iterative_scan = relaxed_order` is
  the fix (also applies locally).

## Drizzle

`drizzle-orm` 0.45 has `vector(name, { dimensions })` in `pg-core`
(`columns/vector_extension`), `cosineDistance()` in `sql/functions/vector`,
and `index().using("hnsw", t.embedding.op("vector_cosine_ops"))`.
`tsvector` has no built-in column type: use `customType` for the column and
raw `sql` for the generated expression, `websearch_to_tsquery` and
`ts_rank_cd`. The same schema runs on `node-postgres` (embedded, Supabase)
and on `drizzle-orm/pglite`.

Keep the vector column and its HNSW index in their own migration that runs
only when the capability check passes, so the keyword-only path never
fails on a missing type.

## Recommended approach for local

1. **Build artifacts in CI, per platform, pinned to PG major 18.** One job
   per target (macOS arm64 runner builds the universal darwin dylib; Linux
   x64 and arm64 build in an old-glibc container such as
   `manylinux_2_28`/Ubuntu 20.04 so the `.so` floor stays at or below the
   bundle's glibc 2.27-era target). Same recipe as step 3: headers-only
   PG 18.x prefix, `make PG_CONFIG=... OPTFLAGS=""` (never
   `-march=native`, which would crash older CPUs), darwin with
   `BE_DLLLIBS="-bundle_loader <embedded>/bin/postgres"` and
   `CC="clang -arch arm64 -arch x86_64 -mmacosx-version-min=13.0"`.
   Output: `lib/vector.{dylib,so}` + `share/extension/vector.control` +
   `vector--*.sql`, tarred, with a sha256.
2. **Ship them as optional per-platform npm packages**, the same pattern
   embedded-postgres uses, for example
   `@withone/search-pgvector-darwin` (universal),
   `@withone/search-pgvector-linux-x64`, `-linux-arm64`, each with `os`/`cpu`
   fields and no install scripts. Works with `npx`, with pnpm 10's build
   script gate, and offline after install. (Alternative: a GitHub release
   fetched at first boot; it needs network on first run and a checksum
   list in the app. Linux could also pull PGDG's
   `postgresql-18-pgvector_0.8.7-1.pgdg22.04+1_{amd64,arm64}.deb` from
   apt.postgresql.org: its `vector.so` needs only GLIBC_2.14, but extracting
   a `.deb` (ar + xz) in Node needs extra code and rehosting is cleaner.)
3. **At boot, copy the resolved package into the app's data home** and pass
   the two flags. Copying (rather than pointing into `node_modules`) keeps
   the path stable across reinstalls and npx cache moves.

Boot outline (`server/src/pgvector.ts`):

```ts
const PG_MAJOR = 18;
const VECTOR_VERSION = "0.8.7";

/** Returns the extension root to pass to postgres, or null for keyword-only. */
export function ensurePgvector(home: string, log: (l: string) => void): string | null {
  const dest = join(home, "pg-ext", `vector-${VECTOR_VERSION}-pg${PG_MAJOR}`);
  if (existsSync(join(dest, "share/extension/vector.control"))) return dest;
  const pkg = `@withone/search-pgvector-${process.platform === "darwin" ? "darwin" : `${process.platform}-${process.arch}`}`;
  let src: string;
  try {
    src = dirname(createRequire(import.meta.url).resolve(`${pkg}/package.json`));
  } catch {
    log(`Semantic search is off: no pgvector build for ${process.platform}-${process.arch}`);
    return null;
  }
  const tmp = `${dest}.tmp-${process.pid}`;
  cpSync(join(src, "ext"), tmp, { recursive: true });
  renameSync(tmp, dest);            // atomic, so a crash never leaves half a copy
  return dest;
}

// in bootDatabase(), embedded branch:
const ext = ensurePgvector(env.HOME, log);
const postgresFlags = ext
  ? ["-c", `extension_control_path=$system:${ext}/share`, "-c", `dynamic_library_path=$libdir:${ext}/lib`]
  : [];
new EmbeddedPostgres({ ...rillOptions, postgresFlags });
```

Version upgrades: a new `VECTOR_VERSION` lands in a new directory; after
boot run `ALTER EXTENSION vector UPDATE` (the control dir ships every
upgrade script). Keep the old directory until that succeeds.

### Linux notes

- The embedded linux bundles are old-glibc builds (postgres needs at most
  GLIBC_2.27, ICU 60, OpenSSL 1.1), so build our `.so` in a container at
  least that old or check the max `GLIBC_` symbol in CI.
- Linux has no bundle loader step: server symbols resolve from the
  running `postgres` at `dlopen` time, so build with plain PGXS.
- Not verified live on Linux in this spike (Docker was not running on this
  Mac). First CI job should run the step 3 SQL against the linux-x64 and
  linux-arm64 embedded bundles.
- linux-arm (32-bit), linux-ia32, linux-ppc64 and windows-x64 bundles exist
  too; no prebuilt for them at first, they get the keyword-only fallback
  (or PGlite later).

## Fallback: keyword-only

When the capability check fails, the app runs Postgres full text only
(`tsvector`, GIN, `websearch_to_tsquery`, `ts_rank_cd`, optionally
`pg_trgm` for typo tolerance, which the bundle does ship). No embedding
calls are made, no vector migration runs. Settings, Search shows one line:
"Semantic search is off. This database has no pgvector." with the reason
(no build for this platform, the external database lacks the extension, or
the role cannot create it) and, for Supabase/external, the one SQL line to
run. When the capability turns on later, a backfill job embeds existing
rows.

## Capability detection at boot

Run after connecting, before migrations, for both embedded and external:

```sql
select
  exists (select 1 from pg_available_extensions where name = 'vector') as available,
  (select extversion from pg_extension where extname = 'vector')         as installed;
```

1. `installed` set and `available` true: try `select '[1]'::vector <=> '[1]'::vector`;
   success means **hybrid**.
2. `installed` null, `available` true: `create extension if not exists vector`
   (`with schema extensions` when that schema exists), then step 1. A
   permission error means **keyword-only** with the reason "role cannot
   create extensions".
3. `available` false, `installed` null: **keyword-only** ("no pgvector").
4. `installed` set, `available` false: the data dir has vector but this
   server cannot load it (the flags were not passed, the ext dir was
   deleted, or a reused server started without them). Embedded: restart
   with the flags; if still broken, **keyword-only** and do not touch
   vector columns (any read of them errors). This is the case tested in
   step 4.

Store the result (`hybrid` or `keyword`, plus reason and pgvector version)
in memory for the request path and show it in Settings. Gate the vector
migration and the embedding writer on it.

## Scratch files

All in `/tmp/search-pgvector-spike` (safe to delete): `scripts/try.mjs`,
`hybrid.mjs`, `extpath.mjs`, `missing.mjs`, `bench.mjs`, `pglite.mjs`;
`pgprefix/` (PG 18.4 headers + pg_config); `build-vector/vector.dylib`
(universal, sha256 `a04a845e...d298`); `home/pg-ext/vector-0.8.2/`.
