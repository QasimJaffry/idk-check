import { readFileSync } from "node:fs";
/** The test suite file: generated once, reviewed by a human, committed, and replayed in CI. */

export type Category =
  | "answerable"       // control: the docs answer it; refusing is a failure
  | "missing_info"     // asks for a detail the docs never state
  | "false_premise"    // assumes something the docs contradict
  | "out_of_scope"     // plausible for this product, but not covered at all
  | "underspecified";  // too vague to answer without asking back

export const UNANSWERABLE: Category[] = ["missing_info", "false_premise", "out_of_scope", "underspecified"];

/** One required fact: a string, or alternatives (any one is enough). */
export type Fact = string | string[];

export interface Case {
  id: string;
  category: Category;
  question: string;
  /** answerable: every fact must appear in the answer. */
  mustInclude?: Fact[];
  /** false_premise: an answer that corrects the premise with one of these facts also passes. */
  acceptIfIncludes?: Fact[];
  /** where the answer (or the contradicting fact) lives, for reviewers */
  evidence?: string[];
  note?: string;
}

export interface Suite {
  version: 1;
  corpusHash?: string;
  generatedBy?: string;
  reviewed?: boolean;
  cases: Case[];
}

export function parseSuite(raw: unknown): Suite {
  const bad = (m: string): never => { throw new Error(`invalid suite: ${m}`); };
  if (!raw || typeof raw !== "object") bad("not an object");
  const s = raw as Record<string, any>;
  if (s.version !== 1) bad("version must be 1");
  if (!Array.isArray(s.cases) || !s.cases.length) bad("cases must be a non-empty array");
  const ids = new Set<string>();
  const cats = new Set<string>(["answerable", ...UNANSWERABLE]);
  const facts = (v: unknown, where: string) => {
    if (v === undefined) return;
    if (!Array.isArray(v) || !v.every((f) => typeof f === "string" || (Array.isArray(f) && f.length && f.every((x) => typeof x === "string"))))
      bad(`${where} must be an array of strings or string arrays`);
  };
  for (const [i, c] of (s.cases as any[]).entries()) {
    const at = `cases[${i}]`;
    if (typeof c?.id !== "string" || !c.id) bad(`${at}.id`);
    if (ids.has(c.id)) bad(`duplicate id ${c.id}`);
    ids.add(c.id);
    if (!cats.has(c.category)) bad(`${at}.category must be one of ${[...cats].join(", ")}`);
    if (typeof c.question !== "string" || !c.question.trim()) bad(`${at}.question`);
    facts(c.mustInclude, `${at}.mustInclude`);
    facts(c.acceptIfIncludes, `${at}.acceptIfIncludes`);
    if (c.category === "answerable" && !c.mustInclude?.length) bad(`${at}: answerable cases need mustInclude`);
  }
  return s as Suite;
}

/** Read and validate a suite file. */
export function loadSuite(path: string): Suite {
  return parseSuite(JSON.parse(readFileSync(path, "utf8")));
}
