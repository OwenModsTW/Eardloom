import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FileText, Folder } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { buildBook, EXTENSIONS, readingOrder, TRIMS, type BookFormat, type BookOptions, type Paper, type PdfLayout, type Trim } from "../lib/export/book";
import { Select } from "./Select";
import type { DocSummary, Project } from "../lib/types";
import { getDefaultAuthor } from "../lib/prefs";

type Saved = Omit<BookOptions, "include" | "title"> & { title?: string };

/** Compile a writing project into an ebook, Word document or Markdown file. */
export function ExportBook({ project, onClose }: { project: Project; onClose: () => void }) {
  const { refreshProjects, notify } = useStore();
  const saved = (project.settings.export ?? {}) as Partial<Saved>;
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(saved.title ?? project.title);
  const [author, setAuthor] = useState(saved.author || getDefaultAuthor());
  const [format, setFormat] = useState<BookFormat>(saved.format ?? "epub");
  const [plainLinks, setPlainLinks] = useState(saved.plainLinks ?? true);
  const [folderHeadings, setFolderHeadings] = useState(saved.folderHeadings ?? false);
  const [chapterTitles, setChapterTitles] = useState(saved.chapterTitles ?? true);
  const [pdfLayout, setPdfLayout] = useState<PdfLayout>(saved.pdfLayout ?? "paperback");
  const [trim, setTrim] = useState<Trim>(saved.trim ?? "5.5x8.5");
  const [paper, setPaper] = useState<Paper>(saved.paper ?? "letter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listDocs(project.id).then((d) => {
      const ordered = readingOrder(d);
      setDocs(ordered);
      setInclude(new Set(ordered.map((x) => x.id)));
    });
  }, [project.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const depth = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const of = (d: DocSummary): number => (d.parentId && byId.has(d.parentId) ? 1 + of(byId.get(d.parentId)!) : 0);
    return new Map(docs.map((d) => [d.id, of(d)]));
  }, [docs]);

  const descendants = (id: string): string[] =>
    docs.filter((d) => d.parentId === id).flatMap((d) => [d.id, ...descendants(d.id)]);

  const toggle = (d: DocSummary) => {
    const next = new Set(include);
    const ids = [d.id, ...descendants(d.id)];
    const on = !include.has(d.id);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setInclude(next);
  };

  const words = docs.filter((d) => include.has(d.id)).reduce((n, d) => n + d.wordCount, 0);
  const chapters = docs.filter((d) => d.kind === "text" && include.has(d.id)).length;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { ext, name } = EXTENSIONS[format];
      const path = await save({
        defaultPath: `${title.replace(/[<>:"/\\|?*]/g, "").trim() || "Book"}.${ext}`,
        filters: [{ name, extensions: [ext] }],
      });
      if (!path) return setBusy(false);
      const opts: BookOptions = { title, author, format, include: docs.filter((d) => include.has(d.id)).map((d) => d.id), plainLinks, folderHeadings, chapterTitles, pdfLayout, trim, paper };
      await writeFile(path, await buildBook(project.id, opts));
      const remembered: Saved = { title, author, format, plainLinks, folderHeadings, chapterTitles, pdfLayout, trim, paper };
      await api.saveProject({ ...project, settings: { ...project.settings, export: remembered } });
      await refreshProjects();
      notify(`Exported ${chapters} chapter${chapters === 1 ? "" : "s"} to ${path.split(/[\\/]/).pop()}`);
      revealItemInDir(path).catch(() => {});
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog export" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Export book">
        <header className="dialog-head">
          <h2>Export “{project.title}”</h2>
        </header>

        <div className="export-body">
          <div className="export-options">
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>Author</span>
              <input value={author} placeholder="Set a default in Settings" onChange={(e) => setAuthor(e.target.value)} />
            </label>

            <span className="field-label">Format</span>
            <div className="format-list">
              {(Object.keys(EXTENSIONS) as BookFormat[]).map((f) => (
                <button key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>
                  <strong>{EXTENSIONS[f].name}</strong>
                  <small>
                    {f === "epub" && "E-readers, Apple Books, Kindle (via Send to Kindle)"}
                    {f === "docx" && "Word, Google Docs, editors and agents"}
                    {f === "md" && "Plain text for other tools, websites, Obsidian"}
                    {f === "pdf" && "A manuscript for agents and editors, or a paperback ready to print"}
                  </small>
                </button>
              ))}
            </div>

            {format === "pdf" && (
              <>
                <div className="field">
                  <span>Layout</span>
                  <div className="segmented">
                    <button className={pdfLayout === "paperback" ? "on" : ""} onClick={() => setPdfLayout("paperback")}>
                      Paperback
                    </button>
                    <button className={pdfLayout === "manuscript" ? "on" : ""} onClick={() => setPdfLayout("manuscript")}>
                      Manuscript
                    </button>
                  </div>
                </div>
                {pdfLayout === "paperback" ? (
                  <label className="field">
                    <span>Trim size</span>
                    <Select value={trim} onChange={setTrim} options={(Object.keys(TRIMS) as Trim[]).map((t) => ({ value: t, label: TRIMS[t].label }))} />
                    <small className="hint">
                      Book typeface, justified text, chapter openings, running heads and page numbers. Margins allow for the
                      binding at this page count, as print-on-demand services ask.
                    </small>
                  </label>
                ) : (
                  <label className="field">
                    <span>Paper</span>
                    <Select value={paper} onChange={setPaper} options={[{ value: "letter", label: "US Letter" }, { value: "a4", label: "A4" }]} />
                    <small className="hint">
                      Standard manuscript format: Courier, double spaced, one-inch margins, your surname, title and page number on
                      every page, and a title page with the word count.
                    </small>
                  </label>
                )}
              </>
            )}

            <span className="field-label">Options</span>
            <label className="check">
              <input type="checkbox" checked={plainLinks} onChange={(e) => setPlainLinks(e.target.checked)} />
              <span>
                Turn entry links into plain text
                <small>
                  {plainLinks
                    ? "Readers just see the names."
                    : format === "md"
                      ? "Links are kept as [[Name]]."
                      : "Linked names are set in small caps."}
                </small>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={chapterTitles} onChange={(e) => setChapterTitles(e.target.checked)} />
              <span>
                Use document titles as chapter headings
                <small>Turn off if your chapters already start with their own heading.</small>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={folderHeadings} onChange={(e) => setFolderHeadings(e.target.checked)} />
              <span>
                Folders become part headings
                <small>e.g. a folder called “Part One” gets its own title page.</small>
              </span>
            </label>
          </div>

          <div className="export-contents">
            <div className="row">
              <span className="field-label">Contents</span>
              <span className="spacer" />
              <button className="link quiet" onClick={() => setInclude(new Set(docs.map((d) => d.id)))}>
                All
              </button>
              <button className="link quiet" onClick={() => setInclude(new Set())}>
                None
              </button>
            </div>
            <div className="export-tree">
              {docs.map((d) => (
                <label key={d.id} className="check tree" style={{ paddingLeft: 6 + (depth.get(d.id) ?? 0) * 16 }}>
                  <input type="checkbox" checked={include.has(d.id)} onChange={() => toggle(d)} />
                  {d.kind === "folder" ? <Folder size={13} /> : <FileText size={13} />}
                  <span>{d.title || "Untitled"}</span>
                  {d.kind === "text" && <small>{d.wordCount.toLocaleString()}</small>}
                </label>
              ))}
            </div>
          </div>
        </div>

        <footer className="dialog-foot">
          {error ? <span className="error-text">{error}</span> : <span className="hint">{chapters} chapters · {words.toLocaleString()} words</span>}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || chapters === 0} onClick={run}>
            {busy ? "Exporting…" : "Export…"}
          </button>
        </footer>
      </div>
    </div>
  );
}
