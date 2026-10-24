//! Automatic backups of the open world, written as ordinary world packs.
//!
//! Kept small on disk: nothing is written when the world hasn't changed since the
//! last backup, older backups are thinned out over time, and a size cap applies.

use crate::share::{snapshot_db, zip_world};
use crate::world::{err, folder_name, info, AppState, CmdResult};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const EXT: &str = "eardloom";
const FINGERPRINT: &str = ".last-backup";
const DAY: i64 = 86_400;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct BackupInfo {
    pub file: String,
    pub path: String,
    /// Seconds since 1970, UTC.
    pub created: i64,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct BackupOutcome {
    /// False when nothing had changed since the last backup.
    pub created: bool,
    pub removed: usize,
    pub total_size: u64,
}

// ---- dates without a date library: days since 1970 <-> civil date (UTC) ----

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// "2026-10-19T101500Z.eardloom": sortable, and safe in Windows file names.
fn file_name(secs: i64) -> String {
    let (y, m, d) = civil_from_days(secs.div_euclid(DAY));
    let t = secs.rem_euclid(DAY);
    format!("{y:04}-{m:02}-{d:02}T{:02}{:02}{:02}Z.{EXT}", t / 3600, t % 3600 / 60, t % 60)
}

fn parse_name(name: &str) -> Option<i64> {
    let s = name.strip_suffix(&format!(".{EXT}"))?;
    let (date, time) = s.split_once('T')?;
    let mut parts = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    let time = time.strip_suffix('Z')?;
    if time.len() != 6 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| time.get(r)?.parse::<i64>().ok();
    let (hh, mm, ss) = (n(0..2)?, n(2..4)?, n(4..6)?);
    Some(days_from_civil(y, m as u32, d as u32) * DAY + hh * 3600 + mm * 60 + ss)
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Which backups to delete: keep the newest, one a day for a week, one a week for
/// four weeks, one a month for six months; then enforce the size cap, oldest first.
pub fn plan_cleanup(backups: &[BackupInfo], now: i64, cap: u64) -> Vec<String> {
    let mut sorted: Vec<&BackupInfo> = backups.iter().collect();
    sorted.sort_by(|a, b| b.created.cmp(&a.created));
    let today = now.div_euclid(DAY);
    let mut keep: Vec<&BackupInfo> = Vec::new();
    let mut buckets: HashSet<(char, i64)> = HashSet::new();
    for (i, b) in sorted.iter().enumerate() {
        let day = b.created.div_euclid(DAY);
        let age = today - day;
        let (y, m, _) = civil_from_days(day);
        let bucket = if age < 7 {
            Some(('d', day))
        } else if age < 28 {
            Some(('w', day.div_euclid(7)))
        } else if age < 183 {
            Some(('m', y * 12 + i64::from(m)))
        } else {
            None
        };
        // Newest first, so the first backup seen in each bucket is the one kept.
        if i == 0 || bucket.is_some_and(|k| buckets.insert(k)) {
            keep.push(b);
        }
    }
    // Size cap: drop the oldest kept backups, but never the newest.
    let mut total: u64 = keep.iter().map(|b| b.size).sum();
    while total > cap && keep.len() > 1 {
        total -= keep.pop().map(|b| b.size).unwrap_or(0);
    }
    let kept: HashSet<&str> = keep.iter().map(|b| b.file.as_str()).collect();
    sorted.iter().filter(|b| !kept.contains(b.file.as_str())).map(|b| b.file.clone()).collect()
}

fn list_in(dir: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|item| {
                    let file = item.file_name().to_string_lossy().to_string();
                    let created = parse_name(&file)?;
                    let size = item.metadata().ok()?.len();
                    Some(BackupInfo { path: item.path().to_string_lossy().to_string(), file, created, size })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

/// A cheap identity for "the world as it is now": its data plus the list of assets.
fn fingerprint(snapshot: &Path, world_dir: &Path) -> CmdResult<String> {
    let mut h = DefaultHasher::new();
    fs::read(snapshot).map_err(err)?.hash(&mut h);
    let mut assets: Vec<(String, u64)> = fs::read_dir(world_dir.join(crate::world::ASSETS_DIR))
        .map(|rd| {
            rd.flatten()
                .filter_map(|i| Some((i.file_name().to_string_lossy().to_string(), i.metadata().ok()?.len())))
                .collect()
        })
        .unwrap_or_default();
    assets.sort();
    assets.hash(&mut h);
    Ok(format!("{:016x}", h.finish()))
}

fn world_dir_in(root: &Path, world_path: &Path) -> PathBuf {
    let name = world_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "World".into());
    root.join(folder_name(&name))
}

#[tauri::command]
pub fn default_backup_dir(app: AppHandle) -> CmdResult<String> {
    let dir = app.path().document_dir().map_err(err)?.join("Eardloom Backups");
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_backups(state: State<AppState>, dir: String) -> CmdResult<Vec<BackupInfo>> {
    state.with(|w| Ok(list_in(&world_dir_in(Path::new(&dir), &w.path))))
}

/// Backs up the open world into `dir`, unless nothing changed since the last backup.
#[tauri::command]
pub async fn run_backup(app: AppHandle, state: State<'_, AppState>, dir: String, max_mb: u64, force: bool) -> CmdResult<BackupOutcome> {
    // Only the database snapshot needs the world; zipping happens without the lock.
    let (snapshot, world_path, world_name) = state.with(|w| Ok((snapshot_db(w, "backup")?, w.path.clone(), info(w)?.name)))?;
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let target = world_dir_in(Path::new(&dir), &world_path);
        let result = (|| {
            fs::create_dir_all(&target).map_err(err)?;
            let print = fingerprint(&snapshot, &world_path)?;
            let unchanged = fs::read_to_string(target.join(FINGERPRINT)).is_ok_and(|p| p.trim() == print);
            let mut created = false;
            if force || !unchanged {
                let dest = target.join(file_name(now()));
                zip_world(&world_path, &world_name, &snapshot, &dest, &HashSet::new(), &version)?;
                fs::write(target.join(FINGERPRINT), &print).map_err(err)?;
                created = true;
            }
            let backups = list_in(&target);
            let doomed = plan_cleanup(&backups, now(), max_mb.saturating_mul(1024 * 1024));
            let sizes: HashMap<&str, u64> = backups.iter().map(|b| (b.file.as_str(), b.size)).collect();
            for f in &doomed {
                let _ = fs::remove_file(target.join(f));
            }
            let total_size = backups.iter().map(|b| b.size).sum::<u64>() - doomed.iter().filter_map(|f| sizes.get(f.as_str())).sum::<u64>();
            Ok(BackupOutcome { created, removed: doomed.len(), total_size })
        })();
        let _ = fs::remove_file(&snapshot);
        result
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(file: &str, created: i64, size: u64) -> BackupInfo {
        BackupInfo { file: file.into(), path: String::new(), created, size }
    }

    #[test]
    fn file_names_round_trip() {
        for secs in [0, 1_792_354_123, 1_700_000_000, 951_782_400 /* 29 Feb 2000 */] {
            let name = file_name(secs);
            assert_eq!(parse_name(&name), Some(secs), "{name}");
        }
        assert_eq!(file_name(1_792_354_123), "2026-10-18T200843Z.eardloom");
        assert_eq!(parse_name("notes.eardloom"), None);
    }

    #[test]
    fn thins_out_old_backups() {
        let now = 1_792_354_123;
        let mut list = Vec::new();
        // Four backups a day for 200 days.
        for day in 0..200 {
            for k in 0..4 {
                let t = now - day * DAY - k * 3600;
                list.push(b(&format!("{t}"), t, 1));
            }
        }
        let doomed: HashSet<String> = plan_cleanup(&list, now, u64::MAX).into_iter().collect();
        let kept: Vec<&BackupInfo> = list.iter().filter(|x| !doomed.contains(&x.file)).collect();
        // 7 daily + 3 weekly + ~6 monthly, give or take bucket edges.
        assert!((14..=19).contains(&kept.len()), "kept {}", kept.len());
        assert!(kept.iter().any(|x| x.created == now), "newest always kept");
        assert!(kept.iter().all(|x| now - x.created < 190 * DAY), "nothing older than ~6 months");
    }

    #[test]
    fn unchanged_worlds_have_the_same_fingerprint() {
        let dir = std::env::temp_dir().join(format!("eardloom-fp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(crate::world::ASSETS_DIR)).unwrap();
        let conn = crate::db::open(&dir.join(crate::world::DB_FILE)).unwrap();
        conn.execute_batch("INSERT INTO meta (key, value) VALUES ('name', 'W');").unwrap();
        let world = crate::world::OpenWorld { path: dir.clone(), conn };
        let print = |w: &crate::world::OpenWorld| {
            let snap = snapshot_db(w, "fp-test").unwrap();
            let p = fingerprint(&snap, &w.path).unwrap();
            let _ = fs::remove_file(snap);
            p
        };
        let first = print(&world);
        assert_eq!(first, print(&world), "same data, same fingerprint");
        world.conn.execute_batch("INSERT INTO meta (key, value) VALUES ('description', 'changed');").unwrap();
        let edited = print(&world);
        assert_ne!(first, edited, "edits change it");
        fs::write(dir.join(crate::world::ASSETS_DIR).join("map.png"), b"img").unwrap();
        assert_ne!(edited, print(&world), "new images change it");
        drop(world);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn size_cap_drops_oldest_but_never_the_newest() {
        let now = 1_792_354_123;
        let list = vec![b("new", now, 400), b("mid", now - DAY, 400), b("old", now - 2 * DAY, 400)];
        assert_eq!(plan_cleanup(&list, now, 900), vec!["old".to_string()]);
        // Even a cap smaller than one backup keeps the newest.
        let doomed = plan_cleanup(&list, now, 10);
        assert!(!doomed.contains(&"new".to_string()));
        assert_eq!(doomed.len(), 2);
    }
}
