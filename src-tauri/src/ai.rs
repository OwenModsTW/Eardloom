//! The in-app assistant.
//!
//! Eardloom runs the author's own installed AI tool (Claude Code) in the background
//! and streams the conversation into the app. The AI reaches the world only through
//! a small local MCP server with Eardloom's own tools. It can read, and it can
//! *propose* changes, which the author approves in the app. By design it has no
//! way to write chapters: it helps with worldbuilding, reviews and suggestions.

use crate::db;
use crate::timeline;
use crate::world::{err, get_meta, AppState, CmdResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Suggestions to chapter text are capped so the assistant edits lines, not writes prose.
const MAX_EDIT_WORDS: usize = 60;
/// Worldbuilding text the assistant may propose for an entry's article in one go.
const MAX_ARTICLE_WORDS: usize = 400;

#[derive(Default)]
pub struct AiState {
    server: Mutex<Option<(u16, String)>>,
    process: Mutex<Option<(Child, ChildStdin)>>,
    pending: Mutex<HashMap<String, Sender<String>>>,
    include_private: Mutex<bool>,
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("system random source");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------- world reading

fn words(s: &str) -> usize {
    s.split_whitespace().count()
}

fn private_filter(include_private: bool) -> &'static str {
    if include_private { "" } else { " AND e.visibility != 'private'" }
}

fn types(conn: &Connection) -> CmdResult<Vec<(String, String, String, Value)>> {
    let mut stmt = conn.prepare("SELECT id, name, plural, fields FROM entry_types ORDER BY sort, name").map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let f: String = r.get(3)?;
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, serde_json::from_str(&f).unwrap_or(Value::Null)))
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

fn title_of(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row("SELECT title FROM entries WHERE id = ?1", [id], |r| r.get(0)).optional().ok().flatten()
}

fn calendar(conn: &Connection) -> Value {
    serde_json::from_str(&get_meta(conn, "calendar").unwrap_or_default()).unwrap_or(Value::Null)
}

fn format_date(cal: &Value, d: &Value) -> String {
    let point = |p: &Value| {
        let year = p.get("year").and_then(Value::as_f64).map(|y| y as i64).unwrap_or(0);
        let era = p
            .get("era")
            .and_then(Value::as_str)
            .and_then(|id| cal.get("eras")?.as_array()?.iter().find(|e| e.get("id").and_then(Value::as_str) == Some(id)))
            .and_then(|e| e.get("name").and_then(Value::as_str))
            .map(|n| format!(", {n}"))
            .unwrap_or_default();
        let month = p
            .get("month")
            .and_then(Value::as_u64)
            .and_then(|m| cal.get("months")?.as_array()?.get(m as usize)?.get("name")?.as_str().map(String::from));
        let day = p.get("day").and_then(Value::as_u64);
        match (day, month) {
            (Some(d), Some(m)) => format!("{d} {m}, year {year}{era}"),
            (None, Some(m)) => format!("{m}, year {year}{era}"),
            _ => format!("year {year}{era}"),
        }
    };
    let mut s = point(d);
    if let Some(end) = d.get("end").filter(|e| e.is_object()) {
        s = format!("{s} to {}", point(end));
    }
    if d.get("approx").and_then(Value::as_bool) == Some(true) {
        s = format!("around {s}");
    }
    s
}

fn field_value(conn: &Connection, cal: &Value, kind: &str, v: &Value) -> Option<String> {
    if v.is_null() || v == &json!("") || v.as_array().is_some_and(|a| a.is_empty()) {
        return None;
    }
    Some(match kind {
        "entry" | "entries" => {
            let ids: Vec<String> = match v {
                Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                Value::String(s) => vec![s.clone()],
                _ => vec![],
            };
            let names: Vec<String> = ids.iter().filter_map(|id| title_of(conn, id)).collect();
            if names.is_empty() {
                return None;
            }
            names.join(", ")
        }
        "worlddate" => format_date(cal, v),
        "longtext" if v.is_object() => db::extract(v).text.trim().to_string(),
        _ => match v {
            Value::Array(a) => a.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect::<Vec<_>>().join(", "),
            Value::String(s) => s.clone(),
            Value::Bool(b) => if *b { "Yes".into() } else { "No".into() },
            other => other.to_string(),
        },
    })
}

/// Finds an entry by id, or by exact title or alias (case-insensitive).
fn find_entry(conn: &Connection, key: &str, include_private: bool) -> CmdResult<Option<String>> {
    let pf = private_filter(include_private);
    let by_id: Option<String> =
        conn.query_row(&format!("SELECT e.id FROM entries e WHERE e.id = ?1{pf}"), [key], |r| r.get(0)).optional().map_err(err)?;
    if by_id.is_some() {
        return Ok(by_id);
    }
    let mut stmt = conn.prepare(&format!("SELECT e.id, e.title, e.aliases FROM entries e WHERE 1=1{pf}")).map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
        .map_err(err)?;
    let k = key.trim().to_lowercase();
    for row in rows.flatten() {
        let aliases: Vec<String> = serde_json::from_str(&row.2).unwrap_or_default();
        if row.1.to_lowercase() == k || aliases.iter().any(|a| a.to_lowercase() == k) {
            return Ok(Some(row.0));
        }
    }
    Ok(None)
}

fn world_overview(conn: &Connection, include_private: bool) -> CmdResult<String> {
    let name = get_meta(conn, "name")?;
    let premise = get_meta(conn, "description")?;
    let mut out = format!("World: {name}\n");
    if !premise.is_empty() {
        out += &format!("Premise: {premise}\n");
    }
    out += "\nCategories (and the fields each tracks):\n";
    for (id, tname, plural, fields) in types(conn)? {
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM entries e WHERE e.type_id = ?1{}", private_filter(include_private)), [&id], |r| r.get(0))
            .map_err(err)?;
        let labels: Vec<String> = fields
            .as_array()
            .map(|a| a.iter().filter_map(|f| Some(format!("{} ({})", f.get("label")?.as_str()?, f.get("kind")?.as_str()?))).collect())
            .unwrap_or_default();
        out += &format!("- {plural} [one: {tname}]: {n} entries. Fields: {}\n", if labels.is_empty() { "none".into() } else { labels.join("; ") });
    }
    let cal = calendar(conn);
    if let Some(eras) = cal.get("eras").and_then(Value::as_array).filter(|e| !e.is_empty()) {
        let list: Vec<String> = eras
            .iter()
            .filter_map(|e| {
                let n = e.get("name")?.as_str()?;
                Some(match e.get("length").and_then(Value::as_f64) {
                    Some(l) => format!("{n} ({l} years)"),
                    None => format!("{n} (ongoing)"),
                })
            })
            .collect();
        out += &format!("\nCalendar eras, in order: {}\n", list.join(" → "));
    }
    let mut stmt = conn.prepare("SELECT p.id, p.title, (SELECT COUNT(*) FROM docs d WHERE d.project_id = p.id AND d.kind = 'text') FROM projects p ORDER BY p.sort").map_err(err)?;
    let books: Vec<(String, String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(err)?.flatten().collect();
    if !books.is_empty() {
        out += "\nBooks:\n";
        for (id, title, n) in books {
            out += &format!("- {title} ({n} chapters) [id {id}]\n");
        }
    }
    Ok(out)
}

fn list_entries(conn: &Connection, category: Option<&str>, include_private: bool) -> CmdResult<String> {
    let pf = private_filter(include_private);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT e.id, e.title, e.summary, t.name, t.plural FROM entries e JOIN entry_types t ON t.id = e.type_id WHERE 1=1{pf} ORDER BY t.sort, e.title COLLATE NOCASE"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)))
        .map_err(err)?;
    let wanted = category.map(|c| c.trim().to_lowercase());
    let mut out = String::new();
    let mut n = 0;
    for (id, title, summary, tname, plural) in rows.flatten() {
        if let Some(w) = &wanted {
            if tname.to_lowercase() != *w && plural.to_lowercase() != *w {
                continue;
            }
        }
        n += 1;
        out += &format!("- {title} ({tname}) [id {id}]{}\n", if summary.is_empty() { String::new() } else { format!(": {summary}") });
    }
    Ok(if n == 0 { "No entries found.".into() } else { out })
}

fn read_entry(conn: &Connection, key: &str, include_private: bool) -> CmdResult<String> {
    let Some(id) = find_entry(conn, key, include_private)? else {
        return Ok(format!("No entry called \"{key}\". Use search or list_entries to find it."));
    };
    let (title, type_id, aliases, summary, body, fields, tags): (String, String, String, String, Option<String>, String, String) = conn
        .query_row("SELECT title, type_id, aliases, summary, body, fields, tags FROM entries WHERE id = ?1", [&id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })
        .map_err(err)?;
    let types = types(conn)?;
    let ty = types.iter().find(|t| t.0 == type_id);
    let cal = calendar(conn);
    let mut out = format!("# {title}\nCategory: {}\nId: {id}\n", ty.map(|t| t.1.as_str()).unwrap_or("?"));
    let aliases: Vec<String> = serde_json::from_str(&aliases).unwrap_or_default();
    if !aliases.is_empty() {
        out += &format!("Also known as: {}\n", aliases.join(", "));
    }
    let tags: Vec<String> = serde_json::from_str(&tags).unwrap_or_default();
    if !tags.is_empty() {
        out += &format!("Tags: {}\n", tags.join(", "));
    }
    if !summary.is_empty() {
        out += &format!("Summary: {summary}\n");
    }
    let values: Value = serde_json::from_str(&fields).unwrap_or(Value::Null);
    if let Some(defs) = ty.and_then(|t| t.3.as_array()) {
        let mut lines = Vec::new();
        for f in defs {
            let (Some(fid), Some(label), Some(kind)) = (f.get("id").and_then(Value::as_str), f.get("label").and_then(Value::as_str), f.get("kind").and_then(Value::as_str)) else { continue };
            if let Some(v) = values.get(fid).and_then(|v| field_value(conn, &cal, kind, v)) {
                lines.push(format!("- {label}: {v}"));
            }
        }
        if !lines.is_empty() {
            out += &format!("\nFields:\n{}\n", lines.join("\n"));
        }
    }
    let article = body.and_then(|b| serde_json::from_str::<Value>(&b).ok()).map(|b| db::extract(&b).text).unwrap_or_default();
    out += &format!("\nArticle:\n{}\n", if article.trim().is_empty() { "(empty)".into() } else { article.trim().to_string() });
    let mut stmt = conn
        .prepare(&format!(
            "SELECT DISTINCT e.title FROM links l JOIN entries e ON e.id = l.source_id WHERE l.target_id = ?1 AND l.source_kind = 'entry'{}",
            private_filter(include_private)
        ))
        .map_err(err)?;
    let refs: Vec<String> = stmt.query_map([&id], |r| r.get(0)).map_err(err)?.flatten().collect();
    if !refs.is_empty() {
        out += &format!("\nReferenced by: {}\n", refs.join(", "));
    }
    Ok(out)
}

fn read_timeline(conn: &Connection) -> CmdResult<String> {
    let cal = calendar(conn);
    let items = timeline::collect(conn)?;
    if items.is_empty() {
        return Ok("Nothing in this world has a timeline date yet.".into());
    }
    let types = types(conn)?;
    let mut lines: Vec<String> = items
        .iter()
        .map(|it| {
            let label = types
                .iter()
                .find(|t| t.0 == it.type_id)
                .and_then(|t| t.3.as_array()?.iter().find(|f| f.get("id").and_then(Value::as_str) == Some(&it.field_id))?.get("label")?.as_str().map(String::from))
                .unwrap_or_default();
            format!("- {}: {} ({label})", format_date(&cal, &it.date), it.title)
        })
        .collect();
    lines.sort();
    Ok(lines.join("\n"))
}

fn list_books(conn: &Connection) -> CmdResult<String> {
    let mut out = String::new();
    let mut stmt = conn.prepare("SELECT id, title FROM projects ORDER BY sort").map_err(err)?;
    let books: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.flatten().collect();
    for (pid, title) in books {
        out += &format!("## {title} [id {pid}]\n");
        let mut s = conn
            .prepare("SELECT id, parent_id, kind, title, synopsis, status, word_count FROM docs WHERE project_id = ?1 ORDER BY sort")
            .map_err(err)?;
        let docs: Vec<(String, Option<String>, String, String, String, String, i64)> = s
            .query_map([&pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
            .map_err(err)?
            .flatten()
            .collect();
        fn walk(out: &mut String, docs: &[(String, Option<String>, String, String, String, String, i64)], parent: Option<&str>, depth: usize) {
            for d in docs.iter().filter(|d| d.1.as_deref() == parent) {
                let pad = "  ".repeat(depth);
                if d.2 == "folder" {
                    *out += &format!("{pad}- [folder] {}\n", d.3);
                } else {
                    *out += &format!("{pad}- {} [chapter id {}] {} words{}\n", d.3, d.0, d.6, if d.4.is_empty() { String::new() } else { format!(". Synopsis: {}", d.4) });
                }
                walk(out, docs, Some(&d.0), depth + 1);
            }
        }
        walk(&mut out, &docs, None, 0);
    }
    Ok(if out.is_empty() { "No books yet.".into() } else { out })
}

fn read_chapter(conn: &Connection, id: &str) -> CmdResult<String> {
    let row: Option<(String, Option<String>)> = conn
        .query_row("SELECT title, body FROM docs WHERE id = ?1 AND kind = 'text'", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(err)?;
    let Some((title, body)) = row else { return Ok("No chapter with that id. Use list_books to find chapter ids.".into()) };
    let text = body.and_then(|b| serde_json::from_str::<Value>(&b).ok()).map(|b| db::extract(&b).text).unwrap_or_default();
    let paragraphs: Vec<String> = text.lines().map(str::trim).filter(|l| !l.is_empty()).enumerate().map(|(i, p)| format!("[{}] {p}", i + 1)).collect();
    Ok(format!("# {title}\n\n{}", if paragraphs.is_empty() { "(empty)".into() } else { paragraphs.join("\n\n") }))
}

fn search(conn: &Connection, query: &str, include_private: bool) -> CmdResult<String> {
    let Some(q) = db::fts_query(query) else { return Ok("Give some words to search for.".into()) };
    let mut stmt = conn
        .prepare("SELECT kind, id, title, snippet(search, 3, '', '', '…', 16) FROM search WHERE search MATCH ?1 ORDER BY bm25(search, 0, 0, 8.0, 1.0) LIMIT 25")
        .map_err(err)?;
    let rows: Vec<(String, String, String, String)> = stmt.query_map(params![q], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(err)?.flatten().collect();
    let mut out = String::new();
    for (kind, id, title, snip) in rows {
        if kind == "entry" && !include_private {
            let private: bool = conn.query_row("SELECT visibility = 'private' FROM entries WHERE id = ?1", [&id], |r| r.get(0)).unwrap_or(false);
            if private {
                continue;
            }
        }
        let what = if kind == "doc" { "chapter" } else { "entry" };
        out += &format!("- {title} ({what}) [id {id}]: {}\n", snip.replace('\n', " "));
    }
    Ok(if out.is_empty() { "No matches.".into() } else { out })
}

// ---------------------------------------------------------------- MCP tools

fn tools() -> Value {
    let s = |props: Value, required: &[&str]| json!({ "type": "object", "properties": props, "required": required });
    json!([
        { "name": "world_overview", "description": "The world's name, premise, categories with their fields, calendar eras and books. Start here.", "inputSchema": s(json!({}), &[]) },
        { "name": "search", "description": "Full-text search across entries and chapters.", "inputSchema": s(json!({ "query": { "type": "string" } }), &["query"]) },
        { "name": "list_entries", "description": "List entries, optionally in one category (e.g. \"Characters\").", "inputSchema": s(json!({ "category": { "type": "string" } }), &[]) },
        { "name": "read_entry", "description": "Read one entry in full: fields, article and what references it. Accepts an id, title or alias.", "inputSchema": s(json!({ "entry": { "type": "string" } }), &["entry"]) },
        { "name": "read_timeline", "description": "Everything in the world that has a timeline date, in order.", "inputSchema": s(json!({}), &[]) },
        { "name": "list_books", "description": "The author's books with their chapters, synopses and chapter ids.", "inputSchema": s(json!({}), &[]) },
        { "name": "read_chapter", "description": "Read a chapter, with numbered paragraphs, so you can review it.", "inputSchema": s(json!({ "chapter_id": { "type": "string" } }), &["chapter_id"]) },
        { "name": "propose_new_entry", "description": "Propose a new codex entry. The author approves it before it's created. Field values are keyed by field label; link fields take entry names. Articles are capped at 400 words.", "inputSchema": s(json!({
            "category": { "type": "string" }, "title": { "type": "string" }, "summary": { "type": "string" },
            "article": { "type": "string", "description": "Plain paragraphs separated by blank lines." },
            "aliases": { "type": "array", "items": { "type": "string" } }, "tags": { "type": "array", "items": { "type": "string" } },
            "fields": { "type": "object", "additionalProperties": true }
        }), &["category", "title"]) },
        { "name": "propose_entry_changes", "description": "Propose changes to an existing entry (summary, fields, aliases, tags, or a few paragraphs added to its article). The author approves them first.", "inputSchema": s(json!({
            "entry": { "type": "string" }, "summary": { "type": "string" }, "add_to_article": { "type": "string" },
            "add_aliases": { "type": "array", "items": { "type": "string" } }, "add_tags": { "type": "array", "items": { "type": "string" } },
            "fields": { "type": "object", "additionalProperties": true }
        }), &["entry"]) },
        { "name": "comment_on_chapter", "description": "Leave a review comment on a passage of a chapter. Quote the passage exactly as it appears.", "inputSchema": s(json!({
            "chapter_id": { "type": "string" }, "quote": { "type": "string" }, "note": { "type": "string" }
        }), &["chapter_id", "quote", "note"]) },
        { "name": "suggest_line_edit", "description": "Suggest replacing a short passage (a sentence or two, at most 60 words) in a chapter. The author decides. Never use this to write new scenes.", "inputSchema": s(json!({
            "chapter_id": { "type": "string" }, "original": { "type": "string" }, "replacement": { "type": "string" }, "reason": { "type": "string" }
        }), &["chapter_id", "original", "replacement"]) }
    ])
}

fn arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Checks a proposal against the assistant's limits before it reaches the author.
fn check_proposal(name: &str, args: &Value) -> Result<(), String> {
    match name {
        "suggest_line_edit" => {
            if words(arg(args, "original")) > MAX_EDIT_WORDS || words(arg(args, "replacement")) > MAX_EDIT_WORDS + 20 {
                return Err(format!(
                    "Too long. Line edits are limited to about {MAX_EDIT_WORDS} words: you're here to suggest, not to write the author's prose. Leave a comment with your advice instead."
                ));
            }
            if arg(args, "original").trim().is_empty() {
                return Err("Quote the original passage exactly.".into());
            }
        }
        "propose_new_entry" | "propose_entry_changes" => {
            let text = format!("{} {}", arg(args, "article"), arg(args, "add_to_article"));
            if words(&text) > MAX_ARTICLE_WORDS {
                return Err(format!("Too long. Keep proposed article text under {MAX_ARTICLE_WORDS} words; the author writes the rest."));
            }
        }
        _ => {}
    }
    Ok(())
}

fn call_tool(app: &AppHandle, name: &str, args: &Value) -> Result<String, String> {
    let ai = app.state::<AiState>();
    let include_private = *ai.include_private.lock().map_err(err)?;
    let state = app.state::<AppState>();
    let read = |f: &dyn Fn(&Connection) -> CmdResult<String>| state.with(|w| f(&w.conn));
    match name {
        "world_overview" => read(&|c| world_overview(c, include_private)),
        "search" => read(&|c| search(c, arg(args, "query"), include_private)),
        "list_entries" => read(&|c| list_entries(c, args.get("category").and_then(Value::as_str), include_private)),
        "read_entry" => read(&|c| read_entry(c, arg(args, "entry"), include_private)),
        "read_timeline" => read(&timeline_text),
        "list_books" => read(&list_books),
        "read_chapter" => read(&|c| read_chapter(c, arg(args, "chapter_id"))),
        "propose_new_entry" | "propose_entry_changes" | "comment_on_chapter" | "suggest_line_edit" => {
            check_proposal(name, args)?;
            // Hand the proposal to the app and wait for the author's decision.
            let id = random_token();
            let (tx, rx) = channel();
            ai.pending.lock().map_err(err)?.insert(id.clone(), tx);
            app.emit("ai://proposal", json!({ "id": id, "tool": name, "args": args })).map_err(err)?;
            let outcome = rx.recv_timeout(Duration::from_secs(30 * 60)).unwrap_or_else(|_| "The author didn't respond.".into());
            ai.pending.lock().map_err(err)?.remove(&id);
            Ok(outcome)
        }
        _ => Err(format!("Unknown tool {name}")),
    }
}

fn timeline_text(c: &Connection) -> CmdResult<String> {
    read_timeline(c)
}

const INSTRUCTIONS: &str = "Eardloom's world tools. Read before you answer; propose changes rather than assuming them.";

/// One MCP JSON-RPC message in, one response (or none, for notifications) out.
fn handle_rpc(app: &AppHandle, msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "eardloom", "version": app.package_info().version.to_string() },
            "instructions": INSTRUCTIONS
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = msg.pointer("/params/name").and_then(Value::as_str).unwrap_or("");
            let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            Ok(match call_tool(app, name, &args) {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
            })
        }
        _ => Err(json!({ "code": -32601, "message": format!("Method not found: {method}") })),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    })
}

/// Starts the local MCP server once, on a random port, guarded by a random token.
fn ensure_server(app: &AppHandle) -> CmdResult<(u16, String)> {
    let ai = app.state::<AiState>();
    let mut guard = ai.server.lock().map_err(err)?;
    if let Some(s) = guard.clone() {
        return Ok(s);
    }
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(err)?;
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("No port")?;
    let token = random_token();
    let expected = format!("Bearer {token}");
    let app = app.clone();
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let app = app.clone();
            let expected = expected.clone();
            // Each request on its own thread: a proposal waits for the author without blocking reads.
            std::thread::spawn(move || {
                let authorised = req.headers().iter().any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
                if !authorised {
                    let _ = req.respond(tiny_http::Response::empty(401));
                    return;
                }
                if req.method() != &tiny_http::Method::Post {
                    let _ = req.respond(tiny_http::Response::empty(405));
                    return;
                }
                let mut body = String::new();
                let _ = req.as_reader().take(4 * 1024 * 1024).read_to_string(&mut body);
                let msg: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let reply = match &msg {
                    Value::Array(batch) => {
                        let replies: Vec<Value> = batch.iter().filter_map(|m| handle_rpc(&app, m)).collect();
                        (!replies.is_empty()).then(|| Value::Array(replies))
                    }
                    m => handle_rpc(&app, m),
                };
                let json_type = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("header");
                let _ = match reply {
                    Some(r) => req.respond(tiny_http::Response::from_string(r.to_string()).with_header(json_type)),
                    None => req.respond(tiny_http::Response::empty(202)),
                };
            });
        }
    });
    *guard = Some((port, token.clone()));
    Ok((port, token))
}

// ---------------------------------------------------------------- running Claude Code

/// Where the author's Claude Code is installed, if it is.
fn find_claude() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let exe = dir.join("claude.exe");
        if exe.is_file() {
            return Some(exe);
        }
        // npm installs a claude.cmd shim next to node_modules.
        let shim = dir.join("claude.cmd");
        if shim.is_file() {
            let real = dir.join("node_modules").join("@anthropic-ai").join("claude-code").join("bin").join("claude.exe");
            if real.is_file() {
                return Some(real);
            }
        }
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from)?;
    let native = home.join(".local").join("bin").join("claude.exe");
    native.is_file().then_some(native)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantInfo {
    pub claude_path: Option<String>,
}

#[tauri::command]
pub fn assistant_info() -> AssistantInfo {
    AssistantInfo { claude_path: find_claude().map(|p| p.to_string_lossy().to_string()) }
}

#[tauri::command]
pub fn assistant_set_private(state: State<AiState>, include: bool) -> CmdResult<()> {
    *state.include_private.lock().map_err(err)? = include;
    Ok(())
}

/// Starts (or restarts) a conversation, optionally resuming an earlier one.
#[tauri::command]
pub fn assistant_start(app: AppHandle, state: State<AiState>, system_prompt: String, resume: Option<String>, session_id: Option<String>) -> CmdResult<()> {
    assistant_stop_inner(&state);
    let claude = find_claude().ok_or("Claude Code isn't installed on this computer.")?;
    let (port, token) = ensure_server(&app)?;
    let mcp = json!({ "mcpServers": { "eardloom": { "type": "http", "url": format!("http://127.0.0.1:{port}/mcp"), "headers": { "Authorization": format!("Bearer {token}") } } } });
    // An empty working folder, so no project instructions or files are picked up.
    let cwd = app.path().app_data_dir().map_err(err)?.join("assistant");
    std::fs::create_dir_all(&cwd).map_err(err)?;

    let mut cmd = Command::new(claude);
    cmd.current_dir(&cwd)
        .args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
        // Only Eardloom's tools: no files, no shell, none of the author's other connectors.
        .args(["--tools", "", "--strict-mcp-config", "--mcp-config", &mcp.to_string(), "--allowedTools", "mcp__eardloom"])
        .args(["--system-prompt", &system_prompt]);
    if let Some(r) = resume.filter(|r| !r.is_empty()) {
        cmd.args(["--resume", &r]);
    } else if let Some(s) = session_id.filter(|s| !s.is_empty()) {
        cmd.args(["--session-id", &s]);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start Claude Code: {e}"))?;
    let stdin = child.stdin.take().ok_or("No input pipe")?;
    let stdout = child.stdout.take().ok_or("No output pipe")?;
    let stderr = child.stderr.take().ok_or("No error pipe")?;

    let out_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = out_app.emit("ai://line", line);
        }
        let _ = out_app.emit("ai://exit", ());
    });
    let err_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = err_app.emit("ai://stderr", line);
        }
    });
    *state.process.lock().map_err(err)? = Some((child, stdin));
    Ok(())
}

#[tauri::command]
pub fn assistant_send(state: State<AiState>, text: String) -> CmdResult<()> {
    let mut guard = state.process.lock().map_err(err)?;
    let (_, stdin) = guard.as_mut().ok_or("The assistant isn't running.")?;
    let msg = json!({ "type": "user", "message": { "role": "user", "content": text } });
    writeln!(stdin, "{msg}").map_err(err)?;
    stdin.flush().map_err(err)
}

fn assistant_stop_inner(state: &AiState) {
    if let Ok(mut guard) = state.process.lock() {
        if let Some((mut child, _)) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    // Anything still waiting for approval is declined.
    if let Ok(mut pending) = state.pending.lock() {
        for (_, tx) in pending.drain() {
            let _ = tx.send("The conversation was stopped before the author decided.".into());
        }
    }
}

#[tauri::command]
pub fn assistant_stop(state: State<AiState>) {
    assistant_stop_inner(&state);
}

/// The author's decision on a proposal, passed back to the waiting tool call.
#[tauri::command]
pub fn assistant_resolve(state: State<AiState>, id: String, outcome: String) -> CmdResult<()> {
    if let Some(tx) = state.pending.lock().map_err(err)?.remove(&id) {
        let _ = tx.send(outcome);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_edits_and_articles_are_capped() {
        let long = "word ".repeat(MAX_EDIT_WORDS + 30);
        assert!(check_proposal("suggest_line_edit", &json!({ "original": "The ship left.", "replacement": "The ship slipped away." })).is_ok());
        assert!(check_proposal("suggest_line_edit", &json!({ "original": long, "replacement": "x" })).is_err());
        assert!(check_proposal("suggest_line_edit", &json!({ "original": "x", "replacement": "word ".repeat(200) })).is_err());
        assert!(check_proposal("propose_new_entry", &json!({ "article": "word ".repeat(MAX_ARTICLE_WORDS + 1) })).is_err());
        assert!(check_proposal("propose_new_entry", &json!({ "article": "A short history." })).is_ok());
    }

    #[test]
    fn there_is_no_tool_for_writing_chapters() {
        let names: Vec<String> = tools().as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
        assert!(!names.iter().any(|n| n.contains("write") || n.contains("create_chapter") || n.contains("append")));
    }

    #[test]
    fn reads_a_world() {
        let path = std::env::temp_dir().join(format!("eardloom-ai-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(&path).unwrap();
        conn.execute_batch(
            r#"INSERT INTO meta (key, value) VALUES ('name', 'Testland');
               INSERT INTO entry_types (id, name, plural, fields) VALUES ('c', 'Character', 'Characters', '[{"id":"ally","label":"Allies","kind":"entries"}]');
               INSERT INTO entries (id, type_id, title, aliases, fields) VALUES ('a', 'c', 'Mira Vale', '["The Navigator"]', '{"ally":["b"]}');
               INSERT INTO entries (id, type_id, title) VALUES ('b', 'c', 'Kade');
               INSERT INTO entries (id, type_id, title, visibility) VALUES ('s', 'c', 'Secret King', 'private');"#,
        )
        .unwrap();
        let overview = world_overview(&conn, false).unwrap();
        assert!(overview.contains("Testland") && overview.contains("Characters [one: Character]: 2 entries"));
        let entry = read_entry(&conn, "the navigator", false).unwrap();
        assert!(entry.contains("# Mira Vale") && entry.contains("Allies: Kade"), "{entry}");
        assert!(read_entry(&conn, "Secret King", false).unwrap().starts_with("No entry"));
        assert!(read_entry(&conn, "Secret King", true).unwrap().contains("# Secret King"));
        assert!(!list_entries(&conn, Some("characters"), false).unwrap().contains("Secret"));
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}
