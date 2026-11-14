#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_TEMPLATE, loadConfig } from "./config.js";
import { loadCorpus } from "./corpus.js";
import { generateSuite } from "./generate.js";
import { openAICompatible } from "./llm.js";
import { gate, summarize, toMarkdown } from "./report.js";
import { runSuite } from "./runner.js";
import { parseSuite } from "./suite.js";
import { commandTarget, httpTarget, type Ask } from "./targets.js";

const HELP = `idk-check: does your AI app say "I don't know" when it should?

  idk-check init                         write idk.config.mjs
  idk-check generate --docs ./docs       draft a test suite from your docs (needs an LLM key), then review it
  idk-check run                          run the suite against your app and gate on thresholds

run options
  --config <file>        default idk.config.mjs
  --suite <file>         test suite (default from config, else idk/suite.json)
  --url <url>            POST {"question": ...} here (overrides config target)
  --answer-path <path>   where the answer is in the JSON reply, e.g. data.answer
  --cmd "<command>"      question on stdin, answer on stdout
  --concurrency <n>      default 4
  --min-abstain <0-1>    fail if fewer unanswerable questions are declined
  --max-false-refusal <0-1>  fail if more answerable questions are refused
  --llm-judge            settle hedged replies with an LLM (IDK_MODEL + OPENROUTER_API_KEY)
  --out <dir>            write report.md + results.json (default .idk)
  --quiet

generate options
  --docs <dir>  --out <file>  --answerable <n=10>  --per-category <n=5>  --model <id>  --checker-model <id>

Exit codes: 0 pass, 1 thresholds failed, 2 usage/config error.`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: v } = parseArgs({
    args: rest, allowPositionals: false,
    options: {
      config: { type: "string" }, suite: { type: "string" }, url: { type: "string" }, "answer-path": { type: "string" },
      cmd: { type: "string" }, concurrency: { type: "string" }, "min-abstain": { type: "string" },
      "max-false-refusal": { type: "string" }, "llm-judge": { type: "boolean" }, out: { type: "string" },
      quiet: { type: "boolean" }, docs: { type: "string" }, answerable: { type: "string" },
      "per-category": { type: "string" }, model: { type: "string" }, "checker-model": { type: "string" },
      force: { type: "boolean" },
    },
  });

  if (cmd === "init") {
    if (existsSync("idk.config.mjs") && !v.force) { console.error("idk.config.mjs exists (use --force)"); return 2; }
    writeFileSync("idk.config.mjs", CONFIG_TEMPLATE);
    console.log("wrote idk.config.mjs. Next: idk-check generate --docs ./docs");
    return 0;
  }

  const cfg = await loadConfig(v.config);

  if (cmd === "generate") {
    const docs = v.docs ?? cfg.docs;
    if (!docs) { console.error("pass --docs <dir>"); return 2; }
    const out = v.out ?? cfg.suite ?? "idk/suite.json";
    const llm = openAICompatible({ model: v.model });
    const checker = v["checker-model"] ? openAICompatible({ model: v["checker-model"] }) : undefined;
    const corpus = loadCorpus(docs);
    console.error(`${corpus.chunks.length} passages from ${docs}; generating with ${llm.name}...`);
    const suite = await generateSuite(corpus, llm, {
      answerable: Number(v.answerable ?? 10), perCategory: Number(v["per-category"] ?? 5), checker,
      onLog: v.quiet ? undefined : (m) => console.error(`  ${m}`),
    });
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(suite, null, 2) + "\n");
    const counts = suite.cases.reduce<Record<string, number>>((a, c) => ((a[c.category] = (a[c.category] ?? 0) + 1), a), {});
    console.log(`wrote ${suite.cases.length} cases to ${out} ${JSON.stringify(counts)}\nReview them, fix or delete bad ones, set "reviewed": true, and commit the file.`);
    return 0;
  }

  if (cmd === "run") {
    const suitePath = v.suite ?? cfg.suite ?? "idk/suite.json";
    if (!existsSync(suitePath)) { console.error(`suite not found: ${suitePath} (run idk-check generate first)`); return 2; }
    const suite = parseSuite(JSON.parse(readFileSync(suitePath, "utf8")));
    let ask: Ask | undefined;
    if (v.url) ask = httpTarget({ url: v.url, answer: v["answer-path"] });
    else if (v.cmd) ask = commandTarget(v.cmd, cfg.timeoutMs);
    else if (cfg.ask) ask = cfg.ask;
    else if (cfg.command) ask = commandTarget(cfg.command, cfg.timeoutMs);
    else if (cfg.target) ask = httpTarget(cfg.target);
    if (!ask) { console.error("no target: pass --url, --cmd, or set target/command/ask in idk.config.mjs"); return 2; }
    if (suite.reviewed === false && !v.quiet) console.error("note: this suite is marked reviewed:false; review generated cases before trusting results");
    if (suite.corpusHash && (v.docs ?? cfg.docs) && existsSync(v.docs ?? cfg.docs!)) {
      const now = loadCorpus((v.docs ?? cfg.docs)!).hash;
      if (now !== suite.corpusHash && !v.quiet) console.error("note: the docs changed since this suite was generated; some cases may be stale");
    }
    const llmJudge = v["llm-judge"] ? openAICompatible({}) : undefined;
    const results = await runSuite(suite, ask, {
      concurrency: Number(v.concurrency ?? cfg.concurrency ?? 4), timeoutMs: cfg.timeoutMs, llmJudge,
      onResult: v.quiet ? undefined : (r) => console.error(`${r.outcome === "pass" ? "✓" : "✗"} ${r.id.padEnd(18)} ${r.outcome}`),
    });
    const s = summarize(results);
    const th = { ...(cfg.thresholds ?? {}) };
    if (v["min-abstain"]) th.minAbstain = Number(v["min-abstain"]);
    if (v["max-false-refusal"]) th.maxFalseRefusal = Number(v["max-false-refusal"]);
    const failures = gate(s, th);
    const md = toMarkdown(s, results, failures);
    const outDir = v.out ?? ".idk";
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/report.md`, md);
    writeFileSync(`${outDir}/results.json`, JSON.stringify({ summary: s, thresholds: th, failures, results }, null, 2));
    console.log(md);
    return failures.length ? 1 : 0;
  }

  console.log(HELP);
  return cmd && cmd !== "help" && cmd !== "--help" ? 2 : 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`idk-check: ${e instanceof Error ? e.message : e}`); process.exit(2); });
