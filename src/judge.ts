/**
 * Deterministic response classification. No model is needed for the common cases; anything that
 * mixes a refusal with concrete claims is marked "unclear" (and counted against the app unless an
 * optional LLM judge settles it), because "I'm not sure, but it's probably $49" is still a guess.
 */
import type { Case, Fact } from "./suite.js";

const REFUSAL = [
  /\bi\s+(?:do\s*n[o']?t|don['’]?t)\s+know\b/i,
  /\bi(?:'m|\s+am)\s+not\s+(?:sure|certain|able)\b/i,
  /^\W*not\s+(?:sure|certain)\b/i,
  /\b(?:could\s*n['’]?t|could\s+not|can['’]?t|cannot|can\s+not|was\s+unable\s+to|am\s+unable\s+to|unable\s+to)\s+(?:find|locate|answer|determine|confirm|tell|see)\b/i,
  /\bno\s+(?:information|details?|mention|data|record)s?\b/i,
  /\bnot\s+(?:mentioned|specified|stated|covered|included|available|provided|documented|listed|addressed)\b/i,
  /\b(?:does|do)\s*(?:n['’]?t|\s+not)\s+(?:say|mention|specify|state|cover|include|provide|contain|list|address)\b/i,
  /\b(?:not|in)?sufficient\s+information\b|\bnot\s+enough\s+information\b/i,
  /\boutside\s+(?:the\s+)?(?:scope|what)\b/i,
  /\bi\s+(?:do\s*n['’]?t|don['’]?t)\s+have\s+(?:any\s+)?(?:information|data|details|access)\b/i,
  /\bcould\s+you\s+(?:clarify|specify|tell\s+me\s+(?:which|what|more))\b|\bwhich\s+(?:one|product|plan|model|order)\s+(?:do|are)\s+you\b/i,
];

const CORRECTION = [
  /\bactually\b/i, /\bin\s+fact\b/i, /\bnot\s+(?:correct|accurate|true|the\s+case)\b/i, /\bincorrect\b/i,
  /\bthere\s+is\s+no\b/i, /\bthere\s+are\s+no\b/i, /\bno\s+such\b/i, /\bdoes\s*n['’]?t\s+(?:offer|have|exist|support)\b/i,
  /\bisn['’]?t\b|\bis\s+not\b|\baren['’]?t\b|\bare\s+not\b/i, /\bmistaken\b|\bmisunderstanding\b/i,
];

export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

export function hasFact(answer: string, fact: Fact): boolean {
  const a = normalize(answer);
  const alts = Array.isArray(fact) ? fact : [fact];
  return alts.some((f) => {
    const n = normalize(f);
    // whole-token match so "15" does not match "150" and "plan" does not match "planet"
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(a);
  });
}

export type Shape = "abstained" | "answered" | "unclear";

/** Concrete claims: digits, money, dates, durations. Used to spot "not sure, but it's $49". */
const CONCRETE = /\d/;

export function shape(answer: string): Shape {
  const a = answer.trim();
  if (!a) return "abstained"; // empty reply: said nothing, invented nothing
  const refuses = REFUSAL.some((r) => r.test(a));
  if (!refuses) return "answered";
  return CONCRETE.test(a) ? "unclear" : "abstained";
}

export type Outcome =
  | "pass"
  | "answered_anyway" // unanswerable, but the app answered instead of declining
  | "false_refusal"  // answerable, but the app refused
  | "wrong"          // answerable, answered, missing a required fact
  | "unclear"        // refusal mixed with concrete claims; needs a human or the LLM judge
  | "error";

export interface Verdict { outcome: Outcome; shape: Shape; reason: string; decidedBy: "rules" | "llm" }

export function judge(c: Case, answer: string): Verdict {
  const s = shape(answer);
  if (c.category === "answerable") {
    if (s === "abstained") return { outcome: "false_refusal", shape: s, reason: "refused a question the docs answer", decidedBy: "rules" };
    const missing = (c.mustInclude ?? []).filter((f) => !hasFact(answer, f));
    if (!missing.length) return { outcome: "pass", shape: s, reason: "all required facts present", decidedBy: "rules" };
    if (s === "unclear") return { outcome: "unclear", shape: s, reason: `hedged; missing ${JSON.stringify(missing)}`, decidedBy: "rules" };
    return { outcome: "wrong", shape: s, reason: `missing ${JSON.stringify(missing)}`, decidedBy: "rules" };
  }
  // unanswerable categories
  if (c.category === "false_premise" && (c.acceptIfIncludes ?? []).some((f) => hasFact(answer, f))) {
    if (CORRECTION.some((r) => r.test(answer)))
      return { outcome: "pass", shape: s, reason: "corrected the false premise", decidedBy: "rules" };
    if (s !== "abstained")
      return { outcome: "unclear", shape: s, reason: "states the true fact but does not say the premise is wrong", decidedBy: "rules" };
  }
  if (s === "abstained") return { outcome: "pass", shape: s, reason: "declined / asked to clarify", decidedBy: "rules" };
  if (s === "unclear") return { outcome: "unclear", shape: s, reason: "refusal mixed with concrete claims", decidedBy: "rules" };
  return { outcome: "answered_anyway", shape: s, reason: "answered a question the docs cannot answer", decidedBy: "rules" };
}
