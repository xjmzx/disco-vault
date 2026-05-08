// Tauri commands for disco-vault. SQLite-backed local discography.
// See https://tauri.app/develop/calling-rust/

use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Manager;

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

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("discography.db"))
}

fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
fn init_db(app: tauri::AppHandle) -> Result<String, String> {
    let path = db_path(&app)?;
    let _ = open(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn add_release(app: tauri::AppHandle, release: Release) -> Result<i64, String> {
    let conn = open(&app)?;
    conn.execute(
        "INSERT INTO releases
         (artist, title, year, medium, format, label, catalog_number, country,
          condition, notes, source, file_path, cover_art_path,
          discogs_id, musicbrainz_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
            release.discogs_id,
            release.musicbrainz_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
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
    })
}

#[tauri::command]
fn list_releases(
    app: tauri::AppHandle,
    query: Option<String>,
    medium: Option<String>,
) -> Result<Vec<Release>, String> {
    let conn = open(&app)?;
    let q = query.unwrap_or_default();
    let q_like = format!("%{}%", q);
    let mut stmt = conn
        .prepare(
            "SELECT id, artist, title, year, medium, format, label, catalog_number,
                    country, condition, notes, source, file_path, cover_art_path,
                    discogs_id, musicbrainz_id, added_at, updated_at
             FROM releases
             WHERE (?1 = '' OR artist LIKE ?2 OR title LIKE ?2
                              OR label  LIKE ?2 OR catalog_number LIKE ?2)
               AND (?3 IS NULL OR medium = ?3)
             ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
        )
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            init_db,
            add_release,
            list_releases,
            delete_release,
            get_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
