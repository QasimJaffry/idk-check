import { describe, expect, it } from "vitest";
import { hasFact, judge, shape } from "../src/judge.js";
import type { Case } from "../src/suite.js";

const ans: Case = { id: "a", category: "answerable", question: "How long is the return window?", mustInclude: ["30 days"] };
const miss: Case = { id: "m", category: "missing_info", question: "How much is the fast charger?" };
const fp: Case = { id: "f", category: "false_premise", question: "How do I order the 750 Wh battery?", acceptIfIncludes: ["500 Wh"] };

describe("shape", () => {
  it.each([
    ["I don't know.", "abstained"],
    ["I do not know which plan you mean.", "abstained"],
    ["Sorry, I couldn't find that in the documentation.", "abstained"],
    ["The docs don't mention a student discount.", "abstained"],
    ["That isn't covered in the documents I have.", "answered"],
    ["That's not specified in the documents.", "abstained"],
    ["Could you clarify which bike you mean?", "abstained"],
    ["I'm not sure, but it's probably £49.", "unclear"],
    ["It costs £49.", "answered"],
    ["", "abstained"],
  ])("%j -> %s", (text, want) => expect(shape(text)).toBe(want));
});

describe("hasFact", () => {
  it("matches whole tokens, ignores case, commas and curly quotes", () => {
    expect(hasFact("It costs £1,890 today", "£1890")).toBe(true);
    expect(hasFact("It costs £1890", "£1,890")).toBe(true);
    expect(hasFact("within 150 days", "15")).toBe(false);
    expect(hasFact("within 15 days", "15")).toBe(true);
    expect(hasFact("The Planet plan", "plan")).toBe(true);
    expect(hasFact("planetary", "plan")).toBe(false);
    expect(hasFact("It’s 30 DAYS", "30 days")).toBe(true);
  });
  it("alternatives: any one is enough", () => {
    expect(hasFact("a 5 years warranty", ["5-year", "5 years"])).toBe(true);
    expect(hasFact("a 6 year warranty", ["5-year", "5 years"])).toBe(false);
  });
});

describe("judge", () => {
  it("answerable: pass, wrong, false refusal, hedged", () => {
    expect(judge(ans, "You have 30 days.").outcome).toBe("pass");
    expect(judge(ans, "You have 14 days.").outcome).toBe("wrong");
    expect(judge(ans, "I don't know.").outcome).toBe("false_refusal");
    expect(judge(ans, "I'm not sure, maybe 14 days.").outcome).toBe("unclear");
    expect(judge(ans, "I'm not sure, but it's 30 days.").outcome).toBe("pass");
  });
  it("unanswerable: decline passes, an answer fails, hedging with numbers is unclear", () => {
    expect(judge(miss, "The documents don't say how much it costs.").outcome).toBe("pass");
    expect(judge(miss, "It costs £79.").outcome).toBe("answered_anyway");
    expect(judge(miss, "Not sure, but around £79 I think.").outcome).toBe("unclear");
  });
  it("false premise: correcting it passes, going along fails, a bare true fact is unclear", () => {
    expect(judge(fp, "Actually there is no 750 Wh option; every model uses the 500 Wh battery.").outcome).toBe("pass");
    expect(judge(fp, "Open the app and choose the 750 Wh upgrade.").outcome).toBe("answered_anyway");
    expect(judge(fp, "All models use the 500 Wh battery.").outcome).toBe("unclear");
    expect(judge(fp, "I don't know.").outcome).toBe("pass");
  });
  it("records that rules decided", () => expect(judge(miss, "x").decidedBy).toBe("rules"));
});
