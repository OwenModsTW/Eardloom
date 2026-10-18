# Eardloom

A worldbuilding and writing tool for people crafting their own worlds, whether fantasy, science fiction, post-apocalyptic, modern day or anything else, and sharing them with others.

- **A codex that fits your world.** Each world defines its own categories (Characters, Starships, Safehouses…) and the fields tracked for each. Nothing is hardcoded to one genre.
- **Everything links.** Type `@` anywhere to link an entry. Link fields and mentions show up as backlinks on the other side.
- **Write inside your world.** Books and campaigns live in the same world as their lore, with a binder for chapters and a lore panel beside the manuscript.
- **Your files, on your disk.** A world is a folder (`world.db` + `assets/`). Back it up or move it like any other folder.
- **Updates itself.** New versions are published to GitHub Releases and installed from inside the app.

## Development

Prerequisites: Node 22+, Rust (stable), and on Windows the Visual Studio C++ Build Tools.

```sh
npm install
npm run tauri dev      # run the app with hot reload
npx tsc --noEmit       # type-check the frontend
cargo test --manifest-path src-tauri/Cargo.toml
```

### Layout

| Path | What lives there |
| --- | --- |
| `src/components` | React views: home, codex, entry pages, world structure, writing |
| `src/lib` | API bindings, genre templates, shared helpers, updater |
| `src-tauri/src/db.rs` | SQLite schema + migrations, rich-text indexing |
| `src-tauri/src/world.rs` | Opening/creating worlds, recent list, assets |
| `src-tauri/src/codex.rs` | Entry types, entries, backlinks, full-text search |
| `src-tauri/src/writing.rs` | Writing projects and their binder |

Database changes go in a **new** entry at the end of `MIGRATIONS` in `db.rs`. Never edit one that has shipped.

## Releasing

1. Bump `version` in `src-tauri/tauri.conf.json` and `package.json`.
2. Merge `main` into `production` and push.
3. The **Release** workflow builds a signed installer and publishes `vX.Y.Z` with `latest.json`. Installed copies offer the update on next launch, or via *Settings → Check for updates*.

The workflow reads these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: contents of the private update-signing key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password (leave this secret out if the key has none)

Keep the private key safe and out of the repo. If it is lost, existing installs cannot verify future updates.
