//! The codex: user-defined entry types and the entries (characters, places, ...) in a world.

use crate::db;
use crate::world::{err, AppState, CmdResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct EntryType {
    pub id: String,
    pub name: String,
    pub plural: String,
    pub icon: String,
    pub color: String,
    pub sort: i64,
    /// Field definitions are owned by the frontend; the backend only reads
    /// `id` and `kind` so it can index entry-link fields.
    pub fields: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct Entry {
    pub id: String,
    pub type_id: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub summary: String,
    pub body: Option<Value>,
    pub fields: Value,
    pub tags: Vec<String>,
    pub image: Option<String>,
    #[serde(default)]
    pub emoji: Option<String>,
    pub visibility: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct EntrySummary {
    pub id: String,
    pub type_id: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub summary: String,
    pub tags: Vec<String>,
    pub image: Option<String>,
    pub emoji: Option<String>,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct Backlink {
    pub source_kind: String,
    pub source_id: String,
    pub title: String,
    /// For entries: the entry type id. For docs: the project id.
    pub parent_id: String,
    pub via: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct SearchHit {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub snippet: String,
}

fn json_vec(s: String) -> Vec<String> {
    serde_json::from_str(&s).unwrap_or_default()
}

fn json_val(s: Option<String>) -> Option<Value> {
    s.and_then(|s| serde_json::from_str(&s).ok())
}

fn type_from_row(r: &Row) -> rusqlite::Result<EntryType> {
    Ok(EntryType {
        id: r.get(0)?,
        name: r.get(1)?,
        plural: r.get(2)?,
        icon: r.get(3)?,
        color: r.get(4)?,
        sort: r.get(5)?,
        fields: json_val(r.get(6)?).unwrap_or(Value::Array(vec![])),
    })
}

pub fn save_type_inner(conn: &Connection, t: &EntryType) -> CmdResult<()> {
    conn.execute(
        "INSERT INTO entry_types (id, name, plural, icon, color, sort, fields)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, plural = excluded.plural, icon = excluded.icon,
           color = excluded.color, sort = excluded.sort, fields = excluded.fields,
           updated_at = datetime('now')",
        params![t.id, t.name, t.plural, t.icon, t.color, t.sort, t.fields.to_string()],
    )
    .map(|_| ())
    .map_err(err)
}

fn link_field_ids(conn: &Connection, type_id: &str) -> CmdResult<Vec<String>> {
    let fields: Option<String> = conn
        .query_row("SELECT fields FROM entry_types WHERE id = ?1", [type_id], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let fields = json_val(fields).unwrap_or(Value::Null);
    Ok(fields
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|f| matches!(f.get("kind").and_then(Value::as_str), Some("entry" | "entries")))
                .filter_map(|f| f.get("id").and_then(Value::as_str).map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

/// Collects every string inside a field value (a string, or an array of strings).
fn strings_in(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

pub fn replace_links(conn: &Connection, kind: &str, source: &str, links: &[(String, String)]) -> CmdResult<()> {
    conn.execute("DELETE FROM links WHERE source_kind = ?1 AND source_id = ?2", params![kind, source])
        .map_err(err)?;
    let mut stmt = conn
        .prepare("INSERT OR IGNORE INTO links (source_kind, source_id, target_id, via) VALUES (?1, ?2, ?3, ?4)")
        .map_err(err)?;
    for (target, via) in links {
        if target != source {
            stmt.execute(params![kind, source, target, via]).map_err(err)?;
        }
    }
    Ok(())
}

pub fn replace_search(conn: &Connection, kind: &str, id: &str, title: &str, body: &str) -> CmdResult<()> {
    conn.execute("DELETE FROM search WHERE kind = ?1 AND id = ?2", params![kind, id]).map_err(err)?;
    conn.execute(
        "INSERT INTO search (kind, id, title, body) VALUES (?1, ?2, ?3, ?4)",
        params![kind, id, title, body],
    )
    .map(|_| ())
    .map_err(err)
}

#[tauri::command]
pub fn list_types(state: State<AppState>) -> CmdResult<Vec<EntryType>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare("SELECT id, name, plural, icon, color, sort, fields FROM entry_types ORDER BY sort, name")
            .map_err(err)?;
        let rows = stmt.query_map([], type_from_row).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[tauri::command]
pub fn save_type(state: State<AppState>, entry_type: EntryType) -> CmdResult<()> {
    state.with(|w| save_type_inner(&w.conn, &entry_type))
}

#[tauri::command]
pub fn delete_type(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| {
        let count: i64 = w
            .conn
            .query_row("SELECT COUNT(*) FROM entries WHERE type_id = ?1", [&id], |r| r.get(0))
            .map_err(err)?;
        if count > 0 {
            return Err(format!("This type still has {count} entries. Move or delete them first."));
        }
        w.conn.execute("DELETE FROM entry_types WHERE id = ?1", [&id]).map_err(err)?;
        Ok(())
    })
}

#[tauri::command]
pub fn list_entries(state: State<AppState>) -> CmdResult<Vec<EntrySummary>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT id, type_id, title, aliases, summary, tags, image, updated_at, emoji
                 FROM entries ORDER BY title COLLATE NOCASE",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(EntrySummary {
                    id: r.get(0)?,
                    type_id: r.get(1)?,
                    title: r.get(2)?,
                    aliases: json_vec(r.get(3)?),
                    summary: r.get(4)?,
                    tags: json_vec(r.get(5)?),
                    image: r.get(6)?,
                    updated_at: r.get(7)?,
                    emoji: r.get(8)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[tauri::command]
pub fn get_entry(state: State<AppState>, id: String) -> CmdResult<Entry> {
    state.with(|w| load_entry(&w.conn, &id).map_err(err))
}

fn load_entry(conn: &Connection, id: &str) -> rusqlite::Result<Entry> {
    conn
        .query_row(
            "SELECT id, type_id, title, aliases, summary, body, fields, tags, image, visibility,
                    created_at, updated_at, emoji
             FROM entries WHERE id = ?1",
            [id],
            |r| {
                Ok(Entry {
                    id: r.get(0)?,
                    type_id: r.get(1)?,
                    title: r.get(2)?,
                    aliases: json_vec(r.get(3)?),
                    summary: r.get(4)?,
                    body: json_val(r.get(5)?),
                    fields: json_val(r.get(6)?).unwrap_or(Value::Object(Default::default())),
                    tags: json_vec(r.get(7)?),
                    image: r.get(8)?,
                    visibility: r.get(9)?,
                    created_at: r.get(10)?,
                    updated_at: r.get(11)?,
                    emoji: r.get(12)?,
                })
            },
        )
}

#[tauri::command]
pub fn save_entry(state: State<AppState>, entry: Entry) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO entries (id, type_id, title, aliases, summary, body, fields, tags, image, visibility, emoji)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               type_id = excluded.type_id, title = excluded.title, aliases = excluded.aliases,
               summary = excluded.summary, body = excluded.body, fields = excluded.fields,
               tags = excluded.tags, image = excluded.image, visibility = excluded.visibility,
               emoji = excluded.emoji, updated_at = datetime('now')",
            params![
                entry.id,
                entry.type_id,
                entry.title,
                serde_json::to_string(&entry.aliases).map_err(err)?,
                entry.summary,
                entry.body.as_ref().map(Value::to_string),
                entry.fields.to_string(),
                serde_json::to_string(&entry.tags).map_err(err)?,
                entry.image,
                entry.visibility,
                entry.emoji,
            ],
        )
        .map_err(err)?;

        let extracted = entry.body.as_ref().map(db::extract).unwrap_or_default();
        let mut links: Vec<(String, String)> =
            extracted.mentions.iter().map(|m| (m.clone(), "mention".to_string())).collect();
        let link_fields = link_field_ids(&tx, &entry.type_id)?;
        let mut field_text = String::new();
        if let Some(obj) = entry.fields.as_object() {
            for (key, value) in obj {
                if value.get("type").and_then(Value::as_str) == Some("doc") {
                    // Rich paragraph field: index its text and treat its @mentions as links via this field.
                    let rich = db::extract(value);
                    links.extend(rich.mentions.into_iter().map(|t| (t, key.clone())));
                    field_text.push_str(&rich.text);
                } else if link_fields.contains(key) {
                    links.extend(strings_in(value).into_iter().map(|t| (t, key.clone())));
                } else {
                    for s in strings_in(value) {
                        field_text.push_str(&s);
                        field_text.push('\n');
                    }
                    if let Some(n) = value.as_f64() {
                        field_text.push_str(&format!("{n}\n"));
                    }
                }
            }
        }
        replace_links(&tx, "entry", &entry.id, &links)?;

        let title = std::iter::once(entry.title.as_str())
            .chain(entry.aliases.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        let body = format!("{}\n{}\n{}\n{}", entry.summary, extracted.text, field_text, entry.tags.join(" "));
        replace_search(&tx, "entry", &entry.id, &title, &body)?;
        tx.commit().map_err(err)
    })
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        tx.execute("DELETE FROM entries WHERE id = ?1", [&id]).map_err(err)?;
        tx.execute("DELETE FROM links WHERE (source_kind = 'entry' AND source_id = ?1) OR target_id = ?1", [&id])
            .map_err(err)?;
        tx.execute("DELETE FROM search WHERE kind = 'entry' AND id = ?1", [&id]).map_err(err)?;
        tx.commit().map_err(err)
    })
}

/// Everything that points at `id`: entries that mention or link to it, and manuscript documents.
#[tauri::command]
pub fn backlinks(state: State<AppState>, id: String) -> CmdResult<Vec<Backlink>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT l.source_kind, l.source_id, e.title, e.type_id, l.via
                   FROM links l JOIN entries e ON e.id = l.source_id
                  WHERE l.target_id = ?1 AND l.source_kind = 'entry'
                 UNION ALL
                 SELECT l.source_kind, l.source_id, d.title, d.project_id, l.via
                   FROM links l JOIN docs d ON d.id = l.source_id
                  WHERE l.target_id = ?1 AND l.source_kind = 'doc'
                 UNION ALL
                 SELECT l.source_kind, l.source_id, m.title, '', l.via
                   FROM links l JOIN maps m ON m.id = l.source_id
                  WHERE l.target_id = ?1 AND l.source_kind = 'map'
                 ORDER BY 1, 3",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([&id], |r| {
                Ok(Backlink {
                    source_kind: r.get(0)?,
                    source_id: r.get(1)?,
                    title: r.get(2)?,
                    parent_id: r.get(3)?,
                    via: r.get(4)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[tauri::command]
pub fn search(state: State<AppState>, query: String, limit: Option<i64>) -> CmdResult<Vec<SearchHit>> {
    let Some(q) = db::fts_query(&query) else { return Ok(vec![]) };
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT kind, id, title, snippet(search, 3, '[', ']', '…', 12)
                   FROM search WHERE search MATCH ?1
                  ORDER BY bm25(search, 0, 0, 8.0, 1.0) LIMIT ?2",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![q, limit.unwrap_or(30)], |r| {
                Ok(SearchHit { kind: r.get(0)?, id: r.get(1)?, title: r.get(2)?, snippet: r.get(3)? })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

/// How many distinct entries or documents link to each entry. Entries missing
/// from the map have no incoming links at all.
#[tauri::command]
pub fn incoming_link_counts(state: State<AppState>) -> CmdResult<std::collections::HashMap<String, i64>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare("SELECT target_id, COUNT(DISTINCT source_kind || source_id) FROM links GROUP BY target_id")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct GraphLink {
    pub source_kind: String,
    pub source_id: String,
    pub target_id: String,
    /// "mention", or the id of the link field (which names the relationship).
    pub via: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct GraphDoc {
    pub id: String,
    pub project_id: String,
    pub title: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct Graph {
    pub links: Vec<GraphLink>,
    pub docs: Vec<GraphDoc>,
}

/// Every link in the world (one per source, target and kind of link), plus the documents
/// that mention entries, for the graph view and family trees.
#[tauri::command]
pub fn link_graph(state: State<AppState>) -> CmdResult<Graph> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT DISTINCT l.source_kind, l.source_id, l.target_id, l.via FROM links l
                  WHERE l.target_id IN (SELECT id FROM entries)
                    AND (l.source_kind = 'doc' OR l.source_id IN (SELECT id FROM entries))",
            )
            .map_err(err)?;
        let links = stmt
            .query_map([], |r| Ok(GraphLink { source_kind: r.get(0)?, source_id: r.get(1)?, target_id: r.get(2)?, via: r.get(3)? }))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut stmt = w
            .conn
            .prepare(
                "SELECT d.id, d.project_id, d.title FROM docs d
                  WHERE d.id IN (SELECT source_id FROM links WHERE source_kind = 'doc')",
            )
            .map_err(err)?;
        let docs = stmt
            .query_map([], |r| Ok(GraphDoc { id: r.get(0)?, project_id: r.get(1)?, title: r.get(2)? }))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(Graph { links, docs })
    })
}

// ---- Versions of entries ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct EntryVersionSummary {
    pub id: String,
    pub name: String,
    pub automatic: bool,
    pub word_count: i64,
    pub created_at: String,
}

/// Automatic versions kept per entry; named ones are never pruned.
const KEEP_AUTOMATIC_VERSIONS: i64 = 30;

/// Everything the author writes in an entry (not its category or sharing setting).
fn version_data(e: &Entry) -> String {
    serde_json::json!({
        "title": e.title, "aliases": e.aliases, "summary": e.summary, "body": e.body,
        "fields": e.fields, "tags": e.tags, "image": e.image, "emoji": e.emoji,
    })
    .to_string()
}

/// Saves the entry as it is now. An automatic version is skipped if nothing changed since the
/// last version; returns whether one was saved.
pub(crate) fn save_entry_version(conn: &Connection, id: &str, entry_id: &str, name: &str, automatic: bool) -> CmdResult<bool> {
    let entry = load_entry(conn, entry_id).map_err(err)?;
    let data = version_data(&entry);
    if automatic {
        let last: Option<String> = conn
            .query_row(
                "SELECT data FROM entry_versions WHERE entry_id = ?1 ORDER BY created_at DESC LIMIT 1",
                [entry_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if last.as_deref() == Some(data.as_str()) {
            return Ok(false);
        }
    }
    let words = entry.body.as_ref().map(|b| db::extract(b).text.split_whitespace().count()).unwrap_or(0) as i64;
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO entry_versions (id, entry_id, name, automatic, data, word_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, entry_id, name, automatic, data, words],
    )
    .map_err(err)?;
    tx.execute(
        "DELETE FROM entry_versions WHERE entry_id = ?1 AND automatic = 1 AND id NOT IN (
           SELECT id FROM entry_versions WHERE entry_id = ?1 AND automatic = 1 ORDER BY created_at DESC LIMIT ?2)",
        params![entry_id, KEEP_AUTOMATIC_VERSIONS],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(true)
}

#[tauri::command]
pub fn create_entry_version(state: State<AppState>, id: String, entry_id: String, name: String, automatic: bool) -> CmdResult<bool> {
    state.with(|w| save_entry_version(&w.conn, &id, &entry_id, &name, automatic))
}

#[tauri::command]
pub fn list_entry_versions(state: State<AppState>, entry_id: String) -> CmdResult<Vec<EntryVersionSummary>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT id, name, automatic, word_count, created_at FROM entry_versions
                  WHERE entry_id = ?1 ORDER BY created_at DESC",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([&entry_id], |r| {
                Ok(EntryVersionSummary {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    automatic: r.get::<_, i64>(2)? != 0,
                    word_count: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

/// A saved version's content: title, aliases, summary, body, fields, tags, image and emoji.
#[tauri::command]
pub fn get_entry_version(state: State<AppState>, id: String) -> CmdResult<Value> {
    state.with(|w| {
        let data: String = w
            .conn
            .query_row("SELECT data FROM entry_versions WHERE id = ?1", [&id], |r| r.get(0))
            .map_err(err)?;
        serde_json::from_str(&data).map_err(err)
    })
}

#[tauri::command]
pub fn rename_entry_version(state: State<AppState>, id: String, name: String) -> CmdResult<()> {
    state.with(|w| {
        w.conn
            .execute("UPDATE entry_versions SET name = ?2, automatic = 0 WHERE id = ?1", params![id, name])
            .map(|_| ())
            .map_err(err)
    })
}

#[tauri::command]
pub fn delete_entry_version(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| w.conn.execute("DELETE FROM entry_versions WHERE id = ?1", [&id]).map(|_| ()).map_err(err))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        db::migrate_for_tests(&conn);
        conn.execute_batch(
            "INSERT INTO entry_types (id, name, plural) VALUES ('t', 'Place', 'Places');
             INSERT INTO entries (id, type_id, title, body) VALUES
               ('e', 't', 'Harbour', '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Old stone quays\"}]}]}');",
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn versions_keep_entry_content_and_skip_unchanged_automatic_ones() {
        let conn = world();
        assert!(save_entry_version(&conn, "v1", "e", "", true).unwrap());
        assert!(!save_entry_version(&conn, "v2", "e", "", true).unwrap(), "nothing changed");
        assert!(save_entry_version(&conn, "v3", "e", "Before the rewrite", false).unwrap(), "named ones are always kept");
        let (data, words): (String, i64) = conn
            .query_row("SELECT data, word_count FROM entry_versions WHERE id = 'v1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        let v: Value = serde_json::from_str(&data).unwrap();
        assert_eq!(v["title"], "Harbour");
        assert_eq!(words, 3);

        conn.execute("UPDATE entries SET summary = 'A busy port.' WHERE id = 'e'", []).unwrap();
        assert!(save_entry_version(&conn, "v4", "e", "", true).unwrap(), "changed since the last version");
    }

    #[test]
    fn automatic_versions_are_thinned_and_go_with_their_entry() {
        let conn = world();
        save_entry_version(&conn, "named", "e", "Keep me", false).unwrap();
        for i in 0..(KEEP_AUTOMATIC_VERSIONS + 5) {
            conn.execute("UPDATE entries SET summary = ?1 WHERE id = 'e'", [format!("Draft {i}")]).unwrap();
            save_entry_version(&conn, &format!("a{i}"), "e", "", true).unwrap();
        }
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM entry_versions WHERE automatic = 1"), KEEP_AUTOMATIC_VERSIONS);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM entry_versions WHERE id = 'named'"), 1);
        conn.execute("DELETE FROM entries WHERE id = 'e'", []).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM entry_versions"), 0);
    }
}
