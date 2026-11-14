import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HttpTarget, Ask } from "./targets.js";
import type { Thresholds } from "./report.js";

export interface Config {
  suite?: string;
  docs?: string;
  target?: HttpTarget;
  command?: string;
  ask?: Ask;
  thresholds?: Thresholds;
  concurrency?: number;
  timeoutMs?: number;
}

export async function loadConfig(path?: string): Promise<Config> {
  const candidates = path ? [path] : ["idk.config.mjs", "idk.config.js", "idk.config.json"];
  for (const c of candidates) {
    const p = resolve(c);
    if (!existsSync(p)) { if (path) throw new Error(`config not found: ${path}`); continue; }
    if (p.endsWith(".json")) {
      const { readFileSync } = await import("node:fs");
      return JSON.parse(readFileSync(p, "utf8"));
    }
    const mod = await import(pathToFileURL(p).href);
    return (mod.default ?? mod) as Config;
  }
  return {};
}

export const CONFIG_TEMPLATE = `// idk-check config. Docs: https://github.com/QasimJaffry/idk-check
export default {
  docs: "./docs",               // what your app is allowed to know (md/mdx/txt/rst)
  suite: "./idk/suite.json",    // generated once, reviewed, committed

  // Point at your running app. The question goes in, the answer comes out.
  target: {
    url: "http://localhost:3000/api/ask",
    body: { question: "{{question}}" },   // or: (q) => ({ messages: [{ role: "user", content: q }] })
    answer: "answer",                      // dot path into the JSON reply, or (json) => json.data.text
    // headers: { authorization: \`Bearer \${process.env.APP_TOKEN}\` },
  },
  // Or: command: "python ask.py",          // question on stdin, answer on stdout
  // Or: ask: async (q) => myRag.answer(q),  // call your code directly

  thresholds: { minAbstain: 0.9, maxFalseRefusal: 0.1 },
};
`;
