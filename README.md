<p align="center">
  <img src="branding/eardloom-logo.png" alt="Eardloom" width="120">
</p>

<h1 align="center">Eardloom</h1>

<p align="center">
  <a href="https://github.com/OwenModsTW/Eardloom/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/OwenModsTW/Eardloom?style=flat-square&color=f6bd60&label=release"></a>
  <a href="https://github.com/OwenModsTW/Eardloom/actions/workflows/release.yml"><img alt="Release build" src="https://img.shields.io/github/actions/workflow/status/OwenModsTW/Eardloom/release.yml?branch=production&style=flat-square&label=build"></a>
  <a href="https://github.com/OwenModsTW/Eardloom/actions/workflows/check.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/OwenModsTW/Eardloom/check.yml?branch=main&style=flat-square&label=checks"></a>
  <a href="https://github.com/OwenModsTW/Eardloom/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/OwenModsTW/Eardloom/total?style=flat-square&color=2a8a6c"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-135e55?style=flat-square">
  <img alt="Status" src="https://img.shields.io/badge/status-early%20development-f6bd60?style=flat-square">
</p>

<p align="center"><em>Build worlds. Write in them. Share them.</em></p>

A worldbuilding and writing tool for people crafting their own worlds, whether fantasy, science fiction, post-apocalyptic, modern day or anything else, and sharing them with others.

- **A codex that fits your world.** Each world defines its own categories (Characters, Starships, Safehouses…) and the fields tracked for each. Nothing is hardcoded to one genre.
- **Everything links.** Type `@` anywhere to link an entry. Link fields and mentions show up as backlinks on the other side.
- **Write inside your world.** Books and campaigns live in the same world as their lore, with a binder for chapters and a lore panel beside the manuscript.
- **Your files, on your disk.** A world is a folder (`world.db` + `assets/`). Back it up or move it like any other folder.
- **Updates itself.** New versions are published to GitHub Releases and installed from inside the app.

## Download

Grab the latest Windows installer from [Releases](https://github.com/OwenModsTW/Eardloom/releases/latest). Once installed, Eardloom keeps itself up to date.

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
