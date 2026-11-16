// Draws the abstention trade-off from the demo results: node scripts/chart.mjs  ->  docs/tradeoff.svg
import { readFileSync, writeFileSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url).pathname;
const policies = [
  ["eager", "eager", "#ff6b6b"],
  ["balanced", "balanced", "#ffb74d"],
  ["strict", "strict", "#6ea8ff"],
];
const pts = policies.map(([f, label, color]) => {
  const { summary: s } = JSON.parse(readFileSync(here(`../examples/out/${f}.json`), "utf8"));
  return { label, color, x: s.falseRefusalRate * 100, y: s.abstained.rate * 100, lo: s.abstained.ci[0] * 100, hi: s.abstained.ci[1] * 100,
           note: `${s.abstained.k}/${s.abstained.n} declined · ${s.falseRefusals}/${s.answered.n} refused` };
});

const W = 860, H = 540, L = 84, R = 36, T = 70, B = 82;
const px = (v) => L + (v / 100) * (W - L - R);
const py = (v) => T + (1 - v / 100) * (H - T - B);
const grid = [0, 25, 50, 75, 100];
const el = [];
el.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" font-family="ui-sans-serif,system-ui,sans-serif">`);
el.push(`<title id="t">The abstention trade-off for three bot settings</title>`);
el.push(`<desc id="d">${pts.map((p) => `${p.label}: ${p.note}`).join("; ")}. None reaches the passing zone of at least 90% declined and at most 10% refused.</desc>`);
el.push(`<rect width="${W}" height="${H}" rx="14" fill="#0b0f17"/>`);
el.push(`<text x="${L}" y="34" fill="#e6ebf5" font-size="21" font-weight="700">The trade-off: inventing answers vs refusing answerable ones</text>`);
el.push(`<text x="${L}" y="54" fill="#9aa6bf" font-size="13">Demo bot at three confidence settings · 24 unanswerable + 12 answerable questions · bars are 95% intervals</text>`);
// pass zone: >=90% declined, <=10% refused
el.push(`<rect x="${px(0)}" y="${py(100)}" width="${px(10) - px(0)}" height="${py(90) - py(100)}" fill="#4cd08a" fill-opacity=".16" stroke="#4cd08a" stroke-dasharray="4 3"/>`);
el.push(`<text x="${px(10) + 8}" y="${py(95) + 4}" fill="#4cd08a" font-size="12.5" font-weight="600">gate: ≥90% declined, ≤10% refused</text>`);
for (const g of grid) {
  el.push(`<line x1="${L}" x2="${W - R}" y1="${py(g)}" y2="${py(g)}" stroke="#1d2638"/>`);
  el.push(`<text x="${L - 10}" y="${py(g) + 4}" fill="#9aa6bf" font-size="12" text-anchor="end">${g}%</text>`);
  el.push(`<line y1="${T}" y2="${H - B}" x1="${px(g)}" x2="${px(g)}" stroke="#1d2638"/>`);
  el.push(`<text x="${px(g)}" y="${H - B + 20}" fill="#9aa6bf" font-size="12" text-anchor="middle">${g}%</text>`);
}
el.push(`<text x="${(L + W - R) / 2}" y="${H - 28}" fill="#c4cde0" font-size="13.5" text-anchor="middle">refused questions it could answer  →  worse</text>`);
el.push(`<text transform="translate(24 ${(T + H - B) / 2}) rotate(-90)" fill="#c4cde0" font-size="13.5" text-anchor="middle">said "I don't know" when it should  →  better</text>`);
for (const p of pts) {
  el.push(`<line x1="${px(p.x)}" x2="${px(p.x)}" y1="${py(p.lo)}" y2="${py(p.hi)}" stroke="${p.color}" stroke-width="3" stroke-opacity=".55" stroke-linecap="round"/>`);
  el.push(`<circle cx="${px(p.x)}" cy="${py(p.y)}" r="9" fill="${p.color}" stroke="#0b0f17" stroke-width="2.5"/>`);
  const right = p.x < 60;
  const tx = px(p.x) + (right ? 18 : -18), anchor = right ? "start" : "end";
  el.push(`<text x="${tx}" y="${py(p.y) - 2}" fill="#e6ebf5" font-size="15" font-weight="700" text-anchor="${anchor}">${p.label}</text>`);
  el.push(`<text x="${tx}" y="${py(p.y) + 15}" fill="#9aa6bf" font-size="12" text-anchor="${anchor}">${p.note}</text>`);
}
el.push(`</svg>`);
writeFileSync(here("../docs/tradeoff.svg"), el.join("\n"));
console.log("wrote docs/tradeoff.svg");
