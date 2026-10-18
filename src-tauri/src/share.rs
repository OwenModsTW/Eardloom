//! Sharing whole worlds: `.eardloom` world packs and exported wiki websites.

use crate::db;
use crate::world::{err, folder_name, info, remember, AppState, CmdResult, OpenWorld, WorldInfo, ASSETS_DIR, DB_FILE};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MANIFEST: &str = "manifest.json";
const PACK_FORMAT: &str = "eardloom-world";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    version: u32,
    name: String,
    app_version: String,
}

/// A path inside an export: relative, no `..`, no drive letters.
fn safe_relative(p: &str) -> Option<PathBuf> {
    let path = Path::new(p);
    path.components()
        .all(|c| matches!(c, Component::Normal(_)))
        .then(|| path.to_path_buf())
}

fn temp_path(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("eardloom-{label}-{}-{nanos}.db", std::process::id()))
}

/// Removes private entries (and everything indexed from them) from a snapshot.
/// Returns images that only private entries used, so they can be left out too.
fn strip_private(conn: &Connection) -> CmdResult<HashSet<String>> {
    let images = |sql: &str| -> CmdResult<HashSet<String>> {
        let mut stmt = conn.prepare(sql).map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    };
    let private_images = images("SELECT image FROM entries WHERE visibility = 'private' AND image IS NOT NULL")?;
    let public_images = images("SELECT image FROM entries WHERE visibility != 'private' AND image IS NOT NULL")?;
    conn.execute_batch(
        "DELETE FROM links WHERE (source_kind = 'entry' AND source_id IN (SELECT id FROM entries WHERE visibility = 'private'))
            OR target_id IN (SELECT id FROM entries WHERE visibility = 'private');
         DELETE FROM search WHERE kind = 'entry' AND id IN (SELECT id FROM entries WHERE visibility = 'private');
         DELETE FROM entries WHERE visibility = 'private';",
    )
    .map_err(err)?;
    Ok(private_images.difference(&public_images).cloned().collect())
}

fn write_pack(world: &OpenWorld, dest: &Path, omit_private: bool, app_version: &str) -> CmdResult<()> {
    // A consistent snapshot, even while the app keeps writing.
    let snapshot = temp_path("pack");
    world
        .conn
        .execute("VACUUM INTO ?1", params![snapshot.to_string_lossy()])
        .map_err(err)?;
    let result = (|| {
        let mut skip_assets = HashSet::new();
        if omit_private {
            let conn = Connection::open(&snapshot).map_err(err)?;
            skip_assets = strip_private(&conn)?;
            conn.execute_batch("VACUUM").map_err(err)?;
        }
        let name = info(world)?.name;
        let manifest = Manifest { format: PACK_FORMAT.into(), version: 1, name, app_version: app_version.into() };

        let mut zip = ZipWriter::new(File::create(dest).map_err(err)?);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file(MANIFEST, opts).map_err(err)?;
        zip.write_all(serde_json::to_string_pretty(&manifest).map_err(err)?.as_bytes()).map_err(err)?;
        zip.start_file(DB_FILE, opts).map_err(err)?;
        zip.write_all(&fs::read(&snapshot).map_err(err)?).map_err(err)?;

        let assets = world.path.join(ASSETS_DIR);
        if let Ok(dir) = fs::read_dir(&assets) {
            // Images are already compressed; storing them is faster and no bigger.
            let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            for item in dir.flatten() {
                let name = item.file_name().to_string_lossy().to_string();
                if !item.path().is_file() || skip_assets.contains(&name) {
                    continue;
                }
                zip.start_file(format!("{ASSETS_DIR}/{name}"), stored).map_err(err)?;
                zip.write_all(&fs::read(item.path()).map_err(err)?).map_err(err)?;
            }
        }
        zip.finish().map_err(err)?;
        Ok(())
    })();
    let _ = fs::remove_file(&snapshot);
    if result.is_err() {
        let _ = fs::remove_file(dest);
    }
    result
}

#[tauri::command]
pub fn export_world_pack(app: AppHandle, state: State<AppState>, dest: String, omit_private: bool) -> CmdResult<()> {
    let version = app.package_info().version.to_string();
    state.with(|w| write_pack(w, Path::new(&dest), omit_private, &version))
}

/// Extracts a world pack into a new folder under `parent_dir`, never overwriting anything.
fn unpack(src: &Path, parent_dir: &Path) -> CmdResult<PathBuf> {
    let not_a_pack = || "That file isn't a world pack.".to_string();
    let mut archive = ZipArchive::new(File::open(src).map_err(err)?).map_err(|_| not_a_pack())?;
    let manifest: Manifest = {
        let mut text = String::new();
        archive.by_name(MANIFEST).map_err(|_| not_a_pack())?.read_to_string(&mut text).map_err(err)?;
        serde_json::from_str(&text).map_err(|_| not_a_pack())?
    };
    if manifest.format != PACK_FORMAT {
        return Err(not_a_pack());
    }

    // "Name", then "Name (2)", "Name (3)"...
    let base = folder_name(&manifest.name);
    let mut dest = parent_dir.join(&base);
    let mut n = 1;
    while dest.exists() {
        n += 1;
        dest = parent_dir.join(format!("{base} ({n})"));
    }
    fs::create_dir_all(dest.join(ASSETS_DIR)).map_err(err)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(err)?;
        let Ok(name) = file.name().map(|n| n.to_string()) else { continue };
        let Some(rel) = safe_relative(&name) else { continue };
        // Only the database and loose files in assets/: nothing else is ever written.
        let allowed = rel == Path::new(DB_FILE)
            || (rel.starts_with(ASSETS_DIR) && rel.components().count() == 2 && !file.is_dir());
        if !allowed {
            continue;
        }
        let mut out = File::create(dest.join(&rel)).map_err(err)?;
        std::io::copy(&mut file, &mut out).map_err(err)?;
    }
    if !dest.join(DB_FILE).exists() {
        let _ = fs::remove_dir_all(&dest);
        return Err(not_a_pack());
    }
    Ok(dest)
}

/// Unpacks a world pack into a new folder under `parent_dir` and opens it.
#[tauri::command]
pub fn import_world_pack(app: AppHandle, state: State<AppState>, src: String, parent_dir: String) -> CmdResult<WorldInfo> {
    let dest = unpack(Path::new(&src), Path::new(&parent_dir))?;
    let conn = db::open(&dest.join(DB_FILE)).map_err(err)?;
    let world = OpenWorld { path: dest, conn };
    let result = info(&world)?;
    remember(&app, &world.path, &result.name)?;
    *state.world.lock().map_err(err)? = Some(world);
    Ok(result)
}

#[derive(Deserialize)]
pub struct SiteFile {
    path: String,
    content: String,
}

/// Writes a generated website into `dir`, copying the images it uses from the world's assets.
/// Returns the path of its index page.
#[tauri::command]
pub fn write_static_site(state: State<AppState>, dir: String, files: Vec<SiteFile>, assets: Vec<String>) -> CmdResult<String> {
    let root = PathBuf::from(&dir);
    for f in &files {
        let rel = safe_relative(&f.path).ok_or_else(|| format!("Bad path in export: {}", f.path))?;
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        fs::write(&path, &f.content).map_err(err)?;
    }
    state.with(|w| {
        let from = w.path.join(ASSETS_DIR);
        let to = root.join(ASSETS_DIR);
        fs::create_dir_all(&to).map_err(err)?;
        for name in &assets {
            let src = from.join(name);
            if src.parent() == Some(from.as_path()) && src.is_file() {
                fs::copy(&src, to.join(name)).map_err(err)?;
            }
        }
        Ok(())
    })?;
    Ok(root.join("index.html").to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_escape_the_folder() {
        assert!(safe_relative("assets/map.png").is_some());
        assert!(safe_relative("../evil.exe").is_none());
        assert!(safe_relative("assets/../../evil.exe").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("C:\\Windows\\evil.dll").is_none());
    }

    #[test]
    fn stripping_private_entries_keeps_shared_images() {
        let tmp = temp_path("test");
        drop(db::open(&tmp).unwrap());
        let conn = Connection::open(&tmp).unwrap();
        conn.execute_batch(
            "INSERT INTO entry_types (id, name, plural) VALUES ('t', 'Character', 'Characters');
             INSERT INTO entries (id, type_id, title, image, visibility) VALUES
               ('a', 't', 'Public hero', 'shared.png', 'public'),
               ('b', 't', 'Secret villain', 'secret.png', 'private'),
               ('c', 't', 'Also secret', 'shared.png', 'private');
             INSERT INTO links (source_kind, source_id, target_id, via) VALUES ('entry', 'a', 'b', 'mention');",
        )
        .unwrap();
        let skipped = strip_private(&conn).unwrap();
        assert_eq!(skipped, HashSet::from(["secret.png".to_string()]));
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0)).unwrap();
        let links: i64 = conn.query_row("SELECT COUNT(*) FROM links", [], |r| r.get(0)).unwrap();
        assert_eq!((left, links), (1, 0));
        drop(conn);
        let _ = fs::remove_file(tmp);
    }

    #[test]
    fn world_pack_round_trip_leaves_out_private_entries_and_images() {
        let root = std::env::temp_dir().join(format!("eardloom-pack-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let world_dir = root.join("Source World");
        fs::create_dir_all(world_dir.join(ASSETS_DIR)).unwrap();
        fs::write(world_dir.join(ASSETS_DIR).join("hero.png"), b"hero").unwrap();
        fs::write(world_dir.join(ASSETS_DIR).join("villain.png"), b"villain").unwrap();
        let conn = db::open(&world_dir.join(DB_FILE)).unwrap();
        conn.execute_batch(
            "INSERT INTO meta (key, value) VALUES ('name', 'Source World');
             INSERT INTO entry_types (id, name, plural) VALUES ('t', 'Character', 'Characters');
             INSERT INTO entries (id, type_id, title, image, visibility) VALUES
               ('a', 't', 'Hero', 'hero.png', 'public'),
               ('b', 't', 'Villain', 'villain.png', 'private');",
        )
        .unwrap();
        let world = OpenWorld { path: world_dir, conn };

        let pack = root.join("shared.eardloom");
        write_pack(&world, &pack, true, "test").unwrap();
        let out = unpack(&pack, &root.join("inbox")).unwrap();
        // Unpacking again never overwrites the first copy.
        let again = unpack(&pack, &root.join("inbox")).unwrap();
        assert_ne!(out, again);

        let copy = Connection::open(out.join(DB_FILE)).unwrap();
        let titles: Vec<String> = copy
            .prepare("SELECT title FROM entries")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(titles, vec!["Hero"]);
        assert!(out.join(ASSETS_DIR).join("hero.png").exists());
        assert!(!out.join(ASSETS_DIR).join("villain.png").exists());

        // A full backup keeps everything.
        write_pack(&world, &root.join("backup.eardloom"), false, "test").unwrap();
        let full = unpack(&root.join("backup.eardloom"), &root.join("restore")).unwrap();
        assert!(full.join(ASSETS_DIR).join("villain.png").exists());

        drop(copy);
        drop(world);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_files_that_are_not_world_packs() {
        let root = std::env::temp_dir().join(format!("eardloom-badpack-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("notes.eardloom"), b"just some text").unwrap();
        assert!(unpack(&root.join("notes.eardloom"), &root).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
