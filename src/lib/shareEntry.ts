import { ask, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore } from "../store";
import { copyCard } from "./export/card";
import { entryDocx, entryHtml, entryMarkdown, entryParts, entryPdf, entryText, fileNameFor } from "./export/entry";
import type { Entry } from "./types";

export type ShareHow = "picture" | "text" | "pdf" | "docx" | "md" | "html";

const FILES: Record<Exclude<ShareHow, "picture" | "text">, { ext: string; name: string }> = {
  pdf: { ext: "pdf", name: "PDF" },
  docx: { ext: "docx", name: "Word document" },
  md: { ext: "md", name: "Markdown" },
  html: { ext: "html", name: "Web page" },
};

/** Private and spoiler entries get a second look before they leave the app. */
async function okToShare(entry: Entry) {
  if (entry.visibility === "public") return true;
  const what = entry.visibility === "private" ? "private (it never leaves this computer otherwise)" : "a spoiler";
  return ask(`“${entry.title || "This entry"}” is marked ${what}. Share it anyway?`, { title: "Share entry", kind: "warning" });
}

/** Shares one entry: copied as a picture or text, or saved as a file. */
export async function shareEntry(entry: Entry, how: ShareHow) {
  const { notify } = useStore.getState();
  if (!(await okToShare(entry))) return;
  try {
    if (how === "picture") {
      await copyCard(entry, useStore.getState().types.find((t) => t.id === entry.typeId));
      return notify("Copied as a picture. Paste it into any chat or message.");
    }
    const parts = entryParts(entry);
    if (how === "text") {
      await navigator.clipboard.writeText(entryText(parts));
      return notify("Copied as text");
    }
    const f = FILES[how];
    const path = await save({ defaultPath: fileNameFor(entry.title || "entry", f.ext), filters: [{ name: f.name, extensions: [f.ext] }] });
    if (!path) return;
    notify(`Making ${f.name}…`);
    const bytes =
      how === "pdf"
        ? await entryPdf(parts)
        : how === "docx"
          ? await entryDocx(parts)
          : new TextEncoder().encode(how === "md" ? entryMarkdown(parts) : await entryHtml(parts));
    await writeFile(path, bytes);
    notify(`Saved ${f.name}`);
    revealItemInDir(path).catch(() => {});
  } catch (e) {
    notify(`Couldn't share: ${String(e)}`);
  }
}
