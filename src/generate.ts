/**
 * Test-suite generator. An LLM proposes questions; deterministic checks and a second, independent
 * LLM pass filter them, because a generated "unanswerable" question that the docs actually answer
 * would punish a correct app.
 *
 *   answerable      facts must be copied VERBATIM from the source passage (checked with string match)
 *   false_premise   the true fact it contradicts must appear verbatim in the passage (becomes acceptIfIncludes)
 *   all unanswerable  BM25 retrieves the 5 most relevant passages from the WHOLE corpus and an LLM must
 *                   agree they do not answer the question; otherwise the question is dropped
 *
 * The output is marked reviewed:false. Read it, fix or delete cases, set reviewed:true, commit it.
 */
import { BM25 } from "./bm25.js";
import type { Chunk, Corpus } from "./corpus.js";
import { hasFact, normalize } from "./judge.js";
import { parseJsonReply, type LLM } from "./llm.js";
import type { Case, Category, Suite } from "./suite.js";

export interface GenerateOptions {
  answerable?: number;
  perCategory?: number;
  seed?: number;
  /** independent model for the answerability check (defaults to the generator) */
  checker?: LLM;
  onLog?: (m: string) => void;
}

const DEFS: Record<Exclude<Category, "answerable">, string> = {
  missing_info: "asks for a specific detail about something the passage discusses, where that detail is NOT stated anywhere in the passage (e.g. a price, date, limit or name that is never given)",
  false_premise: "assumes something that the passage directly contradicts (e.g. a wrong number, duration, or a feature the passage says does not exist). Include the TRUE fact, copied verbatim from the passage, as \"contradicts\"",
  out_of_scope: "is plausible for a user of this product or organisation, but about a topic the passage (and documents like it) do not cover at all",
  underspecified: "is too vague to answer without asking which item, plan, version or situation the user means, even though the documents cover several of them",
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function sample<T>(xs: T[], n: number, r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a.slice(0, n);
}

const SYS = "You write test questions for an assistant that answers ONLY from a company's documents. Reply with JSON only.";

export async function generateSuite(corpus: Corpus, llm: LLM, o: GenerateOptions = {}): Promise<Suite> {
  const r = rng(o.seed ?? 7);
  const log = o.onLog ?? (() => {});
  const index = new BM25(corpus.chunks);
  const checker = o.checker ?? llm;
  const cases: Case[] = [];
  const seen = new Set<string>();
  const add = (c: Omit<Case, "id">) => {
    const key = normalize(c.question);
    if (seen.has(key)) return false;
    seen.add(key);
    cases.push({ id: `${c.category}-${String(cases.filter((x) => x.category === c.category).length + 1).padStart(2, "0")}`, ...c });
    return true;
  };
  const rich = corpus.chunks.filter((c) => c.text.length > 200);
  const pool = rich.length ? rich : corpus.chunks;

  // answerable controls
  const wantA = o.answerable ?? 10;
  for (const ch of sample(pool, Math.min(pool.length, wantA), r)) {
    if (cases.filter((c) => c.category === "answerable").length >= wantA) break;
    try {
      const out = parseJsonReply(await llm.chat(SYS, `Passage (${ch.id}):\n"""\n${ch.text}\n"""\n\nWrite 1 question a user might ask that this passage fully answers.
Give 1-3 short facts that a correct answer must contain, each copied EXACTLY (verbatim) from the passage, as short as possible (a number with its unit, a name, a short phrase).
JSON: [{"question": "...", "facts": ["..."]}]`)) as any[];
      for (const q of Array.isArray(out) ? out : []) {
        const facts = (q?.facts ?? []).filter((f: unknown) => typeof f === "string" && f.trim());
        if (typeof q?.question !== "string" || !facts.length) continue;
        if (!facts.every((f: string) => hasFact(ch.text, f))) { log(`drop answerable (fact not verbatim): ${q.question}`); continue; }
        add({ category: "answerable", question: q.question.trim(), mustInclude: facts, evidence: [ch.id] });
      }
    } catch (e) { log(`answerable generation failed on ${ch.id}: ${e instanceof Error ? e.message : e}`); }
  }

  // unanswerable categories
  const per = o.perCategory ?? 5;
  for (const cat of Object.keys(DEFS) as (keyof typeof DEFS)[]) {
    let tries = 0;
    for (const ch of sample(pool, pool.length, r)) {
      if (cases.filter((c) => c.category === cat).length >= per || tries++ > per * 3) break;
      let proposals: any[] = [];
      try {
        proposals = parseJsonReply(await llm.chat(SYS, `Passage (${ch.id}):\n"""\n${ch.text}\n"""\n\nWrite 1 question that ${DEFS[cat]}.
JSON: [{"question": "..."${cat === "false_premise" ? ', "contradicts": "<verbatim true fact from the passage>"' : ""}}]`)) as any[];
      } catch (e) { log(`${cat} generation failed on ${ch.id}: ${e instanceof Error ? e.message : e}`); continue; }
      for (const q of Array.isArray(proposals) ? proposals : []) {
        if (typeof q?.question !== "string" || !q.question.trim()) continue;
        const accept: string[] = [];
        if (cat === "false_premise") {
          if (typeof q.contradicts !== "string" || !hasFact(ch.text, q.contradicts)) { log(`drop false_premise (fact not verbatim): ${q.question}`); continue; }
          accept.push(q.contradicts);
        }
        if (cat !== "underspecified" && cat !== "false_premise" && (await answerable(checker, index, q.question))) {
          log(`drop ${cat} (docs answer it): ${q.question}`);
          continue;
        }
        add({ category: cat, question: q.question.trim(), ...(accept.length ? { acceptIfIncludes: accept } : {}), evidence: [ch.id] });
      }
    }
  }
  return { version: 1, corpusHash: corpus.hash, generatedBy: llm.name, reviewed: false, cases };
}

/** Independent check: do the 5 most relevant passages in the whole corpus answer this question? */
export async function answerable(llm: LLM, index: BM25, question: string): Promise<boolean> {
  const hits = index.search(question, 5);
  if (!hits.length) return false;
  const ctx = hits.map((h: { chunk: Chunk }) => `[${h.chunk.id}]\n${h.chunk.text}`).join("\n\n");
  const out = parseJsonReply(await llm.chat(
    "You check whether documents answer a question. Reply with JSON only: {\"answerable\": true|false}",
    `Documents:\n${ctx}\n\nQuestion: ${question}\n\nDo these documents contain enough information to answer it? If unsure, answer true.`,
  )) as any;
  return out?.answerable !== false; // unsure / malformed counts as answerable, so the case is dropped
}
