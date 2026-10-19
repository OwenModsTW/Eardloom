// The whole shared wiki as one .html file: every page, the search and the images packed
// inside, so it can be sent like any other file and opened in any browser, even offline.
import { api } from "../api";
import { buildSite, type SiteFile, type SiteOptions } from "./site";
import type { Calendar, EntryType, WorldInfo } from "../types";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Stops page text from closing the script it's carried in. */
const scriptSafe = (json: string) => json.replace(/</g, "\\u003c");

// Pages are shown from the address after #, so links between them work inside one file.
const ROUTER = `
function go(p){ location.hash = encodeURIComponent(p); }
function show(){
  var p = decodeURIComponent(location.hash.slice(1)) || "index.html";
  var pg = PAGES[p] || PAGES["index.html"];
  document.getElementById("app").innerHTML = pg.h;
  document.title = pg.t;
  window.scrollTo(0, 0);
  bindSearch();
}
document.addEventListener("click", function(e){
  var a = e.target.closest && e.target.closest("a[href]");
  if (!a) return;
  var h = a.getAttribute("href");
  if (/^[^:#?\\/]+\\.html$/.test(h)) { e.preventDefault(); go(h); }
});
window.addEventListener("hashchange", show);
`;

export async function buildSingleFile(world: WorldInfo, types: EntryType[], opts: SiteOptions, calendar?: Calendar) {
  const { files, assets, count } = await buildSite(world, types, opts, calendar);
  const html = await packSingleFile(world.name, files, assets, async (name) => new Uint8Array(await api.readAsset(name)));
  return { html, count };
}

/** Packs a built website (pages, style, search and images) into one HTML document. */
export async function packSingleFile(worldName: string, files: SiteFile[], assets: string[], readAsset: (name: string) => Promise<Uint8Array>) {
  const css = files.find((f) => f.path === "style.css")?.content ?? "";
  const search = files.find((f) => f.path === "search.js")?.content ?? "";

  // Images as data, so nothing has to sit next to the file.
  const images = new Map<string, string>();
  for (const name of assets) {
    try {
      const bytes = await readAsset(name);
      images.set(name, `data:${MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"};base64,${toBase64(bytes)}`);
    } catch {
      /* a missing image is left out */
    }
  }

  const pages: Record<string, { t: string; h: string }> = {};
  for (const f of files.filter((x) => x.path.endsWith(".html"))) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(f.content)?.[1] ?? worldName;
    let body = /<body>([\s\S]*)<\/body>/.exec(f.content)?.[1] ?? "";
    body = body.replace(/<script src="search\.js"><\/script>/g, "");
    body = body.replace(/(src|href)="assets\/([^"]+)"/g, (whole, attr, name) => (images.has(name) ? `${attr}="${images.get(name)}"` : whole));
    // Titles are already escaped for HTML; the router sets document.title from text.
    pages[f.path] = { t: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'), h: body };
  }

  // The site's search, re-attached after each page is shown; choosing a result stays in the file.
  const [, searchData = "", searchCode = ""] = /^(var SEARCH=[\s\S]*?;)\n([\s\S]*)$/.exec(search) ?? [];
  const bindSearch = `function bindSearch(){ ${searchCode.replace(/location\.href=hits\[idx\]\.u/g, "go(hits[idx].u)")} }`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${worldName.replace(/</g, "&lt;")}</title><style>${css}</style></head>
<body><div id="app"></div>
<script>
var PAGES = ${scriptSafe(JSON.stringify(pages))};
${scriptSafe(searchData)}
${ROUTER}
${bindSearch}
show();
</script></body></html>`;
}
