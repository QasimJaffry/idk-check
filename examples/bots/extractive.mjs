// A small, real, non-LLM question-answering bot used by the demo: BM25 retrieval + sentence extraction.
// Three policies show what idk-check measures:
//   eager     always answers with the best-matching sentence (the "confident RAG app")
//   strict    answers only when one sentence contains every key word of the question
//   balanced  answers when a sentence covers most key words
import { BM25, loadCorpus, tokenize } from "../../dist/index.js";

const GENERIC = new Set(["much", "long", "many", "cost", "costs", "take", "does", "nimbus", "bike", "bikes", "get", "need", "make"]);
const IDK = "I don't know. The Nimbus documents don't cover that.";

const MIN_COVERAGE = { eager: 0, strict: 1, balanced: 0.6 };

export function makeBot(docsDir, { policy = "balanced" } = {}) {
  const minCoverage = MIN_COVERAGE[policy];
  if (minCoverage === undefined) throw new Error(`unknown policy ${policy}`);
  const corpus = loadCorpus(docsDir);
  const index = new BM25(corpus.chunks);
  return async function ask(question) {
    const [hit] = index.search(question, 1);
    if (!hit) return IDK;
    const q = tokenize(question).filter((t) => !GENERIC.has(t));
    const body = hit.chunk.text.split("\n").filter((l) => !l.trimStart().startsWith("#")).join(" ");
    const sentences = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const scored = sentences.map((s) => {
      const toks = new Set(tokenize(s));
      return { s, cov: q.length ? q.filter((t) => toks.has(t)).length / q.length : 0 };
    }).sort((a, b) => b.cov - a.cov);
    const best = scored[0];
    if (!best) return IDK;
    if (policy !== "eager" && (q.length < 2 || best.cov < minCoverage)) return IDK;
    return best.s.trim();
  };
}
