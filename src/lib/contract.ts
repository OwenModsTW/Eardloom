// Checks, when the app is built, that what Eardloom's backend sends matches what the app
// expects. The backend's types are generated from its Rust code (src/generated/bindings, by
// `cargo test`); if a field is added, renamed or changes kind on either side, the build fails
// here and names the field. Nothing in this file runs.
//
// The app keeps its own richer types for documents (rich text, field values, map data); those
// fields are free-form JSON to the backend and aren't compared beyond their names.

import type { JsonValue } from "../generated/bindings/serde_json/JsonValue";
import type * as R from "./bindings";
import type * as App from "./types";
import type { BackupInfo } from "./backup";
import type { AiDevice, LocalAiStatus, ModelInfo } from "./localAi";
import type { GraphData } from "./graph";
import type { WorldMap } from "./maps/model";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Text, numbers and flags compared by kind (the app may narrow text to a set of values). */
type Kind<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T extends (infer U)[] ? Kind<U>[] : T extends object ? { [K in keyof T]-?: Kind<NonNullable<T[K]>> } : T;
type Json = NonNullable<JsonValue>;
type IsJson<T> = [NonNullable<T>] extends [Json] ? ([Json] extends [NonNullable<T>] ? true : false) : false;
type FieldsThatDiffer<A, B> = {
  [K in keyof A & keyof B]: IsJson<B[K]> extends true ? never : Same<Kind<NonNullable<A[K]>>, Kind<NonNullable<B[K]>>> extends true ? never : K;
}[keyof A & keyof B];
/** The names of fields that only one side has, or that differ in kind. `never` when they match. */
type Mismatch<AppType, Backend> = Exclude<keyof AppType, keyof Backend> | Exclude<keyof Backend, keyof AppType> | FieldsThatDiffer<AppType, Backend>;

/** Fails to compile, naming the mismatched fields, unless the two types match. */
function matches<T extends never>() {
  return true as T extends never ? true : false;
}

export const checked = [
  matches<Mismatch<App.RecentWorld, R.RecentWorld>>(),
  matches<Mismatch<App.WorldInfo, R.WorldInfo>>(),
  matches<Mismatch<App.EntryType, R.EntryType>>(),
  matches<Mismatch<App.Entry, R.Entry>>(),
  matches<Mismatch<App.EntrySummary, R.EntrySummary>>(),
  matches<Mismatch<App.Backlink, R.Backlink>>(),
  matches<Mismatch<App.SearchHit, R.SearchHit>>(),
  matches<Mismatch<App.Project, R.Project>>(),
  matches<Mismatch<App.DocSummary, R.DocSummary>>(),
  matches<Mismatch<App.Doc, R.Doc>>(),
  matches<Mismatch<App.TimelineItem, R.TimelineItem>>(),
  matches<Mismatch<WorldMap, R.WorldMap>>(),
  matches<Mismatch<BackupInfo, R.BackupInfo>>(),
  matches<Mismatch<ModelInfo, R.ModelInfo>>(),
  matches<Mismatch<LocalAiStatus, R.LocalAiStatus>>(),
  matches<Mismatch<AiDevice, R.Device>>(),
  matches<Mismatch<GraphData, R.Graph>>(),
];
