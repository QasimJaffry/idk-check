// Offline end-to-end demo: the hand-written suite against two policies of a real extractive bot.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseSuite, runSuite, summarize, gate, toMarkdown } from "../dist/index.js";
import { makeBot } from "./bots/extractive.mjs";

const here = (p) => new URL(p, import.meta.url).pathname;
const suite = parseSuite(JSON.parse(readFileSync(here("./suite.json"), "utf8")));
mkdirSync(here("./out"), { recursive: true });
for (const policy of ["eager", "strict", "balanced"]) {
  const results = await runSuite(suite, makeBot(here("./nimbus-docs"), { policy }), { concurrency: 8 });
  const s = summarize(results);
  const failures = gate(s, { minAbstain: 0.9, maxFalseRefusal: 0.1 });
  const md = toMarkdown(s, results, failures, `demo bot, ${policy} policy`);
  writeFileSync(here(`./out/${policy}.md`), md);
  writeFileSync(here(`./out/${policy}.json`), JSON.stringify({ summary: s, results }, null, 2));
  console.log(md);
}
