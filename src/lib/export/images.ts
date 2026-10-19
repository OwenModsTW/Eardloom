import { readFile } from "@tauri-apps/plugin-fs";
import type { JSONContent } from "@tiptap/react";
import { useStore } from "../../store";

export interface LoadedImage {
  name: string;
  bytes: Uint8Array;
  type: "png" | "jpg" | "gif";
  mime: string;
  width: number;
  height: number;
}

/** The world images a document uses. */
export function imagesIn(doc: JSONContent | null | undefined, into = new Set<string>()) {
  if (!doc) return into;
  if (doc.type === "image" && typeof doc.attrs?.asset === "string") into.add(doc.attrs.asset);
  doc.content?.forEach((c) => imagesIn(c, into));
  return into;
}

/** Reads images from the world's assets for an export. Formats Word can't hold are converted to PNG. */
export async function loadImages(names: Iterable<string>): Promise<Map<string, LoadedImage>> {
  const base = useStore.getState().world?.assetsPath;
  const out = new Map<string, LoadedImage>();
  if (!base) return out;
  for (const name of names) {
    try {
      let bytes: Uint8Array = await readFile(`${base}/${name}`);
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      let type: LoadedImage["type"] = ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "gif" ? "gif" : "png";
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
      if (!["png", "jpg", "jpeg", "gif"].includes(ext)) {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
        type = "png";
      }
      out.set(name, {
        name: type === "png" && !name.toLowerCase().endsWith(".png") ? `${name.replace(/\.[^.]+$/, "")}.png` : name,
        bytes,
        type,
        mime: type === "jpg" ? "image/jpeg" : `image/${type}`,
        width: bitmap.width,
        height: bitmap.height,
      });
      bitmap.close();
    } catch {
      /* a missing or unreadable image is left out */
    }
  }
  return out;
}
