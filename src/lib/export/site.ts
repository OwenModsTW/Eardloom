import type { JSONContent } from "@tiptap/react";
import { api } from "../api";
import { docToHtml, esc } from "./html";
import { mentionText } from "../editor/mention";
import type { Calendar, Entry, EntryType, WorldDate, WorldInfo } from "../types";
import { EMPTY_CALENDAR, formatDate } from "../calendar";

export interface SiteOptions {
  /** Include spoiler entries behind a "Reveal" gate, or leave them out entirely. */
  includeSpoilers: boolean;
}

export interface SiteFile {
  path: string;
  content: string;
}

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** Every entry id referenced by a document: @mentions anywhere inside it. */
function mentionsIn(doc: unknown, out: Set<string>) {
  if (Array.isArray(doc)) doc.forEach((d) => mentionsIn(d, out));
  else if (doc && typeof doc === "object") {
    const n = doc as JSONContent;
    if (n.type === "mention" && n.attrs?.id) out.add(n.attrs.id);
    if (n.content) mentionsIn(n.content, out);
  }
}

const CSS = `
:root { --bg:#111b1a; --side:#0c1a18; --raised:#162321; --line:#1f302d; --line2:#2d4540; --text:#ece6d5; --soft:#bcb5a3; --muted:#7c8a85; --accent:#f6bd60;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; --sans:"Segoe UI",system-ui,-apple-system,sans-serif; color-scheme:dark; }
@media (prefers-color-scheme: light) { :root { --bg:#f4f0e6; --side:#e6ebe3; --raised:#fbf9f3; --line:#ddd8c8; --line2:#c4c3ae; --text:#1b2826; --soft:#43514c; --muted:#737a70; --accent:#a86f12; color-scheme:light; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.6 var(--sans); }
a { color:inherit; text-decoration-color:color-mix(in srgb, var(--accent) 50%, transparent); text-underline-offset:3px; }
a:hover { color:var(--accent); }
.top { display:flex; align-items:center; gap:16px; padding:10px 24px; border-bottom:1px solid var(--line); background:var(--side); position:sticky; top:0; z-index:5; }
.top .world { font:600 19px var(--serif); text-decoration:none; }
.search { margin-left:auto; position:relative; }
.search input { width:260px; font:inherit; font-size:14px; padding:6px 10px; border-radius:4px; border:1px solid var(--line2); background:var(--bg); color:var(--text); }
.results { position:absolute; right:0; top:calc(100% + 4px); width:340px; background:var(--raised); border:1px solid var(--line2); border-radius:6px; box-shadow:0 10px 30px #0008; padding:4px; display:none; }
.results a { display:block; padding:6px 10px; border-radius:4px; text-decoration:none; }
.results a:hover, .results a.active { background:var(--line); }
.results small { color:var(--muted); margin-left:6px; }
.layout { display:grid; grid-template-columns:220px minmax(0,1fr); min-height:calc(100vh - 52px); }
nav.side { background:var(--side); border-right:1px solid var(--line); padding:18px 12px; font-size:15px; }
nav.side h4 { margin:0 8px 8px; font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
nav.side a { display:flex; justify-content:space-between; padding:4px 8px; border-radius:4px; text-decoration:none; color:var(--soft); }
nav.side a:hover, nav.side a.on { background:var(--line); color:var(--text); }
nav.side small { color:var(--muted); }
main { padding:28px 40px 80px; max-width:1180px; }
h1, h2, h3, h4 { font-family:var(--serif); font-weight:600; line-height:1.25; }
h1 { font-size:36px; margin:0 0 6px; }
.eyebrow { font-size:13px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; margin:0 0 4px; }
.aka { color:var(--muted); font-style:italic; margin:0 0 8px; }
.lede { font:italic 18px/1.5 var(--serif); color:var(--soft); margin:6px 0 20px; }
.premise { font:italic 19px/1.5 var(--serif); color:var(--soft); max-width:720px; }
.entry { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:40px; }
.article { font:17px/1.75 var(--serif); }
.article p { margin:0 0 .9em; }
.article blockquote { border-left:2px solid var(--accent); margin:0 0 1em; padding-left:14px; font-style:italic; color:var(--soft); }
.article hr { border:0; text-align:center; margin:1.5em 0; } .article hr::after { content:"* * *"; color:var(--muted); }
.mention { text-decoration:underline; text-decoration-color:var(--c, var(--accent)); text-decoration-thickness:1px; }
.infobox { align-self:start; background:var(--raised); border:1px solid var(--line); border-top:3px solid var(--c, var(--accent)); border-radius:4px; font-size:14.5px; }
.infobox .ib-title { padding:8px 12px; text-align:center; font:600 16px var(--serif); border-bottom:1px solid var(--line); }
.infobox img { display:block; width:100%; max-height:320px; object-fit:cover; border-bottom:1px solid var(--line); }
.infobox h5 { margin:0; padding:4px 10px; text-align:center; font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--c, var(--accent)); border-bottom:1px solid var(--line); }
.infobox .row { display:grid; grid-template-columns:100px 1fr; gap:8px; padding:5px 12px; border-bottom:1px solid var(--line); }
.infobox .row:last-child { border-bottom:0; }
.infobox .row b { color:var(--muted); font-weight:600; font-size:13.5px; }
.infobox .row p { margin:0 0 .4em; }
.backlinks { margin-top:44px; }
.backlinks h3, .cat h2 { font:600 12px var(--sans); letter-spacing:.08em; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--line2); padding-bottom:5px; }
.links { list-style:none; padding:0; margin:0; columns:2; }
.links li { padding:3px 0; break-inside:avoid; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; font-size:13px; color:var(--muted); padding:6px 10px; border-bottom:1px solid var(--line2); }
td { padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:middle; }
td.name { display:flex; align-items:center; gap:10px; font-weight:600; }
.thumb { width:30px; height:30px; border-radius:3px; object-fit:cover; display:inline-grid; place-items:center; flex-shrink:0; background:color-mix(in srgb, var(--c) 18%, var(--raised)); font-size:18px; }
td.sum { color:var(--soft); }
.cats { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px,1fr)); gap:28px; margin-top:28px; }
.cat ul { list-style:none; padding:0; margin:0; } .cat li { padding:3px 0; }
.cat .more { color:var(--muted); font-size:14px; }
.gate { padding:40px; text-align:center; border:1px dashed var(--line2); border-radius:6px; color:var(--soft); }
.gate button { margin-top:10px; font:inherit; padding:6px 14px; border-radius:4px; border:0; background:var(--accent); color:#1d1505; cursor:pointer; }
footer.made { margin-top:60px; font-size:13px; color:var(--muted); }
@media (max-width: 800px) {
  .layout { grid-template-columns:1fr; } nav.side { display:none; }
  .entry { grid-template-columns:1fr; } main { padding:20px 16px 60px; } .search input { width:160px; } .links { columns:1; }
}
`;

const SEARCH_JS = `
(function(){
  var input=document.getElementById('q'), box=document.getElementById('results'), idx=0, hits=[];
  function render(){
    box.innerHTML=hits.map(function(h,i){return '<a href="'+h.u+'"'+(i===idx?' class="active"':'')+'>'+h.t.replace(/</g,'&lt;')+'<small>'+h.c+'</small></a>';}).join('');
    box.style.display=hits.length?'block':'none';
  }
  input.addEventListener('input',function(){
    var q=input.value.trim().toLowerCase(); idx=0;
    hits=q?SEARCH.filter(function(e){return (e.t+' '+e.a+' '+e.s).toLowerCase().indexOf(q)>-1;}).slice(0,10):[];
    render();
  });
  input.addEventListener('keydown',function(ev){
    if(ev.key==='ArrowDown'){idx=Math.min(idx+1,hits.length-1);render();ev.preventDefault();}
    if(ev.key==='ArrowUp'){idx=Math.max(idx-1,0);render();ev.preventDefault();}
    if(ev.key==='Enter'&&hits[idx]){location.href=hits[idx].u;}
    if(ev.key==='Escape'){hits=[];render();}
  });
  document.addEventListener('click',function(ev){if(!box.contains(ev.target)&&ev.target!==input){hits=[];render();}});
})();
`;

/**
 * Builds a self-contained wiki for the world. Private entries are never included;
 * links to anything left out become plain text.
 */
export async function buildSite(world: WorldInfo, types: EntryType[], opts: SiteOptions, calendar: Calendar = EMPTY_CALENDAR) {
  const summaries = await api.listEntries();
  const all: Entry[] = [];
  for (const s of summaries) all.push(await api.getEntry(s.id));
  const entries = all.filter((e) => e.visibility === "public" || (opts.includeSpoilers && e.visibility === "spoiler"));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const typeOf = (e: Entry) => types.find((t) => t.id === e.typeId);
  const titleOf = (id: string) => all.find((e) => e.id === id)?.title;

  // Stable, unique file names.
  const used = new Set(["index", "search", "style"]);
  const unique = (base: string) => {
    let name = base || "page";
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return `${name}.html`;
  };
  const catUrl = new Map(types.map((t) => [t.id, unique(`category-${slugify(t.plural)}`)]));
  const entryUrl = new Map(entries.map((e) => [e.id, unique(slugify(e.title) || "entry")]));

  const link = (id: string, label?: string) => {
    const e = byId.get(id);
    const text = esc(label ?? e?.title ?? titleOf(id) ?? "");
    if (!e) return text;
    const color = typeOf(e)?.color;
    return `<a class="mention" href="${entryUrl.get(id)}"${color ? ` style="--c:${color}"` : ""}>${text}</a>`;
  };
  // Images used in the articles that are shared (so nothing from a private entry is copied).
  const articleImages = new Set<string>();
  const rich = (doc: JSONContent | null | undefined) =>
    docToHtml(doc, {
      headingOffset: 1,
      mention: (m) => link(m.attrs?.id, mentionText(m.attrs, titleOf(m.attrs?.id))),
      image: (asset) => (articleImages.add(asset), `assets/${asset}`),
      footnote: (text) => `<sup class="footnote" title="${esc(text)}">*</sup>`,
    });

  const thumb = (e: Entry, color?: string) =>
    e.image
      ? `<img class="thumb" src="assets/${esc(e.image)}" alt=""/>`
      : `<span class="thumb" style="--c:${color ?? "#888"}">${e.emoji ? esc(e.emoji) : ""}</span>`;

  const visibleTypes = types.filter((t) => entries.some((e) => e.typeId === t.id));
  const page = (title: string, body: string, activeType?: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} · ${esc(world.name)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
<header class="top"><a class="world" href="index.html">${esc(world.name)}</a>
<div class="search"><input id="q" placeholder="Search ${esc(world.name)}" autocomplete="off"/><div class="results" id="results"></div></div></header>
<div class="layout"><nav class="side"><h4>Codex</h4>
${visibleTypes
  .map((t) => `<a href="${catUrl.get(t.id)}"${t.id === activeType ? ' class="on"' : ""}>${esc(t.plural)} <small>${entries.filter((e) => e.typeId === t.id).length}</small></a>`)
  .join("\n")}
</nav><main>${body}
<footer class="made">Made with Eardloom</footer></main></div>
<script src="search.js"></script></body></html>`;

  const files: SiteFile[] = [{ path: "style.css", content: CSS }];

  // Search index, as a script so it works when opened straight from disk.
  const index = entries.map((e) => ({
    t: e.title || "Untitled",
    a: e.aliases.join(" "),
    s: e.visibility === "spoiler" ? "" : e.summary,
    u: entryUrl.get(e.id),
    c: typeOf(e)?.name ?? "",
  }));
  files.push({ path: "search.js", content: `var SEARCH=${JSON.stringify(index)};\n${SEARCH_JS}` });

  // Backlinks: which included entries point at each entry, and how.
  const backlinks = new Map<string, Set<string>>();
  for (const e of entries) {
    const refs = new Set<string>();
    mentionsIn(e.body, refs);
    for (const f of typeOf(e)?.fields ?? []) {
      const v = e.fields[f.id];
      if (f.kind === "entry" && typeof v === "string") refs.add(v);
      if (f.kind === "entries" && Array.isArray(v)) v.forEach((x) => refs.add(x));
      if (f.kind === "longtext" && v && typeof v === "object") mentionsIn(v, refs);
    }
    refs.forEach((target) => target !== e.id && (backlinks.get(target) ?? backlinks.set(target, new Set()).get(target)!).add(e.id));
  }

  // Entry pages
  for (const e of entries) {
    const t = typeOf(e);
    const color = t?.color ?? "#f6bd60";
    const rows: string[] = [];
    let section = "";
    for (const f of t?.fields ?? []) {
      const v = e.fields[f.id];
      let html = "";
      if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
      if (f.kind === "entry" || f.kind === "entries") {
        const ids = (Array.isArray(v) ? v : [String(v)]).filter((id) => byId.has(id));
        html = ids.map((id) => link(id)).join(", ");
      } else if (f.kind === "worlddate") html = esc(formatDate(calendar, v as WorldDate));
      else if (f.kind === "longtext" && typeof v === "object") html = rich(v as JSONContent);
      else if (typeof v === "boolean") html = v ? "Yes" : "No";
      else if (Array.isArray(v)) html = v.map((x) => esc(String(x))).join(", ");
      else if (f.kind === "url") html = `<a href="${esc(String(v))}" rel="noopener">${esc(String(v))}</a>`;
      else html = esc(String(v));
      if (!html) continue;
      if ((f.section ?? "") !== section) {
        section = f.section ?? "";
        if (section) rows.push(`<h5>${esc(section)}</h5>`);
      }
      rows.push(`<div class="row"><b>${esc(f.label)}</b><div>${html}</div></div>`);
    }

    const refs = [...(backlinks.get(e.id) ?? [])].map((id) => byId.get(id)!).sort((a, b) => a.title.localeCompare(b.title));
    const content = `
<article class="entry" style="--c:${color}">
  <div>
    <p class="eyebrow" style="color:${color}">${esc(t?.name ?? "")}</p>
    <h1>${e.emoji ? `${esc(e.emoji)} ` : ""}${esc(e.title || "Untitled")}</h1>
    ${e.aliases.length ? `<p class="aka">Also known as ${e.aliases.map(esc).join(", ")}</p>` : ""}
    ${e.summary ? `<p class="lede">${esc(e.summary)}</p>` : ""}
    <div class="article">${rich(e.body)}</div>
    ${refs.length ? `<section class="backlinks"><h3>Referenced by</h3><ul class="links">${refs.map((r) => `<li>${link(r.id)}</li>`).join("")}</ul></section>` : ""}
  </div>
  <aside class="infobox"><div class="ib-title">${esc(e.title)}</div>
    ${e.image ? `<img src="assets/${esc(e.image)}" alt=""/>` : ""}
    ${rows.join("\n")}
  </aside>
</article>`;
    const body =
      e.visibility === "spoiler"
        ? `<div class="gate" id="gate"><strong>This page contains spoilers.</strong><br/><button onclick="document.getElementById('gate').remove();document.getElementById('spoiler').hidden=false">Reveal</button></div><div id="spoiler" hidden>${content}</div>`
        : content;
    files.push({ path: entryUrl.get(e.id)!, content: page(e.title || "Untitled", body, e.typeId) });
  }

  // Category pages
  for (const t of visibleTypes) {
    const list = entries.filter((e) => e.typeId === t.id).sort((a, b) => a.title.localeCompare(b.title));
    const rows = list
      .map(
        (e) =>
          `<tr><td class="name">${thumb(e, t.color)}<a href="${entryUrl.get(e.id)}">${esc(e.title || "Untitled")}</a></td><td class="sum">${
            e.visibility === "spoiler" ? "<em>Spoiler</em>" : esc(e.summary)
          }</td></tr>`,
      )
      .join("\n");
    files.push({
      path: catUrl.get(t.id)!,
      content: page(t.plural, `<p class="eyebrow" style="color:${t.color}">Category</p><h1>${esc(t.plural)}</h1><table><thead><tr><th>Name</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table>`, t.id),
    });
  }

  // Home page
  const cats = visibleTypes
    .map((t) => {
      const list = entries.filter((e) => e.typeId === t.id).sort((a, b) => a.title.localeCompare(b.title));
      const shown = list.slice(0, 8).map((e) => `<li>${link(e.id)}</li>`).join("");
      const more = list.length > 8 ? `<li class="more"><a href="${catUrl.get(t.id)}">and ${list.length - 8} more</a></li>` : "";
      return `<section class="cat"><h2><a href="${catUrl.get(t.id)}" style="color:${t.color};text-decoration:none">${esc(t.plural)}</a></h2><ul>${shown}${more}</ul></section>`;
    })
    .join("\n");
  files.push({
    path: "index.html",
    content: page(world.name, `<h1>${esc(world.name)}</h1>${world.description ? `<p class="premise">${esc(world.description)}</p>` : ""}<div class="cats">${cats}</div>`),
  });

  const assets = [...new Set([...entries.map((e) => e.image).filter((x): x is string => !!x), ...articleImages])];
  return { files, assets, count: entries.length };
}
