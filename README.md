# disco-vault

Local music discography library — track and evaluate a collection of
**physical and digital** music releases, with Nostr-backed search and
sharing.

**Stack:** Tauri 2 desktop binary + React 19 + TypeScript + Tailwind v3
+ SQLite (via `rusqlite`, bundled). Catalog data lives in
`~/.local/share/disco-vault/discography.db` (Linux); the app initialises
the schema on first launch.

> **Status: scaffold.** The schema, five Rust commands (`init_db`,
> `add_release`, `list_releases`, `delete_release`, `get_stats`), the
> add-release form, the searchable list, the detail panel and the
> stats panel are wired end-to-end against SQLite. Discogs/MusicBrainz
> enrichment and Nostr publishing are stubbed.

## Planned features

- Local catalog of music releases the user owns or has access to:
  - **Physical**: format (LP, 12", CD, cassette, etc.), label, catalog
    number, year, condition, notes, location.
  - **Digital**: file path or external link, codec, bit depth, sample
    rate, source (rip / store / Bandcamp / etc.).
- Per-release: artist, title, year, notes, cover art, track listing.
- Search across artist / title / label / catalog number (working).
- Library evaluation stats (working): totals by medium, unique artists,
  year range. Future: by-format breakdown, missing data audit,
  duplicates.
- Pull metadata from external sources (Discogs API, MusicBrainz,
  Bandcamp) — to be wired.
- Publish a release entry to Nostr so other clients can subscribe to
  the user's collection or selected lists — to be wired.
- Subscribe to other users' collections to discover music.
- Cross-reference with `audio-flac-quality-check` reports for digital
  files (a track flagged `PROBABLY-LOSSY` should surface on its
  release entry).

## Schema (current)

```sql
releases (
  id, artist, title, year, medium, format,
  label, catalog_number, country, condition, notes, source,
  file_path, cover_art_path, discogs_id, musicbrainz_id,
  added_at, updated_at
)
```

`medium` is `'physical' | 'digital'`. Indexes on artist, title, year,
medium. See `src-tauri/src/lib.rs`.

## Install dependencies (Debian / Ubuntu)

Tauri's [Linux prerequisites](https://tauri.app/start/prerequisites/#linux):

```sh
sudo apt update
sudo apt install \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  build-essential \
  curl wget file
```

Plus a Node toolchain and a Rust toolchain:

```sh
sudo apt install nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

`rusqlite` is built with the `bundled` feature, so no system SQLite
package is required.

## Quick start

```sh
git clone https://github.com/xjmzx/disco-vault.git
cd disco-vault

make deps      # npm install + cargo fetch
make dev       # opens the Tauri window with hot reload
```

On first launch the SQLite database is created at the platform's
app-data directory (Linux: `~/.local/share/uk.fizx.discovault/`).

## Build / install / deploy

The repo ships a `Makefile` that builds a release binary and places it
under `PREFIX/bin`, the icon under
`PREFIX/share/icons/hicolor/scalable/apps`, and a `.desktop` entry
under `PREFIX/share/applications` (so the app appears in GNOME / KDE /
XFCE app menus).

```sh
# user-level install (no sudo) — default PREFIX is $HOME/.local
make install

# system-wide
sudo make install PREFIX=/usr/local

# remove
make uninstall                     # or: sudo make uninstall PREFIX=/usr/local
```

Other targets:

```sh
make help     # list everything
make check    # tsc + vite build + cargo check (no full Tauri build)
make build    # release build only
make clean    # remove dist/ and src-tauri/target/
```

The desktop entry is generated from `disco-vault.desktop.in` with the
install paths substituted in, so it works regardless of `PREFIX`.

## Layout

```
disco-vault/
├── src/                       # React + TS frontend
│   ├── App.tsx                # main layout: list + detail/add + stats + nostr
│   ├── components/             # ReleaseList, ReleaseDetail, AddReleaseForm,
│   │                           #   StatsPanel, NostrPanel, Section
│   ├── lib/cn.ts               # clsx + tailwind-merge helper
│   └── lib/tauri.ts            # typed wrappers around invoke()
├── src-tauri/                  # Rust crate (Tauri shell + SQLite layer)
│   ├── src/lib.rs              # schema, init_db, add/list/delete/get_stats
│   ├── Cargo.toml              # rusqlite (bundled)
│   └── tauri.conf.json
├── icon.svg                          # suite-style 128px tile
├── disco-vault.desktop.in            # .desktop template (placeholders)
└── Makefile                          # deps / dev / build / install / uninstall
```

## Companion apps in the suite

- [`bpm-tapper`](https://github.com/xjmzx/bpm-tapper)
- [`audio-flac-quality-check`](https://github.com/xjmzx/audio-flac-quality-check)
- [`smpl-tool`](https://github.com/xjmzx/smpl-tool)
