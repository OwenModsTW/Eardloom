import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImageUp, PenLine, Plus } from "lucide-react";
import { api, newId } from "../../lib/api";
import { useStore } from "../../store";
import { generateWorld } from "../../lib/maps/geometry";
import { MAP_STYLES } from "../../lib/maps/styles";
import { emptyData, normaliseData, type MapStyle, type WorldMap } from "../../lib/maps/model";
import { assetUrl } from "../EntryIcon";
import { MapRenderer } from "./MapRenderer";

const DRAWN_SIZE = { width: 2400, height: 1600 };

function Thumb({ map }: { map: WorldMap }) {
  const world = useStore((s) => s.world);
  const image = map.image && world ? assetUrl(world.assetsPath, map.image) : null;
  return (
    <svg viewBox={`0 0 ${map.width} ${map.height}`} preserveAspectRatio="xMidYMid slice">
      <MapRenderer data={normaliseData(map.data)} width={map.width} height={map.height} image={image} />
    </svg>
  );
}

export function MapsPage() {
  const { go } = useStore();
  const [maps, setMaps] = useState<WorldMap[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api.listMaps().then(setMaps);
  }, []);

  return (
    <div className="page wide">
      <header className="page-head">
        <h1>Maps</h1>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New map
        </button>
      </header>
      {maps && maps.length === 0 && (
        <div className="blank-slate">
          <p>Draw your world from scratch, or bring in a map you already have, then pin your places, people and events onto it.</p>
          <button className="primary" onClick={() => setCreating(true)}>
            Make your first map
          </button>
        </div>
      )}
      <div className="map-grid">
        {maps?.map((m) => (
          <button key={m.id} className="map-card" onClick={() => go({ view: "map", id: m.id })}>
            <div className="map-thumb">
              <Thumb map={m} />
            </div>
            <strong>{m.title}</strong>
            <small>
              {(m.data?.pins?.length ?? 0) || "No"} pin{m.data?.pins?.length === 1 ? "" : "s"}
            </small>
          </button>
        ))}
      </div>
      {creating && <NewMapDialog onClose={() => setCreating(false)} count={maps?.length ?? 0} />}
    </div>
  );
}

function NewMapDialog({ onClose, count }: { onClose: () => void; count: number }) {
  const { go, notify } = useStore();
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState<MapStyle>("parchment");
  const [start, setStart] = useState<"blank" | "continent" | "islands">("continent");

  const createDrawn = async () => {
    const data = emptyData(style);
    if (start !== "blank" && style !== "starchart") {
      const shapes = generateWorld(DRAWN_SIZE.width, DRAWN_SIZE.height, data.seed, start === "continent" ? 1 : 4);
      data.areas = shapes.map((points) => ({ id: newId(), kind: "land", points }));
    }
    const map: WorldMap = { id: newId(), title: title.trim() || "Untitled map", image: null, ...DRAWN_SIZE, sort: count, data };
    await api.saveMap(map);
    go({ view: "map", id: map.id });
  };

  const createFromImage = async () => {
    const file = await openDialog({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (typeof file !== "string") return;
    try {
      const img = new Image();
      img.src = convertFileSrc(file);
      await img.decode();
      const asset = await api.importAsset(file);
      const map: WorldMap = {
        id: newId(),
        title: title.trim() || file.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ""),
        image: asset,
        width: img.naturalWidth,
        height: img.naturalHeight,
        sort: count,
        data: emptyData("atlas"),
      };
      await api.saveMap(map);
      go({ view: "map", id: map.id });
    } catch (e) {
      notify(`Couldn't use that image: ${String(e)}`);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog new-map" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="New map">
        <header className="dialog-head">
          <h2>New map</h2>
        </header>
        <div className="new-map-body">
          <label className="field">
            <span>Name</span>
            <input autoFocus value={title} placeholder="The Known World" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="new-map-choices">
            <section>
              <h3>
                <PenLine size={15} /> Draw it here
              </h3>
              <div className="format-list">
                {(Object.keys(MAP_STYLES) as MapStyle[]).map((k) => (
                  <button key={k} className={style === k ? "on" : ""} onClick={() => setStyle(k)}>
                    <strong>{MAP_STYLES[k].label}</strong>
                    <small>{MAP_STYLES[k].blurb}</small>
                  </button>
                ))}
              </div>
              {style !== "starchart" && (
                <div className="segmented start-with">
                  {(["continent", "islands", "blank"] as const).map((s) => (
                    <button key={s} className={start === s ? "on" : ""} onClick={() => setStart(s)}>
                      {s === "continent" ? "Start with a continent" : s === "islands" ? "Islands" : "Blank"}
                    </button>
                  ))}
                </div>
              )}
              <button className="primary" onClick={createDrawn}>
                Create and start drawing
              </button>
            </section>
            <section>
              <h3>
                <ImageUp size={15} /> Use an image
              </h3>
              <p className="hint">A map you've drawn elsewhere, a scan, a star chart or a floor plan. You can add pins, labels and regions on top.</p>
              <button className="ghost" onClick={createFromImage}>
                Choose image…
              </button>
            </section>
          </div>
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
