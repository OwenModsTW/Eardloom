//! The world's calendar and the dated fields that make up its timeline.

use crate::world::{err, get_meta, set_meta, AppState, CmdResult};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use tauri::State;

const CALENDAR_KEY: &str = "calendar";
const DATE_KIND: &str = "worlddate";

/// One dated field on one entry, e.g. a character's "Born".
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineItem {
    pub entry_id: String,
    pub type_id: String,
    pub title: String,
    pub summary: String,
    pub emoji: Option<String>,
    pub field_id: String,
    pub date: Value,
}

#[tauri::command]
pub fn get_calendar(state: State<AppState>) -> CmdResult<Option<Value>> {
    state.with(|w| {
        let raw = get_meta(&w.conn, CALENDAR_KEY)?;
        Ok(serde_json::from_str(&raw).ok())
    })
}

#[tauri::command]
pub fn save_calendar(state: State<AppState>, calendar: Value) -> CmdResult<()> {
    state.with(|w| set_meta(&w.conn, CALENDAR_KEY, &calendar.to_string()))
}

pub fn collect(conn: &Connection) -> CmdResult<Vec<TimelineItem>> {
    // Which fields of which types hold timeline dates.
    let mut date_fields: HashMap<String, Vec<String>> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, fields FROM entry_types").map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        for row in rows {
            let (type_id, fields) = row.map_err(err)?;
            let ids: Vec<String> = serde_json::from_str::<Value>(&fields)
                .ok()
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
                .iter()
                .filter(|f| f.get("kind").and_then(Value::as_str) == Some(DATE_KIND))
                .filter_map(|f| f.get("id").and_then(Value::as_str).map(String::from))
                .collect();
            if !ids.is_empty() {
                date_fields.insert(type_id, ids);
            }
        }
    }
    if date_fields.is_empty() {
        return Ok(vec![]);
    }

    let mut items = Vec::new();
    let mut stmt = conn
        .prepare("SELECT id, type_id, title, summary, emoji, fields FROM entries")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(err)?;
    for row in rows {
        let (entry_id, type_id, title, summary, emoji, fields) = row.map_err(err)?;
        let Some(wanted) = date_fields.get(&type_id) else { continue };
        let Ok(Value::Object(values)) = serde_json::from_str::<Value>(&fields) else { continue };
        for field_id in wanted {
            // A usable date always has a numeric year.
            if let Some(date) = values.get(field_id).filter(|d| d.get("year").and_then(Value::as_f64).is_some()) {
                items.push(TimelineItem {
                    entry_id: entry_id.clone(),
                    type_id: type_id.clone(),
                    title: title.clone(),
                    summary: summary.clone(),
                    emoji: emoji.clone(),
                    field_id: field_id.clone(),
                    date: date.clone(),
                });
            }
        }
    }
    Ok(items)
}

#[tauri::command]
pub fn timeline_items(state: State<AppState>) -> CmdResult<Vec<TimelineItem>> {
    state.with(|w| collect(&w.conn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn collects_only_dated_fields_with_a_year() {
        let path = std::env::temp_dir().join(format!("eardloom-timeline-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(&path).unwrap();
        conn.execute_batch(
            r#"INSERT INTO entry_types (id, name, plural, fields) VALUES
                 ('c', 'Character', 'Characters', '[{"id":"born","label":"Born","kind":"worlddate"},{"id":"bio","label":"Bio","kind":"longtext"}]'),
                 ('n', 'Note', 'Notes', '[]');
               INSERT INTO entries (id, type_id, title, fields) VALUES
                 ('a', 'c', 'Mira', '{"born":{"era":"e1","year":1042},"bio":"x"}'),
                 ('b', 'c', 'Kade', '{"born":{"era":"e1"}}'),
                 ('n1', 'n', 'Loose note', '{"born":{"year":5}}');"#,
        )
        .unwrap();
        let items = collect(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Mira");
        assert_eq!(items[0].field_id, "born");
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}
