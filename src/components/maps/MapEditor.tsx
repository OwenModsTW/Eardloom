import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  ArrowLeft, Brush, Droplet, Fence, Hand, MapPin, Maximize, MousePointer2, Pentagon, Redo2, Route, Stamp, TreePine,
  Type, Undo2, Waves, Waypoints,
} from "lucide-react";
import { api, newId } from "../../lib/api";
import { useStore } from "../../store";
import { generateWorld, simplify } from "../../lib/maps/geometry";
import { MAP_STYLES, REGION_COLORS } from "../../lib/maps/styles";
import { SYMBOLS } from "../../lib/maps/symbols";
import { normaliseData, type AreaKind, type LineKind, type MapData, type MapStyle, type Pt, type WorldMap } from "../../lib/maps/model";
import { useAutosave } from "../../lib/useAutosave";
import { assetUrl, EntryGlyph } from "../EntryIcon";
import { EntryPicker } from "../Inputs";
import { Select } from "../Select";
import { MapRenderer } from "./MapRenderer";

type Tool = "pan" | "select" | AreaKind | LineKind | "symbol" | "label" | "pin";

const AREA_TOOLS: AreaKind[] = ["land", "forest", "lake", "region"];
const LINE_TOOLS: LineKind[] = ["river", "road", "route", "border"];

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode; key?: string }[] = [
  { tool: "pan", label: "Move around (H)", icon: <Hand size={16} />, key: "h" },
  { tool: "select", label: "Select and move (V)", icon: <MousePointer2 size={16} />, key: "v" },
  { tool: "land", label: "Land (L)", icon: <Brush size={16} />, key: "l" },
  { tool: "forest", label: "Forest", icon: <TreePine size={16} /> },
  { tool: "lake", label: "Lake", icon: <Droplet size={16} /> },
  { tool: "region", label: "Region or territory", icon: <Pentagon size={16} /> },
  { tool: "river", label: "River", icon: <Waves size={16} /> },
  { tool: "road", label: "Road", icon: <Route size={16} /> },
  { tool: "route", label: "Route or trade lane", icon: <Waypoints size={16} /> },
  { tool: "border", label: "Border", icon: <Fence size={16} /> },
  { tool: "symbol", label: "Symbol (S)", icon: <Stamp size={16} />, key: "s" },
  { tool: "label", label: "Label (T)", icon: <Type size={16} />, key: "t" },
  { tool: "pin", label: "Pin an entry (P)", icon: <MapPin size={16} />, key: "p" },
];

const isTyping = () => !!document.activeElement?.closest("input, textarea, [contenteditable='true']");

export function MapEditor({ id, focusPin }: { id: string; focusPin?: string }) {
  const { go, entries, types, world, notify } = useStore();
  const [map, setMap] = useState<WorldMap | null>(null);
  const [allMaps, setAllMaps] = useState<WorldMap[]>([]);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [symbol, setSymbol] = useState("mountain");
  const [selected, setSelected] = useState<string | null>(focusPin ?? null);
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hoverPin, setHoverPin] = useState<{ id: string; x: number; y: number } | null>(null);
  const [regionColor, setRegionColor] = useState(REGION_COLORS[0]);
  const past = useRef<MapData[]>([]);
  const future = useRef<MapData[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const action = useRef<
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; hit: string | null }
    | { kind: "draw" }
    | { kind: "move"; id: string; dx: number; dy: number; before: MapData; moved: boolean }
    | null
  >(null);

  useEffect(() => {
    api.getMap(id).then((m) => m && setMap({ ...m, data: normaliseData(m.data) }));
    api.listMaps().then(setAllMaps);
  }, [id]);

  const { schedule, flush } = useAutosave((m: WorldMap) => api.saveMap(m), 700);

  // ---- data changes with undo ----
  const commit = useCallback(
    (fn: (d: MapData) => MapData, record = true) =>
      setMap((m) => {
        if (!m) return m;
        if (record) {
          past.current = [...past.current.slice(-60), m.data];
          future.current = [];
        }
        const next = { ...m, data: fn(m.data) };
        schedule(next);
        return next;
      }),
    [schedule],
  );
  const undo = () =>
    setMap((m) => {
      const prev = past.current.pop();
      if (!m || !prev) return m;
      future.current.push(m.data);
      const next = { ...m, data: prev };
      schedule(next);
      return next;
    });
  const redo = () =>
    setMap((m) => {
      const nxt = future.current.pop();
      if (!m || !nxt) return m;
      past.current.push(m.data);
      const next = { ...m, data: nxt };
      schedule(next);
      return next;
    });
  const updateMap = (patch: Partial<WorldMap>) =>
    setMap((m) => {
      if (!m) return m;
      const next = { ...m, ...patch };
      schedule(next);
      return next;
    });

  // ---- view: fit, zoom, coordinates ----
  const fit = useCallback(() => {
    const box = boxRef.current;
    if (!box || !map) return;
    const { width, height } = box.getBoundingClientRect();
    const k = Math.min(width / map.width, height / map.height) * 0.94;
    setView({ k, x: (width - map.width * k) / 2, y: (height - map.height * k) / 2 });
  }, [map?.width, map?.height]);
  useEffect(() => {
    if (map) fit();
  }, [map?.id, fit]);

  // Centre on a pin when arriving from an entry's "On maps" link.
  useEffect(() => {
    if (!map || !focusPin || !boxRef.current) return;
    const pin = map.data.pins.find((p) => p.id === focusPin);
    if (!pin) return;
    const { width, height } = boxRef.current.getBoundingClientRect();
    const k = Math.max(view.k, 1);
    setView({ k, x: width / 2 - pin.x * k, y: height / 2 - pin.y * k });
  }, [map?.id, focusPin]);

  const toMap = (clientX: number, clientY: number): Pt => {
    const r = boxRef.current!.getBoundingClientRect();
    return [(clientX - r.left - view.x) / view.k, (clientY - r.top - view.y) / view.k];
  };

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      setView((v) => {
        const k = Math.min(8, Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.0015)));
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
      });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [map?.id]);

  // ---- keyboard ----
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!editing || isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") (e.preventDefault(), e.shiftKey ? redo() : undo());
      else if (mod && e.key.toLowerCase() === "y") (e.preventDefault(), redo());
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) (e.preventDefault(), removeItem(selected));
      else if (e.key === "Escape") (setDraft(null), setSelected(null));
      else if (!mod) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.tool);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editing, selected]);

  const removeItem = (itemId: string) => {
    commit((d) => ({
      ...d,
      areas: d.areas.filter((x) => x.id !== itemId),
      lines: d.lines.filter((x) => x.id !== itemId),
      symbols: d.symbols.filter((x) => x.id !== itemId),
      labels: d.labels.filter((x) => x.id !== itemId),
      pins: d.pins.filter((x) => x.id !== itemId),
    }));
    setSelected(null);
  };

  // ---- pointer handling ----
  const itemAt = (target: EventTarget) => (target as Element).closest?.("[data-id]")?.getAttribute("data-id") ?? null;

  const onDown = (e: React.PointerEvent) => {
    if (!map) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toMap(e.clientX, e.clientY);
    const panning = !editing || tool === "pan" || e.button === 1;
    const hit = itemAt(e.target);

    if (!panning && editing) {
      if ((AREA_TOOLS as string[]).includes(tool) || (LINE_TOOLS as string[]).includes(tool)) {
        action.current = { kind: "draw" };
        setDraft([p]);
        return;
      }
      if (tool === "symbol") {
        const sid = newId();
        commit((d) => ({ ...d, symbols: [...d.symbols, { id: sid, icon: symbol, x: p[0], y: p[1], size: SYMBOLS[symbol]?.group === "Space" ? 34 : 40 }] }));
        setSelected(sid);
        return;
      }
      if (tool === "label") {
        const lid = newId();
        commit((d) => ({ ...d, labels: [...d.labels, { id: lid, text: "New label", x: p[0], y: p[1], size: 28, kind: "place" }] }));
        setSelected(lid);
        setTool("select");
        return;
      }
      if (tool === "pin") {
        const pid = newId();
        commit((d) => ({ ...d, pins: [...d.pins, { id: pid, x: p[0], y: p[1] }] }));
        setSelected(pid);
        setTool("select");
        return;
      }
      if (tool === "select") {
        setSelected(hit);
        const d = map.data;
        const movable = d.symbols.find((x) => x.id === hit) ?? d.labels.find((x) => x.id === hit) ?? d.pins.find((x) => x.id === hit);
        if (movable) {
          action.current = { kind: "move", id: movable.id, dx: p[0] - movable.x, dy: p[1] - movable.y, before: d, moved: false };
          return;
        }
        if (hit) return;
      }
    }
    action.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, hit };
  };

  const onMove = (e: React.PointerEvent) => {
    const a = action.current;
    if (!a) return;
    if (a.kind === "pan") setView((v) => ({ ...v, x: a.vx + e.clientX - a.sx, y: a.vy + e.clientY - a.sy }));
    else if (a.kind === "draw") {
      const p = toMap(e.clientX, e.clientY);
      setDraft((pts) => {
        if (!pts) return pts;
        const last = pts[pts.length - 1];
        return Math.hypot(p[0] - last[0], p[1] - last[1]) * view.k > 4 ? [...pts, p] : pts;
      });
    } else if (a.kind === "move") {
      const p = toMap(e.clientX, e.clientY);
      a.moved = true;
      const nx = p[0] - a.dx;
      const ny = p[1] - a.dy;
      commit(
        (d) => ({
          ...d,
          symbols: d.symbols.map((x) => (x.id === a.id ? { ...x, x: nx, y: ny } : x)),
          labels: d.labels.map((x) => (x.id === a.id ? { ...x, x: nx, y: ny } : x)),
          pins: d.pins.map((x) => (x.id === a.id ? { ...x, x: nx, y: ny } : x)),
        }),
        false,
      );
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const a = action.current;
    action.current = null;
    // A click (not a drag) on a pin while viewing opens what it points to.
    if (a?.kind === "pan" && !editing && a.hit && Math.hypot(e.clientX - a.sx, e.clientY - a.sy) < 4 && map?.data.pins.some((p) => p.id === a.hit)) {
      openPin(a.hit);
      return;
    }
    if (a?.kind === "move" && a.moved) {
      // One undo step for the whole drag.
      past.current = [...past.current.slice(-60), a.before];
      future.current = [];
    }
    if (a?.kind !== "draw" || !draft) return;
    const pts = simplify(draft, 1.5 / view.k);
    setDraft(null);
    if ((AREA_TOOLS as string[]).includes(tool) && pts.length >= 4) {
      const kind = tool as AreaKind;
      commit((d) => ({ ...d, areas: [...d.areas, { id: newId(), kind, points: pts, ...(kind === "region" ? { color: regionColor } : {}) }] }));
    } else if ((LINE_TOOLS as string[]).includes(tool) && pts.length >= 2) {
      commit((d) => ({ ...d, lines: [...d.lines, { id: newId(), kind: tool as LineKind, points: pts }] }));
    }
  };

  // ---- export ----
  const exportPng = async () => {
    if (!map) return;
    await flush();
    let image: string | null = null;
    if (map.image) {
      const bytes = new Uint8Array(await api.readAsset(map.image));
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      image = `data:image/${map.image.split(".").pop()};base64,${btoa(bin)}`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${map.width}" height="${map.height}" viewBox="0 0 ${map.width} ${map.height}">${renderToStaticMarkup(
      <MapRenderer data={map.data} width={map.width} height={map.height} image={image} />,
    )}</svg>`;
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = map.width;
    canvas.height = map.height;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const path = await save({ defaultPath: `${map.title || "Map"}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
    if (!path) return;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    notify("Map exported");
  };

  const generate = (count: number) => {
    if (!map) return;
    const shapes = generateWorld(map.width, map.height, Math.floor(Math.random() * 1e9), count);
    commit((d) => ({ ...d, areas: [...d.areas.filter((a) => a.kind !== "land"), ...shapes.map((points) => ({ id: newId(), kind: "land" as const, points }))] }));
  };

  const removeMap = async () => {
    if (!map || !(await ask(`Delete the map "${map.title}"? This can't be undone.`, { title: "Delete map", kind: "warning" }))) return;
    await api.deleteMap(map.id);
    go({ view: "maps" });
  };

  const imageUrl = map?.image && world ? assetUrl(world.assetsPath, map.image) : null;
  const style = map ? MAP_STYLES[map.data.style] ?? MAP_STYLES.parchment : MAP_STYLES.parchment;
  const sel = useMemo(() => {
    if (!map || !selected) return null;
    const d = map.data;
    return (
      (d.symbols.find((x) => x.id === selected) && { kind: "symbol" as const, item: d.symbols.find((x) => x.id === selected)! }) ||
      (d.labels.find((x) => x.id === selected) && { kind: "label" as const, item: d.labels.find((x) => x.id === selected)! }) ||
      (d.pins.find((x) => x.id === selected) && { kind: "pin" as const, item: d.pins.find((x) => x.id === selected)! }) ||
      (d.areas.find((x) => x.id === selected) && { kind: "area" as const, item: d.areas.find((x) => x.id === selected)! }) ||
      (d.lines.find((x) => x.id === selected) && { kind: "line" as const, item: d.lines.find((x) => x.id === selected)! }) ||
      null
    );
  }, [map, selected]);

  if (!map) return null;
  const setItem = (list: "symbols" | "labels" | "pins" | "areas" | "lines", itemId: string, patch: Record<string, unknown>) =>
    commit((d) => ({ ...d, [list]: (d[list] as { id: string }[]).map((x) => (x.id === itemId ? { ...x, ...patch } : x)) }));

  const pinTarget = (pinId: string) => {
    const pin = map.data.pins.find((p) => p.id === pinId);
    const entry = entries.find((e) => e.id === pin?.entryId);
    const sub = allMaps.find((m) => m.id === pin?.mapId);
    return { pin, entry, sub };
  };
  const openPin = (pinId: string) => {
    const { entry, sub } = pinTarget(pinId);
    if (sub) go({ view: "map", id: sub.id });
    else if (entry) go({ view: "entry", id: entry.id });
  };

  const draftKind = (AREA_TOOLS as string[]).includes(tool) ? "area" : "line";
  const cursor = !editing || tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";

  return (
    <div className="map-page">
      <header className="map-bar">
        <button className="icon-btn" onClick={() => (flush(), go({ view: "maps" }))} title="All maps">
          <ArrowLeft size={15} />
        </button>
        <input className="map-title" value={map.title} onChange={(e) => updateMap({ title: e.target.value })} />
        <div className="segmented">
          <button className={!editing ? "on" : ""} onClick={() => (setEditing(false), setSelected(null))}>
            View
          </button>
          <button className={editing ? "on" : ""} onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <span className="spacer" />
        {editing && (
          <>
            <button className="icon-btn" onClick={undo} title="Undo (Ctrl+Z)">
              <Undo2 size={15} />
            </button>
            <button className="icon-btn" onClick={redo} title="Redo (Ctrl+Y)">
              <Redo2 size={15} />
            </button>
          </>
        )}
        <button className="icon-btn" onClick={fit} title="Fit to window">
          <Maximize size={15} />
        </button>
        <button className="ghost tiny" onClick={exportPng}>
          Export PNG
        </button>
      </header>

      <div className="map-body">
        {editing && (
          <nav className="map-tools">
            {TOOLS.map((t) => (
              <button key={t.tool} className={tool === t.tool ? "on" : ""} title={t.label} onClick={() => setTool(t.tool)}>
                {t.icon}
              </button>
            ))}
          </nav>
        )}
        {editing && tool === "symbol" && (
          <div className="symbol-palette">
            {(["Land", "Places", "Space"] as const).map((g) => (
              <section key={g}>
                <h5>{g}</h5>
                <div>
                  {Object.entries(SYMBOLS)
                    .filter(([, s]) => s.group === g)
                    .map(([key, s]) => (
                      <button key={key} className={symbol === key ? "on" : ""} title={s.label} onClick={() => setSymbol(key)}>
                        <svg viewBox="-55 -55 110 110" width="30" height="30">
                          {s.draw(style.ink, style.space ? style.sea : style.land)}
                        </svg>
                      </button>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div
          ref={boxRef}
          className="map-stage"
          style={{ cursor, background: imageUrl ? "var(--bg-sunken)" : style.seaDeep }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <svg width="100%" height="100%">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <MapRenderer data={map.data} width={map.width} height={map.height} image={imageUrl} selectedId={editing ? selected : null}>
                {draft && draft.length > 1 && (
                  <path
                    d={`M${draft.map((p) => p.join(",")).join("L")}${draftKind === "area" ? "Z" : ""}`}
                    fill={draftKind === "area" ? "#f6bd6033" : "none"}
                    stroke="#f6bd60"
                    strokeWidth={2 / view.k}
                  />
                )}
                {map.data.pins.map((p) => {
                  const { entry, sub } = pinTarget(p.id);
                  const color = sub ? "#5fb0c9" : types.find((t) => t.id === entry?.typeId)?.color ?? "#f6bd60";
                  const label = p.label || entry?.title || sub?.title || "";
                  return (
                    <g
                      key={p.id}
                      data-id={p.id}
                      className="map-pin"
                      transform={`translate(${p.x} ${p.y}) scale(${1 / view.k})`}
                      onPointerEnter={(e) => setHoverPin({ id: p.id, x: e.clientX, y: e.clientY })}
                      onPointerLeave={() => setHoverPin(null)}
                    >
                      <path d="M0,0 C-4,-10 -12,-14 -12,-22 A12,12 0 1,1 12,-22 C12,-14 4,-10 0,0 Z" fill={color} stroke={p.id === selected && editing ? "#fff" : "#0008"} strokeWidth={1.5} />
                      <circle cy={-22} r={4.5} fill="#fff" opacity={0.9} />
                      {label && (
                        <text y={14} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#fff" stroke="#000a" strokeWidth={3} paintOrder="stroke">
                          {label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </MapRenderer>
            </g>
          </svg>
          {hoverPin && !action.current && (() => {
            const { entry, sub } = pinTarget(hoverPin.id);
            if (!entry && !sub) return null;
            const r = boxRef.current!.getBoundingClientRect();
            return (
              <div className="pin-card" style={{ left: hoverPin.x - r.left + 14, top: hoverPin.y - r.top + 14 }}>
                {sub ? (
                  <>
                    <strong>{sub.title}</strong>
                    <small>Map · click to open</small>
                  </>
                ) : (
                  <>
                    <strong>
                      <EntryGlyph entry={entry} size={13} /> {entry!.title}
                    </strong>
                    {entry!.summary && <p>{entry!.summary}</p>}
                    <small>{types.find((t) => t.id === entry!.typeId)?.name}{!editing && " · click to open"}</small>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {editing && (
          <aside className="map-props">
            {sel?.kind === "symbol" && (
              <>
                <h4>{SYMBOLS[sel.item.icon]?.label ?? "Symbol"}</h4>
                <label className="field">
                  <span>Size</span>
                  <input type="range" min={12} max={160} value={sel.item.size} onChange={(e) => setItem("symbols", sel.item.id, { size: Number(e.target.value) })} />
                </label>
              </>
            )}
            {sel?.kind === "label" && (
              <>
                <h4>Label</h4>
                <label className="field">
                  <span>Text</span>
                  <input autoFocus value={sel.item.text} onChange={(e) => setItem("labels", sel.item.id, { text: e.target.value })} />
                </label>
                <label className="field">
                  <span>Kind</span>
                  <Select
                    value={sel.item.kind}
                    onChange={(kind) => setItem("labels", sel.item.id, { kind })}
                    options={[
                      { value: "region", label: "Region (spaced capitals)" },
                      { value: "place", label: "Place" },
                      { value: "water", label: "Water (italic)" },
                    ]}
                  />
                </label>
                <label className="field">
                  <span>Size</span>
                  <input type="range" min={10} max={120} value={sel.item.size} onChange={(e) => setItem("labels", sel.item.id, { size: Number(e.target.value) })} />
                </label>
              </>
            )}
            {sel?.kind === "pin" && (
              <>
                <h4>Pin</h4>
                <label className="field">
                  <span>Links to entry</span>
                  <EntryPicker value={sel.item.entryId ? [sel.item.entryId] : []} multiple={false} onChange={(ids) => setItem("pins", sel.item.id, { entryId: ids[0] })} />
                </label>
                <label className="field">
                  <span>Or opens map</span>
                  <Select
                    value={sel.item.mapId ?? ""}
                    onChange={(mapId) => setItem("pins", sel.item.id, { mapId: mapId || undefined })}
                    options={[{ value: "", label: <span className="placeholder">None</span> }, ...allMaps.filter((m) => m.id !== map.id).map((m) => ({ value: m.id, label: m.title }))]}
                  />
                </label>
                <label className="field">
                  <span>Label (optional)</span>
                  <input value={sel.item.label ?? ""} placeholder="Uses the entry's name" onChange={(e) => setItem("pins", sel.item.id, { label: e.target.value || undefined })} />
                </label>
              </>
            )}
            {sel?.kind === "area" && (
              <>
                <h4>{{ land: "Land", forest: "Forest", lake: "Lake", region: "Region" }[sel.item.kind]}</h4>
                {sel.item.kind === "region" && (
                  <div className="swatch-row">
                    {REGION_COLORS.map((c) => (
                      <button key={c} className="swatch-btn" style={{ background: c }} onClick={() => setItem("areas", sel.item.id, { color: c })} />
                    ))}
                  </div>
                )}
              </>
            )}
            {sel?.kind === "line" && (
              <>
                <h4>Line</h4>
                <Select
                  value={sel.item.kind}
                  onChange={(kind) => setItem("lines", sel.item.id, { kind })}
                  options={[
                    { value: "river", label: "River" },
                    { value: "road", label: "Road" },
                    { value: "route", label: "Route" },
                    { value: "border", label: "Border" },
                  ]}
                />
              </>
            )}
            {sel && (
              <button className="danger subtle" onClick={() => removeItem(sel.item.id)}>
                Delete (Del)
              </button>
            )}

            {!sel && (
              <>
                <h4>Map</h4>
                {tool === "region" && (
                  <div className="field">
                    <span>New region colour</span>
                    <div className="swatch-row">
                      {REGION_COLORS.map((c) => (
                        <button key={c} className={`swatch-btn ${regionColor === c ? "on" : ""}`} style={{ background: c }} onClick={() => setRegionColor(c)} />
                      ))}
                    </div>
                  </div>
                )}
                {!map.image && (
                  <label className="field">
                    <span>Style</span>
                    <Select
                      value={map.data.style}
                      onChange={(s) => commit((d) => ({ ...d, style: s as MapStyle }))}
                      options={(Object.keys(MAP_STYLES) as MapStyle[]).map((k) => ({ value: k, label: MAP_STYLES[k].label, hint: MAP_STYLES[k].blurb }))}
                    />
                  </label>
                )}
                {!map.image && (
                  <div className="field">
                    <span>Generate land</span>
                    <div className="row">
                      <button className="ghost tiny" onClick={() => generate(1)}>
                        Continent
                      </button>
                      <button className="ghost tiny" onClick={() => generate(4)}>
                        Islands
                      </button>
                      <button className="ghost tiny" onClick={() => generate(2)}>
                        Two lands
                      </button>
                    </div>
                    <small className="hint">Replaces the land you have; undo with Ctrl+Z. Generate again for a new shape.</small>
                  </div>
                )}
                <p className="hint">
                  Pick a tool on the left. Drag to draw land, forests, lakes and regions; they close and smooth themselves. Scroll to
                  zoom, and hold the middle mouse button (or use the hand) to move around.
                </p>
                <button className="danger subtle" onClick={removeMap}>
                  Delete map
                </button>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
