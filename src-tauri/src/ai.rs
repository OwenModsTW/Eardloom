//! The AI connector.
//!
//! Eardloom never runs or signs in to an AI itself. Instead it offers a small local
//! MCP server that the author's own AI app (Claude Desktop, Claude Code, Codex...)
//! can connect to, the same way those apps connect to any tool. The AI can read the
//! world and *propose* changes, which the author approves inside Eardloom. By design
//! it has no way to write chapters: it helps with worldbuilding, reviews and suggestions.
//!
//! Those apps start local tools as a program they talk to over stdin/stdout, so
//! `Eardloom.exe --mcp` acts as a small bridge to the running Eardloom (see `run_bridge`).

use crate::db;
use crate::timeline;
use crate::world::{err, get_meta, AppState, CmdResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Where the running app tells the bridge how to reach it.
const DISCOVERY_FILE: &str = "connector.json";
/// Matches the identifier in tauri.conf.json (Tauri's app data folder on Windows).
const APP_ID: &str = "com.eardloom.app";

/// Suggestions to chapter text are capped so the assistant edits lines, not writes prose.
const MAX_EDIT_WORDS: usize = 60;
/// Lore is the assistant's to help write in full; this only stops runaway output in one proposal.
const MAX_ARTICLE_WORDS: usize = 3000;
/// A summary is the one- or two-sentence line under an entry's title; detail belongs in the article.
const MAX_SUMMARY_WORDS: usize = 50;

#[derive(Default)]
pub struct AiState {
    server: Mutex<Option<(u16, String)>>,
    pending: Mutex<HashMap<String, Sender<String>>>,
    include_private: Mutex<bool>,
}

pub(crate) fn random_token() -> String {
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
        { "name": "propose_new_entry", "description": "Propose a new codex (lore) entry, with as full an article as the author wants. The author approves it before it's created. Field values are keyed by field label; link fields take entry names.", "inputSchema": s(json!({
            "category": { "type": "string" }, "title": { "type": "string" },
            "summary": { "type": "string", "description": "One or two short sentences shown under the title. Not the place for detail." },
            "article": { "type": "string", "description": "The entry's main text: description, history, culture and other detail. Markdown: paragraphs, ## headings, lists, bold, italics." },
            "aliases": { "type": "array", "items": { "type": "string" } }, "tags": { "type": "array", "items": { "type": "string" } },
            "fields": { "type": "object", "additionalProperties": true }
        }), &["category", "title"]) },
        { "name": "propose_entry_changes", "description": "Propose changes to an existing codex (lore) entry: its summary, fields, aliases, tags, or its article (add to it, or rewrite it completely). To write about the entry (description, history, culture, details) use add_to_article or rewrite_article, not summary. The author approves them first and can undo them.", "inputSchema": s(json!({
            "entry": { "type": "string" },
            "summary": { "type": "string", "description": "Replaces the one- or two-sentence summary under the title. Only use when the summary itself should change." },
            "add_to_article": { "type": "string", "description": "Text added to the end of the entry's article (its main text). Markdown: paragraphs, ## headings, lists, bold, italics." },
            "rewrite_article": { "type": "string", "description": "A complete new article that replaces the current one. Use when asked to rewrite, restructure or expand the whole article; keep what the author wrote unless asked to change it. Markdown." },
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
            let text = format!("{} {} {}", arg(args, "article"), arg(args, "add_to_article"), arg(args, "rewrite_article"));
            if words(&text) > MAX_ARTICLE_WORDS {
                return Err(format!(
                    "That's more than {MAX_ARTICLE_WORDS} words in one go. Propose the article in parts: start it, then add_to_article for the rest."
                ));
            }
            if words(arg(args, "summary")) > MAX_SUMMARY_WORDS {
                let field = if name == "propose_new_entry" { "article" } else { "add_to_article" };
                return Err(format!(
                    "The summary is too long. Keep it to one or two sentences (under {MAX_SUMMARY_WORDS} words) and put the detail in {field}, then propose again."
                ));
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

pub const INSTRUCTIONS: &str = "You are connected to Eardloom, the author's worldbuilding and writing app. \
You help with two things, under different rules. \
LORE (the codex: entries for characters, places, peoples, history, magic, technology and so on): you're a full collaborator. \
When asked, write or rewrite complete entry articles, fill in fields and propose new entries, building on what the world \
establishes and pointing out contradictions. \
STORY (the author's books and chapters): the writing is theirs alone. Never write or continue chapters, scenes, dialogue or \
narrative prose, even if asked. You may review, comment, discuss ideas and suggest short line edits. \
Always read before you answer (start with world_overview). An entry's summary is one or two sentences; descriptions, history \
and other detail go in its article. You cannot change anything directly: every change is a proposal the author \
approves or skips in Eardloom, so explain each one briefly.";

/// One MCP JSON-RPC message in, one response (or none, for notifications) out.
fn handle_rpc(app: &AppHandle, msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => {
            let client = msg.pointer("/params/clientInfo/name").and_then(Value::as_str).unwrap_or("An AI app");
            let _ = app.emit("ai://client", client);
            Ok(json!({
            "protocolVersion": msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "eardloom", "version": app.package_info().version.to_string() },
            "instructions": INSTRUCTIONS
        }))
        }
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

fn discovery_path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join(APP_ID).join(DISCOVERY_FILE))
}

/// Starts the local MCP server once, on a random port, guarded by a random token,
/// and tells the bridge where to find it.
pub fn ensure_server(app: &AppHandle) -> CmdResult<(u16, String)> {
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
    if let Some(path) = discovery_path() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, json!({ "port": port, "token": token, "pid": std::process::id() }).to_string());
    }
    *guard = Some((port, token.clone()));
    Ok((port, token))
}

// ---------------------------------------------------------------- the bridge

/// Sends one JSON-RPC message to the running app and returns its reply (if any).
fn post(port: u16, token: &str, body: &str) -> std::io::Result<Option<String>> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(Duration::from_secs(40 * 60)))?;
    write!(
        stream,
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    let text = String::from_utf8_lossy(&raw);
    let (head, rest) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    if head.starts_with("HTTP/1.1 202") || rest.trim().is_empty() {
        return Ok(None);
    }
    if !head.starts_with("HTTP/1.1 200") {
        return Err(std::io::Error::other(head.lines().next().unwrap_or("").to_string()));
    }
    Ok(Some(rest.trim().to_string()))
}

fn reply(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// `Eardloom.exe --mcp`: what an AI app launches. Answers the handshake itself (so the
/// connection works even before Eardloom is opened) and forwards everything else to the
/// running app.
pub fn run_bridge() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = msg.get("id").cloned() else { continue }; // notifications need no answer
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let out = match method {
            "initialize" => reply(
                &id,
                json!({
                    "protocolVersion": msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "eardloom", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": INSTRUCTIONS
                }),
            ),
            "tools/list" => reply(&id, json!({ "tools": tools() })),
            "ping" => reply(&id, json!({})),
            _ => {
                let target = discovery_path()
                    .and_then(|p| std::fs::read_to_string(p).ok())
                    .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                    .and_then(|v| Some((v.get("port")?.as_u64()? as u16, v.get("token")?.as_str()?.to_string())));
                let forwarded = target.and_then(|(port, token)| post(port, &token, &line).ok().flatten());
                forwarded.unwrap_or_else(|| {
                    reply(
                        &id,
                        json!({ "content": [{ "type": "text", "text": "Eardloom isn't open. Ask the author to open Eardloom and their world, then try again." }], "isError": true }),
                    )
                })
            }
        };
        if writeln!(stdout, "{out}").and_then(|_| stdout.flush()).is_err() {
            break;
        }
    }
}

// ---------------------------------------------------------------- connecting AI apps

fn exe_path() -> CmdResult<String> {
    Ok(std::env::current_exe().map_err(err)?.to_string_lossy().to_string())
}

fn claude_desktop_config() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join("Claude").join("claude_desktop_config.json"))
}

fn codex_config() -> Option<PathBuf> {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".codex")))?;
    Some(home.join("config.toml"))
}

const CODEX_SECTION: &str = "[mcp_servers.eardloom]";

/// The author's Claude Code command-line tool, if installed. Only ever used to add or
/// remove Eardloom from its list of tools; Eardloom never runs it for anything else.
fn find_claude_code() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let exe = dir.join("claude.exe");
        if exe.is_file() {
            return Some(exe);
        }
        // npm installs a claude.cmd shim next to node_modules.
        if dir.join("claude.cmd").is_file() {
            let real = dir.join("node_modules").join("@anthropic-ai").join("claude-code").join("bin").join("claude.exe");
            if real.is_file() {
                return Some(real);
            }
        }
    }
    let native = PathBuf::from(std::env::var_os("USERPROFILE")?).join(".local").join("bin").join("claude.exe");
    native.is_file().then_some(native)
}

/// Whether Claude Code's user settings already list Eardloom.
fn claude_code_connected() -> bool {
    std::env::var_os("USERPROFILE")
        .map(|h| PathBuf::from(h).join(".claude.json"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .is_some_and(|v| v.pointer("/mcpServers/eardloom").is_some())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    pub exe: String,
    pub claude_desktop_installed: bool,
    pub claude_desktop_connected: bool,
    pub codex_installed: bool,
    pub codex_connected: bool,
    pub claude_code_installed: bool,
    pub claude_code_connected: bool,
    /// The same setup as a terminal command, for anyone who prefers to run it themselves
    /// (quoted so PowerShell passes the `--` through).
    pub claude_code_command: String,
}

#[tauri::command]
pub fn connector_status() -> CmdResult<ConnectorStatus> {
    let exe = exe_path()?;
    let desktop = claude_desktop_config();
    let desktop_json: Value = desktop.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let codex = codex_config();
    let codex_text = codex.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    Ok(ConnectorStatus {
        claude_desktop_installed: desktop.as_ref().and_then(|p| p.parent()).is_some_and(|d| d.is_dir()),
        claude_desktop_connected: desktop_json.pointer("/mcpServers/eardloom").is_some(),
        codex_installed: codex.as_ref().and_then(|p| p.parent()).is_some_and(|d| d.is_dir()),
        codex_connected: codex_text.contains(CODEX_SECTION),
        claude_code_installed: find_claude_code().is_some(),
        claude_code_connected: claude_code_connected(),
        claude_code_command: format!("claude mcp add --scope user eardloom '--' \"{exe}\" --mcp"),
        exe,
    })
}

/// Whether the Claude Desktop app is open (Windows only; elsewhere assume not).
fn claude_desktop_running() -> bool {
    #[cfg(windows)]
    {
        // Claude Code is also named claude.exe, so look at where each process runs from:
        // the desktop app lives in WindowsApps (Store install) or AnthropicClaude.
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", "Get-Process claude -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"]);
        hide_window(&mut cmd);
        if let Ok(out) = cmd.output() {
            let paths = String::from_utf8_lossy(&out.stdout).to_lowercase();
            return paths.lines().any(|p| p.contains(r"\windowsapps\claude_") || p.contains(r"\anthropicclaude\"));
        }
    }
    false
}

/// Adds Eardloom to Claude Desktop's list of local tools (keeping a backup of the file).
#[tauri::command]
pub fn connect_claude_desktop(connect: bool) -> CmdResult<()> {
    // Claude Desktop saves over this file while it's running, which would undo the change.
    if claude_desktop_running() {
        return Err("Quit Claude Desktop first (right-click its icon by the clock and choose Quit), then click Connect again.".into());
    }
    let path = claude_desktop_config().ok_or("Couldn't find Claude Desktop's settings folder.")?;
    let existing = std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".into());
    let mut config: Value = serde_json::from_str(&existing).map_err(|_| "Claude Desktop's settings file isn't valid JSON, so it was left alone.")?;
    if path.exists() {
        std::fs::write(path.with_extension("json.eardloom-backup"), &existing).map_err(err)?;
    }
    let servers = config
        .as_object_mut()
        .ok_or("Unexpected settings format.")?
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("Unexpected settings format.")?;
    if connect {
        servers.insert("eardloom".into(), json!({ "command": exe_path()?, "args": ["--mcp"] }));
    } else {
        servers.remove("eardloom");
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&config).map_err(err)?).map_err(err)
}

/// Adds (or removes) Eardloom in Codex's config.toml.
#[tauri::command]
pub fn connect_codex(connect: bool) -> CmdResult<()> {
    let path = codex_config().ok_or("Couldn't find Codex's settings folder.")?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if path.exists() {
        std::fs::write(path.with_extension("toml.eardloom-backup"), &existing).map_err(err)?;
    }
    // Remove any earlier Eardloom section (it runs until the next [section]).
    let mut kept = Vec::new();
    let mut skipping = false;
    for line in existing.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            skipping = t == CODEX_SECTION;
        }
        if !skipping {
            kept.push(line);
        }
    }
    let mut text = kept.join("\n").trim_end().to_string();
    if connect {
        let exe = exe_path()?.replace('\\', "\\\\");
        text = format!("{text}{}{CODEX_SECTION}\ncommand = \"{exe}\"\nargs = [\"--mcp\"]\n", if text.is_empty() { "" } else { "\n\n" });
    } else if !text.is_empty() {
        text.push('\n');
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    std::fs::write(&path, text).map_err(err)
}

/// Adds (or removes) Eardloom in Claude Code's tools using its own `claude mcp` command,
/// with arguments passed directly (no shell, so nothing gets mangled).
#[tauri::command]
pub fn connect_claude_code(connect: bool) -> CmdResult<()> {
    let claude = find_claude_code().ok_or("Claude Code isn't installed on this computer.")?;
    let exe = exe_path()?;
    let mut cmd = std::process::Command::new(claude);
    if connect {
        // Replace any earlier entry (e.g. from an older install location).
        if claude_code_connected() {
            let mut remove = std::process::Command::new(find_claude_code().ok_or("Claude Code isn't installed.")?);
            remove.args(["mcp", "remove", "eardloom", "--scope", "user"]);
            hide_window(&mut remove);
            let _ = remove.output();
        }
        cmd.args(["mcp", "add", "--scope", "user", "eardloom", "--", &exe, "--mcp"]);
    } else {
        cmd.args(["mcp", "remove", "eardloom", "--scope", "user"]);
    }
    hide_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("Couldn't run Claude Code: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("Claude Code said: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

fn hide_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

#[tauri::command]
pub fn assistant_set_private(state: State<AiState>, include: bool) -> CmdResult<()> {
    *state.include_private.lock().map_err(err)? = include;
    Ok(())
}

/// The author's decision on a proposal, passed back to the waiting tool call.
#[tauri::command]
pub fn assistant_resolve(state: State<AiState>, id: String, outcome: String) -> CmdResult<()> {
    if let Some(tx) = state.pending.lock().map_err(err)?.remove(&id) {
        let _ = tx.send(outcome);
    }
    Ok(())
}

// ---------------------------------------------------------------- the built-in assistant

const READ_TOOLS: &[&str] = &["world_overview", "search", "list_entries", "read_entry", "read_timeline", "list_books", "read_chapter"];

/// The same tools, in the shape local models expect (OpenAI-style function definitions).
#[tauri::command]
pub fn assistant_tool_specs() -> Value {
    Value::Array(
        tools()
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|t| json!({ "type": "function", "function": { "name": t["name"], "description": t["description"], "parameters": t["inputSchema"] } }))
                    .collect()
            })
            .unwrap_or_default(),
    )
}

/// Runs a read-only tool for the built-in assistant. Proposals go through the app instead.
#[tauri::command]
pub fn assistant_read_tool(app: AppHandle, name: String, args: Value) -> Result<String, String> {
    if !READ_TOOLS.contains(&name.as_str()) {
        return Err(format!("{name} isn't a lookup tool."));
    }
    call_tool(&app, &name, &args)
}

/// The same limits the connector enforces, for proposals made in the built-in assistant.
#[tauri::command]
pub fn assistant_check_proposal(name: String, args: Value) -> Result<(), String> {
    check_proposal(&name, &args)
}

/// A search for any of the question's meaningful words, so one matching name is enough.
fn question_query(question: &str) -> Option<String> {
    let terms: Vec<String> = question
        .split(|c: char| !c.is_alphanumeric() && c != '\'' && c != '’')
        .filter(|w| w.chars().count() > 3)
        .map(|w| format!("\"{}\"*", w.replace('"', "")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" OR "))
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max_chars).collect::<String>())
    }
}

/// What a small local model needs to answer well: the world in brief, the entries that
/// match the question, and whatever the author has open. Kept compact to fit its memory.
#[tauri::command]
pub fn assistant_context(app: AppHandle, query: String, entry_id: Option<String>, chapter_id: Option<String>) -> CmdResult<String> {
    let include_private = *app.state::<AiState>().include_private.lock().map_err(err)?;
    app.state::<AppState>().with(|w| {
        let conn = &w.conn;
        let mut out = truncate(&world_overview(conn, include_private)?, 3000);
        if let Some(id) = entry_id.filter(|s| !s.is_empty()) {
            out += &format!("\n\n## The entry this conversation is about\n{}", truncate(&read_entry(conn, &id, include_private)?, 4000));
        }
        if let Some(id) = chapter_id.filter(|s| !s.is_empty()) {
            out += &format!("\n\n## The chapter this conversation is about\n{}", truncate(&read_chapter(conn, &id)?, 9000));
        }
        // Entries matching the question, most relevant first.
        if let Some(q) = question_query(&query) {
            let ids: Vec<String> = conn
                .prepare("SELECT id FROM search WHERE kind = 'entry' AND search MATCH ?1 ORDER BY bm25(search, 0, 0, 8.0, 1.0) LIMIT 4")
                .map_err(err)?
                .query_map(params![q], |r| r.get(0))
                .map_err(err)?
                .flatten()
                .collect();
            let mut found = String::new();
            for id in ids {
                let text = read_entry(conn, &id, include_private)?;
                if !text.starts_with("No entry") {
                    found += &format!("\n\n{}", truncate(&text, 1800));
                }
            }
            if !found.is_empty() {
                out += &format!("\n\n## Entries that may be relevant{found}");
            }
        }
        Ok(out)
    })
}

/// The built-in assistant's saved conversation about one entry, chapter or the whole world.
#[derive(Serialize)]
pub struct SavedChat {
    data: String,
    updated_at: String,
}

#[tauri::command]
pub fn assistant_chat_load(state: State<AppState>, subject: String) -> CmdResult<Option<SavedChat>> {
    state.with(|w| {
        w.conn
            .query_row("SELECT data, updated_at FROM assistant_chats WHERE subject = ?1", [&subject], |r| {
                Ok(SavedChat { data: r.get(0)?, updated_at: r.get(1)? })
            })
            .optional()
            .map_err(err)
    })
}

#[tauri::command]
pub fn assistant_chat_save(state: State<AppState>, subject: String, data: String) -> CmdResult<()> {
    state.with(|w| {
        w.conn
            .execute(
                "INSERT INTO assistant_chats (subject, data, updated_at) VALUES (?1, ?2, datetime('now'))
                 ON CONFLICT(subject) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                params![subject, data],
            )
            .map(|_| ())
            .map_err(err)
    })
}

#[tauri::command]
pub fn assistant_chat_clear(state: State<AppState>, subject: String) -> CmdResult<()> {
    state.with(|w| w.conn.execute("DELETE FROM assistant_chats WHERE subject = ?1", [&subject]).map(|_| ()).map_err(err))
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
        // Full lore articles are welcome.
        assert!(check_proposal("propose_entry_changes", &json!({ "rewrite_article": "word ".repeat(1500) })).is_ok());
        assert!(check_proposal("propose_entry_changes", &json!({ "rewrite_article": "word ".repeat(MAX_ARTICLE_WORDS + 1) })).is_err());
        // Detail belongs in the article, and the error says so.
        let essay = check_proposal("propose_entry_changes", &json!({ "summary": "word ".repeat(MAX_SUMMARY_WORDS + 1) }));
        assert!(essay.unwrap_err().contains("add_to_article"));
        assert!(check_proposal("propose_entry_changes", &json!({ "summary": "A seafaring people of the northern isles." })).is_ok());
    }

    #[test]
    fn there_is_no_tool_for_writing_chapters() {
        let names: Vec<String> = tools().as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
        assert!(!names.iter().any(|n| n.contains("write") || n.contains("create_chapter") || n.contains("append")));
    }

    /// Upgrades a copy of a real world and reads everything back. Run by hand:
    /// `EARDLOOM_TEST_DB=path/to/copy/world.db cargo test real_world -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_world_upgrades_and_reads() {
        let Ok(path) = std::env::var("EARDLOOM_TEST_DB") else { return };
        let before: i64 = Connection::open(&path).unwrap().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        let conn = db::open(std::path::Path::new(&path)).expect("upgrade");
        let after: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        println!("schema v{before} -> v{after}");
        println!(
            "entries {} | categories {} | books {} | documents {} | snapshots {} | links {} | maps {} | comments {}",
            count("SELECT COUNT(*) FROM entries"),
            count("SELECT COUNT(*) FROM entry_types"),
            count("SELECT COUNT(*) FROM projects"),
            count("SELECT COUNT(*) FROM docs"),
            count("SELECT COUNT(*) FROM snapshots"),
            count("SELECT COUNT(*) FROM links"),
            count("SELECT COUNT(*) FROM maps"),
            count("SELECT COUNT(*) FROM comments"),
        );
        println!("integrity: {}", conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap());
        // Every reader the assistant uses, against real data.
        assert!(world_overview(&conn, false).is_ok());
        assert!(list_entries(&conn, None, true).is_ok());
        assert!(read_timeline(&conn).is_ok());
        assert!(list_books(&conn).is_ok());
        let ids: Vec<String> = conn.prepare("SELECT id FROM entries").unwrap().query_map([], |r| r.get(0)).unwrap().flatten().collect();
        for id in &ids {
            read_entry(&conn, id, true).expect("read entry");
        }
        let docs: Vec<String> = conn.prepare("SELECT id FROM docs WHERE kind = 'text'").unwrap().query_map([], |r| r.get(0)).unwrap().flatten().collect();
        for id in &docs {
            read_chapter(&conn, id).expect("read chapter");
        }
        println!("read {} entries and {} chapters without errors", ids.len(), docs.len());
    }

    #[test]
    fn context_finds_entries_named_in_the_question() {
        let path = std::env::temp_dir().join(format!("eardloom-ctx-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(&path).unwrap();
        conn.execute_batch(
            "INSERT INTO entry_types (id, name, plural) VALUES ('c', 'Character', 'Characters');
             INSERT INTO entries (id, type_id, title) VALUES ('a', 'c', 'Mira Vale'), ('b', 'c', 'Kade Ashborn');
             INSERT INTO search (kind, id, title, body) VALUES ('entry', 'a', 'Mira Vale', 'A navigator'), ('entry', 'b', 'Kade Ashborn', 'A smuggler');",
        )
        .unwrap();
        let q = question_query("What does Kade think of the harbour?").unwrap();
        let hits: Vec<String> = conn
            .prepare("SELECT id FROM search WHERE kind = 'entry' AND search MATCH ?1")
            .unwrap()
            .query_map(params![q], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(hits, vec!["b".to_string()], "one matching name is enough");
        drop(conn);
        let _ = std::fs::remove_file(path);
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
