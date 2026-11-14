import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BM25, tokenize } from "../src/bm25.js";
import { chunkText, loadCorpus } from "../src/corpus.js";
import { gate, summarize, toMarkdown } from "../src/report.js";
import { parseSuite } from "../src/suite.js";
import { wilson } from "../src/stats.js";

function docs(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "idk-"));
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  return d;
}

describe("corpus + bm25", () => {
  it("chunks on paragraphs and hashes content", () => {
    expect(chunkText("a\n\nb\n\nc", 3)).toEqual(["a", "b", "c"]);
    expect(chunkText("aaa\n\nbbb", 100)).toEqual(["aaa\n\nbbb"]);
    const d = docs({ "a.md": "Refunds take 10 days.", "sub/b.txt": "Delivery takes 3 days.", "img.png": "x", ".hidden/c.md": "no" });
    const c = loadCorpus(d);
    expect(c.chunks.map((x) => x.id)).toEqual(["a.md#1", "sub/b.txt#1"]);
    const h = c.hash;
    writeFileSync(join(d, "a.md"), "Refunds take 12 days.");
    expect(loadCorpus(d).hash).not.toBe(h);
  });
  it("fails loudly on an empty folder", () => expect(() => loadCorpus(docs({ "x.png": "" }))).toThrow(/no .md/));
  it("ranks the relevant chunk first", () => {
    const c = loadCorpus(docs({ "r.md": "Refunds are paid within 10 business days.", "d.md": "Delivery to the EU costs £79.", "w.md": "The warranty lasts 5 years." }));
    const hits = new BM25(c.chunks).search("how long do refunds take", 3);
    expect(hits[0]!.chunk.file).toBe("r.md");
    expect(new BM25(c.chunks).search("zebra", 3)).toEqual([]);
    expect(tokenize("The Refunds, the DAYS!")).toEqual(["refunds", "days"]);
  });
});

describe("suite validation", () => {
  const ok = { version: 1, cases: [{ id: "a", category: "answerable", question: "q", mustInclude: ["x"] }] };
  it("accepts a valid suite", () => expect(parseSuite(ok).cases).toHaveLength(1));
  it.each([
    [{ ...ok, version: 2 }, /version/],
    [{ version: 1, cases: [] }, /non-empty/],
    [{ version: 1, cases: [{ id: "a", category: "nope", question: "q" }] }, /category/],
    [{ version: 1, cases: [{ id: "a", category: "answerable", question: "q" }] }, /mustInclude/],
    [{ version: 1, cases: [{ id: "a", category: "out_of_scope", question: "q" }, { id: "a", category: "out_of_scope", question: "r" }] }, /duplicate/],
    [{ version: 1, cases: [{ id: "a", category: "false_premise", question: "q", acceptIfIncludes: [3] }] }, /acceptIfIncludes/],
  ])("rejects bad suite %#", (s, re) => expect(() => parseSuite(s)).toThrow(re));
});

describe("report", () => {
  const base = { question: "q", answer: "a", ms: 1, shape: "answered" as const, reason: "", decidedBy: "rules" as const };
  const results = [
    { ...base, id: "1", category: "answerable" as const, outcome: "pass" as const },
    { ...base, id: "2", category: "answerable" as const, outcome: "false_refusal" as const },
    { ...base, id: "3", category: "missing_info" as const, outcome: "pass" as const },
    { ...base, id: "4", category: "out_of_scope" as const, outcome: "answered_anyway" as const },
    { ...base, id: "5", category: "out_of_scope" as const, outcome: "unclear" as const },
  ];
  it("summarizes both sides of the trade-off", () => {
    const s = summarize(results);
    expect(s.abstained).toMatchObject({ n: 3, k: 1 });
    expect(s.answeredAnyway).toBe(1);
    expect(s.answered).toMatchObject({ n: 2, k: 1 });
    expect(s.falseRefusals).toBe(1);
    expect(s.unclear).toBe(1);
    expect(s.byCategory.out_of_scope).toMatchObject({ n: 2, k: 0 });
  });
  it("gates on thresholds and request errors", () => {
    const s = summarize(results);
    expect(gate(s, {})).toEqual([]);
    expect(gate(s, { minAbstain: 0.5 })).toHaveLength(1);
    expect(gate(s, { maxFalseRefusal: 0.4 })).toHaveLength(1);
    expect(gate(summarize([...results, { ...base, id: "6", category: "answerable", outcome: "error" }]), {})).toHaveLength(1);
  });
  it("markdown states the headline and failures", () => {
    const md = toMarkdown(summarize(results), results, ["x"]);
    expect(md).toContain("❌");
    expect(md).toContain("declined **33%**");
    expect(md).toContain("<details>");
  });
  it("wilson interval", () => {
    const [lo, hi] = wilson(9, 10);
    expect(lo).toBeCloseTo(0.596, 2);
    expect(hi).toBeCloseTo(0.982, 2);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
