import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus.js";
import { generateSuite } from "../src/generate.js";
import type { LLM } from "../src/llm.js";
import { parseSuite } from "../src/suite.js";

const d = mkdtempSync(join(tmpdir(), "idkgen-"));
const long = (s: string) => `${s} ${"Filler sentence about the product line and its everyday use. ".repeat(4)}`;
writeFileSync(join(d, "returns.md"), long("You can return a bike within 30 days of delivery for a full refund."));
writeFileSync(join(d, "battery.md"), long("Every model uses a 500 Wh battery. A full charge takes about 4 hours."));
const corpus = loadCorpus(d);

/** Scripted fake LLM: answers by recognising which prompt it got. */
function fake(): LLM & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "fake-model", calls,
    async chat(_sys, user) {
      calls.push(user);
      if (user.includes("Do these documents contain enough information")) {
        // the checker: says the "return window" question IS answerable, everything else is not
        return JSON.stringify({ answerable: /return window/i.test(user.split("Question:")[1] ?? "") });
      }
      if (user.includes("fully answers")) {
        return user.includes("30 days")
          ? '[{"question":"How long do I have to return a bike?","facts":["30 days"]}]'
          : '[{"question":"How big is the battery?","facts":["750 Wh"]}]'; // not verbatim -> must be dropped
      }
      if (user.includes("directly contradicts")) {
        return user.includes("500 Wh")
          ? '[{"question":"How do I order the 750 Wh battery?","contradicts":"500 Wh battery"}]'
          : '[{"question":"Why is the return window 90 days?","contradicts":"90 days"}]'; // not verbatim -> drop
      }
      if (user.includes("NOT stated")) return '[{"question":"What is the refund processing fee?"}]';
      if (user.includes("do not cover at all")) return '[{"question":"Do you offer a student discount?"}, {"question":"What is the return window?"}]';
      if (user.includes("too vague")) return '[{"question":"How long does it take?"}]';
      return "[]";
    },
  };
}

describe("generateSuite", () => {
  it("keeps only verified cases and produces a valid suite", async () => {
    const llm = fake();
    const logs: string[] = [];
    const s = await generateSuite(corpus, llm, { answerable: 2, perCategory: 1, onLog: (m) => logs.push(m) });
    expect(() => parseSuite(s)).not.toThrow();
    expect(s.reviewed).toBe(false);
    expect(s.corpusHash).toBe(corpus.hash);
    const q = (cat: string) => s.cases.filter((c: { category: string }) => c.category === cat).map((c) => c.question);
    expect(q("answerable")).toEqual(["How long do I have to return a bike?"]);
    expect(q("false_premise")).toEqual(["How do I order the 750 Wh battery?"]);
    expect(s.cases.find((c) => c.category === "false_premise")!.acceptIfIncludes).toEqual(["500 Wh battery"]);
    expect(q("out_of_scope")).toEqual(["Do you offer a student discount?"]);
    expect(q("missing_info")).toEqual(["What is the refund processing fee?"]);
    expect(q("underspecified")).toEqual(["How long does it take?"]);
    expect(logs.some((m) => m.includes("fact not verbatim"))).toBe(true);
    expect(logs.some((m) => m.includes("docs answer it") && m.includes("return window"))).toBe(true);
  });

  it("an unsure or broken checker drops the case rather than keeping it", async () => {
    const llm = fake();
    const checker: LLM = { name: "c", chat: async () => "garbage" };
    const s = await generateSuite(corpus, llm, { answerable: 0, perCategory: 1, checker }).catch((e) => e);
    // checker failure throws inside answerable(); generation must not keep unchecked cases
    if (s instanceof Error) expect(s.message).toMatch(/JSON/);
    else expect(s.cases.filter((c: { category: string }) => c.category === "out_of_scope")).toEqual([]);
  });
});
