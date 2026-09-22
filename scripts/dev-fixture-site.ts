#!/usr/bin/env node
/**
 * A small local "company website" for manual testing: serves a homepage with
 * relative links to careers/about, robots.txt, and an engineering blog —
 * enough for the crawler's link-ranking path to run against something real.
 *
 *   npx tsx scripts/dev-fixture-site.ts [port]
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 4567);

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>
<nav><a href="/">Home</a> <a href="/careers">Careers</a> <a href="/about">About us</a> <a href="/blog/engineering">Engineering blog</a></nav>
<main>${body}</main></body></html>`;

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const send = (title: string, body: string) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(title, body));
  };
  if (url === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("User-agent: *\nDisallow: /private\nCrawl-delay: 0");
    return;
  }
  if (url === "/")
    return send("FixtureCorp — Home", `<h1>FixtureCorp</h1><p>${"We build logistics software that keeps freight moving across Europe. ".repeat(6)}</p>`);
  if (url === "/careers")
    return send("Careers at FixtureCorp", `<h1>How we hire</h1><p>${"Our process: intro call, a short take-home, a system design round, and a behavioural interview. ".repeat(6)}</p>`);
  if (url === "/about")
    return send("About FixtureCorp", `<h1>About</h1><p>${"Founded in 2015, FixtureCorp serves 400 freight companies. ".repeat(6)}</p>`);
  if (url === "/blog/engineering")
    return send("Engineering at FixtureCorp", `<h1>Engineering</h1><p>${"We write about Django, Kubernetes and event-driven architecture. ".repeat(6)}</p>`);
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fixture company site: http://127.0.0.1:${port}/`);
});
