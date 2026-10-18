import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";

interface Iconish {
  typeId: string;
  image: string | null;
  emoji: string | null;
}

export function assetUrl(assetsPath: string, file: string | null) {
  return file ? convertFileSrc(`${assetsPath}/${file}`) : null;
}

/** Small inline marker for an entry: its emoji if it has one, otherwise its category icon. */
export function EntryGlyph({ entry, size = 14 }: { entry: Iconish | undefined; size?: number }) {
  const type = useStore((s) => s.types.find((t) => t.id === entry?.typeId));
  if (entry?.emoji)
    return (
      <span className="emoji-glyph" style={{ fontSize: size, width: size + 2 }}>
        {entry.emoji}
      </span>
    );
  return <TypeIcon name={type?.icon ?? ""} size={size} color={type?.color} className="type-glyph" />;
}

/** Square thumbnail: the image, else the emoji, else a tile in the category's colour. */
export function EntryThumb({ entry, size = 26 }: { entry: Iconish; size?: number }) {
  const type = useStore((s) => s.types.find((t) => t.id === entry.typeId));
  const assetsPath = useStore((s) => s.world?.assetsPath ?? "");
  const style = { width: size, height: size, "--chip": type?.color } as React.CSSProperties;
  if (entry.image) return <img className="thumb" style={style} src={assetUrl(assetsPath, entry.image)!} alt="" />;
  if (entry.emoji)
    return (
      <span className="thumb thumb-emoji" style={{ ...style, fontSize: size * 0.62 }}>
        {entry.emoji}
      </span>
    );
  return (
    <span className="thumb thumb-blank" style={style}>
      <TypeIcon name={type?.icon ?? ""} size={Math.round(size * 0.5)} />
    </span>
  );
}
