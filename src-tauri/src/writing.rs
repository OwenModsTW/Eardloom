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
                "SELECT id, project_id, parent_id, kind, title, synopsis, status, word_count, sort
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
                "SELECT id, project_id, parent_id, kind, title, synopsis, status, body, sort, word_count
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
            "INSERT INTO docs (id, project_id, parent_id, kind, title, synopsis, status, body, word_count, sort)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               parent_id = excluded.parent_id, kind = excluded.kind, title = excluded.title,
               synopsis = excluded.synopsis, status = excluded.status, body = excluded.body,
               word_count = excluded.word_count, sort = excluded.sort, updated_at = datetime('now')",
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
