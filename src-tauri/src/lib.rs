// Tauri commands for ndisc. SQLite-backed local discography.
// See https://tauri.app/develop/calling-rust/

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use std::time::Duration;

use keyring::Entry;
use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::ItemKey;
use nostr_sdk::prelude::*;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

const KEYRING_SERVICE: &str = "ndisc";
const KEYRING_USER: &str = "nostr-nsec";
const LEGACY_KEYRING_SERVICE: &str = "disco-vault";
const LEGACY_BUNDLE_ID: &str = "uk.fizx.discovault";
const KIND_RELEASE: u16 = 31237;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS releases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    artist          TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    year            INTEGER,
    medium          TEXT,           -- 'physical' | 'digital'
    format          TEXT,           -- LP, 12", CD, cassette, FLAC, MP3, ...
    label           TEXT,
    catalog_number  TEXT,
    country         TEXT,
    condition       TEXT,           -- M, NM, VG+, VG, G, F, P (physical only)
    notes           TEXT,
    source          TEXT,           -- discogs URL, Bandcamp, store, ...
    file_path       TEXT,           -- digital: path to file/folder
    cover_art_path  TEXT,
    discogs_id      INTEGER,
    musicbrainz_id  TEXT,
    added_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS releases_artist_idx ON releases(artist);
CREATE INDEX IF NOT EXISTS releases_title_idx  ON releases(title);
CREATE INDEX IF NOT EXISTS releases_year_idx   ON releases(year);
CREATE INDEX IF NOT EXISTS releases_medium_idx ON releases(medium);
"#;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    #[serde(default)]
    pub id: Option<i64>,
    pub artist: String,
    pub title: String,
    pub year: Option<i32>,
    pub medium: Option<String>,
    pub format: Option<String>,
    pub label: Option<String>,
    pub catalog_number: Option<String>,
    pub country: Option<String>,
    pub condition: Option<String>,
    pub notes: Option<String>,
    pub source: Option<String>,
    pub file_path: Option<String>,
    pub cover_art_path: Option<String>,
    pub cover_art_url: Option<String>,
    pub discogs_id: Option<i64>,
    pub musicbrainz_id: Option<String>,
    #[serde(default)]
    pub added_at: Option<i64>,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub physical: i64,
    pub digital: i64,
    pub unique_artists: i64,
    pub year_min: Option<i32>,
    pub year_max: Option<i32>,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn default_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("discography.db"))
}

fn config_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("config.json"))
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(cfg) = config_file_path(app) {
        if let Ok(s) = std::fs::read_to_string(&cfg) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Some(p) = v.get("dbPath").and_then(|x| x.as_str()) {
                    let p = PathBuf::from(p);
                    if !p.as_os_str().is_empty() {
                        return Ok(p);
                    }
                }
            }
        }
    }
    default_db_path(app)
}

fn save_db_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let cfg = config_file_path(app)?;
    let json = serde_json::json!({ "dbPath": path.to_string_lossy() });
    std::fs::write(&cfg, json.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let existing: String = row.get(1).map_err(|e| e.to_string())?;
        if existing == column {
            return Ok(());
        }
    }
    drop(rows);
    drop(stmt);
    conn.execute(
        &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl),
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    ensure_column(&conn, "releases", "cover_art_url", "TEXT")?;
    Ok(conn)
}

#[tauri::command]
fn init_db(app: tauri::AppHandle) -> Result<String, String> {
    let path = db_path(&app)?;
    let _ = open(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_db_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if p.as_os_str().is_empty() {
        return Err("empty path".into());
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    // Open (creates file if missing) and apply schema. CREATE TABLE IF NOT
    // EXISTS makes this safe for both new and existing DBs.
    let conn = Connection::open(&p).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    save_db_path(&app, &p)?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn add_release(app: tauri::AppHandle, release: Release) -> Result<i64, String> {
    let conn = open(&app)?;
    conn.execute(
        "INSERT INTO releases
         (artist, title, year, medium, format, label, catalog_number, country,
          condition, notes, source, file_path, cover_art_path, cover_art_url,
          discogs_id, musicbrainz_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            release.artist,
            release.title,
            release.year,
            release.medium,
            release.format,
            release.label,
            release.catalog_number,
            release.country,
            release.condition,
            release.notes,
            release.source,
            release.file_path,
            release.cover_art_path,
            release.cover_art_url,
            release.discogs_id,
            release.musicbrainz_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn set_cover_art_url(
    app: tauri::AppHandle,
    release_id: i64,
    url: Option<String>,
) -> Result<(), String> {
    let normalized = url.and_then(|s| {
        let t = s.trim().to_owned();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET cover_art_url = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_release(row: &rusqlite::Row) -> rusqlite::Result<Release> {
    Ok(Release {
        id: row.get(0)?,
        artist: row.get(1)?,
        title: row.get(2)?,
        year: row.get(3)?,
        medium: row.get(4)?,
        format: row.get(5)?,
        label: row.get(6)?,
        catalog_number: row.get(7)?,
        country: row.get(8)?,
        condition: row.get(9)?,
        notes: row.get(10)?,
        source: row.get(11)?,
        file_path: row.get(12)?,
        cover_art_path: row.get(13)?,
        discogs_id: row.get(14)?,
        musicbrainz_id: row.get(15)?,
        added_at: row.get(16)?,
        updated_at: row.get(17)?,
        cover_art_url: row.get(18)?,
    })
}

const RELEASE_SELECT_COLS: &str =
    "id, artist, title, year, medium, format, label, catalog_number,
     country, condition, notes, source, file_path, cover_art_path,
     discogs_id, musicbrainz_id, added_at, updated_at, cover_art_url";

#[tauri::command]
fn list_releases(
    app: tauri::AppHandle,
    query: Option<String>,
    medium: Option<String>,
    needs_cover: Option<bool>,
) -> Result<Vec<Release>, String> {
    let conn = open(&app)?;
    let q = query.unwrap_or_default();
    let q_like = format!("%{}%", q);

    // SQLite treats NULL and empty string differently; cover may legitimately
    // be either, so check both for emptiness.
    let no_cover_clause = "(cover_art_url IS NULL OR cover_art_url = '')
                       AND (cover_art_path IS NULL OR cover_art_path = '')";
    let cover_filter = match needs_cover {
        Some(true) => format!("AND {}", no_cover_clause),
        Some(false) => format!("AND NOT ({})", no_cover_clause),
        None => String::new(),
    };

    let select_sql = format!(
        "SELECT {cols}
         FROM releases
         WHERE (?1 = '' OR artist LIKE ?2 OR title LIKE ?2
                          OR label  LIKE ?2 OR catalog_number LIKE ?2)
           AND (?3 IS NULL OR medium = ?3)
           {cover}
         ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
        cols = RELEASE_SELECT_COLS,
        cover = cover_filter,
    );
    let mut stmt = conn
        .prepare(&select_sql)
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![q, q_like, medium], row_to_release)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn delete_release(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let conn = open(&app)?;
    conn.execute("DELETE FROM releases WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_stats(app: tauri::AppHandle) -> Result<Stats, String> {
    let conn = open(&app)?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM releases", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let physical: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM releases WHERE medium = 'physical'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let digital: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM releases WHERE medium = 'digital'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let unique_artists: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT artist COLLATE NOCASE) FROM releases",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let year_min: Option<i32> = conn
        .query_row(
            "SELECT MIN(year) FROM releases WHERE year IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let year_max: Option<i32> = conn
        .query_row(
            "SELECT MAX(year) FROM releases WHERE year IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(Stats {
        total,
        physical,
        digital,
        unique_artists,
        year_min,
        year_max,
    })
}

// ---------------------------------------------------------------------------
// Interop: refresh metadata from disk; sync published cover URL to local file
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub status: String, // "ok" | "no_changes" | "missing_path" | "no_path" | "no_audio"
    pub changes: Vec<String>,
}

#[tauri::command]
fn refresh_release(
    app: tauri::AppHandle,
    release_id: i64,
) -> Result<RefreshResult, String> {
    let conn = open(&app)?;
    let sql = format!(
        "SELECT {} FROM releases WHERE id = ?1",
        RELEASE_SELECT_COLS
    );
    let release: Release = conn
        .query_row(&sql, params![release_id], row_to_release)
        .map_err(|e| e.to_string())?;

    let Some(file_path) = release.file_path.as_deref() else {
        return Ok(RefreshResult {
            status: "no_path".into(),
            changes: vec![],
        });
    };
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Ok(RefreshResult {
            status: "missing_path".into(),
            changes: vec![],
        });
    }

    // Treat file_path as the album dir for folder-imported releases, or fall
    // back to its parent for manually-added single-file entries.
    let dir = if path.is_dir() {
        path.clone()
    } else {
        path.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    };

    let mut audio_files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()))
        .filter(|p| p.is_file() && is_audio(p))
        .collect();
    audio_files.sort();

    if audio_files.is_empty() {
        return Ok(RefreshResult {
            status: "no_audio".into(),
            changes: vec![],
        });
    }

    let info = read_dir_tags(&audio_files);

    let new_artist = info.artist.clone().unwrap_or_else(|| release.artist.clone());
    let new_title = info.title.clone().unwrap_or_else(|| release.title.clone());
    let new_year = info.year.or(release.year);
    let new_format_str = if info.codec.is_some() {
        Some(build_format_string(&info))
    } else {
        release.format.clone()
    };
    let new_cover_path = find_cover(&dir).or_else(|| release.cover_art_path.clone());

    let mut changes: Vec<String> = Vec::new();
    if new_artist != release.artist {
        changes.push("artist".into());
    }
    if new_title != release.title {
        changes.push("title".into());
    }
    if new_year != release.year {
        changes.push("year".into());
    }
    if new_format_str != release.format {
        changes.push("format".into());
    }
    if new_cover_path != release.cover_art_path {
        changes.push("cover_art_path".into());
    }

    if changes.is_empty() {
        return Ok(RefreshResult {
            status: "no_changes".into(),
            changes,
        });
    }

    conn.execute(
        "UPDATE releases
         SET artist = ?1,
             title = ?2,
             year = ?3,
             format = ?4,
             cover_art_path = ?5,
             updated_at = strftime('%s','now')
         WHERE id = ?6",
        params![
            new_artist,
            new_title,
            new_year,
            new_format_str,
            new_cover_path,
            release_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(RefreshResult {
        status: "ok".into(),
        changes,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrphanInfo {
    pub id: i64,
    pub artist: String,
    pub title: String,
    pub file_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanSummary {
    pub scanned: usize,
    pub refreshed: usize,
    pub no_changes: usize,
    pub orphaned: usize,
    pub no_audio: usize,
    pub no_path: usize,
    pub orphans: Vec<OrphanInfo>,
    pub errors: Vec<String>,
}

#[tauri::command]
fn scan_library_changes(
    app: tauri::AppHandle,
) -> Result<LibraryScanSummary, String> {
    // Pull all releases that have a file_path. Physical releases without a
    // path are excluded — there's nothing on disk to scan against. Fetch
    // artist/title up front so we can surface orphan details without a
    // second DB round-trip per orphan.
    let candidates: Vec<(i64, String, String, String)> = {
        let conn = open(&app)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, artist, title, file_path
                 FROM releases
                 WHERE file_path IS NOT NULL AND file_path <> ''
                 ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total = candidates.len();
    let mut summary = LibraryScanSummary {
        scanned: total,
        refreshed: 0,
        no_changes: 0,
        orphaned: 0,
        no_audio: 0,
        no_path: 0,
        orphans: Vec::new(),
        errors: Vec::new(),
    };
    let _ = app.emit("scan:started", total);

    for (i, (release_id, artist, title, file_path)) in candidates.iter().enumerate() {
        let _ = app.emit(
            "scan:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: file_path.clone(),
            },
        );

        match refresh_release(app.clone(), *release_id) {
            Ok(result) => match result.status.as_str() {
                "ok" => summary.refreshed += 1,
                "no_changes" => summary.no_changes += 1,
                "missing_path" => {
                    summary.orphaned += 1;
                    summary.orphans.push(OrphanInfo {
                        id: *release_id,
                        artist: artist.clone(),
                        title: title.clone(),
                        file_path: file_path.clone(),
                    });
                }
                "no_audio" => summary.no_audio += 1,
                "no_path" => summary.no_path += 1,
                _ => {}
            },
            Err(e) => summary
                .errors
                .push(format!("release {}: {}", release_id, e)),
        }
    }

    Ok(summary)
}

#[tauri::command]
fn update_release_path(
    app: tauri::AppHandle,
    release_id: i64,
    new_path: String,
) -> Result<RefreshResult, String> {
    let trimmed = new_path.trim().to_owned();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    {
        let conn = open(&app)?;
        conn.execute(
            "UPDATE releases
             SET file_path = ?1, updated_at = strftime('%s','now')
             WHERE id = ?2",
            params![trimmed, release_id],
        )
        .map_err(|e| e.to_string())?;
    }
    refresh_release(app, release_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverSyncResult {
    pub status: String, // "ok" | "no_url" | "no_path" | "missing_path"
    pub written: Option<String>,
    pub bytes: Option<u64>,
}

fn ext_for_content_type(content_type: Option<&str>, url: &str) -> &'static str {
    if let Some(ct) = content_type {
        let lower = ct.to_lowercase();
        if lower.contains("png") {
            return "png";
        }
        if lower.contains("webp") {
            return "webp";
        }
        if lower.contains("gif") {
            return "gif";
        }
        if lower.contains("jpeg") || lower.contains("jpg") {
            return "jpg";
        }
    }
    // Fallback: URL extension.
    if let Some(idx) = url.rfind('.') {
        let ext = &url[idx + 1..].to_lowercase();
        if ["jpg", "jpeg", "png", "webp", "gif"].contains(&ext.as_str()) {
            return if ext == "jpeg" { "jpg" } else { Box::leak(ext.clone().into_boxed_str()) };
        }
    }
    "jpg"
}

#[tauri::command]
async fn sync_cover_to_disk(
    app: tauri::AppHandle,
    release_id: i64,
) -> Result<CoverSyncResult, String> {
    let (file_path, cover_url) = {
        let conn = open(&app)?;
        let row: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT file_path, cover_art_url FROM releases WHERE id = ?1",
                params![release_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        row
    };

    let Some(cover_url) = cover_url.filter(|s| !s.trim().is_empty()) else {
        return Ok(CoverSyncResult {
            status: "no_url".into(),
            written: None,
            bytes: None,
        });
    };
    let Some(file_path) = file_path.filter(|s| !s.trim().is_empty()) else {
        return Ok(CoverSyncResult {
            status: "no_path".into(),
            written: None,
            bytes: None,
        });
    };

    let path = PathBuf::from(&file_path);
    let dir = if path.is_dir() {
        path.clone()
    } else if let Some(parent) = path.parent() {
        parent.to_path_buf()
    } else {
        return Ok(CoverSyncResult {
            status: "missing_path".into(),
            written: None,
            bytes: None,
        });
    };
    if !dir.exists() {
        return Ok(CoverSyncResult {
            status: "missing_path".into(),
            written: None,
            bytes: None,
        });
    }

    let response = reqwest::get(&cover_url)
        .await
        .map_err(|e| format!("fetch {}: {}", cover_url, e))?;
    let ct = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_owned());
    let ext = ext_for_content_type(ct.as_deref(), &cover_url);
    let body = response
        .bytes()
        .await
        .map_err(|e| format!("read body: {}", e))?;

    let out = dir.join(format!("cover.{}", ext));
    std::fs::write(&out, &body).map_err(|e| {
        format!("write {}: {}", out.display(), e)
    })?;

    let out_str = out.to_string_lossy().into_owned();
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET cover_art_path = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![out_str, release_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(CoverSyncResult {
        status: "ok".into(),
        written: Some(out_str),
        bytes: Some(body.len() as u64),
    })
}

// ---------------------------------------------------------------------------
// Nostr identity (keypair stored in OS keychain)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Keypair {
    pub npub: String,
    pub nsec: String,
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn store_nsec(nsec: &str) -> Result<(), String> {
    keyring_entry()?
        .set_password(nsec)
        .map_err(|e| e.to_string())
}

fn load_nsec() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn keys_from_nsec(nsec: &str) -> Result<Keys, String> {
    let sk = SecretKey::from_bech32(nsec).map_err(|e| format!("invalid nsec: {e}"))?;
    Ok(Keys::new(sk))
}

#[tauri::command]
fn generate_keypair() -> Result<Keypair, String> {
    let keys = Keys::generate();
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    store_nsec(&nsec)?;
    Ok(Keypair { npub, nsec })
}

#[tauri::command]
fn import_keypair(nsec: String) -> Result<String, String> {
    let nsec = nsec.trim().to_owned();
    let keys = keys_from_nsec(&nsec)?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    store_nsec(&nsec)?;
    Ok(npub)
}

#[tauri::command]
fn get_npub() -> Result<Option<String>, String> {
    let Some(nsec) = load_nsec()? else {
        return Ok(None);
    };
    let keys = keys_from_nsec(&nsec)?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    Ok(Some(npub))
}

#[tauri::command]
fn clear_keypair() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Nostr publish (kind:31237 release events)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelayError {
    pub relay: String,
    pub error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub event_id: String,
    pub naddr: String,
    pub accepted_by: Vec<String>,
    pub rejected: Vec<RelayError>,
}

fn release_d_tag(release_id: i64) -> String {
    format!("disco-vault:{}", release_id)
}

fn build_naddr(keys: &Keys, d: &str, relays: &[String]) -> Result<String, String> {
    let relay_hints: Vec<RelayUrl> = relays
        .iter()
        .take(3)
        .filter_map(|r| RelayUrl::parse(r).ok())
        .collect();
    let coordinate = Coordinate::new(Kind::Custom(KIND_RELEASE), keys.public_key())
        .identifier(d.to_string());
    let nip19 = Nip19Coordinate::new(coordinate, relay_hints);
    nip19.to_bech32().map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PublishProgress {
    current: usize,
    total: usize,
    title: String,
    artist: String,
    accepted_by: Vec<String>,
    rejected: Vec<RelayError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishLibrarySummary {
    pub total: usize,
    pub published: usize,
    pub failed: usize,
}

fn push_tag(tags: &mut Vec<Tag>, name: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    let tag = Tag::parse([name, value]).map_err(|e| e.to_string())?;
    tags.push(tag);
    Ok(())
}

fn release_event(keys: &Keys, r: &Release) -> Result<Event, String> {
    let d = release_d_tag(r.id.unwrap_or_default());
    let mut tags: Vec<Tag> = Vec::new();
    push_tag(&mut tags, "d", &d)?;
    push_tag(&mut tags, "title", &r.title)?;
    push_tag(&mut tags, "artist", &r.artist)?;
    if let Some(m) = r.medium.as_deref() {
        push_tag(&mut tags, "medium", m)?;
    }
    if let Some(f) = r.format.as_deref() {
        push_tag(&mut tags, "format", f)?;
    }
    if let Some(y) = r.year {
        push_tag(&mut tags, "year", &y.to_string())?;
    }
    if let Some(l) = r.label.as_deref() {
        push_tag(&mut tags, "label", l)?;
    }
    if let Some(c) = r.catalog_number.as_deref() {
        push_tag(&mut tags, "catalog", c)?;
    }
    if let Some(c) = r.country.as_deref() {
        push_tag(&mut tags, "country", c)?;
    }
    if let Some(c) = r.condition.as_deref() {
        push_tag(&mut tags, "condition", c)?;
    }
    if let Some(d_id) = r.discogs_id {
        push_tag(&mut tags, "i", &format!("discogs:release:{}", d_id))?;
    }
    if let Some(mb) = r.musicbrainz_id.as_deref() {
        push_tag(&mut tags, "i", &format!("musicbrainz:release:{}", mb))?;
    }
    if let Some(url) = r.cover_art_url.as_deref() {
        push_tag(&mut tags, "image", url)?;
    }

    let content = r.notes.clone().unwrap_or_default();
    EventBuilder::new(Kind::Custom(KIND_RELEASE), content)
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())
}

async fn build_client(keys: Keys, relays: &[String]) -> Client {
    let client = Client::builder().signer(keys).build();
    for url in relays {
        let _ = client.add_relay(url.as_str()).await;
    }
    client.connect().await;
    client
}

fn split_send_output(output: &Output<EventId>) -> (Vec<String>, Vec<RelayError>) {
    let accepted: Vec<String> = output.success.iter().map(|u| u.to_string()).collect();
    let rejected: Vec<RelayError> = output
        .failed
        .iter()
        .map(|(url, err)| RelayError {
            relay: url.to_string(),
            error: err.clone(),
        })
        .collect();
    (accepted, rejected)
}

#[tauri::command]
async fn unpublish_release(
    _app: tauri::AppHandle,
    release_id: i64,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let d = release_d_tag(release_id);
    let address = format!(
        "{}:{}:{}",
        u16::from(Kind::Custom(KIND_RELEASE)),
        keys.public_key(),
        d
    );

    let tag_a = Tag::parse(["a", &address]).map_err(|e| e.to_string())?;
    let tag_k =
        Tag::parse(["k", &KIND_RELEASE.to_string()]).map_err(|e| e.to_string())?;

    let event = EventBuilder::new(Kind::EventDeletion, "")
        .tags([tag_a, tag_k])
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;
    let event_id = event.id.to_string();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

#[tauri::command]
async fn publish_release(
    app: tauri::AppHandle,
    release_id: i64,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let release: Release = {
        let conn = open(&app)?;
        let sql = format!(
            "SELECT {} FROM releases WHERE id = ?1",
            RELEASE_SELECT_COLS
        );
        conn.query_row(&sql, params![release_id], row_to_release)
            .map_err(|e| e.to_string())?
    };

    let event = release_event(&keys, &release)?;
    let event_id = event.id.to_string();
    let naddr = build_naddr(&keys, &release_d_tag(release_id), &relays).unwrap_or_default();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    Ok(PublishResult {
        event_id,
        naddr,
        accepted_by,
        rejected,
    })
}

#[tauri::command]
async fn publish_library(
    app: tauri::AppHandle,
    relays: Vec<String>,
    query: Option<String>,
    medium: Option<String>,
    needs_cover: Option<bool>,
) -> Result<PublishLibrarySummary, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let releases: Vec<Release> = {
        let conn = open(&app)?;
        let q = query.unwrap_or_default();
        let q_like = format!("%{}%", q);
        let no_cover_clause = "(cover_art_url IS NULL OR cover_art_url = '')
                           AND (cover_art_path IS NULL OR cover_art_path = '')";
        let cover_filter = match needs_cover {
            Some(true) => format!("AND {}", no_cover_clause),
            Some(false) => format!("AND NOT ({})", no_cover_clause),
            None => String::new(),
        };
        let sql = format!(
            "SELECT {cols}
             FROM releases
             WHERE (?1 = '' OR artist LIKE ?2 OR title LIKE ?2
                              OR label  LIKE ?2 OR catalog_number LIKE ?2)
               AND (?3 IS NULL OR medium = ?3)
               {cover}
             ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
            cols = RELEASE_SELECT_COLS,
            cover = cover_filter,
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![q, q_like, medium], row_to_release)
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total = releases.len();
    let _ = app.emit("publish:started", total);

    let client = build_client(keys.clone(), &relays).await;

    let mut summary = PublishLibrarySummary {
        total,
        published: 0,
        failed: 0,
    };

    for (i, r) in releases.iter().enumerate() {
        let event = match release_event(&keys, r) {
            Ok(e) => e,
            Err(_) => {
                summary.failed += 1;
                let _ = app.emit(
                    "publish:progress",
                    PublishProgress {
                        current: i + 1,
                        total,
                        title: r.title.clone(),
                        artist: r.artist.clone(),
                        accepted_by: vec![],
                        rejected: vec![RelayError {
                            relay: "*".into(),
                            error: "could not build event".into(),
                        }],
                    },
                );
                continue;
            }
        };

        match client.send_event(&event).await {
            Ok(output) => {
                let (accepted_by, rejected) = split_send_output(&output);
                if !accepted_by.is_empty() {
                    summary.published += 1;
                } else {
                    summary.failed += 1;
                }
                let _ = app.emit(
                    "publish:progress",
                    PublishProgress {
                        current: i + 1,
                        total,
                        title: r.title.clone(),
                        artist: r.artist.clone(),
                        accepted_by,
                        rejected,
                    },
                );
            }
            Err(e) => {
                summary.failed += 1;
                let _ = app.emit(
                    "publish:progress",
                    PublishProgress {
                        current: i + 1,
                        total,
                        title: r.title.clone(),
                        artist: r.artist.clone(),
                        accepted_by: vec![],
                        rejected: vec![RelayError {
                            relay: "*".into(),
                            error: e.to_string(),
                        }],
                    },
                );
            }
        }

        // Be polite to relays — don't hammer.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let _ = client.shutdown().await;
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Local library import (digital releases)
// ---------------------------------------------------------------------------

const AUDIO_EXTS: &[&str] = &[
    "flac", "mp3", "m4a", "alac", "aac", "ogg", "opus", "wav", "wave", "aiff",
    "aif", "ape", "wv", "dsf", "dff", "mka",
];

const COVER_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

fn is_image_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| COVER_IMAGE_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

// Score a filename stem as a likely album-front cover. Higher = more likely.
// Returns 0 for files that match alternate-art patterns (back cover, tray,
// disc art, etc.) so we never prefer those even if no obvious cover exists.
fn cover_name_score(stem: &str, dir_name: &str) -> u32 {
    let stem_lc = stem.to_lowercase();
    let dir_lc = dir_name.to_lowercase();

    // Alternate-art patterns: standalone token, qualifier prefix/suffix, or
    // compound "back cover" forms. Veto outright.
    const NEG: &[&str] = &[
        "back", "tray", "inlay", "inside", "booklet", "spine", "label", "obi",
        "disc",
    ];
    for tok in NEG {
        if stem_lc == *tok
            || stem_lc.ends_with(&format!("_{}", tok))
            || stem_lc.ends_with(&format!("-{}", tok))
            || stem_lc.ends_with(&format!(" {}", tok))
            || stem_lc.starts_with(&format!("{}_", tok))
            || stem_lc.starts_with(&format!("{}-", tok))
            || stem_lc.starts_with(&format!("{} ", tok))
        {
            return 0;
        }
    }
    if stem_lc.contains("back cover")
        || stem_lc.contains("back_cover")
        || stem_lc.contains("back-cover")
        || stem_lc.contains("disc art")
    {
        return 0;
    }

    // Strict known names.
    match stem_lc.as_str() {
        "cover" | "folder" | "front" => return 100,
        "albumart" | "albumartlarge" | "albumartsmall" => return 95,
        "art" | "artwork" => return 90,
        _ => {}
    }

    if stem_lc.starts_with("cover") {
        return 85;
    }
    if stem_lc.starts_with("front") {
        return 80;
    }
    if stem_lc.starts_with("folder") {
        return 75;
    }
    if stem_lc.starts_with("albumart") {
        return 72;
    }
    if !dir_lc.is_empty() && stem_lc == dir_lc {
        return 70;
    }
    if !dir_lc.is_empty() && stem_lc.contains(&dir_lc) {
        return 60;
    }
    if stem_lc.contains("cover") {
        return 50;
    }
    if stem_lc.contains("front") {
        return 45;
    }
    0
}

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn find_cover(dir: &Path) -> Option<String> {
    let dir_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let entries = std::fs::read_dir(dir).ok()?;
    let images: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_image_ext(p))
        .collect();
    if images.is_empty() {
        return None;
    }

    let mut scored: Vec<(u32, &PathBuf)> = images
        .iter()
        .map(|p| {
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            (cover_name_score(stem, dir_name), p)
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));

    let (best_score, best_path) = scored[0].clone();
    if best_score > 0 {
        return Some(best_path.to_string_lossy().into_owned());
    }

    // No name match anywhere; if only one image lives in the directory it's
    // almost certainly the cover. With multiple unidentified images we bail
    // rather than guess.
    if images.len() == 1 {
        return Some(images[0].to_string_lossy().into_owned());
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanSummary {
    pub scanned: usize,
    pub matched: usize,
    pub no_match: usize,
    pub no_dir: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
fn rescan_local_covers(app: tauri::AppHandle) -> Result<RescanSummary, String> {
    let mut conn = open(&app)?;

    let candidates: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path
                 FROM releases
                 WHERE (cover_art_url IS NULL OR cover_art_url = '')
                   AND (cover_art_path IS NULL OR cover_art_path = '')
                   AND file_path IS NOT NULL AND file_path <> ''
                 ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total = candidates.len();
    let mut summary = RescanSummary {
        scanned: total,
        matched: 0,
        no_match: 0,
        no_dir: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("rescan:started", total);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, (release_id, file_path)) in candidates.iter().enumerate() {
        let path = PathBuf::from(file_path);
        let _ = app.emit(
            "rescan:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: file_path.clone(),
            },
        );

        // Walk the album directory (or its parent for manual file entries).
        let dir = if path.is_dir() {
            path.clone()
        } else if path.is_file() {
            match path.parent() {
                Some(p) => p.to_path_buf(),
                None => {
                    summary.no_dir += 1;
                    continue;
                }
            }
        } else {
            summary.no_dir += 1;
            continue;
        };

        match find_cover(&dir) {
            Some(cover_path) => {
                match tx.execute(
                    "UPDATE releases
                     SET cover_art_path = ?1, updated_at = strftime('%s','now')
                     WHERE id = ?2",
                    params![cover_path, release_id],
                ) {
                    Ok(_) => summary.matched += 1,
                    Err(e) => summary
                        .errors
                        .push(format!("release {}: DB update: {}", release_id, e)),
                }
            }
            None => {
                summary.no_match += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub scanned: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub total_dirs: usize,
    pub total_files: usize,
    pub total_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportProgress {
    current: usize,
    total: usize,
    current_dir: String,
}

#[tauri::command]
fn scan_directory(root: String) -> Result<ScanReport, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("not a directory: {}", root.display()));
    }
    let mut report = ScanReport {
        total_dirs: 0,
        total_files: 0,
        total_bytes: 0,
    };
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() && is_audio(entry.path()) {
            report.total_files += 1;
            if let Ok(md) = entry.metadata() {
                report.total_bytes += md.len();
            }
            if let Some(parent) = entry.path().parent() {
                if seen.insert(parent.to_path_buf()) {
                    report.total_dirs += 1;
                }
            }
        }
    }
    Ok(report)
}

struct DirInfo {
    artist: Option<String>,
    title: Option<String>,
    year: Option<i32>,
    codec: Option<String>,
    bit_depth: Option<u8>,
    sample_rate: Option<u32>,
    bitrate_kbps: Option<u32>,
}

fn read_dir_tags(files: &[PathBuf]) -> DirInfo {
    let mut info = DirInfo {
        artist: None,
        title: None,
        year: None,
        codec: None,
        bit_depth: None,
        sample_rate: None,
        bitrate_kbps: None,
    };
    // Relaxed parsing tolerates malformed tag fields (e.g. non-4-digit year
    // strings) instead of erroring out — we'd rather get the artist/album
    // from a file with a bogus year than fall back to dir names.
    let opts = ParseOptions::new().parsing_mode(ParsingMode::Relaxed);
    for f in files {
        let Ok(probe) = Probe::open(f) else { continue };
        let Ok(tagged) = probe.options(opts).read() else {
            continue;
        };
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            if info.artist.is_none() {
                info.artist = tag
                    .get_string(&ItemKey::AlbumArtist)
                    .or_else(|| tag.get_string(&ItemKey::TrackArtist))
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty());
            }
            if info.title.is_none() {
                info.title = tag
                    .get_string(&ItemKey::AlbumTitle)
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty());
            }
            if info.year.is_none() {
                info.year = tag
                    .get_string(&ItemKey::Year)
                    .or_else(|| tag.get_string(&ItemKey::RecordingDate))
                    .or_else(|| tag.get_string(&ItemKey::OriginalReleaseDate))
                    .and_then(|s| s.get(..4).and_then(|p| p.parse::<i32>().ok()));
            }
        }
        let props = tagged.properties();
        if info.codec.is_none() {
            info.codec = f
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_uppercase());
        }
        if info.bit_depth.is_none() {
            info.bit_depth = props.bit_depth();
        }
        if info.sample_rate.is_none() {
            info.sample_rate = props.sample_rate();
        }
        if info.bitrate_kbps.is_none() {
            info.bitrate_kbps = props.audio_bitrate();
        }
        if info.artist.is_some()
            && info.title.is_some()
            && info.year.is_some()
            && info.codec.is_some()
        {
            break;
        }
    }
    info
}

fn build_format_string(info: &DirInfo) -> String {
    let codec = info.codec.clone().unwrap_or_else(|| "digital".into());
    if let (Some(bd), Some(sr)) = (info.bit_depth, info.sample_rate) {
        if bd > 0 && sr > 0 {
            let khz = sr as f32 / 1000.0;
            let khz_str = if (khz - khz.trunc()).abs() < 0.05 {
                format!("{:.0}", khz)
            } else {
                format!("{:.1}", khz)
            };
            return format!("{} {}/{}", codec, bd, khz_str);
        }
    }
    if let Some(kbps) = info.bitrate_kbps.filter(|&b| b > 0) {
        return format!("{} {}", codec, kbps);
    }
    codec
}

#[tauri::command]
fn import_directory(app: tauri::AppHandle, root: String) -> Result<ImportSummary, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("not a directory: {}", root.display()));
    }

    // Group every audio file by its parent directory. Each parent that
    // directly contains audio files becomes one digital release.
    let mut by_dir: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() && is_audio(entry.path()) {
            if let Some(parent) = entry.path().parent() {
                by_dir
                    .entry(parent.to_path_buf())
                    .or_default()
                    .push(entry.into_path());
            }
        }
    }

    let total = by_dir.len();
    let mut summary = ImportSummary {
        scanned: total,
        imported: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    let _ = app.emit("import:started", total);

    let mut conn = open(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, (dir, files)) in by_dir.into_iter().enumerate() {
        let dir_str = dir.to_string_lossy().into_owned();

        let _ = app.emit(
            "import:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: dir_str.clone(),
            },
        );

        let exists: bool = tx
            .query_row(
                "SELECT 1 FROM releases WHERE file_path = ?1 LIMIT 1",
                params![dir_str],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if exists {
            summary.skipped += 1;
            continue;
        }

        let info = read_dir_tags(&files);

        let dir_name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();
        let parent_name = dir
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();

        let artist = info.artist.clone().unwrap_or_else(|| {
            if parent_name.is_empty() {
                "Unknown Artist".into()
            } else {
                parent_name
            }
        });
        let title = info.title.clone().unwrap_or_else(|| {
            if dir_name.is_empty() {
                "Unknown Album".into()
            } else {
                dir_name
            }
        });
        let format = build_format_string(&info);
        let cover = find_cover(&dir);

        match tx.execute(
            "INSERT INTO releases
             (artist, title, year, medium, format, file_path, cover_art_path, source)
             VALUES (?1, ?2, ?3, 'digital', ?4, ?5, ?6, 'import')",
            params![artist, title, info.year, format, dir_str, cover],
        ) {
            Ok(_) => summary.imported += 1,
            Err(e) => summary.errors.push(format!("{}: {}", dir.display(), e)),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Embedded cover-art extraction (digital releases with no cover yet)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractSummary {
    pub scanned: usize,
    pub extracted: usize,
    pub no_embedded: usize,
    pub no_audio: usize,
    pub errors: Vec<String>,
}

fn ext_for_image(mime: Option<&lofty::picture::MimeType>, data: &[u8]) -> &'static str {
    use lofty::picture::MimeType;
    match mime {
        Some(MimeType::Jpeg) => "jpg",
        Some(MimeType::Png) => "png",
        Some(MimeType::Gif) => "gif",
        Some(MimeType::Bmp) => "bmp",
        Some(MimeType::Tiff) => "tiff",
        _ => sniff_image_ext(data),
    }
}

fn sniff_image_ext(data: &[u8]) -> &'static str {
    if data.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else if data.starts_with(&[0x89, 0x50, 0x4e, 0x47]) {
        "png"
    } else if data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"WEBP" {
        "webp"
    } else if data.starts_with(b"GIF8") {
        "gif"
    } else {
        "jpg"
    }
}

fn first_audio_in(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_audio(p))
        .collect();
    paths.sort();
    paths.into_iter().next()
}

fn extract_picture_from(audio_path: &Path) -> Option<(Vec<u8>, &'static str)> {
    let opts = ParseOptions::new().parsing_mode(ParsingMode::Relaxed);
    let probe = Probe::open(audio_path).ok()?;
    let tagged = probe.options(opts).read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let picture = tag.pictures().first()?;
    let data = picture.data().to_vec();
    if data.is_empty() {
        return None;
    }
    let ext = ext_for_image(picture.mime_type(), &data);
    Some((data, ext))
}

#[tauri::command]
fn extract_embedded_covers(app: tauri::AppHandle) -> Result<ExtractSummary, String> {
    let mut conn = open(&app)?;

    // Pull every release that currently lacks a cover URL and a cover path,
    // restricted to digital (physical never has a file_path to extract from).
    let candidates: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path
                 FROM releases
                 WHERE medium = 'digital'
                   AND (cover_art_url IS NULL OR cover_art_url = '')
                   AND (cover_art_path IS NULL OR cover_art_path = '')
                   AND file_path IS NOT NULL AND file_path <> ''
                 ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total = candidates.len();
    let mut summary = ExtractSummary {
        scanned: total,
        extracted: 0,
        no_embedded: 0,
        no_audio: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("extract:started", total);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, (release_id, file_path)) in candidates.iter().enumerate() {
        let path = PathBuf::from(file_path);
        let _ = app.emit(
            "extract:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: file_path.clone(),
            },
        );

        // file_path is typically a directory (album folder); fall back to
        // treating it as a single file for manual entries.
        let (album_dir, audio_path) = if path.is_dir() {
            let Some(audio) = first_audio_in(&path) else {
                summary.no_audio += 1;
                continue;
            };
            (path.clone(), audio)
        } else if path.is_file() && is_audio(&path) {
            let dir = path
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            (dir, path.clone())
        } else {
            summary.no_audio += 1;
            continue;
        };

        let Some((data, ext)) = extract_picture_from(&audio_path) else {
            summary.no_embedded += 1;
            continue;
        };

        let out = album_dir.join(format!("cover-extracted.{}", ext));
        if let Err(e) = std::fs::write(&out, &data) {
            summary
                .errors
                .push(format!("{}: write failed: {}", out.display(), e));
            continue;
        }

        let out_str = out.to_string_lossy().into_owned();
        match tx.execute(
            "UPDATE releases
             SET cover_art_path = ?1, updated_at = strftime('%s','now')
             WHERE id = ?2",
            params![out_str, release_id],
        ) {
            Ok(_) => summary.extracted += 1,
            Err(e) => summary
                .errors
                .push(format!("release {}: DB update: {}", release_id, e)),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Discogs CSV import (physical + digital releases from a Discogs export)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDiscogsReport {
    pub total_rows: usize,
    pub physical: usize,
    pub digital: usize,
    pub with_condition: usize,
}

fn medium_from_format(format: &str) -> &'static str {
    if format.contains("File") {
        "digital"
    } else {
        "physical"
    }
}

fn nonempty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_owned())
    }
}

#[tauri::command]
fn scan_discogs_csv(path: String) -> Result<ScanDiscogsReport, String> {
    let mut reader = csv::Reader::from_path(&path).map_err(|e| e.to_string())?;
    let mut report = ScanDiscogsReport {
        total_rows: 0,
        physical: 0,
        digital: 0,
        with_condition: 0,
    };
    for result in reader.deserialize::<HashMap<String, String>>() {
        let row = result.map_err(|e| e.to_string())?;
        report.total_rows += 1;
        let format = row.get("Format").map(String::as_str).unwrap_or("");
        if medium_from_format(format) == "digital" {
            report.digital += 1;
        } else {
            report.physical += 1;
        }
        if row
            .get("Collection Media Condition")
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            report.with_condition += 1;
        }
    }
    Ok(report)
}

#[tauri::command]
fn import_discogs_csv(
    app: tauri::AppHandle,
    path: String,
) -> Result<ImportSummary, String> {
    let mut reader = csv::Reader::from_path(&path).map_err(|e| e.to_string())?;

    // Collect rows first so we know the total before emitting events.
    let rows: Vec<HashMap<String, String>> = reader
        .deserialize::<HashMap<String, String>>()
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let total = rows.len();
    let mut summary = ImportSummary {
        scanned: total,
        imported: 0,
        skipped: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("import:started", total);

    let mut conn = open(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, row) in rows.iter().enumerate() {
        let artist = nonempty(row.get("Artist").map(String::as_str).unwrap_or(""));
        let title = nonempty(row.get("Title").map(String::as_str).unwrap_or(""));
        let format = row.get("Format").map(String::as_str).unwrap_or("");
        let label = nonempty(row.get("Label").map(String::as_str).unwrap_or(""));
        let catalog = nonempty(row.get("Catalog#").map(String::as_str).unwrap_or(""));
        let year: Option<i32> = row
            .get("Released")
            .and_then(|s| s.trim().parse::<i32>().ok())
            .filter(|&y| y > 0);
        let discogs_id: Option<i64> = row
            .get("release_id")
            .and_then(|s| s.trim().parse::<i64>().ok());
        let media_cond =
            nonempty(row.get("Collection Media Condition").map(String::as_str).unwrap_or(""));
        let sleeve_cond =
            nonempty(row.get("Collection Sleeve Condition").map(String::as_str).unwrap_or(""));
        let user_notes =
            nonempty(row.get("Collection Notes").map(String::as_str).unwrap_or(""));

        // Discogs guarantees artist+title, but defend against bad rows.
        let (Some(artist), Some(title)) = (artist, title) else {
            summary.errors.push(format!("row {}: missing artist or title", i + 1));
            continue;
        };

        // Sleeve condition has no native column; fold into notes when present.
        let notes = match (sleeve_cond, user_notes) {
            (Some(s), Some(n)) => Some(format!("Sleeve: {}\n{}", s, n)),
            (Some(s), None) => Some(format!("Sleeve: {}", s)),
            (None, n) => n,
        };

        let _ = app.emit(
            "import:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: format!("{} — {}", artist, title),
            },
        );

        // Idempotency: skip if this Discogs release is already in the DB.
        if let Some(d_id) = discogs_id {
            let exists: bool = tx
                .query_row(
                    "SELECT 1 FROM releases WHERE discogs_id = ?1 LIMIT 1",
                    params![d_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);
            if exists {
                summary.skipped += 1;
                continue;
            }
        }

        let medium = medium_from_format(format);
        let format_opt = nonempty(format);

        match tx.execute(
            "INSERT INTO releases
             (artist, title, year, medium, format, label, catalog_number,
              condition, notes, source, discogs_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'discogs', ?10)",
            params![
                artist,
                title,
                year,
                medium,
                format_opt,
                label,
                catalog,
                media_cond,
                notes,
                discogs_id,
            ],
        ) {
            Ok(_) => summary.imported += 1,
            Err(e) => summary.errors.push(format!("row {}: {}", i + 1, e)),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// One-shot migration from the disco-vault era. On first launch of the
// renamed binary we move user data (the SQLite DB and config.json) from the
// old app-data directory to the new one. The libsecret nsec is migrated
// separately via `migrate_legacy_keychain`. Idempotent: once user files are
// gone from the legacy path, subsequent runs are no-ops.
//
// We deliberately do NOT rename the whole directory: Tauri creates the new
// `app_data_dir` during webview initialisation (for CacheStorage, localstorage,
// etc.) BEFORE `setup` callbacks run, so the new dir effectively always exists
// by this point. We move individual user files instead, and leave webview
// state (which is per-bundle-id and not portable) where it sits.
fn migrate_legacy_data_dir(app: &tauri::AppHandle) -> Result<(), String> {
    let Ok(home) = std::env::var("HOME") else {
        return Ok(());
    };
    let old_dir = PathBuf::from(&home)
        .join(".local")
        .join("share")
        .join(LEGACY_BUNDLE_ID);
    if !old_dir.exists() {
        return Ok(());
    }

    let new_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    let new_id = new_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    // 64 KiB: bigger than a schema-only SQLite stub (~28 KiB on Linux), small
    // enough that a real disco-vault DB with any releases will exceed it.
    // Used to distinguish "Tauri-created empty file" from "user already
    // started using the new install."
    const STUB_THRESHOLD: u64 = 64 * 1024;

    for filename in ["discography.db", "config.json"] {
        let src = old_dir.join(filename);
        if !src.exists() {
            continue;
        }
        let dst = new_dir.join(filename);

        if dst.exists() {
            let dst_size = std::fs::metadata(&dst)
                .map(|m| m.len())
                .unwrap_or(u64::MAX);
            if dst_size > STUB_THRESHOLD {
                eprintln!(
                    "ndisc: keeping existing {} ({} bytes) at new location; \
                     not overwriting from legacy",
                    filename, dst_size
                );
                continue;
            }
            let _ = std::fs::remove_file(&dst);
        }

        std::fs::rename(&src, &dst).map_err(|e| {
            format!(
                "rename {} -> {}: {}",
                src.display(),
                dst.display(),
                e
            )
        })?;

        if filename == "config.json" && !new_id.is_empty() {
            // Rewrite any legacy path references inside config.json.
            if let Ok(text) = std::fs::read_to_string(&dst) {
                let rewritten = text.replace(LEGACY_BUNDLE_ID, new_id);
                if rewritten != text {
                    let _ = std::fs::write(&dst, rewritten);
                }
            }
        }

        eprintln!(
            "ndisc: migrated {} -> {}",
            src.display(),
            dst.display()
        );
    }

    // If the legacy dir has nothing left, drop it. If it still holds webview
    // state (CacheStorage, localstorage, etc.) we leave it alone — that's
    // orphaned data for a now-defunct bundle id; the user can delete it by
    // hand if they want the space back.
    if let Ok(entries) = std::fs::read_dir(&old_dir) {
        if entries.filter_map(|e| e.ok()).next().is_none() {
            let _ = std::fs::remove_dir(&old_dir);
        }
    }

    Ok(())
}

fn migrate_legacy_keychain() -> Result<(), String> {
    let old = Entry::new(LEGACY_KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?;
    let secret = match old.get_password() {
        Ok(s) => s,
        Err(keyring::Error::NoEntry) => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let new = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match new.get_password() {
        Ok(_) => return Ok(()), // already migrated; leave old as-is for safety
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    new.set_password(&secret).map_err(|e| e.to_string())?;
    // Only delete the legacy entry after a successful write to the new one.
    let _ = old.delete_credential();
    eprintln!(
        "ndisc: migrated keychain entry {} -> {}",
        LEGACY_KEYRING_SERVICE, KEYRING_SERVICE
    );
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Err(e) = migrate_legacy_data_dir(&app.handle()) {
                eprintln!("ndisc: data-dir migration error: {}", e);
            }
            if let Err(e) = migrate_legacy_keychain() {
                eprintln!("ndisc: keychain migration error: {}", e);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
            set_db_path,
            add_release,
            set_cover_art_url,
            list_releases,
            delete_release,
            get_stats,
            scan_directory,
            import_directory,
            scan_discogs_csv,
            import_discogs_csv,
            extract_embedded_covers,
            rescan_local_covers,
            refresh_release,
            scan_library_changes,
            sync_cover_to_disk,
            update_release_path,
            generate_keypair,
            import_keypair,
            get_npub,
            clear_keypair,
            publish_release,
            publish_library,
            unpublish_release
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
