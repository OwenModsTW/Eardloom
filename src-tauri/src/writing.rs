//! Writing projects (books, campaigns, notes) and their binder of folders and documents.

use crate::codex::{replace_links, replace_search};
use crate::db;
use crate::world::{err, AppState, CmdResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub description: String,
    pub sort: i64,
    pub settings: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub synopsis: String,
    pub status: String,
    pub label: String,
    pub word_count: i64,
    pub sort: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Doc {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub synopsis: String,
    pub status: String,
    #[serde(default)]
    pub label: String,
    pub body: Option<Value>,
    pub sort: f64,
    #[serde(default)]
    pub word_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocPosition {
    pub id: String,
    pub parent_id: Option<String>,
    pub sort: f64,
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> CmdResult<Vec<Project>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare("SELECT id, title, kind, description, sort, settings FROM projects ORDER BY sort, title")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                let settings: String = r.get(5)?;
                Ok(Project {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    kind: r.get(2)?,
                    description: r.get(3)?,
                    sort: r.get(4)?,
                    settings: serde_json::from_str(&settings).unwrap_or(Value::Object(Default::default())),
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[tauri::command]
pub fn save_project(state: State<AppState>, project: Project) -> CmdResult<()> {
    state.with(|w| {
        w.conn
            .execute(
                "INSERT INTO projects (id, title, kind, description, sort, settings)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title, kind = excluded.kind, description = excluded.description,
                   sort = excluded.sort, settings = excluded.settings, updated_at = datetime('now')",
                params![project.id, project.title, project.kind, project.description, project.sort, project.settings.to_string()],
            )
            .map(|_| ())
            .map_err(err)
    })
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        tx.execute(
            "DELETE FROM links WHERE source_kind = 'doc' AND source_id IN (SELECT id FROM docs WHERE project_id = ?1)",
            [&id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM search WHERE kind = 'doc' AND id IN (SELECT id FROM docs WHERE project_id = ?1)",
            [&id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM docs WHERE project_id = ?1", [&id]).map_err(err)?;
        tx.execute("DELETE FROM projects WHERE id = ?1", [&id]).map_err(err)?;
        tx.commit().map_err(err)
    })
}

#[tauri::command]
pub fn list_docs(state: State<AppState>, project_id: String) -> CmdResult<Vec<DocSummary>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT id, project_id, parent_id, kind, title, synopsis, status, word_count, sort, label
                   FROM docs WHERE project_id = ?1 ORDER BY sort",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([&project_id], |r| {
                Ok(DocSummary {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    parent_id: r.get(2)?,
                    kind: r.get(3)?,
                    title: r.get(4)?,
                    synopsis: r.get(5)?,
                    status: r.get(6)?,
                    word_count: r.get(7)?,
                    sort: r.get(8)?,
                    label: r.get(9)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[tauri::command]
pub fn get_doc(state: State<AppState>, id: String) -> CmdResult<Doc> {
    state.with(|w| {
        w.conn
            .query_row(
                "SELECT id, project_id, parent_id, kind, title, synopsis, status, body, sort, word_count, label
                   FROM docs WHERE id = ?1",
                [&id],
                |r| {
                    let body: Option<String> = r.get(7)?;
                    Ok(Doc {
                        id: r.get(0)?,
                        project_id: r.get(1)?,
                        parent_id: r.get(2)?,
                        kind: r.get(3)?,
                        title: r.get(4)?,
                        synopsis: r.get(5)?,
                        status: r.get(6)?,
                        body: body.and_then(|b| serde_json::from_str(&b).ok()),
                        sort: r.get(8)?,
                        word_count: r.get(9)?,
                        label: r.get(10)?,
                    })
                },
            )
            .map_err(err)
    })
}

/// Saves a document and returns its new word count.
#[tauri::command]
pub fn save_doc(state: State<AppState>, doc: Doc) -> CmdResult<i64> {
    state.with(|w| {
        let extracted = doc.body.as_ref().map(db::extract).unwrap_or_default();
        let words = db::word_count(&extracted.text);
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO docs (id, project_id, parent_id, kind, title, synopsis, status, body, word_count, sort, label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               parent_id = excluded.parent_id, kind = excluded.kind, title = excluded.title,
               synopsis = excluded.synopsis, status = excluded.status, body = excluded.body,
               word_count = excluded.word_count, sort = excluded.sort, label = excluded.label,
               updated_at = datetime('now')",
            params![
                doc.id,
                doc.project_id,
                doc.parent_id,
                doc.kind,
                doc.title,
                doc.synopsis,
                doc.status,
                doc.body.as_ref().map(Value::to_string),
                words,
                doc.sort,
                doc.label,
            ],
        )
        .map_err(err)?;
        let links: Vec<(String, String)> =
            extracted.mentions.into_iter().map(|m| (m, "mention".to_string())).collect();
        replace_links(&tx, "doc", &doc.id, &links)?;
        replace_search(&tx, "doc", &doc.id, &doc.title, &format!("{}\n{}", doc.synopsis, extracted.text))?;
        tx.commit().map_err(err)?;
        Ok(words)
    })
}

#[tauri::command]
pub fn move_docs(state: State<AppState>, positions: Vec<DocPosition>) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        for p in &positions {
            tx.execute(
                "UPDATE docs SET parent_id = ?2, sort = ?3 WHERE id = ?1",
                params![p.id, p.parent_id, p.sort],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    })
}

/// Deletes a document or folder along with everything nested inside it.
#[tauri::command]
pub fn delete_doc(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        let ids: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "WITH RECURSIVE tree(id) AS (
                        SELECT ?1 UNION ALL SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
                     ) SELECT id FROM tree",
                )
                .map_err(err)?;
            let rows = stmt.query_map([&id], |r| r.get(0)).map_err(err)?;
            rows.collect::<Result<_, _>>().map_err(err)?
        };
        for d in &ids {
            tx.execute("DELETE FROM links WHERE source_kind = 'doc' AND source_id = ?1", [d]).map_err(err)?;
            tx.execute("DELETE FROM search WHERE kind = 'doc' AND id = ?1", [d]).map_err(err)?;
            tx.execute("DELETE FROM docs WHERE id = ?1", [d]).map_err(err)?;
        }
        tx.commit().map_err(err)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDoc {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub word_count: i64,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTotals {
    pub project_id: String,
    pub words: i64,
    pub documents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingOverview {
    pub recent: Vec<RecentDoc>,
    pub totals: Vec<ProjectTotals>,
}

/// What was written last, and how big each project is, for the dashboard.
#[tauri::command]
pub fn writing_overview(state: State<AppState>) -> CmdResult<WritingOverview> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT id, project_id, title, word_count, updated_at FROM docs
                  WHERE kind = 'text' ORDER BY updated_at DESC LIMIT 5",
            )
            .map_err(err)?;
        let recent = stmt
            .query_map([], |r| {
                Ok(RecentDoc { id: r.get(0)?, project_id: r.get(1)?, title: r.get(2)?, word_count: r.get(3)?, updated_at: r.get(4)? })
            })
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        let mut stmt = w
            .conn
            .prepare("SELECT project_id, SUM(word_count), COUNT(*) FROM docs WHERE kind = 'text' GROUP BY project_id")
            .map_err(err)?;
        let totals = stmt
            .query_map([], |r| Ok(ProjectTotals { project_id: r.get(0)?, words: r.get(1)?, documents: r.get(2)? }))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        Ok(WritingOverview { recent, totals })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: String,
    pub name: String,
    pub automatic: bool,
    pub word_count: i64,
    pub created_at: String,
}

/// Automatic snapshots kept per document; named ones are never pruned.
const KEEP_AUTOMATIC: i64 = 25;

/// Saves the document's current text as a snapshot.
#[tauri::command]
pub fn create_snapshot(state: State<AppState>, id: String, doc_id: String, name: String, automatic: bool) -> CmdResult<()> {
    state.with(|w| {
        let tx = w.conn.unchecked_transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO snapshots (id, doc_id, name, automatic, body, word_count)
             SELECT ?1, id, ?3, ?4, body, word_count FROM docs WHERE id = ?2",
            params![id, doc_id, name, automatic],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM snapshots WHERE doc_id = ?1 AND automatic = 1 AND id NOT IN (
               SELECT id FROM snapshots WHERE doc_id = ?1 AND automatic = 1 ORDER BY created_at DESC LIMIT ?2)",
            params![doc_id, KEEP_AUTOMATIC],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    })
}

#[tauri::command]
pub fn list_snapshots(state: State<AppState>, doc_id: String) -> CmdResult<Vec<SnapshotSummary>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT id, name, automatic, word_count, created_at FROM snapshots
                  WHERE doc_id = ?1 ORDER BY created_at DESC",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([&doc_id], |r| {
                Ok(SnapshotSummary {
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

#[tauri::command]
pub fn get_snapshot_body(state: State<AppState>, id: String) -> CmdResult<Option<Value>> {
    state.with(|w| {
        let body: Option<String> = w
            .conn
            .query_row("SELECT body FROM snapshots WHERE id = ?1", [&id], |r| r.get(0))
            .map_err(err)?;
        Ok(body.and_then(|b| serde_json::from_str(&b).ok()))
    })
}

#[tauri::command]
pub fn rename_snapshot(state: State<AppState>, id: String, name: String) -> CmdResult<()> {
    state.with(|w| {
        w.conn
            .execute("UPDATE snapshots SET name = ?2, automatic = 0 WHERE id = ?1", params![id, name])
            .map(|_| ())
            .map_err(err)
    })
}

#[tauri::command]
pub fn delete_snapshot(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| w.conn.execute("DELETE FROM snapshots WHERE id = ?1", [&id]).map(|_| ()).map_err(err))
}

#[cfg(test)]
mod tests {
    use crate::db;
    use rusqlite::params;

    #[test]
    fn snapshots_follow_their_document_and_prune_automatic_ones() {
        let path = std::env::temp_dir().join(format!("eardloom-snap-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(&path).unwrap();
        conn.execute_batch(
            "INSERT INTO projects (id, title) VALUES ('p', 'Book');
             INSERT INTO docs (id, project_id, title, body, word_count) VALUES ('d', 'p', 'Ch 1', '{\"type\":\"doc\"}', 3);",
        )
        .unwrap();
        for i in 0..30 {
            conn.execute(
                "INSERT INTO snapshots (id, doc_id, automatic, created_at) VALUES (?1, 'd', 1, ?2)",
                params![format!("a{i}"), format!("2026-01-01 00:00:{i:02}")],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO snapshots (id, doc_id, name) VALUES ('named', 'd', 'Draft 1')", []).unwrap();
        // Same pruning statement as create_snapshot.
        conn.execute(
            "DELETE FROM snapshots WHERE doc_id = ?1 AND automatic = 1 AND id NOT IN (
               SELECT id FROM snapshots WHERE doc_id = ?1 AND automatic = 1 ORDER BY created_at DESC LIMIT ?2)",
            params!["d", super::KEEP_AUTOMATIC],
        )
        .unwrap();
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM snapshots WHERE automatic = 1"), super::KEEP_AUTOMATIC);
        assert_eq!(count("SELECT COUNT(*) FROM snapshots WHERE id = 'a0'"), 0, "oldest automatic pruned");
        assert_eq!(count("SELECT COUNT(*) FROM snapshots WHERE id = 'named'"), 1, "named kept");
        conn.execute("DELETE FROM docs WHERE id = 'd'", []).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM snapshots"), 0, "deleted with their document");
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}

/// The clipboard's RTF, if any. Some writing apps copy only RTF and
/// plain text, which the webview can't read, so formatting would otherwise be lost.
#[tauri::command]
pub fn clipboard_rtf() -> Option<String> {
    #[cfg(windows)]
    {
        use clipboard_win::{formats, get_clipboard, raw::register_format};
        let format = register_format("Rich Text Format")?;
        let bytes: Vec<u8> = get_clipboard(formats::RawData(format.get())).ok()?;
        // RTF escapes anything outside ASCII, so a lossy decode is exact; drop the trailing NUL.
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        (end > 0).then(|| String::from_utf8_lossy(&bytes[..end]).into_owned())
    }
    #[cfg(not(windows))]
    {
        None
    }
}


/// Card details only: title, synopsis, status and label, without touching the text.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocDetails {
    pub title: Option<String>,
    pub synopsis: Option<String>,
    pub status: Option<String>,
    pub label: Option<String>,
}

#[tauri::command]
pub fn update_doc_details(state: State<AppState>, id: String, details: DocDetails) -> CmdResult<()> {
    state.with(|w| {
        w.conn
            .execute(
                "UPDATE docs SET
                   title = COALESCE(?2, title), synopsis = COALESCE(?3, synopsis),
                   status = COALESCE(?4, status), label = COALESCE(?5, label)
                 WHERE id = ?1",
                params![id, details.title, details.synopsis, details.status, details.label],
            )
            .map(|_| ())
            .map_err(err)
    })
}


#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub doc_id: String,
    pub body: String,
    pub resolved: bool,
    #[serde(default)]
    pub created_at: String,
}

#[tauri::command]
pub fn list_comments(state: State<AppState>, doc_id: String) -> CmdResult<Vec<Comment>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare("SELECT id, doc_id, body, resolved, created_at FROM comments WHERE doc_id = ?1 ORDER BY created_at")
            .map_err(err)?;
        let rows = stmt
            .query_map([&doc_id], |r| {
                Ok(Comment {
                    id: r.get(0)?,
                    doc_id: r.get(1)?,
                    body: r.get(2)?,
                    resolved: r.get::<_, i64>(3)? != 0,
                    created_at: r.get(4)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}

#[tauri::command]
pub fn save_comment(state: State<AppState>, comment: Comment) -> CmdResult<()> {
    state.with(|w| {
        w.conn
            .execute(
                "INSERT INTO comments (id, doc_id, body, resolved) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET body = excluded.body, resolved = excluded.resolved",
                params![comment.id, comment.doc_id, comment.body, comment.resolved],
            )
            .map(|_| ())
            .map_err(err)
    })
}

#[tauri::command]
pub fn delete_comment(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with(|w| w.conn.execute("DELETE FROM comments WHERE id = ?1", [&id]).map(|_| ()).map_err(err))
}

/// Comment counts per document, for badges in the binder.
#[tauri::command]
pub fn comment_counts(state: State<AppState>, project_id: String) -> CmdResult<std::collections::HashMap<String, i64>> {
    state.with(|w| {
        let mut stmt = w
            .conn
            .prepare(
                "SELECT c.doc_id, COUNT(*) FROM comments c JOIN docs d ON d.id = c.doc_id
                  WHERE d.project_id = ?1 AND c.resolved = 0 GROUP BY c.doc_id",
            )
            .map_err(err)?;
        let rows = stmt.query_map([&project_id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
}
