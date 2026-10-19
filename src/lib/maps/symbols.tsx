import type { ReactNode } from "react";

/**
 * Map symbols, drawn in a box from -50 to 50 with strokes in the map's ink colour.
 * Kept deliberately simple and hand-drawn in feel, like an atlas engraving.
 */
type Glyph = (ink: string, paper: string) => ReactNode;

const stroke = (ink: string, w = 4) => ({ stroke: ink, strokeWidth: w, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export const SYMBOLS: Record<string, { label: string; group: "Land" | "Places" | "Space"; draw: Glyph }> = {
  mountain: {
    label: "Mountain",
    group: "Land",
    draw: (ink, paper) => (
      <>
        <path d="M-42,34 L-6,-36 L34,34 Z" {...stroke(ink)} fill={paper} />
        <path d="M-6,-36 L4,-14 L-4,-8 L6,6" {...stroke(ink, 3)} />
      </>
    ),
  },
  range: {
    label: "Mountain range",
    group: "Land",
    draw: (ink, paper) => (
      <>
        <path d="M-10,34 L18,-24 L46,34 Z" {...stroke(ink)} fill={paper} />
        <path d="M-48,34 L-22,-34 L6,34 Z" {...stroke(ink)} fill={paper} />
        <path d="M-22,-34 L-14,-14 L-20,-8" {...stroke(ink, 3)} />
      </>
    ),
  },
  hills: {
    label: "Hills",
    group: "Land",
    draw: (ink) => <path d="M-46,24 Q-28,-14 -10,24 M-6,24 Q14,-22 34,24 M20,8 Q34,-6 46,12" {...stroke(ink)} />,
  },
  forest: {
    label: "Forest",
    group: "Land",
    draw: (ink, paper) => (
      <>
        {[[-24, 6], [0, -10], [22, 8], [-6, 22]].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path d="M0,-22 C14,-18 18,2 0,10 C-18,2 -14,-18 0,-22 Z" {...stroke(ink, 3.5)} fill={paper} />
            <path d="M0,10 L0,20" {...stroke(ink, 3.5)} />
          </g>
        ))}
      </>
    ),
  },
  pine: {
    label: "Pines",
    group: "Land",
    draw: (ink) => (
      <>
        {[-22, 0, 22].map((x, i) => (
          <path key={i} d={`M${x},-28 L${x - 13},12 L${x + 13},12 Z M${x},12 L${x},24`} {...stroke(ink, 3.5)} fill="none" />
        ))}
      </>
    ),
  },
  swamp: {
    label: "Marsh",
    group: "Land",
    draw: (ink) => <path d="M-40,10 H-10 M0,10 H34 M-28,24 H6 M16,24 H40 M-20,-6 V10 M-14,-14 V10 M24,-10 V10" {...stroke(ink, 3)} />,
  },
  city: {
    label: "City",
    group: "Places",
    draw: (ink, paper) => (
      <>
        <circle r="22" {...stroke(ink, 4)} fill={paper} />
        <circle r="9" fill={ink} />
      </>
    ),
  },
  town: {
    label: "Town",
    group: "Places",
    draw: (ink, paper) => <circle r="15" {...stroke(ink, 5)} fill={paper} />,
  },
  village: {
    label: "Village",
    group: "Places",
    draw: (ink) => <circle r="9" fill={ink} />,
  },
  castle: {
    label: "Castle",
    group: "Places",
    draw: (ink, paper) => (
      <path
        d="M-30,30 V-14 H-20 V-24 H-10 V-14 H10 V-24 H20 V-14 H30 V30 Z M-6,30 V12 Q0,4 6,12 V30"
        {...stroke(ink)}
        fill={paper}
      />
    ),
  },
  tower: {
    label: "Tower",
    group: "Places",
    draw: (ink, paper) => <path d="M-12,34 L-9,-18 H9 L12,34 Z M-16,-18 H16 V-30 H8 V-24 H4 V-30 H-4 V-24 H-8 V-30 H-16 Z" {...stroke(ink)} fill={paper} />,
  },
  ruins: {
    label: "Ruins",
    group: "Places",
    draw: (ink) => <path d="M-32,30 H32 M-24,30 V-6 L-18,-14 M-4,30 V-20 M-4,-8 H10 M18,30 V4 L24,-4" {...stroke(ink)} />,
  },
  temple: {
    label: "Temple",
    group: "Places",
    draw: (ink, paper) => <path d="M-34,-10 L0,-32 L34,-10 Z M-26,-10 V24 M-9,-10 V24 M9,-10 V24 M26,-10 V24 M-36,24 H36 V30 H-36 Z" {...stroke(ink, 3.5)} fill={paper} />,
  },
  port: {
    label: "Port",
    group: "Places",
    draw: (ink) => <path d="M0,-30 V28 M-12,-18 H12 M-26,8 Q-24,28 0,28 Q24,28 26,8 M0,-30 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0" {...stroke(ink)} />,
  },
  cave: {
    label: "Cave",
    group: "Places",
    draw: (ink, paper) => (
      <>
        <path d="M-36,28 Q-30,-28 0,-30 Q30,-28 36,28 Z" {...stroke(ink)} fill={paper} />
        <path d="M-14,28 Q-12,0 0,-2 Q12,0 14,28 Z" fill={ink} />
      </>
    ),
  },
  camp: {
    label: "Camp",
    group: "Places",
    draw: (ink, paper) => <path d="M-32,28 L0,-28 L32,28 Z M0,-28 L-8,28 M0,-28 L8,28" {...stroke(ink)} fill={paper} />,
  },
  danger: {
    label: "Danger",
    group: "Places",
    draw: (ink) => <path d="M-26,-26 L26,26 M26,-26 L-26,26" {...stroke(ink, 7)} />,
  },
  star: {
    label: "Star",
    group: "Space",
    draw: (ink) => (
      <>
        <circle r="10" fill={ink} />
        <path d="M0,-34 V-18 M0,18 V34 M-34,0 H-18 M18,0 H34" {...stroke(ink, 3)} />
      </>
    ),
  },
  sun: {
    label: "Sun",
    group: "Space",
    draw: (ink) => (
      <>
        <circle r="22" fill="#f6bd60" stroke={ink} strokeWidth={3} />
        <circle r="32" fill="none" stroke="#f6bd60" strokeWidth={2} opacity={0.5} />
      </>
    ),
  },
  planet: {
    label: "Planet",
    group: "Space",
    draw: (ink, paper) => (
      <>
        <circle r="20" {...stroke(ink)} fill={paper} />
        <path d="M-20,0 Q0,10 20,0" {...stroke(ink, 2.5)} />
      </>
    ),
  },
  ringed: {
    label: "Ringed planet",
    group: "Space",
    draw: (ink, paper) => (
      <>
        <circle r="17" {...stroke(ink)} fill={paper} />
        <ellipse rx="38" ry="11" transform="rotate(-18)" {...stroke(ink, 3)} />
      </>
    ),
  },
  moon: {
    label: "Moon",
    group: "Space",
    draw: (ink) => <path d="M10,-24 A26,26 0 1,0 10,24 A20,20 0 1,1 10,-24 Z" fill={ink} />,
  },
  station: {
    label: "Station",
    group: "Space",
    draw: (ink, paper) => (
      <>
        <circle r="24" {...stroke(ink, 4)} />
        <circle r="8" {...stroke(ink, 3)} fill={paper} />
        <path d="M0,-24 V-8 M0,8 V24 M-24,0 H-8 M8,0 H24" {...stroke(ink, 3)} />
      </>
    ),
  },
  gate: {
    label: "Gate",
    group: "Space",
    draw: (ink) => (
      <>
        <circle r="28" {...stroke(ink, 5)} />
        <circle r="18" {...stroke(ink, 2)} strokeDasharray="4 6" />
      </>
    ),
  },
  asteroids: {
    label: "Asteroids",
    group: "Space",
    draw: (ink) => (
      <>
        {[[-24, -8, 7], [-4, 10, 5], [14, -14, 6], [28, 8, 4], [-14, 22, 4], [6, -30, 3]].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={ink} />
        ))}
      </>
    ),
  },
  nebula: {
    label: "Nebula",
    group: "Space",
    draw: (ink) => (
      <>
        <ellipse rx="40" ry="22" fill="#9b8bd4" opacity={0.25} />
        <ellipse rx="26" ry="14" cx="10" cy="-4" fill="#5fb0c9" opacity={0.25} />
        <ellipse rx="40" ry="22" fill="none" stroke={ink} strokeWidth={1.5} strokeDasharray="3 5" />
      </>
    ),
  },
};
