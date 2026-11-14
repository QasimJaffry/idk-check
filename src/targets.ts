import { spawn } from "node:child_process";

export type Ask = (question: string) => Promise<string>;

export interface HttpTarget {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Request body: a function of the question, or a JSON template where "{{question}}" is replaced. */
  body?: ((question: string) => unknown) | unknown;
  /** How to read the answer: a function of the parsed JSON, or a dot path like "data.answer". */
  answer?: ((json: any) => string) | string;
}

const fill = (tpl: unknown, q: string): unknown => {
  if (typeof tpl === "string") return tpl.split("{{question}}").join(q);
  if (Array.isArray(tpl)) return tpl.map((t) => fill(t, q));
  if (tpl && typeof tpl === "object") return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fill(v, q)]));
  return tpl;
};

export const getPath = (obj: any, path: string): unknown =>
  path.split(".").filter(Boolean).reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);

/** Joins a Server-Sent Events body into plain text (OpenAI-style deltas, {text}/{content}, or raw data lines). */
export function joinSse(body: string): string {
  let out = "";
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const d = line.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    try {
      const j = JSON.parse(d);
      out += j?.choices?.[0]?.delta?.content ?? j?.delta ?? j?.text ?? j?.content ?? (typeof j === "string" ? j : "");
    } catch {
      out += d;
    }
  }
  return out;
}

export function httpTarget(t: HttpTarget, fetchImpl: typeof fetch = fetch): Ask {
  return async (question) => {
    const body = typeof t.body === "function" ? (t.body as (q: string) => unknown)(question) : fill(t.body ?? { question: "{{question}}" }, question);
    const res = await fetchImpl(t.url, {
      method: t.method ?? "POST",
      headers: { "content-type": "application/json", ...(t.headers ?? {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) return joinSse(text);
    let json: unknown;
    try { json = JSON.parse(text); } catch { return text; }
    if (typeof t.answer === "function") return String(t.answer(json) ?? "");
    if (typeof t.answer === "string") {
      const v = getPath(json, t.answer);
      if (v === undefined) throw new Error(`answer path "${t.answer}" not found in response`);
      return String(v);
    }
    if (typeof json === "string") return json;
    for (const k of ["answer", "text", "content", "output", "response", "message"]) {
      const v = (json as any)?.[k];
      if (typeof v === "string") return v;
    }
    throw new Error('could not find the answer in the JSON response; set target.answer (e.g. "data.answer")');
  };
}

/** Runs a shell command per question: question on stdin, answer on stdout. */
export function commandTarget(cmd: string, timeoutMs = 60_000): Ask {
  return (question) =>
    new Promise((resolve, reject) => {
      const p = spawn(cmd, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "";
      const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("command timed out")); }, timeoutMs);
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => { clearTimeout(timer); reject(e); });
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`command exited ${code}: ${err.trim().slice(0, 200)}`));
      });
      p.stdin.end(question);
    });
}
