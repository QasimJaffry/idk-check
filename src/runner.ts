import { judge, type Verdict } from "./judge.js";
import { llmSaysDeclined, llmSaysPremiseRejected, type LLM } from "./llm.js";
import type { Case, Suite } from "./suite.js";
import type { Ask } from "./targets.js";

export interface Result extends Verdict {
  id: string;
  category: Case["category"];
  question: string;
  answer: string;
  ms: number;
  error?: string;
}

export interface RunOptions {
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  /** settles "unclear" replies; without it they count as failures */
  llmJudge?: LLM;
  onResult?: (r: Result) => void;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

export async function runSuite(suite: Suite, ask: Ask, o: RunOptions = {}): Promise<Result[]> {
  const conc = Math.max(1, o.concurrency ?? 4), retries = o.retries ?? 1, timeout = o.timeoutMs ?? 60_000;
  const results: Result[] = new Array(suite.cases.length);
  let next = 0;
  async function worker() {
    while (next < suite.cases.length) {
      const i = next++;
      const c = suite.cases[i]!;
      const t0 = Date.now();
      let answer = "", error: string | undefined;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try { answer = await withTimeout(ask(c.question), timeout); error = undefined; break; }
        catch (e) { error = e instanceof Error ? e.message : String(e); }
      }
      let r: Result;
      if (error !== undefined) {
        r = { id: c.id, category: c.category, question: c.question, answer: "", ms: Date.now() - t0, error,
              outcome: "error", shape: "answered", reason: error, decidedBy: "rules" };
      } else {
        let v = judge(c, answer);
        if (v.outcome === "unclear" && o.llmJudge) {
          try {
            if (c.category === "answerable") {
              // the required fact is already missing, so this can never pass; the judge only decides which failure it is
              const declined = await llmSaysDeclined(o.llmJudge, c.question, answer);
              v = { ...v, decidedBy: "llm", outcome: declined ? "false_refusal" : "wrong",
                    reason: `LLM judge: ${declined ? "declined" : "answered without the expected fact"} (${v.reason})` };
            } else {
              let ok: boolean;
              if (c.category === "false_premise" && c.acceptIfIncludes?.length) {
                const facts = c.acceptIfIncludes.map((f) => (Array.isArray(f) ? f.join(" / ") : f));
                ok = await llmSaysPremiseRejected(o.llmJudge, c.question, facts, answer);
              } else {
                ok = await llmSaysDeclined(o.llmJudge, c.question, answer);
              }
              v = { ...v, decidedBy: "llm", outcome: ok ? "pass" : "answered_anyway",
                    reason: `LLM judge: ${ok ? "acceptable" : "not acceptable"} (${v.reason})` };
            }
          } catch (e) {
            v = { ...v, reason: `${v.reason}; LLM judge failed: ${e instanceof Error ? e.message : e}` };
          }
        }
        r = { id: c.id, category: c.category, question: c.question, answer, ms: Date.now() - t0, ...v };
      }
      results[i] = r;
      o.onResult?.(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, suite.cases.length) }, worker));
  return results;
}
