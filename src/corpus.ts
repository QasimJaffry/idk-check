import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, extname } from "node:path";

export interface Chunk {
  id: string; // "file.md#3"
  file: string;
  text: string;
}

const TEXT_EXT = new Set([".md", ".mdx", ".txt", ".rst"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (TEXT_EXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

/** Split text into paragraph-aligned chunks of roughly `target` characters. */
export function chunkText(text: string, target = 800): string[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > target) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export interface Corpus {
  root: string;
  chunks: Chunk[];
  /** Hash of all file contents: lets a saved suite detect that the docs changed. */
  hash: string;
}

export function loadCorpus(root: string, target = 800): Corpus {
  const files = walk(root);
  if (!files.length) throw new Error(`no .md/.mdx/.txt/.rst files under ${root}`);
  const h = createHash("sha256");
  const chunks: Chunk[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const rel = relative(root, f).split("\\").join("/");
    h.update(rel).update("\0").update(text).update("\0");
    chunkText(text, target).forEach((c, i) => chunks.push({ id: `${rel}#${i + 1}`, file: rel, text: c }));
  }
  return { root, chunks, hash: h.digest("hex").slice(0, 16) };
}
