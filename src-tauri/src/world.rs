use crate::codex::{save_type_inner, EntryType};
use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub const DB_FILE: &str = "world.db";
pub const ASSETS_DIR: &str = "assets";

pub type CmdResult<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub struct OpenWorld {
    pub path: PathBuf,
    pub conn: Connection,
}

#[derive(Default)]
pub struct AppState {
    pub world: Mutex<Option<OpenWorld>>,
}

impl AppState {
    /// Runs `f` against the open world, or fails if none is open.
    pub fn with<T>(&self, f: impl FnOnce(&mut OpenWorld) -> CmdResult<T>) -> CmdResult<T> {
        let mut guard = self.world.lock().map_err(err)?;
        let world = guard.as_mut().ok_or("No world is open")?;
        f(world)
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorld {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub path: String,
    pub assets_path: String,
    pub name: String,
    pub description: String,
    pub genre: String,
}

fn recent_file(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("recent-worlds.json"))
}

fn read_recent(app: &AppHandle) -> Vec<RecentWorld> {
    recent_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_recent(app: &AppHandle, list: &[RecentWorld]) -> CmdResult<()> {
    let json = serde_json::to_string_pretty(list).map_err(err)?;
    fs::write(recent_file(app)?, json).map_err(err)
}

pub(crate) fn remember(app: &AppHandle, path: &Path, name: &str) -> CmdResult<()> {
    let path = path.to_string_lossy().to_string();
    let mut list = read_recent(app);
    list.retain(|w| w.path != path);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    list.insert(0, RecentWorld { path, name: name.to_string(), opened_at: now });
    list.truncate(20);
    write_recent(app, &list)
}

fn get_meta(conn: &Connection, key: &str) -> CmdResult<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .map(|v| v.unwrap_or_default())
        .map_err(err)
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> CmdResult<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(err)
}

pub(crate) fn info(world: &OpenWorld) -> CmdResult<WorldInfo> {
    Ok(WorldInfo {
        path: world.path.to_string_lossy().to_string(),
        assets_path: world.path.join(ASSETS_DIR).to_string_lossy().to_string(),
        name: get_meta(&world.conn, "name")?,
        description: get_meta(&world.conn, "description")?,
        genre: get_meta(&world.conn, "genre")?,
    })
}

/// Strips characters Windows/macOS won't accept in a folder name.
pub(crate) fn folder_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() { "Untitled World".into() } else { trimmed }
}

#[tauri::command]
pub fn list_recent_worlds(app: AppHandle) -> Vec<RecentWorld> {
    read_recent(&app)
        .into_iter()
        .filter(|w| Path::new(&w.path).join(DB_FILE).exists())
        .collect()
}

#[tauri::command]
pub fn forget_recent_world(app: AppHandle, path: String) -> CmdResult<()> {
    let mut list = read_recent(&app);
    list.retain(|w| w.path != path);
    write_recent(&app, &list)
}

#[tauri::command]
pub fn default_worlds_dir(app: AppHandle) -> CmdResult<String> {
    let dir = app.path().document_dir().map_err(err)?.join("Eardloom");
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_world(
    app: AppHandle,
    state: State<AppState>,
    parent_dir: String,
    name: String,
    description: String,
    genre: String,
    types: Vec<EntryType>,
) -> CmdResult<WorldInfo> {
    let path = Path::new(&parent_dir).join(folder_name(&name));
    if path.join(DB_FILE).exists() {
        return Err(format!("A world already exists at {}", path.display()));
    }
    fs::create_dir_all(path.join(ASSETS_DIR)).map_err(err)?;
    let conn = db::open(&path.join(DB_FILE)).map_err(err)?;
    set_meta(&conn, "name", &name)?;
    set_meta(&conn, "description", &description)?;
    set_meta(&conn, "genre", &genre)?;
    for t in &types {
        save_type_inner(&conn, t)?;
    }
    remember(&app, &path, &name)?;
    let world = OpenWorld { path, conn };
    let result = info(&world)?;
    *state.world.lock().map_err(err)? = Some(world);
    Ok(result)
}

#[tauri::command]
pub fn open_world(app: AppHandle, state: State<AppState>, path: String) -> CmdResult<WorldInfo> {
    let path = PathBuf::from(path);
    let db_path = path.join(DB_FILE);
    if !db_path.exists() {
        return Err(format!("No world found in {}", path.display()));
    }
    fs::create_dir_all(path.join(ASSETS_DIR)).map_err(err)?;
    let conn = db::open(&db_path).map_err(err)?;
    let world = OpenWorld { path, conn };
    let result = info(&world)?;
    remember(&app, &world.path, &result.name)?;
    *state.world.lock().map_err(err)? = Some(world);
    Ok(result)
}

#[tauri::command]
pub fn close_world(state: State<AppState>) -> CmdResult<()> {
    *state.world.lock().map_err(err)? = None;
    Ok(())
}

#[tauri::command]
pub fn update_world_info(
    app: AppHandle,
    state: State<AppState>,
    name: String,
    description: String,
) -> CmdResult<WorldInfo> {
    state.with(|w| {
        set_meta(&w.conn, "name", &name)?;
        set_meta(&w.conn, "description", &description)?;
        remember(&app, &w.path, &name)?;
        info(w)
    })
}

/// Copies an image (or any file) into the world's assets folder and returns its
/// path relative to that folder, so worlds stay portable when moved or shared.
#[tauri::command]
pub fn import_asset(state: State<AppState>, source: String) -> CmdResult<String> {
    state.with(|w| {
        let src = Path::new(&source);
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("bin").to_lowercase();
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("asset");
        let dir = w.path.join(ASSETS_DIR);
        let mut name = format!("{}.{ext}", folder_name(stem));
        let mut n = 1;
        while dir.join(&name).exists() {
            n += 1;
            name = format!("{}-{n}.{ext}", folder_name(stem));
        }
        fs::copy(src, dir.join(&name)).map_err(err)?;
        Ok(name)
    })
}

/// Raw bytes of a file in the world's assets folder, for drawing images onto
/// share cards (a canvas can't read the asset protocol's URLs directly).
#[tauri::command]
pub fn read_asset(state: State<AppState>, name: String) -> CmdResult<tauri::ipc::Response> {
    state.with(|w| {
        let dir = w.path.join(ASSETS_DIR);
        let path = dir.join(&name);
        // Only files directly inside the assets folder.
        if path.parent() != Some(dir.as_path()) {
            return Err("Invalid asset name".into());
        }
        fs::read(path).map(tauri::ipc::Response::new).map_err(err)
    })
}
