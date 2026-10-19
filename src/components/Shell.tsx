import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowRight, BookOpen, Hourglass, LayoutGrid, LogOut, Map as MapIcon, Plus, Search, Waypoints } from "lucide-react";
import { useStore } from "../store";
import { api } from "../lib/api";
import { TypeIcon } from "../lib/icons";
import { createEntry, createProject } from "../lib/actions";
import { Dashboard } from "./Dashboard";
import { EntryView } from "./EntryView";
import { TypeListView } from "./TypeListView";
import { SchemaEditor } from "./SchemaEditor";
import { ProjectView } from "./ProjectView";
import { SearchPalette } from "./SearchPalette";
import { Settings } from "./Settings";
import { TimelineView } from "./TimelineView";
import { CalendarEditor } from "./CalendarEditor";
import { GraphView } from "./GraphView";
import { MapsPage } from "./maps/MapsPage";
import { MapEditor } from "./maps/MapEditor";
import { openMenu } from "./ContextMenu";
import { setKnownWords } from "../lib/spell";
import { startAutoBackups } from "../lib/backup";
import { ExportBook } from "./ExportBook";
import type { Project } from "../lib/types";

export function Shell() {
  const { world, types, entries, projects, route, back, forward, paletteOpen, go, goBack, goForward, setPalette, closeWorld, refreshProjects, focusMode } =
    useStore();

  const [exportProject, setExportProject] = useState<Project | null>(null);

  // Automatic backups while this world is open.
  useEffect(() => startAutoBackups(), [world?.path]);

  // Learned words and every entry name and alias count as correctly spelt.
  const dictionary = useStore((s) => s.dictionary);
  useEffect(() => {
    const names = entries.flatMap((e) => [e.title, ...e.aliases]).flatMap((n) => n.split(/[^\p{L}\p{M}'’]+/u));
    setKnownWords([...new Set([...dictionary, ...names].map((w) => w.replace(/[’‘]/g, "'")).filter(Boolean))]);
  }, [entries, dictionary]);

  // The category in view: a category page, or the category of the open entry.
  const activeType =
    route.view === "type" ? route.typeId : route.view === "entry" ? entries.find((e) => e.id === route.id)?.typeId : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") (e.preventDefault(), setPalette(true));
      if (mod && e.key.toLowerCase() === "n" && activeType) (e.preventDefault(), createEntry(activeType));
      if (e.altKey && e.key === "ArrowLeft") goBack();
      if (e.altKey && e.key === "ArrowRight") goForward();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) goBack();
      if (e.button === 4) goForward();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => (window.removeEventListener("keydown", onKey), window.removeEventListener("mouseup", onMouse));
  }, [goBack, goForward, setPalette, activeType]);

  return (
    <div className={`shell ${focusMode ? "focus-mode" : ""}`}>
      <nav className="sidebar">
        <div className="sidebar-top">
          <img className="sidebar-logo" src="/logo.png" alt="Eardloom" />
          <button className="icon-btn" disabled={!back.length} onClick={goBack} title="Back (Alt+←)">
            <ArrowLeft size={15} />
          </button>
          <button className="icon-btn" disabled={!forward.length} onClick={goForward} title="Forward (Alt+→)">
            <ArrowRight size={15} />
          </button>
          <span className="spacer" />
          <button className="icon-btn" onClick={closeWorld} title="Close world">
            <LogOut size={14} />
          </button>
        </div>

        <button className={`world-name ${route.view === "dashboard" ? "active" : ""}`} onClick={() => go({ view: "dashboard" })}>
          {world!.name}
        </button>
        <button className="search-button" onClick={() => setPalette(true)}>
          <Search size={13} /> Search or create
          <kbd>Ctrl K</kbd>
        </button>

        <div className="nav-heading">Codex</div>
        {types.map((t) => (
          <button
            key={t.id}
            className={`nav-item ${activeType === t.id ? "active" : ""}`}
            style={{ "--chip": t.color } as React.CSSProperties}
            onClick={() => go({ view: "type", typeId: t.id })}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: `New ${t.name.toLowerCase()}`, shortcut: activeType === t.id ? "Ctrl N" : undefined, onClick: () => createEntry(t.id) },
                { label: "Edit fields", onClick: () => go({ view: "schema", typeId: t.id }) },
              ])
            }
          >
            <TypeIcon name={t.icon} size={14} className="type-glyph" />
            <span>{t.plural}</span>
            <small>{entries.filter((e) => e.typeId === t.id).length || ""}</small>
          </button>
        ))}
        <div className="nav-heading">World</div>
        <button
          className={`nav-item ${route.view === "timeline" || route.view === "calendar" ? "active" : ""}`}
          onClick={() => go({ view: "timeline" })}
        >
          <Hourglass size={14} className="type-glyph" />
          <span>Timeline</span>
        </button>
        <button
          className={`nav-item ${route.view === "maps" || route.view === "map" ? "active" : ""}`}
          onClick={() => go({ view: "maps" })}
        >
          <MapIcon size={14} className="type-glyph" />
          <span>Maps</span>
        </button>
        <button className={`nav-item ${route.view === "graph" ? "active" : ""}`} onClick={() => go({ view: "graph" })}>
          <Waypoints size={14} className="type-glyph" />
          <span>Graph</span>
        </button>
        <button className={`nav-item ${route.view === "schema" ? "active" : ""}`} onClick={() => go({ view: "schema" })}>
          <LayoutGrid size={14} className="type-glyph" />
          <span>Structure</span>
        </button>

        <div className="nav-heading">
          Writing
          <button className="icon-btn" onClick={() => createProject("Untitled Book")} title="New writing project">
            <Plus size={13} />
          </button>
        </div>
        {projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${route.view === "project" && route.id === p.id ? "active" : ""}`}
            onClick={() => go({ view: "project", id: p.id })}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: "Open", onClick: () => go({ view: "project", id: p.id }) },
                { label: "Export…", onClick: () => setExportProject(p) },
                "separator",
                {
                  label: "Delete project",
                  danger: true,
                  onClick: async () => {
                    if (!(await ask(`Delete "${p.title}" and all of its documents?`, { title: "Delete project", kind: "warning" }))) return;
                    await api.deleteProject(p.id);
                    await refreshProjects();
                    if (route.view === "project" && route.id === p.id) go({ view: "dashboard" });
                  },
                },
              ])
            }
          >
            <BookOpen size={14} className="type-glyph" />
            <span>{p.title}</span>
          </button>
        ))}
        {projects.length === 0 && (
          <button className="nav-item quiet" onClick={() => createProject("Untitled Book")}>
            <span>Start a book…</span>
          </button>
        )}

        <span className="spacer" />
        <button className={`nav-item quiet ${route.view === "settings" ? "active" : ""}`} onClick={() => go({ view: "settings" })}>
          <span>Settings</span>
        </button>
      </nav>

      <main className="content">
        {route.view === "dashboard" && <Dashboard />}
        {route.view === "type" && <TypeListView key={route.typeId} typeId={route.typeId} />}
        {route.view === "entry" && <EntryView id={route.id} />}
        {route.view === "schema" && <SchemaEditor typeId={route.typeId} />}
        {route.view === "project" && <ProjectView id={route.id} docId={route.docId} />}
        {route.view === "settings" && <Settings />}
        {route.view === "timeline" && <TimelineView />}
        {route.view === "calendar" && <CalendarEditor />}
        {route.view === "maps" && <MapsPage />}
        {route.view === "map" && <MapEditor key={route.id} id={route.id} focusPin={route.pin} />}
        {route.view === "graph" && <GraphView key={route.focus ?? ""} focus={route.focus} />}
      </main>

      {paletteOpen && <SearchPalette />}
      {exportProject && <ExportBook project={exportProject} onClose={() => setExportProject(null)} />}
    </div>
  );
}
