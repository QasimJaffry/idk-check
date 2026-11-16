// Builds the static playground: node scripts/build-site.mjs  ->  site/index.html
// Inlines the compiled judge (dist/judge.js), the example suite and the demo results, so the page
// runs the same judging code as the CLI with no server and no network calls.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const at = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(at(p), "utf8");

const judgeSrc = read("dist/judge.js");
if (/^import\s/m.test(judgeSrc)) throw new Error("dist/judge.js has runtime imports; the playground expects it to be self-contained");
const judgeCode = judgeSrc.replace(/^export\s+/gm, "").replace(/^\/\/# sourceMappingURL.*$/m, "");

const suite = JSON.parse(read("examples/suite.json"));
const policies = ["eager", "balanced", "strict"];
const runs = Object.fromEntries(policies.map((p) => [p, JSON.parse(read(`examples/out/${p}.json`))]));
const replies = {};
for (const p of policies) for (const r of runs[p].results) (replies[r.id] ??= {})[p] = r.answer;
const summaries = Object.fromEntries(policies.map((p) => [p, runs[p].summary]));
const chart = read("docs/tradeoff.svg");
const safe = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>idk-check playground</title>
<meta name="description" content="Type a bot reply and see how idk-check judges it. Runs the real judge in your browser.">
<style>
  :root { --bg:#0a0d14; --panel:#0f1420; --line:#1f2a3d; --text:#e6ebf5; --dim:#9aa6bf; --mute:#69748c;
          --good:#4cd08a; --bad:#ff6b6b; --warn:#ffc857; --blue:#7fb2ff; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif }
  main { max-width:920px; margin:0 auto; padding:40px 20px 64px }
  h1 { font-size:34px; letter-spacing:-.5px; margin:0 0 6px }
  h2 { font-size:21px; margin:44px 0 10px }
  p { color:var(--dim); margin:0 0 14px; max-width:68ch }
  a { color:var(--blue) }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px }
  label { display:block; font-size:13px; color:var(--mute); text-transform:uppercase; letter-spacing:.08em; margin:0 0 6px }
  select, textarea, button { font:inherit; color:var(--text); background:#0a0e18; border:1px solid var(--line); border-radius:10px }
  select { width:100%; padding:10px 12px }
  textarea { width:100%; min-height:92px; padding:12px; resize:vertical }
  select:focus-visible, textarea:focus-visible, button:focus-visible { outline:2px solid var(--blue); outline-offset:2px }
  .row { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 16px }
  button { padding:7px 12px; cursor:pointer; color:var(--dim) }
  button:hover { color:var(--text); border-color:#33415c }
  .meta { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 16px; font-size:14px }
  .chip { border:1px solid var(--line); border-radius:999px; padding:3px 10px; color:var(--dim) }
  .chip b { color:var(--text); font-weight:600 }
  #verdict { border-radius:12px; padding:14px 16px; margin-top:16px; border:1px solid var(--line) }
  #verdict .o { font-weight:700; font-size:18px }
  #verdict .r { color:var(--dim); font-size:15px; margin-top:2px }
  .pass { background:#0f2219; border-color:#215c40 !important } .pass .o { color:var(--good) }
  .fail { background:#2a1316; border-color:#6b2a30 !important } .fail .o { color:var(--bad) }
  .unclear { background:#2a2313; border-color:#6b5a24 !important } .unclear .o { color:var(--warn) }
  table { width:100%; border-collapse:collapse; font-size:15px }
  th, td { text-align:right; padding:9px 10px; border-bottom:1px solid var(--line) }
  th:first-child, td:first-child { text-align:left }
  th { color:var(--mute); font-weight:600; font-size:13px }
  .chart svg { width:100%; height:auto; display:block }
  footer { margin-top:48px; color:var(--mute); font-size:14px }
  .note { font-size:14px; color:var(--mute) }
</style>
</head>
<body>
<main>
  <h1>idk-check playground</h1>
  <p>idk-check tests whether an AI app says "I don't know" when its documents can't answer a question, without refusing questions it could answer. This page runs the same judging code as the command-line tool, in your browser. Nothing you type leaves the page.</p>
  <p><a href="https://github.com/QasimJaffry/idk-check">Source and docs on GitHub</a></p>

  <h2>Judge a reply</h2>
  <p>Pick a test question from the example suite (docs for a fictional e-bike company), then type what a bot might answer or load a reply the demo bot gave.</p>
  <div class="panel">
    <label for="case">Test question</label>
    <select id="case"></select>
    <div class="meta" id="meta"></div>
    <label for="reply">Bot reply</label>
    <textarea id="reply" spellcheck="false"></textarea>
    <div class="row" id="presets"></div>
    <div id="verdict" role="status" aria-live="polite"></div>
    <p class="note" style="margin-top:12px">Rules only: no model is called. Replies that hedge and still state specifics are marked unclear, and the CLI can pass those to an optional LLM judge.</p>
  </div>

  <h2>What the demo run found</h2>
  <p>The same 36 questions were put to a deliberately simple demo bot at three confidence settings. These are results for that demo bot, not for any real AI model.</p>
  <div class="panel"><table id="results"></table></div>
  <div class="panel chart" style="margin-top:14px;padding:8px">${chart}</div>
  <p class="note" style="margin-top:10px">No setting lands in the passing zone: making the bot more careful swaps invented answers for refusals.</p>

  <footer>MIT licensed. Built from the repository by <code>npm run site</code>.</footer>
</main>
<script type="module">
${judgeCode}
const SUITE = ${safe(suite.cases)};
const REPLIES = ${safe(replies)};
const SUMMARIES = ${safe(summaries)};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const facts = (list) => (list ?? []).map((f) => (Array.isArray(f) ? f.join(" or ") : f)).join("; ");
const LABEL = { pass: "Pass", answered_anyway: "Answered anyway (should have declined)", false_refusal: "Refused a question the docs answer",
                wrong: "Answered, but without the expected fact", unclear: "Unclear (needs a human or the LLM judge)" };
const EXPECT = { answerable: "answer with the fact", missing_info: "decline: the docs mention the topic but not this fact",
                 false_premise: "correct the false premise, or decline", out_of_scope: "decline: not covered", underspecified: "ask for the missing detail" };

const sel = $("case");
for (const c of SUITE) sel.add(new Option(\`[\${c.category.replace("_", " ")}] \${c.question}\`, c.id));

function current() { return SUITE.find((c) => c.id === sel.value); }

function render() {
  const c = current();
  const text = $("reply").value;
  const v = judge(c, text);
  const cls = v.outcome === "pass" ? "pass" : v.outcome === "unclear" ? "unclear" : "fail";
  $("verdict").className = cls;
  $("verdict").innerHTML = text.trim()
    ? \`<div class="o">\${esc(LABEL[v.outcome] ?? v.outcome)}</div><div class="r">\${esc(v.reason)}</div>\`
    : \`<div class="r">Type a reply to see the verdict.</div>\`;
  if (!text.trim()) $("verdict").className = "";
}

function pick() {
  const c = current();
  const need = c.category === "answerable" ? facts(c.mustInclude) : facts(c.acceptIfIncludes);
  $("meta").innerHTML = \`<span class="chip">category <b>\${esc(c.category.replace("_", " "))}</b></span>\`
    + \`<span class="chip">right reply: <b>\${esc(EXPECT[c.category])}</b></span>\`
    + (need ? \`<span class="chip">\${c.category === "answerable" ? "must include" : "true fact"}: <b>\${esc(need)}</b></span>\` : "");
  const box = $("presets"); box.innerHTML = "";
  for (const [p, a] of Object.entries(REPLIES[c.id] ?? {})) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = \`Load \${p} bot's reply\`;
    b.onclick = () => { $("reply").value = a; render(); };
    box.append(b);
  }
  $("reply").value = (REPLIES[c.id] ?? {}).eager ?? "";
  render();
}

sel.onchange = pick; $("reply").oninput = render;
sel.value = "mis-01"; pick();

const pc = (x) => Math.round(x * 100) + "%";
$("results").innerHTML = "<tr><th>bot setting</th><th>declined when it should</th><th>answered anyway</th><th>answered correctly</th><th>refused answerable</th></tr>"
  + Object.entries(SUMMARIES).map(([p, s]) => \`<tr><td>\${p}</td><td>\${s.abstained.k}/\${s.abstained.n} (\${pc(s.abstained.rate)})</td><td>\${s.answeredAnyway}</td><td>\${s.answered.k}/\${s.answered.n}</td><td>\${s.falseRefusals}</td></tr>\`).join("");
</script>
</body>
</html>
`;
mkdirSync(at("site"), { recursive: true });
writeFileSync(at("site/index.html"), html);
console.log(`wrote site/index.html (${(html.length / 1024).toFixed(0)} KB)`);
