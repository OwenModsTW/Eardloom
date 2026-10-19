// Relationships between entries come from link fields ("Homeworld", "Parents", ...). A field
// can name the reverse direction ("Native peoples", "Children") and can take part in family trees.
import type { EntryType, FamilyRole, FieldDef } from "./types";

export interface LinkRow {
  sourceKind: string;
  sourceId: string;
  targetId: string;
  /** "mention", or the id of the link field. */
  via: string;
}

export function fieldsById(types: EntryType[]) {
  const out = new Map<string, FieldDef>();
  for (const t of types) for (const f of t.fields) out.set(f.id, f);
  return out;
}

/**
 * How a link reads from one end. From the source it's the field's own name ("Parents");
 * from the target it's the reverse name ("Children"), if the field has one.
 */
export function relationLabel(field: FieldDef | undefined, fromSource: boolean): string | null {
  if (!field) return null;
  return fromSource ? field.label : (field.inverse?.trim() || null);
}

export const FAMILY_ROLES: { value: FamilyRole; label: string; inverse: string }[] = [
  { value: "parents", label: "Parents", inverse: "Children" },
  { value: "children", label: "Children", inverse: "Parents" },
  { value: "partners", label: "Partners", inverse: "Partners" },
  { value: "siblings", label: "Siblings", inverse: "Siblings" },
];

export interface Family {
  parents: Map<string, Set<string>>;
  partners: Map<string, Set<string>>;
  siblings: Map<string, Set<string>>;
}

const add = (m: Map<string, Set<string>>, k: string, v: string) => {
  if (k === v) return;
  if (!m.has(k)) m.set(k, new Set());
  m.get(k)!.add(v);
};

/** Who is whose parent, partner and sibling, from every family field in the world. */
export function buildFamily(links: LinkRow[], fields: Map<string, FieldDef>): Family {
  const fam: Family = { parents: new Map(), partners: new Map(), siblings: new Map() };
  for (const l of links) {
    if (l.sourceKind !== "entry") continue;
    switch (fields.get(l.via)?.family) {
      case "parents":
        add(fam.parents, l.sourceId, l.targetId);
        break;
      case "children":
        add(fam.parents, l.targetId, l.sourceId);
        break;
      case "partners":
        add(fam.partners, l.sourceId, l.targetId);
        add(fam.partners, l.targetId, l.sourceId);
        break;
      case "siblings":
        add(fam.siblings, l.sourceId, l.targetId);
        add(fam.siblings, l.targetId, l.sourceId);
        break;
    }
  }
  return fam;
}

const list = (s: Set<string> | undefined) => [...(s ?? [])];

export function parentsOf(fam: Family, id: string) {
  return list(fam.parents.get(id));
}

export function childrenOf(fam: Family, id: string) {
  const out: string[] = [];
  for (const [child, ps] of fam.parents) if (ps.has(id)) out.push(child);
  return out;
}

/** Brothers and sisters: anyone sharing a parent, plus anyone linked as a sibling. */
export function siblingsOf(fam: Family, id: string) {
  const out = new Set(list(fam.siblings.get(id)));
  for (const p of parentsOf(fam, id)) for (const c of childrenOf(fam, p)) out.add(c);
  out.delete(id);
  return [...out];
}

export function partnersOf(fam: Family, id: string) {
  return list(fam.partners.get(id));
}

/** Five generations around one person, each a row of entry ids, plus the lines between them. */
export function familyTree(fam: Family, focus: string) {
  const uniq = (ids: string[], taken: Set<string>) => {
    const out: string[] = [];
    for (const id of ids) if (!taken.has(id)) (taken.add(id), out.push(id));
    return out;
  };
  const taken = new Set<string>([focus]);
  const siblings = uniq(siblingsOf(fam, focus), taken);
  const partners = uniq(partnersOf(fam, focus), taken);
  const parents = uniq(parentsOf(fam, focus), taken);
  const grandparents = uniq(parents.flatMap((p) => parentsOf(fam, p)), taken);
  const children = uniq([focus, ...partners].flatMap((p) => childrenOf(fam, p)), taken);
  const grandchildren = uniq(children.flatMap((c) => childrenOf(fam, c)), taken);
  const rows = [grandparents, parents, [...siblings, focus, ...partners], children, grandchildren];

  const shown = new Set(rows.flat());
  const lines: { from: string; to: string; kind: "parent" | "partner" }[] = [];
  for (const id of shown) {
    for (const p of parentsOf(fam, id)) if (shown.has(p)) lines.push({ from: p, to: id, kind: "parent" });
    for (const p of partnersOf(fam, id)) if (shown.has(p) && id < p) lines.push({ from: id, to: p, kind: "partner" });
  }
  return { rows, lines };
}
