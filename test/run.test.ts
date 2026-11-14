import { describe, expect, it, vi } from "vitest";
import type { LLM } from "../src/llm.js";
import { parseJsonReply } from "../src/llm.js";
import { runSuite } from "../src/runner.js";
import type { Suite } from "../src/suite.js";
import { commandTarget, getPath, httpTarget, joinSse } from "../src/targets.js";

const suite: Suite = {
  version: 1,
  cases: [
    { id: "a1", category: "answerable", question: "How long is the return window?", mustInclude: ["30 days"] },
    { id: "m1", category: "missing_info", question: "How much is the fast charger?" },
    { id: "o1", category: "out_of_scope", question: "Student discount?" },
  ],
};

const resp = (body: string, type = "application/json", status = 200) =>
  new Response(body, { status, headers: { "content-type": type } });

describe("http target", () => {
  it("fills the template, reads a dot path", async () => {
    const f = vi.fn(async (_u: any, init: any) => resp(JSON.stringify({ data: { answer: `echo:${JSON.parse(init.body).input.q}` } })));
    const ask = httpTarget({ url: "http://x", body: { input: { q: "{{question}}" } }, answer: "data.answer" }, f as any);
    expect(await ask("hi")).toBe("echo:hi");
  });
  it("guesses common fields, accepts plain text, joins SSE, reports HTTP errors", async () => {
    expect(await httpTarget({ url: "u" }, (async () => resp('{"text":"t"}')) as any)("q")).toBe("t");
    expect(await httpTarget({ url: "u" }, (async () => resp("plain", "text/plain")) as any)("q")).toBe("plain");
    const sse = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n';
    expect(await httpTarget({ url: "u" }, (async () => resp(sse, "text/event-stream")) as any)("q")).toBe("Hello");
    await expect(httpTarget({ url: "u" }, (async () => resp("no", "text/plain", 500)) as any)("q")).rejects.toThrow(/500/);
    await expect(httpTarget({ url: "u", answer: "nope.x" }, (async () => resp("{}")) as any)("q")).rejects.toThrow(/not found/);
    await expect(httpTarget({ url: "u" }, (async () => resp('{"weird":1}')) as any)("q")).rejects.toThrow(/set target.answer/);
  });
  it("helpers", () => {
    expect(getPath({ a: [{ b: 2 }] }, "a.0.b")).toBe(2);
    expect(joinSse("data: raw\ndata: {\"text\":\"!\"}")).toBe("raw!");
  });
});

describe("command target", () => {
  it("passes the question on stdin", async () => {
    expect(await commandTarget("cat")("hello there")).toBe("hello there");
    await expect(commandTarget("exit 3")("q")).rejects.toThrow(/exited 3/);
    await expect(commandTarget("sleep 5", 200)("q")).rejects.toThrow(/timed out/);
  });
});

describe("runSuite", () => {
  it("judges every case, keeps order, runs concurrently", async () => {
    let inFlight = 0, peak = 0;
    const ask = async (q: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return q.includes("return") ? "30 days." : "I don't know.";
    };
    const rs = await runSuite(suite, ask, { concurrency: 3 });
    expect(rs.map((r) => r.id)).toEqual(["a1", "m1", "o1"]);
    expect(rs.every((r) => r.outcome === "pass")).toBe(true);
    expect(peak).toBe(3);
  });
  it("retries, then records errors and timeouts as outcomes", async () => {
    let calls = 0;
    const flaky = async () => { if (calls++ === 0) throw new Error("boom"); return "30 days"; };
    expect((await runSuite({ ...suite, cases: [suite.cases[0]!] }, flaky, { retries: 1 }))[0]!.outcome).toBe("pass");
    const dead = async () => { throw new Error("down"); };
    expect((await runSuite({ ...suite, cases: [suite.cases[0]!] }, dead, { retries: 0 }))[0]).toMatchObject({ outcome: "error", error: "down" });
    const slow = () => new Promise<string>((r) => setTimeout(() => r("x"), 500));
    expect((await runSuite({ ...suite, cases: [suite.cases[0]!] }, slow, { retries: 0, timeoutMs: 50 }))[0]!.error).toMatch(/timed out/);
  });
  it("the optional LLM judge settles unclear replies only", async () => {
    const chat = vi.fn(async () => '```json\n{"declined": false}\n```');
    const llm: LLM = { name: "fake", chat };
    const rs = await runSuite(suite, async (q) => (q.includes("charger") ? "Not sure, maybe £79." : q.includes("return") ? "30 days" : "I don't know."), { llmJudge: llm });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(rs[1]).toMatchObject({ outcome: "answered_anyway", decidedBy: "llm" });
    expect(rs[0]!.decidedBy).toBe("rules");
  });
  it("LLM judge never passes an answerable case that lacks the fact", async () => {
    const one = { ...suite, cases: [suite.cases[0]!] };
    const hedge = async () => "I'm not sure, maybe 14 days.";
    const said = (declined: boolean): LLM => ({ name: "f", chat: async () => JSON.stringify({ declined }) });
    expect((await runSuite(one, hedge, { llmJudge: said(false) }))[0]!.outcome).toBe("wrong");
    expect((await runSuite(one, hedge, { llmJudge: said(true) }))[0]!.outcome).toBe("false_refusal");
  });
  it("false-premise unclear cases use the premise judge", async () => {
    const fp = { version: 1 as const, cases: [{ id: "f", category: "false_premise" as const, question: "How do I order the 750 Wh battery?", acceptIfIncludes: ["500 Wh"] }] };
    const chat = vi.fn(async (sys: string) => (sys.includes("FALSE premise") ? '{"rejected_premise": true}' : '{"declined": false}'));
    const rs = await runSuite(fp, async () => "All models use the 500 Wh battery.", { llmJudge: { name: "f", chat } });
    expect(rs[0]).toMatchObject({ outcome: "pass", decidedBy: "llm" });
  });
  it("judge failure leaves the case unclear instead of guessing", async () => {
    const llm: LLM = { name: "fake", chat: async () => "no json here" };
    const rs = await runSuite({ ...suite, cases: [suite.cases[1]!] }, async () => "Not sure, maybe £79.", { llmJudge: llm });
    expect(rs[0]).toMatchObject({ outcome: "unclear" });
    expect(rs[0]!.reason).toMatch(/LLM judge failed/);
  });
});

it("parseJsonReply tolerates fences and chatter", () => {
  expect(parseJsonReply('Sure! ```json\n[{"a":1}]\n``` done')).toEqual([{ a: 1 }]);
  expect(parseJsonReply('ok {"b": true} thanks')).toEqual({ b: true });
  expect(() => parseJsonReply("nothing")).toThrow();
});
