# idk-check

**Does your AI app say "I don't know" when it should, without refusing everything?**

`idk-check` is a test runner for RAG apps and support bots. You point it at your docs and your running app. It asks questions your docs **can** answer, plus questions they **can't**, and reports both sides of the trade-off with confidence intervals. In CI it fails the build when either side gets worse.

```
$ npx idk-check run --min-abstain 0.85 --max-false-refusal 0.15

### ❌ support-bot: declined 79% of questions the docs can't answer · answered 50% of ones they can

| | result | 95% CI |
|---|---:|---:|
| said "I don't know" when it should      | 19/24 | 60%–91% |
| answered anyway (should have declined)  |  4/24 |         |
| answered correctly when it could        |  6/12 | 25%–75% |
| refused a question it could answer      |  6/12 |         |

- ❌ declined 79% of unanswerable questions; need ≥ 85%
- ❌ refused 50% of answerable questions; allowed ≤ 15%
```

Zero runtime dependencies. Works with any app you can reach over HTTP, a shell command or a function call.

## Why this exists

Most RAG evals score the answers to questions that *have* answers. In production, a large share of real questions don't: a price that isn't in the docs, a feature that doesn't exist, "when will it arrive?" with no order number. Those are the questions where an app invents something, and nothing in a typical test suite notices.

The easy fix ("refuse unless you're sure") breaks the other side: the bot starts refusing questions it could answer. You can't judge either number alone. `idk-check` always reports both.

## The five kinds of question

| category | example (fictional Nimbus e-bike docs) | the right reply |
|---|---|---|
| `answerable` (control) | How long is the frame warranty? | the fact: 5 years |
| `missing_info` | How much does the optional fast charger cost? | docs mention the charger, not its price → decline |
| `false_premise` | How do I order the 750 Wh battery? | there is no 750 Wh battery; correct the premise |
| `out_of_scope` | Do you offer a student discount? | not covered → decline |
| `underspecified` | When will it arrive? | ask which order |

`missing_info` is the hard one. The topic *is* in the docs, so retrieval finds relevant text and the model is tempted to fill in the gap.

## What the demo shows

`examples/` has six short docs for a fictional e-bike company, 36 hand-written test cases and a deliberately simple extractive bot with three confidence policies. `npm run demo` runs all three:

| bot policy | declined unanswerable | answered anyway | answered correctly | refused answerable |
|---|---:|---:|---:|---:|
| eager (always answer) | 6/24 (25%) | 17 | 7/12 | 0 |
| strict (refuse unless every keyword matches) | 23/24 (96%) | 1 | 4/12 | 8 |
| balanced | 19/24 (79%) | 4 | 6/12 | 6 |

None of the three passes a sensible gate. Turning the "be careful" knob trades invented answers for refused ones, and a single accuracy number would have hidden it. Real LLM apps sit somewhere on the same curve; this tool tells you where, and alerts you when a prompt or model change moves you.

## Quick start

```bash
npm i -D idk-check
npx idk-check init                 # writes idk.config.mjs
```

```js
// idk.config.mjs
export default {
  docs: "./docs",
  suite: "./idk/suite.json",
  target: {
    url: "http://localhost:3000/api/ask",
    body: { question: "{{question}}" },      // or (q) => ({ messages: [{ role: "user", content: q }] })
    answer: "data.answer",                    // dot path, or (json) => ...
  },
  // command: "python ask.py",               // question on stdin, answer on stdout
  // ask: async (q) => myRag.answer(q),      // call your code directly
  thresholds: { minAbstain: 0.9, maxFalseRefusal: 0.1 },
};
```

Streaming endpoints (Server-Sent Events, OpenAI-style deltas) are joined automatically.

### Write the suite, or draft one from your docs

Write cases by hand (see `examples/suite.json`), or let a model draft them:

```bash
export OPENROUTER_API_KEY=...       # or IDK_API_KEY / OPENAI_API_KEY + IDK_BASE_URL
npx idk-check generate --docs ./docs --out idk/suite.json --model openai/gpt-4o-mini
```

Generated cases are checked before they are kept:

- **answerable:** every expected fact must appear **verbatim** in the docs.
- **false_premise:** the contradicted fact must appear verbatim.
- **missing_info / out_of_scope:** a second model reads the top retrieved passages and must agree the docs **can't** answer. If it is unsure, the case is dropped.

The file is written with `"reviewed": false`, and `run` warns until a person reads it and flips the flag. A generated test is a draft, not ground truth. The suite also records a hash of your docs, so `run` tells you when the docs changed under it.

### Run it

```bash
npx idk-check run
npx idk-check run --url http://localhost:3000/api/ask --answer-path answer
npx idk-check run --cmd "python ask.py" --llm-judge
```

It writes `.idk/report.md` (paste it into a PR or `$GITHUB_STEP_SUMMARY`) and `.idk/results.json`. Exit codes: `0` passed, `1` a threshold failed, `2` usage or config error.

`examples/github-action/idk.yml` is a copy-paste workflow that starts your app, runs the suite and adds the report to the PR's job summary.

## How replies are judged

Rules first, so most runs need no LLM and cost nothing:

1. **Shape.** Is the reply a decline ("I don't know", "the docs don't mention…", a clarifying question), an answer, or a hedge?
2. **Facts.** Answerable cases list the facts a correct answer must contain, with alternatives (`["5-year", "5 years"]`). Matching is whole-token, ignoring case, thousands separators and curly quotes, so `15` doesn't match `150`.
3. **False premises** pass only if the reply contains the true fact **and** corrects the premise (or declines).
4. **Hedges with specifics** ("not sure, but probably £79") are marked `unclear` instead of being guessed at.

With `--llm-judge`, a model settles only the `unclear` cases, and each one is labelled `decidedBy: "llm"` in the results. The judge can never upgrade an answerable reply that is missing the fact to a pass, and if the judge call fails the case stays `unclear`.

## Library use

```ts
import { loadSuite, runSuite, summarize, gate, httpTarget } from "idk-check";

const suite = loadSuite("idk/suite.json");
const results = await runSuite(suite, httpTarget({ url: "http://localhost:3000/api/ask" }), { concurrency: 8 });
const failures = gate(summarize(results), { minAbstain: 0.9, maxFalseRefusal: 0.1 });
```

## Limits, stated plainly

- Rule-based judging is conservative. Unusual phrasings of "I don't know" may land in `unclear`; add `--llm-judge` or extend the suite.
- 24 unanswerable cases give a wide interval (the demo's 79% is really "somewhere between 60% and 91%"). Use 50 or more per side before trusting small differences between versions.
- It tests the whole app as a black box. It tells you *that* the app invents answers on a class of questions, not *which* component is at fault.

## Related work

Research tools cover parts of this ground: KnowOrNot and UAEval4RAG study abstention in RAG systems. `idk-check` is aimed at a different job: a small, dependency-free check you drop into an existing app's CI and read in a PR.

## Development

```bash
npm ci
npm test          # 43 tests, including scripted fake LLMs for the generator and judge
npm run typecheck
npm run demo      # writes examples/out/{eager,strict,balanced}.md
```

MIT © Qasim Hassan Jaffry
