import type { EntryType, FieldDef, FieldKind } from "./types";
import { newId } from "./api";

/**
 * Starter schemas for new worlds. These are only a starting point: once a world
 * is created its types and fields belong to the user and can be changed freely.
 *
 * A field spec is [label, kind, extra?]. For entry/entries fields, `to` lists the
 * names of the template types that may be linked, resolved to ids on creation.
 */
type FieldSpec = [string, FieldKind, { options?: string[]; to?: string[]; section?: string }?];

interface TypeSpec {
  name: string;
  plural: string;
  icon: string;
  color: string;
  fields: FieldSpec[];
}

export interface WorldTemplate {
  id: string;
  name: string;
  blurb: string;
  types: TypeSpec[];
}

const STATUS = ["Alive", "Dead", "Unknown"];

export const TEMPLATES: WorldTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    blurb: "Start almost empty and build every category yourself.",
    types: [
      { name: "Character", plural: "Characters", icon: "User", color: "#e0a458", fields: [] },
      { name: "Location", plural: "Locations", icon: "MapPin", color: "#6fb58a", fields: [] },
      { name: "Note", plural: "Notes", icon: "StickyNote", color: "#8b9bb4", fields: [] },
    ],
  },
  {
    id: "fantasy",
    name: "Fantasy",
    blurb: "Kingdoms, magic, gods and monsters.",
    types: [
      {
        name: "Character", plural: "Characters", icon: "User", color: "#e0a458",
        fields: [
          ["Species", "entry", { to: ["Species"] }],
          ["Gender", "text"],
          ["Age", "text"],
          ["Occupation", "text"],
          ["Status", "select", { options: STATUS }],
          ["Birthplace", "entry", { to: ["Location"] }],
          ["Affiliations", "entries", { to: ["Faction"], section: "Relationships" }],
          ["Allies", "entries", { to: ["Character"], section: "Relationships" }],
          ["Enemies", "entries", { to: ["Character"], section: "Relationships" }],
          ["Family", "entries", { to: ["Character"], section: "Relationships" }],
        ],
      },
      {
        name: "Location", plural: "Locations", icon: "Castle", color: "#6fb58a",
        fields: [
          ["Kind", "select", { options: ["Continent", "Region", "Kingdom", "City", "Town", "Village", "Landmark", "Dungeon", "Building"] }],
          ["Part of", "entry", { to: ["Location"] }],
          ["Ruler", "entry", { to: ["Character"] }],
          ["Population", "number"],
          ["Climate", "text"],
        ],
      },
      {
        name: "Faction", plural: "Factions", icon: "Shield", color: "#c96d6d",
        fields: [
          ["Kind", "select", { options: ["Kingdom", "Guild", "Order", "Cult", "Clan", "Company", "Other"] }],
          ["Leader", "entry", { to: ["Character"] }],
          ["Headquarters", "entry", { to: ["Location"] }],
          ["Goals", "longtext"],
        ],
      },
      {
        name: "Species", plural: "Species", icon: "PawPrint", color: "#9b8bd4",
        fields: [["Lifespan", "text"], ["Homeland", "entry", { to: ["Location"] }], ["Traits", "list"]],
      },
      {
        name: "Magic", plural: "Magic", icon: "Sparkles", color: "#5fb0c9",
        fields: [["Source", "text"], ["Rules", "longtext"], ["Costs & Limits", "longtext"]],
      },
      {
        name: "Item", plural: "Items", icon: "Gem", color: "#d4b45f",
        fields: [["Kind", "text"], ["Owner", "entry", { to: ["Character"] }], ["Powers", "longtext"]],
      },
      {
        name: "Deity", plural: "Deities", icon: "Sun", color: "#e6c86e",
        fields: [["Domains", "list"], ["Pantheon", "text"], ["Worshipped by", "entries", { to: ["Faction", "Species"] }]],
      },
      {
        name: "Event", plural: "Events", icon: "CalendarDays", color: "#b07fc9",
        fields: [["Date", "date"], ["Where", "entries", { to: ["Location"] }], ["Participants", "entries"]],
      },
      { name: "Lore", plural: "Lore", icon: "ScrollText", color: "#8b9bb4", fields: [] },
    ],
  },
  {
    id: "scifi",
    name: "Science Fiction",
    blurb: "Star systems, starships, corporations and technology.",
    types: [
      {
        name: "Character", plural: "Characters", icon: "User", color: "#e0a458",
        fields: [
          ["Species", "entry", { to: ["Species"] }],
          ["Rank / Role", "text"],
          ["Homeworld", "entry", { to: ["Celestial Body"] }],
          ["Status", "select", { options: STATUS }],
          ["Augmentations", "list"],
          ["Affiliations", "entries", { to: ["Faction"], section: "Relationships" }],
          ["Allies", "entries", { to: ["Character"], section: "Relationships" }],
          ["Enemies", "entries", { to: ["Character"], section: "Relationships" }],
        ],
      },
      {
        name: "Star System", plural: "Star Systems", icon: "Orbit", color: "#e6c86e",
        fields: [["Star Class", "text"], ["Controlled by", "entry", { to: ["Faction"] }], ["Sector", "text"]],
      },
      {
        name: "Celestial Body", plural: "Celestial Bodies", icon: "Globe", color: "#6fb58a",
        fields: [
          ["Kind", "select", { options: ["Planet", "Moon", "Star", "Gas Giant", "Asteroid", "Station", "Megastructure"] }],
          ["System", "entry", { to: ["Star System"] }],
          ["Population", "number"],
          ["Atmosphere", "text"],
          ["Gravity", "text"],
        ],
      },
      {
        name: "Starship", plural: "Starships", icon: "Rocket", color: "#5fb0c9",
        fields: [
          ["Class", "text"],
          ["Manufacturer", "entry", { to: ["Faction"] }],
          ["Captain", "entry", { to: ["Character"] }],
          ["Crew", "entries", { to: ["Character"] }],
          ["FTL", "boolean"],
          ["Armament", "list"],
        ],
      },
      {
        name: "Faction", plural: "Factions", icon: "Building2", color: "#c96d6d",
        fields: [
          ["Kind", "select", { options: ["Government", "Corporation", "Military", "Rebellion", "Religion", "Syndicate", "Other"] }],
          ["Leader", "entry", { to: ["Character"] }],
          ["Headquarters", "entry", { to: ["Celestial Body"] }],
          ["Goals", "longtext"],
        ],
      },
      {
        name: "Species", plural: "Species", icon: "Dna", color: "#9b8bd4",
        fields: [["Homeworld", "entry", { to: ["Celestial Body"] }], ["Lifespan", "text"], ["Traits", "list"]],
      },
      {
        name: "Technology", plural: "Technology", icon: "Cpu", color: "#7fa7d9",
        fields: [["Tech Level", "text"], ["Developed by", "entry", { to: ["Faction", "Character"] }], ["Applications", "longtext"]],
      },
      {
        name: "Event", plural: "Events", icon: "CalendarDays", color: "#b07fc9",
        fields: [["Date", "date"], ["Where", "entries"], ["Participants", "entries"]],
      },
      { name: "Lore", plural: "Lore", icon: "ScrollText", color: "#8b9bb4", fields: [] },
    ],
  },
  {
    id: "apocalypse",
    name: "Post-Apocalyptic",
    blurb: "Survivors, settlements, threats and scarce resources.",
    types: [
      {
        name: "Survivor", plural: "Survivors", icon: "User", color: "#e0a458",
        fields: [
          ["Age", "text"],
          ["Before the fall", "text"],
          ["Status", "select", { options: ["Alive", "Infected", "Dead", "Missing"] }],
          ["Skills", "list"],
          ["Group", "entry", { to: ["Group"] }],
          ["Days survived", "number"],
          ["Trusts", "entries", { to: ["Survivor"], section: "Relationships" }],
          ["Distrusts", "entries", { to: ["Survivor"], section: "Relationships" }],
        ],
      },
      {
        name: "Group", plural: "Groups", icon: "Users", color: "#c96d6d",
        fields: [
          ["Leader", "entry", { to: ["Survivor"] }],
          ["Base", "entry", { to: ["Location"] }],
          ["Size", "number"],
          ["Disposition", "select", { options: ["Friendly", "Neutral", "Wary", "Hostile"] }],
        ],
      },
      {
        name: "Location", plural: "Locations", icon: "MapPin", color: "#6fb58a",
        fields: [
          ["Kind", "select", { options: ["Safehouse", "Settlement", "Outpost", "Ruins", "Dead Zone", "Landmark"] }],
          ["Danger", "select", { options: ["Safe", "Low", "Moderate", "High", "Lethal"] }],
          ["Controlled by", "entry", { to: ["Group"] }],
          ["Resources", "list"],
        ],
      },
      {
        name: "Threat", plural: "Threats", icon: "Skull", color: "#9bb46f",
        fields: [
          ["Kind", "select", { options: ["Infected", "Mutant", "Raiders", "Environmental", "Other"] }],
          ["Transmission", "text"],
          ["Symptoms", "list"],
          ["Weaknesses", "list"],
        ],
      },
      {
        name: "Supply", plural: "Supplies", icon: "Package", color: "#d4b45f",
        fields: [["Kind", "text"], ["Rarity", "select", { options: ["Common", "Scarce", "Rare", "Unique"] }], ["Held by", "entry"]],
      },
      {
        name: "Event", plural: "Events", icon: "CalendarDays", color: "#b07fc9",
        fields: [["Day", "text"], ["Where", "entries", { to: ["Location"] }], ["Involved", "entries"]],
      },
    ],
  },
  {
    id: "modern",
    name: "Modern / Contemporary",
    blurb: "Present-day settings: thrillers, drama, urban fantasy.",
    types: [
      {
        name: "Character", plural: "Characters", icon: "User", color: "#e0a458",
        fields: [
          ["Age", "text"],
          ["Occupation", "text"],
          ["Lives in", "entry", { to: ["Place"] }],
          ["Works for", "entry", { to: ["Organization"] }],
          ["Relationships", "entries", { to: ["Character"] }],
        ],
      },
      { name: "Place", plural: "Places", icon: "MapPin", color: "#6fb58a", fields: [["Address / Area", "text"], ["Part of", "entry", { to: ["Place"] }]] },
      { name: "Organization", plural: "Organizations", icon: "Building2", color: "#c96d6d", fields: [["Kind", "text"], ["Head", "entry", { to: ["Character"] }]] },
      { name: "Event", plural: "Events", icon: "CalendarDays", color: "#b07fc9", fields: [["Date", "date"], ["Involved", "entries"]] },
      { name: "Item", plural: "Items", icon: "Package", color: "#d4b45f", fields: [["Owner", "entry", { to: ["Character"] }]] },
    ],
  },
  {
    id: "ttrpg",
    name: "Tabletop RPG",
    blurb: "D&D-style campaigns: NPCs, monsters, quests and session logs.",
    types: [
      {
        name: "NPC", plural: "NPCs", icon: "User", color: "#e0a458",
        fields: [
          ["Race", "text"],
          ["Class", "text"],
          ["Level", "number"],
          ["Alignment", "select", { options: ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"] }],
          ["Location", "entry", { to: ["Location"] }],
          ["Faction", "entry", { to: ["Faction"] }],
          ["Armor Class", "number", { section: "Stats" }],
          ["Hit Points", "number", { section: "Stats" }],
        ],
      },
      { name: "Location", plural: "Locations", icon: "Castle", color: "#6fb58a", fields: [["Kind", "text"], ["Part of", "entry", { to: ["Location"] }]] },
      { name: "Faction", plural: "Factions", icon: "Shield", color: "#c96d6d", fields: [["Leader", "entry", { to: ["NPC"] }], ["Goals", "longtext"]] },
      {
        name: "Monster", plural: "Monsters", icon: "Skull", color: "#9bb46f",
        fields: [
          ["Challenge Rating", "text"],
          ["Type", "text"],
          ["Armor Class", "number", { section: "Stats" }],
          ["Hit Points", "text", { section: "Stats" }],
          ["Abilities", "longtext"],
        ],
      },
      {
        name: "Item", plural: "Items", icon: "Gem", color: "#d4b45f",
        fields: [["Rarity", "select", { options: ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"] }], ["Requires attunement", "boolean"], ["Properties", "longtext"]],
      },
      {
        name: "Quest", plural: "Quests", icon: "Flag", color: "#5fb0c9",
        fields: [["Status", "select", { options: ["Rumoured", "Active", "Completed", "Failed"] }], ["Given by", "entry", { to: ["NPC"] }], ["Reward", "text"]],
      },
      {
        name: "Session", plural: "Sessions", icon: "Dices", color: "#b07fc9",
        fields: [["Session #", "number"], ["Date played", "date"], ["Players present", "list"]],
      },
      { name: "Deity", plural: "Deities", icon: "Sun", color: "#e6c86e", fields: [["Domains", "list"], ["Alignment", "text"]] },
    ],
  },
];

/** Builds concrete entry types (with fresh ids) from a template. */
export function instantiateTemplate(template: WorldTemplate): EntryType[] {
  const ids = new Map(template.types.map((t) => [t.name, newId()]));
  return template.types.map((t, i) => ({
    id: ids.get(t.name)!,
    name: t.name,
    plural: t.plural,
    icon: t.icon,
    color: t.color,
    sort: i,
    fields: t.fields.map(([label, kind, extra]): FieldDef => ({
      id: newId(),
      label,
      kind,
      ...(extra?.options ? { options: extra.options } : {}),
      ...(extra?.to ? { targetTypes: extra.to.map((n) => ids.get(n)).filter((x): x is string => !!x) } : {}),
      ...(extra?.section ? { section: extra.section } : {}),
    })),
  }));
}
