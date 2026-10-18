/** Small per-computer preferences that aren't part of any world. */
const AUTHOR = "eardloom.author";

export function getDefaultAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR) ?? "";
  } catch {
    return "";
  }
}

export function setDefaultAuthor(name: string) {
  try {
    localStorage.setItem(AUTHOR, name);
  } catch {
    /* preference just won't persist */
  }
}
