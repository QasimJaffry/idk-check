// The same bot over HTTP, for trying `idk-check run --url`:  node examples/bots/server.mjs [eager|strict|balanced]
import { createServer } from "node:http";
import { makeBot } from "./extractive.mjs";

const policy = process.argv[2] ?? "balanced";
const ask = makeBot(new URL("../nimbus-docs", import.meta.url).pathname, { policy });
createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const { question } = JSON.parse(body || "{}");
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ answer: await ask(String(question ?? "")) }));
}).listen(3311, () => console.log(`demo bot (${policy}) on http://localhost:3311/api/ask`));
