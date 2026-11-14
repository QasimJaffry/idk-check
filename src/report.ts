import { wilson } from "./stats.js";
import type { Result } from "./runner.js";
import { UNANSWERABLE } from "./suite.js";

export interface Rate { n: number; k: number; rate: number; ci: [number, number] }
const rate = (k: number, n: number): Rate => ({ n, k, rate: n ? k / n : 0, ci: wilson(k, n) });

export interface Summary {
  /** unanswerable questions the app correctly declined (or corrected the premise of) */
  abstained: Rate;
  answeredAnyway: number;
  /** answerable questions answered with every required fact */
  answered: Rate;
  falseRefusals: number;
  wrong: number;
  unclear: number;
  errors: number;
  byCategory: Record<string, Rate>;
  falseRefusalRate: number;
}

export function summarize(results: Result[]): Summary {
  const un = results.filter((r) => r.category !== "answerable");
  const an = results.filter((r) => r.category === "answerable");
  const byCategory: Record<string, Rate> = {};
  for (const cat of ["answerable", ...UNANSWERABLE]) {
    const rs = results.filter((r) => r.category === cat);
    if (rs.length) byCategory[cat] = rate(rs.filter((r) => r.outcome === "pass").length, rs.length);
  }
  const fr = an.filter((r) => r.outcome === "false_refusal").length;
  return {
    abstained: rate(un.filter((r) => r.outcome === "pass").length, un.length),
    answeredAnyway: un.filter((r) => r.outcome === "answered_anyway").length,
    answered: rate(an.filter((r) => r.outcome === "pass").length, an.length),
    falseRefusals: fr,
    wrong: an.filter((r) => r.outcome === "wrong").length,
    unclear: results.filter((r) => r.outcome === "unclear").length,
    errors: results.filter((r) => r.outcome === "error").length,
    byCategory,
    falseRefusalRate: an.length ? fr / an.length : 0,
  };
}

export interface Thresholds { minAbstain?: number; maxFalseRefusal?: number; minAnswered?: number }

export function gate(s: Summary, t: Thresholds): string[] {
  const fails: string[] = [];
  if (t.minAbstain !== undefined && s.abstained.rate < t.minAbstain)
    fails.push(`declined ${pct(s.abstained.rate)} of unanswerable questions; need ≥ ${pct(t.minAbstain)}`);
  if (t.maxFalseRefusal !== undefined && s.falseRefusalRate > t.maxFalseRefusal)
    fails.push(`refused ${pct(s.falseRefusalRate)} of answerable questions; allowed ≤ ${pct(t.maxFalseRefusal)}`);
  if (t.minAnswered !== undefined && s.answered.rate < t.minAnswered)
    fails.push(`answered ${pct(s.answered.rate)} of answerable questions correctly; need ≥ ${pct(t.minAnswered)}`);
  if (s.errors) fails.push(`${s.errors} request(s) failed`);
  return fails;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
const ci = (r: Rate) => `${pct(r.ci[0])}–${pct(r.ci[1])}`;
const LABEL: Record<string, string> = {
  answerable: "answerable (control)", missing_info: "missing info", false_premise: "false premise",
  out_of_scope: "out of scope", underspecified: "underspecified",
};

export function toMarkdown(s: Summary, results: Result[], failures: string[] = [], title = "idk-check"): string {
  const L: string[] = [];
  const ok = !failures.length;
  L.push(`### ${ok ? "✅" : "❌"} ${title}: declined **${pct(s.abstained.rate)}** of questions the docs can't answer · answered **${pct(s.answered.rate)}** of ones they can`);
  L.push("");
  L.push(`| | result | 95% CI |`, `|---|---:|---:|`);
  L.push(`| said "I don't know" when it should | ${s.abstained.k}/${s.abstained.n} | ${ci(s.abstained)} |`);
  L.push(`| answered anyway (should have declined) | ${s.answeredAnyway}/${s.abstained.n} | |`);
  L.push(`| answered correctly when it could | ${s.answered.k}/${s.answered.n} | ${ci(s.answered)} |`);
  L.push(`| refused a question it could answer | ${s.falseRefusals}/${s.answered.n} | |`);
  if (s.unclear) L.push(`| unclear (needs a human or --llm-judge) | ${s.unclear} | |`);
  if (s.errors) L.push(`| request errors | ${s.errors} | |`);
  L.push("", "| category | passed | rate |", "|---|---:|---:|");
  for (const [c, r] of Object.entries(s.byCategory)) L.push(`| ${LABEL[c] ?? c} | ${r.k}/${r.n} | ${pct(r.rate)} |`);
  const bad = results.filter((r) => r.outcome !== "pass").slice(0, 8);
  if (bad.length) {
    L.push("", "<details><summary>Failures</summary>", "");
    for (const r of bad) {
      const a = r.answer.replace(/\s+/g, " ").slice(0, 160);
      L.push(`- **${r.outcome.replace(/_/g, " ")}** · ${LABEL[r.category] ?? r.category} · _${r.question}_  `, `  → ${a || r.reason}`);
    }
    L.push("", "</details>");
  }
  if (failures.length) L.push("", ...failures.map((f) => `- ❌ ${f}`));
  return L.join("\n") + "\n";
}
