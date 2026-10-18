import { useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import { api } from "../lib/api";
import { compareVersions, RELEASES, releasesBetween, type Release } from "../lib/changelog";
import { UPDATED_FROM_KEY } from "../lib/updater";
import { Markdown } from "./Markdown";

const LAST_SEEN_KEY = "eardloom.lastSeenVersion";

const useWhatsNew = create<{ releases: Release[] | null }>(() => ({ releases: null }));

/** Open the changelog on demand, e.g. from Settings. */
export const showWhatsNew = (releases: Release[] = RELEASES) => useWhatsNew.setState({ releases });

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Decide, once per launch, whether this version is new to this person. */
async function checkForNewVersion() {
  const current = await getVersion();
  const from = read(UPDATED_FROM_KEY) ?? read(LAST_SEEN_KEY);
  try {
    localStorage.setItem(LAST_SEEN_KEY, current);
    localStorage.removeItem(UPDATED_FROM_KEY);
  } catch {
    /* ignore */
  }
  if (from) {
    if (compareVersions(current, from) > 0) {
      const releases = releasesBetween(from, current);
      if (releases.length) showWhatsNew(releases);
    }
    return;
  }
  // No record yet: a brand-new install has no worlds, someone upgrading from a
  // version that predates this check does. Show them just this release.
  if ((await api.listRecentWorlds()).length) {
    const release = RELEASES.find((r) => r.version === current);
    if (release) showWhatsNew([release]);
  }
}

export function WhatsNew() {
  const releases = useWhatsNew((s) => s.releases);
  const close = () => useWhatsNew.setState({ releases: null });

  useEffect(() => {
    if (!import.meta.env.DEV) checkForNewVersion();
  }, []);

  useEffect(() => {
    if (!releases) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [releases]);

  if (!releases?.length) return null;
  const [latest] = releases;
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog update-dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="What's new">
        <header className="dialog-head">
          <span className="update-eyebrow">What's new</span>
          <h2>Eardloom {latest.version}</h2>
        </header>
        <div className="update-notes">
          {releases.map((r) => (
            <section key={r.version}>
              {releases.length > 1 && <h3>{r.version}</h3>}
              <p className="update-summary">{r.summary}</p>
              {r.body && <Markdown text={r.body} />}
            </section>
          ))}
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="primary" onClick={close} autoFocus>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
