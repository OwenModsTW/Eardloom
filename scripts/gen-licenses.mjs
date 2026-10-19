// Collects the licences of everything Eardloom ships (JavaScript packages and Rust crates)
// into src/generated/licenses.json, shown in Settings → About → Open-source licences.
// Runs before every build, and fails it if anything's licence is missing or copyleft-only,
// so a release can never go out without its notices.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const LICENCE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

const texts = {};
const store = (text) => {
  const t = text.replace(/\r\n/g, "\n").trim();
  const id = createHash("sha256").update(t).digest("hex").slice(0, 16);
  texts[id] = t;
  return id;
};

function licenceFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort()
    .map((f) => store(readFileSync(join(dir, f), "utf8")));
}

const packages = [];
const problems = [];

// Copyleft-only licences would put conditions on Eardloom itself. Dual licences with a
// permissive option (e.g. "MIT OR GPL-3.0") are fine: we use the permissive one.
function checkLicence(name, expr) {
  if (!expr) return problems.push(`${name}: no licence declared`);
  const options = expr.replace(/[()]/g, "").split(/\s+OR\s+|\//);
  const copyleft = (o) => /(^|[^L])GPL|AGPL|SSPL|EUPL/i.test(o) && !/LGPL/i.test(o);
  if (options.every(copyleft)) problems.push(`${name}: copyleft-only licence (${expr})`);
}

// ---- JavaScript packages that end up in the app (not dev tools) ----
const prod = JSON.parse(execSync("npm query .prod", { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }));
for (const p of prod) {
  if (!p.location) continue; // the app itself
  const licence = typeof p.license === "string" ? p.license : p.license?.type;
  checkLicence(`${p.name} (npm)`, licence);
  const repo = typeof p.repository === "string" ? p.repository : p.repository?.url;
  packages.push({
    name: p.name,
    version: p.version,
    kind: "npm",
    licence: licence ?? "Unknown",
    source: (repo ?? `https://www.npmjs.com/package/${p.name}`).replace(/^git\+/, "").replace(/\.git$/, ""),
    texts: licenceFiles(join(root, p.location)),
  });
}

// ---- Rust crates built into the Windows app ----
const meta = JSON.parse(
  execSync("cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc", {
    cwd: join(root, "src-tauri"),
    encoding: "utf8",
    maxBuffer: 256 << 20,
  }),
);
const own = new Set(meta.workspace_members);
for (const c of meta.packages) {
  if (own.has(c.id)) continue;
  const dir = dirname(c.manifest_path);
  const files = licenceFiles(dir);
  if (c.license_file) files.push(store(readFileSync(join(dir, c.license_file), "utf8")));
  checkLicence(`${c.name} (crate)`, c.license ?? (c.license_file ? "see file" : null));
  packages.push({
    name: c.name,
    version: c.version,
    kind: "crate",
    licence: c.license ?? "See licence text",
    source: c.repository ?? `https://crates.io/crates/${c.name}`,
    texts: [...new Set(files)],
  });
}

// ---- Downloaded only if the author turns on the built-in assistant ----
const MIT_GGML = `MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const apache = Object.entries(texts).find(([, t]) => /Apache License\s+Version 2\.0, January 2004/.test(t) && t.length > 9000)?.[0];
const downloaded = [
  { name: "llama.cpp (assistant engine)", version: "b11722", kind: "download", licence: "MIT", source: "https://github.com/ggml-org/llama.cpp", texts: [store(MIT_GGML)] },
  ...["4B", "8B", "14B"].map((size) => ({
    name: `Qwen3 ${size} (assistant model)`,
    version: "GGUF Q4_K_M",
    kind: "download",
    licence: "Apache-2.0",
    source: `https://huggingface.co/Qwen/Qwen3-${size}-GGUF`,
    texts: apache ? [apache] : [],
  })),
];

// A few packages are published without a licence file. Give them the standard text for
// their declared licence (attributed to that package's authors, with a link to its source).
const findText = (pattern) => Object.entries(texts).find(([, t]) => pattern.test(t))?.[0];
const template = (name, source, body) => store(`${name}: copyright the ${name} authors (see ${source}).\n\n${body}`);
const MIT_BODY = MIT_GGML.split("\n").slice(4).join("\n");
const BSD3_BODY = `Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and
   the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions
   and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or
   promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;
const BSL_BODY = `Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization obtaining a copy of the software
and accompanying documentation covered by this license (the "Software") to use, reproduce, display,
distribute, execute, and transmit the Software, and to prepare derivative works of the Software, and to
permit third-parties to whom the Software is furnished to do so, all subject to the following:

The copyright notices in the Software and this entire statement, including the above license grant, this
restriction and the following disclaimer, must be included in all copies of the Software, in whole or in
part, and all derivative works of the Software, unless such copies or derivative works are solely in the
form of machine-executable object code generated by a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT.
IN NO EVENT SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE FOR ANY DAMAGES OR
OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
for (const p of packages) {
  if (p.texts.length) continue;
  const l = p.licence;
  if (/MPL-2\.0/.test(l)) p.texts.push(findText(/Mozilla Public License,? [Vv]ersion 2\.0/) ?? template(p.name, p.source, "Mozilla Public License 2.0: https://mozilla.org/MPL/2.0/"));
  else if (/^Apache-2\.0/.test(l) && apache) p.texts.push(apache);
  else if (/BSL-1\.0/.test(l)) p.texts.push(template(p.name, p.source, BSL_BODY));
  else if (/BSD-3-Clause/.test(l)) p.texts.push(template(p.name, p.source, BSD3_BODY));
  else if (/MIT/.test(l)) p.texts.push(template(p.name, p.source, `MIT License\n\n${MIT_BODY}`));
  else problems.push(`${p.name}: no licence text and no standard text for "${l}"`);
}

if (problems.length) {
  console.error(`Licence check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

packages.sort((a, b) => a.name.localeCompare(b.name));
const outDir = join(root, "src", "generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "licenses.json"), JSON.stringify({ packages, downloaded, texts }));
const missing = packages.filter((p) => !p.texts.length).length;
console.log(`Licences: ${packages.length} packages, ${Object.keys(texts).length} distinct texts, ${missing} without a licence file (declared licence shown).`);
