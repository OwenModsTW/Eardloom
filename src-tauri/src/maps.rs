//! Maps: uploaded images or maps drawn in the app, with pins that link to entries.

use crate::codex::replace_links;
use crate::world::{err, AppState, CmdResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct WorldMap {
    pub id: String,
    pub title: String,
    /// Background image in the world's assets folder; None for drawn maps.
    pub image: Option<String>,
    pub width: f64,
    pub height: f64,
    pub sort: i64,
    /// Drawing, labels and pins; shaped by the frontend.
    pub data: Value,
    #[serde(default)]
    pub updated_at: String,
}

/// Entries a map's pins point at.
fn pinned_entries(data: &Value) -> Vec<(String, String)> {
    data.get("pins")
        .and_then(Value::as_array)
        .map(|pins| {
            pins.iter()
                .filter_map(|p| p.get("entryId").and_then(Value::as_str))
                .map(|id| (id.to_string(), "pin".to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn row_to_map(r: &rusqlite::Row) -> rusqlite::Result<WorldMap> {
    let data: String = r.get(6)?;
    Ok(WorldMap {
        id: r.get(0)?,
        title: r.get(1)?,
        image: r.get(2)?,
        width: r.get(3)?,
        height: r.get(4)?,
        sort: r.get(5)?,
        data: serde_json::from_str(&data).unwrap_or(Value::Object(Default::default())),
        updated_at: r.get(7)?,
    })
}

const COLUMNS: &str = "id, title, image, width, height, sort, data, updated_at";

#[tauri::command]
pub fn list_maps(state: State<AppState>) -> CmdResult<Vec<WorldMap>> {
    state.with(|w| {
        let mut stmt = w.conn.prepare(&format!("SELECT {COLUMNS} FROM maps ORDER BY sort, title")).map_err(err)?;
        let rows = stmt.query_map([], row_to_map).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[tauri::command]
pub fn get_map(state: State<AppState>, id: String) -> CmdResult<Option<WorldMap>> {
    state.with(|w| {
        w.conn
            .query_row(&format!("SELECT {COLUMNS} FROM maps WHERE id = ?1"), [&id], row_to_map)
            .optional()
            .map_err(err)
    })
}

#[tauri::command]
pub fn save_map(state: State<AppState>, map: WorldMap) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO maps (id, title, image, width, height, sort, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, image = excluded.image, width = excluded.width, height = excluded.height,
               sort = excluded.sort, data = excluded.data, updated_at = datetime('now')",
            params![map.id, map.title, map.image, map.width, map.height, map.sort, map.data.to_string()],
        )
        .map_err(err)?;
        replace_links(&tx, "map", &map.id, &pinned_entries(&map.data))?;
        tx.commit().map_err(err)
    })
}

#[tauri::command]
pub fn delete_map(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        tx.execute("DELETE FROM links WHERE source_kind = 'map' AND source_id = ?1", [&id]).map_err(err)?;
        tx.execute("DELETE FROM maps WHERE id = ?1", [&id]).map_err(err)?;
        tx.commit().map_err(err)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pins_become_links() {
        let data = json!({ "pins": [{ "id": "p1", "entryId": "e1" }, { "id": "p2", "mapId": "m2" }, { "id": "p3", "entryId": "e3" }] });
        assert_eq!(pinned_entries(&data), vec![("e1".to_string(), "pin".to_string()), ("e3".to_string(), "pin".to_string())]);
        assert!(pinned_entries(&json!({})).is_empty());
    }
}
