# PrepMind

Turn a job description into a personalised interview preparation kit. Paste the
description, give the company's website, say how many days you have — PrepMind
crawls the company site, looks for public discussion of its interview process,
and builds a kit: company brief, role breakdown, a categorised question bank,
flashcards and a day-by-day study schedule. Everything in the kit is
reshapeable, and you practise against it inside the app.

## Stack

- **Next.js 16 (App Router) + TypeScript** — UI and API routes in one deployable
- **Groq** (`LLM_PROVIDER=groq`, default) — Llama 3.3 70B via Groq's
  OpenAI-compatible chat-completions API; any other OpenAI-shaped endpoint works
  too (`LLM_PROVIDER=openai-compatible`)
- **Tailwind CSS v4** — styling (light-scheme design; see `globals.css` for why)
- **better-sqlite3** — persistence (one file, WAL, auto-migrated)
- **zod** — request and kit-document validation
- **cheerio** — untrusted-HTML parsing for the crawler
- **undici** — guarded outbound fetch dispatcher
- **vitest** — 69 automated tests

## Install & run

```bash
npm install
cp .env.example .env      # set GROQ_API_KEY (free at console.groq.com/keys), or LLM_PROVIDER=fake
npm run dev               # http://localhost:3000
```

`LLM_PROVIDER=fake` runs the whole app offline against a deterministic fake
model — useful for trying the product without credentials. With a real Groq
key, generation typically takes well under a minute per kit (Groq's inference
speed suits the pipeline's many small calls).

### Batch entry point (mandatory command)

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Reads `[{ id, jd, company_url, days }]` (or `{"cases": [...]}`), runs the **same
pipeline the app uses** on each case, and writes one JSON file of results
(`{ generated_at, model, case_count, succeeded, failed, results }` where each
result is `{ case_id, status: "ok", kit }` or `{ case_id, status: "failed",
error }`). A failing case is recorded and the run continues. Progress goes to
stderr. Five cases complete comfortably within the 15-minute budget
(≤150s per-case wall-clock guard, default concurrency 2). `examples/cases.example.json`
is a ready-made input, and `scripts/dev-fixture-site.ts` serves a local company
site to point it at. Case URLs that resolve to loopback/private hosts relax the
SSRF guard automatically (with a warning) so local fixtures work from a clean
clone; public hostnames keep full guarding.

## Architecture

Strict separation of concerns, three layers:

```
src/core/          pure, framework-free domain logic (all unit-tested)
  kit/             kit schema (Appendix A), validation, coverage check, scheduler
  retrieval/       guarded fetcher, robots.txt, HTML cleaner, crawler, DDG search
  llm/             client interface + OpenAI impl + FakeLLM, prompts, pipeline, regen
  practice.ts      spaced-repetition state machine

src/server/        Node-side app layer
  db.ts            sqlite persistence
  auth.ts          scrypt + session cookies
  generation.ts    background jobs, progress events, dedupe, double-trigger guard
  kit-ops.ts       validated user mutations on a kit
  regen-runner.ts  section regeneration dispatch

src/app/           Next.js routes (pages + /api) and React components
```

### The pipeline is genuinely multi-step

`src/core/llm/pipeline.ts` runs ten deliberate steps, each reacting to what the
previous step actually found:

1. **Extract requirements** (one LLM call) — the pasted JD needs no retrieval;
   requirements keep the posting's own wording, marked `must`/`nice` from how
   each line is framed ("required" vs "bonus").
2. **Crawl the company site** (pure code) — fetch the homepage, rank its links
   by hiring/about/engineering signals, fetch the top candidates; falls back to
   `sitemap.xml` when the nav yields too little. No hard-coded paths.
3. **Search public discussion** (code + fetch) — DuckDuckGo's HTML endpoint for
   "company + interview process", fetching a couple of promising results.
4. **Company brief** (LLM) — written *only* from what steps 2–3 retrieved; a
   company nothing could be found about gets an honest brief saying so.
5. **Questions** (LLM, one call **per requirement**) — the prompt is
   category-specific: technical requirements get depth/trade-off probes,
   behavioural ones get STAR-style situations, system-design ones get design
   exercises. A "five years of React" requirement and a "mentoring juniors"
   requirement never share a call or instructions.
6. **Coverage check** (deterministic) — a requirement is covered iff some
   question references its id. Set difference, our code, not the model.
7. **Gap-fill passes** — uncovered requirements go back for more questions,
   then the check re-runs. Maximum **3 total generation passes**: one initial
   pass plus two gap-fill rounds. Three is enough for a model that is listening
   (each round closes nearly all gaps) while bounding cost and latency; anything
   still uncovered after three passes is reported honestly in the Coverage
   section rather than shipped silently — a kit that pretends to be complete is
   worse than one that admits its gaps.
8. **Flashcards** (LLM) — derived from the final question set; fails soft.
9. **Schedule** (deterministic arithmetic) — see below.
10. **Validation** (zod + cross-references) — the kit is saved only if it
    validates; otherwise the run fails loudly.

### Determinism where it belongs

Two things are never delegated to the model:

- **Scheduling** (`src/core/kit/schedule.ts`): questions are ordered by
  requirement priority (must before nice) then difficulty, and days are filled
  front-to-back under a daily-minute budget — so harder, must-have material
  lands early, not the night before. Every must-have requirement is guaranteed
  a place (the budget auto-raises if needed; overflow is added to the final day
  with a notice; spare days become rotating review sessions). 1 day → everything
  on day one; 60 days → review days after fresh material runs out. Same inputs
  always produce the same schedule.
- **Coverage** (`src/core/kit/coverage.ts`): pure set arithmetic between
  requirement ids and question references.

### The builder state model (regeneration without clobbering)

Every question and flashcard carries `origin` (`"generated"` | `"edited"` |
`"user"`) and a `pinned` lock:

- `origin: "generated"` — replaceable when its section regenerates
- `origin: "edited"` — the user touched an AI item; it is sticky and survives
- `origin: "user"` — hand-added; always survives, pinned by default
- `pinned` — an explicit lock that survives even if otherwise replaceable

Regenerating a question category removes only that category's replaceable
questions, recomputes coverage across *all* requirements, and fills whatever no
longer has a question — so the removed set plus any pre-existing gap is what
gets regenerated, and nothing else moves. Surviving items keep their ids
(stable ids are what practice history references); regenerated items get fresh
ids that were never used before. The schedule is re-allocated after question
changes so must-have coverage in the plan still holds. A failed regeneration
keeps the previous payload.

Id assignment is server-owned end to end: model-supplied ids are ignored, and
the payload's kit id is forced to match the database row id (the URL and every
client call key off it).

### Authentication

scrypt-hashed passwords (timing-safe comparison), opaque 32-byte session tokens
in an httpOnly, SameSite=Lax cookie with 7-day expiry. Every protected page
server-side-redirects signed-out visitors; every API route returns structured
`401 { error: { code: "unauthorized" } }`, and the client redirects to
`/login?expired=1` on any 401. Expired sessions are deleted lazily on use.
Email verification, password reset and roles are out of scope per the brief.

### Generation is long, external and failure-prone

- Kits run **in the background** of the server process; progress events are
  **persisted** to sqlite, so a refresh or second tab re-joins the run via the
  SSE endpoint (`/api/kits/[id]/events`, with a polling fallback in the client).
- **Double-trigger guard**: an in-process running set per kit id; a second
  trigger for the same kit is a no-op and a second submission of the same
  description/company/days by the same user **deduplicates by fingerprint**
  (sha256 of normalised jd+url+days) — the existing kit is returned instead of
  a second copy. Failed kits retry on the same row when resubmitted.
- Partial failure keeps what finished: the kit row stores the error and the
  user can retry; a failed section regeneration keeps the previous content.
- LLM provider failures (429/5xx/network) are retried with exponential backoff
  honouring `Retry-After`; per-requirement question failures become coverage
  gaps rather than dead runs; flashcard failures are skipped entirely.
- Everything a user edits is persisted server-side on each mutation (debounced
  ~700ms for text), so nothing lives only in the browser.

## Sources used by retrieval

- **The company site you provide** — homepage, then pages discovered by ranking
  its own links (careers/jobs/hiring, about/team, engineering blog/handbook),
  with sitemap.xml as fallback. Relative links are followed; hosts are never
  assumed.
- **DuckDuckGo HTML search** (`html.duckduckgo.com`) for public interview-
  process discussion, plus the top result pages. Major boards (Glassdoor,
  LinkedIn, Indeed) are excluded up front — they block automated access, and
  blocked fetches are reported as skipped sources rather than treated as data.

Crawler etiquette: `robots.txt` is fetched, cached per origin, and honoured
(longest-match Allow/Disallow, `Crawl-delay` respected up to 10s); at most one
request per host per second and two in flight; 10s timeouts; 2MB body cap;
HTML/plain-text/XML/JSON content types only.

## Security

- **SSRF**: every URL passes scheme/port/credential checks, then DNS is
  validated pre-flight *and again at connect time* through a custom undici
  dispatcher lookup — loopback, RFC1918, link-local (incl. the 169.254.169.254
  metadata endpoint), CGNAT, ULA and IPv4-mapped IPv6 ranges are rejected, as
  are `localhost`-family and reserved pseudo-TLD hostnames. Redirect targets
  are re-validated per hop. `ALLOW_PRIVATE_HOSTS=1` exists for local fixtures
  in development only; the batch CLI enables it automatically for private case
  URLs and says so.
- **Untrusted content**: fetched pages are parsed with cheerio (scripts/styles
  stripped), truncated, and every prompt wraps crawled or pasted text in
  `<untrusted_content>` tags whose system-prompt contract says the contents are
  data, never instructions. The UI renders model output through a small React
  markdown renderer — there is no `dangerouslySetInnerHTML` anywhere.
- **Validation**: request bodies are zod-validated per route; a generated or
  mutated kit is fully revalidated (schema + id cross-references + schedule
  guarantees) before it is ever saved.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Company URL invalid / 404 / timeout | Crawl reports the source as skipped; the brief states honestly that nothing was retrieved; notices on the kit; generation still completes |
| No hiring/about page discoverable | The brief's "How they hire" says unknown; sources panel shows what was and wasn't fetched |
| Two-line job description | Rejected below 30 chars; above that, extraction returns only what's there (even one requirement) and the kit carries a "thin description" notice — a thin kit, never an invented one |
| No public discussion found | Reported as a notice + skipped source; never fatal |
| Model returns invalid JSON | Fenced-code stripping, balanced-extraction, trailing-comma repair; then a retryable error — per-requirement failures degrade to coverage gaps |
| Provider rate-limits / brief failure | Exponential backoff with Retry-After, up to 4 attempts per call; runs slow down but complete |
| Same description + company submitted twice | Deduplicated by fingerprint; the existing kit is returned |
| 1-day or 60-day schedule | Exactly N days always: day one takes everything on a 1-day plan; a 60-day plan cycles review days after fresh material is exhausted |

## Tests

```bash
npm test
```

61 tests cover the behaviour most worth protecting: schedule allocation
(exact day count, must-have coverage, priority ordering, 1/60-day cases,
determinism), coverage checking (gap detection, priority order), kit structure
validation (schema, cross-references, must-in-schedule), SSRF rejection,
robots parsing, HTML extraction, link ranking, practice ordering, the full
pipeline against a **local fixture HTTP server** (real crawler, fake LLM),
and regeneration semantics (edited/user items survive; removed ids are never
reused).

## Creativity feature: mock interview mode

`/kits/[id]/interview` runs the question bank as a timed mock interview:
questions are ordered by *your* weakness (each question inherits a score from
the practice confidence of flashcards sharing its requirements, plus must-have
priority), a countdown clock per question, shaky answers resurface later in the
run, and the finish screen summarises weak categories and the requirements to
revisit next.

## Practice mode ordering

Unseen cards come first (they are by definition the least confident), then
cards by lowest last confidence, then earliest due date — a deterministic,
confidence-weighted sort rather than full SM-2. Intervals themselves follow a
light SM-2 rule (0–3 confidence → interval growth 0 / ×1.2 / ×ease / ×ease×1.3,
ease clamped 1.3–2.8), which is simple enough to store per card and to reason
about in tests while still spacing repeats over days.
