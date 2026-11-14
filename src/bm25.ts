import type { Chunk } from "./corpus.js";

const STOP = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its of on or our so that the their them then there these they this to was we what when where which who why will with you your".split(" "),
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOP.has(t));
}

export interface Hit { chunk: Chunk; score: number }

/** Plain Okapi BM25 (k1=1.2, b=0.75). Small, dependency-free, good enough to validate questions. */
export class BM25 {
  private docs: string[][];
  private df = new Map<string, number>();
  private avgdl: number;
  constructor(private chunks: Chunk[], private k1 = 1.2, private b = 0.75) {
    this.docs = chunks.map((c) => tokenize(c.text));
    for (const d of this.docs) for (const t of new Set(d)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgdl = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }
  private idf(t: string): number {
    const n = this.docs.length, df = this.df.get(t) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }
  search(query: string, k = 5): Hit[] {
    const q = tokenize(query);
    const scored = this.docs.map((d, i) => {
      const tf = new Map<string, number>();
      for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
      let s = 0;
      for (const t of q) {
        const f = tf.get(t) ?? 0;
        if (!f) continue;
        s += this.idf(t) * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.length) / this.avgdl)));
      }
      return { chunk: this.chunks[i]!, score: s };
    });
    return scored.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
}
