use rusqlite::Connection;
use serde_json::Value;
use std::path::Path;

/// Each entry in this list upgrades the database by one version.
/// Never edit a migration that has shipped; append a new one instead.
const MIGRATIONS: &[&str] = &[
    // v1: initial schema
    r#"
    CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE entry_types (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        plural     TEXT NOT NULL,
        icon       TEXT NOT NULL DEFAULT 'file-text',
        color      TEXT NOT NULL DEFAULT '#8b9bb4',
        sort       INTEGER NOT NULL DEFAULT 0,
        fields     TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE entries (
        id         TEXT PRIMARY KEY,
        type_id    TEXT NOT NULL REFERENCES entry_types(id),
        title      TEXT NOT NULL,
        aliases    TEXT NOT NULL DEFAULT '[]',
        summary    TEXT NOT NULL DEFAULT '',
        body       TEXT,
        fields     TEXT NOT NULL DEFAULT '{}',
        tags       TEXT NOT NULL DEFAULT '[]',
        image      TEXT,
        visibility TEXT NOT NULL DEFAULT 'public',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX entries_by_type ON entries(type_id);

    -- Derived index of references, rebuilt whenever the source is saved.
    -- source_kind: 'entry' | 'doc'; via: 'mention' or the id of an entry-link field.
    CREATE TABLE links (
        source_kind TEXT NOT NULL,
        source_id   TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        via         TEXT NOT NULL,
        PRIMARY KEY (source_kind, source_id, target_id, via)
    );
    CREATE INDEX links_by_target ON links(target_id);

    CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'book',
        description TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        settings    TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE docs (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id  TEXT,
        kind       TEXT NOT NULL DEFAULT 'text',
        title      TEXT NOT NULL,
        synopsis   TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL DEFAULT '',
        body       TEXT,
        word_count INTEGER NOT NULL DEFAULT 0,
        sort       REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX docs_by_project ON docs(project_id);

    CREATE VIRTUAL TABLE search USING fts5(
        kind UNINDEXED,
        id UNINDEXED,
        title,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
    );
    "#,
    // v2: an emoji that stands in for an entry when it has no image
    "ALTER TABLE entries ADD COLUMN emoji TEXT;",
    // v3: saved versions of manuscript documents
    r#"
    CREATE TABLE snapshots (
        id         TEXT PRIMARY KEY,
        doc_id     TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        name       TEXT NOT NULL DEFAULT '',
        automatic  INTEGER NOT NULL DEFAULT 0,
        body       TEXT,
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );
    CREATE INDEX snapshots_by_doc ON snapshots(doc_id, created_at);
    "#,
    // v4: a colour label per manuscript document (e.g. POV, storyline)
    "ALTER TABLE docs ADD COLUMN label TEXT NOT NULL DEFAULT '';",
    // v5: comments on manuscript text (the anchor lives in the text as a mark)
    r#"
    CREATE TABLE comments (
        id         TEXT PRIMARY KEY,
        doc_id     TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        body       TEXT NOT NULL DEFAULT '',
        resolved   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );
    CREATE INDEX comments_by_doc ON comments(doc_id);
    "#,
    // v6: maps (uploaded or drawn), with pins in their data
    r#"
    CREATE TABLE maps (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        image      TEXT,
        width      REAL NOT NULL DEFAULT 2000,
        height     REAL NOT NULL DEFAULT 1400,
        sort       INTEGER NOT NULL DEFAULT 0,
        data       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    "#,
    // v7: the built-in assistant's conversation about each entry or chapter ('entry:<id>', 'doc:<id>' or 'world')
    r#"
    CREATE TABLE assistant_chats (
        subject    TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TRIGGER assistant_chats_entry_gone AFTER DELETE ON entries
        BEGIN DELETE FROM assistant_chats WHERE subject = 'entry:' || old.id; END;
    CREATE TRIGGER assistant_chats_doc_gone AFTER DELETE ON docs
        BEGIN DELETE FROM assistant_chats WHERE subject = 'doc:' || old.id; END;
    "#,
    // v8: saved versions of codex entries (everything the author writes in them)
    r#"
    CREATE TABLE entry_versions (
        id         TEXT PRIMARY KEY,
        entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        name       TEXT NOT NULL DEFAULT '',
        automatic  INTEGER NOT NULL DEFAULT 0,
        data       TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );
    CREATE INDEX entry_versions_by_entry ON entry_versions(entry_id, created_at);
    "#,
    // v9: scene details for each manuscript document: POV, location, who's present, date, plot threads
    "ALTER TABLE docs ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';",
];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub(crate) fn migrate_for_tests(conn: &Connection) {
    migrate(conn).unwrap();
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current as usize > MIGRATIONS.len() {
        return Err(rusqlite::Error::InvalidParameterName(
            "This world was saved by a newer version of the app. Please update.".into(),
        ));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// Plain text and @mention targets pulled out of a TipTap/ProseMirror JSON document.
#[derive(Default)]
pub struct Extracted {
    pub text: String,
    pub mentions: Vec<String>,
}

pub fn extract(doc: &Value) -> Extracted {
    let mut out = Extracted::default();
    walk(doc, &mut out);
    out.mentions.sort();
    out.mentions.dedup();
    out
}

fn walk(node: &Value, out: &mut Extracted) {
    match node {
        Value::Array(items) => items.iter().for_each(|n| walk(n, out)),
        Value::Object(map) => {
            let kind = map.get("type").and_then(Value::as_str).unwrap_or("");
            if kind == "mention" {
                let attrs = map.get("attrs");
                if let Some(id) = attrs.and_then(|a| a.get("id")).and_then(Value::as_str) {
                    out.mentions.push(id.to_string());
                }
                // The wording shown in the text ("Vex"), else the name it was linked by.
                let display = attrs.and_then(|a| a.get("display")).and_then(Value::as_str).filter(|s| !s.trim().is_empty());
                if let Some(text) = display.or_else(|| attrs.and_then(|a| a.get("label")).and_then(Value::as_str)) {
                    out.text.push_str(text);
                }
            }
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                out.text.push_str(text);
            }
            if let Some(content) = map.get("content") {
                walk(content, out);
            }
            if matches!(kind, "paragraph" | "heading" | "blockquote" | "listItem" | "codeBlock" | "hardBreak") {
                out.text.push('\n');
            }
        }
        _ => {}
    }
}

pub fn word_count(text: &str) -> i64 {
    text.split_whitespace().count() as i64
}

/// Turns free text into an FTS5 prefix query: `drag king` -> `"drag"* "king"*`.
pub fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn migrates_fresh_database_and_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("eardloom-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("world.db");
        let _ = std::fs::remove_file(&path);
        drop(open(&path).unwrap());
        let conn = open(&path).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn assistant_chats_go_with_their_entry_or_chapter() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO entry_types (id, name, plural) VALUES ('t', 'Place', 'Places');
             INSERT INTO entries (id, type_id, title) VALUES ('e1', 't', 'Harbour'), ('e2', 't', 'Lighthouse');
             INSERT INTO projects (id, title) VALUES ('p', 'Book');
             INSERT INTO docs (id, project_id, title) VALUES ('d', 'p', 'Chapter');
             INSERT INTO assistant_chats (subject, data) VALUES ('entry:e1', '{}'), ('entry:e2', '{}'), ('doc:d', '{}'), ('world', '{}');
             DELETE FROM entries WHERE id = 'e1';
             DELETE FROM projects WHERE id = 'p';",
        )
        .unwrap();
        let left: Vec<String> = conn
            .prepare("SELECT subject FROM assistant_chats ORDER BY subject")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(left, vec!["entry:e2", "world"]);
    }

    #[test]
    fn upgrades_a_v1_world_without_losing_entries() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1i64).unwrap();
        conn.execute_batch(
            "INSERT INTO entry_types (id, name, plural) VALUES ('t', 'Character', 'Characters');
             INSERT INTO entries (id, type_id, title) VALUES ('e', 't', 'Vex');",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let (title, emoji): (String, Option<String>) =
            conn.query_row("SELECT title, emoji FROM entries WHERE id = 'e'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(title, "Vex");
        assert_eq!(emoji, None);
    }

    #[test]
    fn extracts_text_and_mentions() {
        let doc = json!({"type": "doc", "content": [
            {"type": "paragraph", "content": [
                {"type": "text", "text": "Captain "},
                {"type": "mention", "attrs": {"id": "abc", "label": "Vex"}},
                {"type": "text", "text": " boarded the ship."}
            ]},
            {"type": "paragraph", "content": [
                {"type": "mention", "attrs": {"id": "abc", "label": "Vex"}}
            ]}
        ]});
        let e = extract(&doc);
        assert_eq!(e.mentions, vec!["abc"]);
        assert!(e.text.contains("Captain Vex boarded the ship."));
        assert_eq!(word_count(&e.text), 6);
    }

    #[test]
    fn mentions_read_as_their_chosen_wording() {
        let doc = json!({"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "mention", "attrs": {"id": "abc", "label": "Vex Arandel", "display": "Vex"}},
            {"type": "text", "text": " smiled."}
        ]}]});
        let e = extract(&doc);
        assert!(e.text.contains("Vex smiled."));
        assert!(!e.text.contains("Arandel"));
        assert_eq!(e.mentions, vec!["abc"]);
    }

    #[test]
    fn builds_safe_prefix_queries() {
        assert_eq!(fts_query("iron ci").as_deref(), Some("\"iron\"* \"ci\"*"));
        assert_eq!(fts_query("say \"hi\"").as_deref(), Some("\"say\"* \"hi\"*"));
        assert_eq!(fts_query("   "), None);
    }

    #[test]
    fn search_finds_prefix_matches() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn.execute("INSERT INTO search (kind, id, title, body) VALUES ('entry', '1', 'Iron Citadel', 'A fortress on the northern coast')", [])
            .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM search WHERE search MATCH ?1", [fts_query("fort").unwrap()], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
