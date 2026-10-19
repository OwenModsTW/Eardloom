import { memo, useMemo, type ReactNode } from "react";
import { rng, smoothPath } from "../../lib/maps/geometry";
import { MAP_STYLES } from "../../lib/maps/styles";
import { SYMBOLS } from "../../lib/maps/symbols";
import type { Area, Line, MapData } from "../../lib/maps/model";

interface Props {
  data: MapData;
  width: number;
  height: number;
  /** Background image URL for uploaded maps. */
  image?: string | null;
  /** Rendered on top, in map coordinates (pins, selection, drafts). */
  children?: ReactNode;
  selectedId?: string | null;
}

const LINE_STYLE: Record<Line["kind"], (s: (typeof MAP_STYLES)["parchment"]) => React.SVGProps<SVGPathElement>> = {
  river: (s) => ({ stroke: s.river, strokeWidth: 4 }),
  road: (s) => ({ stroke: s.road, strokeWidth: 3, strokeDasharray: "10 6" }),
  route: (s) => ({ stroke: s.road, strokeWidth: 2.5, strokeDasharray: "2 9" }),
  border: (s) => ({ stroke: s.border, strokeWidth: 3, strokeDasharray: "16 6 3 6" }),
};

/** Draws a map as SVG. Used for editing, thumbnails and PNG export alike. */
export const MapRenderer = memo(function MapRenderer({ data, width, height, image, children, selectedId }: Props) {
  const s = MAP_STYLES[data.style] ?? MAP_STYLES.parchment;

  // Decorative texture, fixed per map by its seed.
  const texture = useMemo(() => {
    const rand = rng(data.seed || 1);
    if (s.space) {
      const stars = Array.from({ length: Math.round((width * height) / 2400) }, () => ({
        x: rand() * width,
        y: rand() * height,
        r: rand() < 0.08 ? 1.8 : rand() * 1.1 + 0.3,
        o: 0.25 + rand() * 0.7,
      }));
      return { stars, waves: [] as { x: number; y: number; w: number }[] };
    }
    const waves = image
      ? []
      : Array.from({ length: Math.round((width * height) / 26000) }, () => ({ x: rand() * width, y: rand() * height, w: 10 + rand() * 14 }));
    return { stars: [], waves };
  }, [data.seed, s.space, width, height, image]);

  const areaPath = (a: Area) => smoothPath(a.points, true);
  const lands = data.areas.filter((a) => a.kind === "land");

  return (
    <g>
      {/* Background */}
      {image ? (
        <image href={image} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />
      ) : (
        <>
          <rect width={width} height={height} fill={s.sea} />
          {s.space ? (
            <>
              {Array.from({ length: Math.floor(width / 100) + 1 }, (_, i) => (
                <line key={`gx${i}`} x1={i * 100} y1={0} x2={i * 100} y2={height} stroke={s.coast} strokeOpacity={0.12} />
              ))}
              {Array.from({ length: Math.floor(height / 100) + 1 }, (_, i) => (
                <line key={`gy${i}`} x1={0} y1={i * 100} x2={width} y2={i * 100} stroke={s.coast} strokeOpacity={0.12} />
              ))}
              {texture.stars.map((st, i) => (
                <circle key={i} cx={st.x} cy={st.y} r={st.r} fill="#fff" opacity={st.o} />
              ))}
            </>
          ) : (
            texture.waves.map((w, i) => (
              <path key={i} d={`M${w.x},${w.y} q${w.w / 4},-4 ${w.w / 2},0 t${w.w / 2},0`} stroke={s.seaDeep} strokeWidth={1.5} fill="none" />
            ))
          )}
        </>
      )}

      {/* Coastal ripples behind the land, like an engraved chart. */}
      {s.ripples &&
        !image &&
        [30, 20, 11].map((w, i) => (
          <g key={w} opacity={0.18 + i * 0.12}>
            {lands.map((a) => (
              <path key={a.id} d={areaPath(a)} fill="none" stroke={s.seaDeep} strokeWidth={w} strokeLinejoin="round" />
            ))}
          </g>
        ))}

      {/* Areas: land first, then what sits on it */}
      {(["land", "forest", "lake", "region"] as const).map((kind) =>
        data.areas
          .filter((a) => a.kind === kind)
          .map((a) => {
            const d = areaPath(a);
            const selected = a.id === selectedId;
            if (kind === "land") return <path key={a.id} data-id={a.id} d={d} fill={s.land} stroke={selected ? "#f6bd60" : s.coast} strokeWidth={selected ? 4 : 2.5} strokeLinejoin="round" />;
            if (kind === "forest") return <path key={a.id} data-id={a.id} d={d} fill={s.forest} stroke={selected ? "#f6bd60" : "none"} strokeWidth={3} opacity={0.85} />;
            if (kind === "lake") return <path key={a.id} data-id={a.id} d={d} fill={s.lake} stroke={selected ? "#f6bd60" : s.coast} strokeWidth={2} />;
            const c = a.color ?? s.border;
            return <path key={a.id} data-id={a.id} d={d} fill={c} fillOpacity={0.16} stroke={selected ? "#f6bd60" : c} strokeWidth={selected ? 4 : 2.5} strokeDasharray="12 6" />;
          }),
      )}

      {/* Rivers, roads, routes, borders */}
      {data.lines.map((l) => (
        <path
          key={l.id}
          data-id={l.id}
          d={smoothPath(l.points, false)}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          {...LINE_STYLE[l.kind](s)}
          {...(l.id === selectedId ? { stroke: "#f6bd60" } : {})}
        />
      ))}

      {/* Symbols */}
      {data.symbols.map((m) => {
        const sym = SYMBOLS[m.icon];
        if (!sym) return null;
        return (
          <g key={m.id} data-id={m.id} transform={`translate(${m.x} ${m.y}) scale(${m.size / 100})`}>
            {m.id === selectedId && <circle r={60} fill="none" stroke="#f6bd60" strokeWidth={4} strokeDasharray="8 6" />}
            {sym.draw(s.ink, s.space ? s.sea : s.land)}
          </g>
        );
      })}

      {/* Labels */}
      {data.labels.map((l) => {
        const region = l.kind === "region";
        return (
          <text
            key={l.id}
            data-id={l.id}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily={s.labelFont}
            fontSize={l.size}
            fontStyle={l.kind === "water" ? "italic" : "normal"}
            fontWeight={region ? 600 : 500}
            letterSpacing={region ? l.size * 0.28 : 0}
            fill={l.kind === "water" ? s.muted : s.ink}
            stroke={s.space ? "none" : s.land}
            strokeWidth={l.kind === "place" ? l.size * 0.22 : 0}
            paintOrder="stroke"
            style={{ textTransform: region ? "uppercase" : "none", userSelect: "none" }}
            textDecoration={l.id === selectedId ? "underline" : undefined}
          >
            {l.text}
          </text>
        );
      })}

      {children}
    </g>
  );
});
