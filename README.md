# Prism AI

AI marketing engine you run yourself. A named team of specialist agents with
persistent memory and nightly dream cycles, viral research, an AI video Studio
and conversational Director, an Ad Studio with AI image/video generation, an
SEO/GEO suite, a website builder, Meta and Google ads management, a leads CRM,
newsletters, and scheduling across Instagram, Facebook, TikTok, LinkedIn,
YouTube, Pinterest and Google Business via Postiz — coordinated by a supervisor
agent that reports on everything.

**No API credits needed.** Every agent runs on an AI engine you already pay for:
sign in to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (Claude
Pro/Max) or [OpenAI Codex](https://developers.openai.com/codex) (ChatGPT
Plus/Pro) on the machine, and Prism drives it locally. An Anthropic API key
works too if you prefer pay-per-token. **No brand baked in:** the first run reads
your website, asks a two-minute quiz, and briefs every agent on *your* business.

- Clone: `https://github.com/memefactorydev-design/Prism-Download-Only.git`
- Download zip: `https://github.com/memefactorydev-design/Prism-Download-Only/archive/refs/heads/main.zip`
- Licence: AGPL-3.0 (run it for your business freely; share changes if you offer it to others)

## Quick start (local)

Requirements: Node 22 or newer, npm, and one AI engine signed in (see below).
ffmpeg ships with the app (`ffmpeg-static`).

```bash
git clone https://github.com/memefactorydev-design/Prism-Download-Only.git prism
cd prism
npm install
npm run setup        # writes .env (generated secrets, OPEN_ACCESS=1), creates the SQLite DB, detects engines
npm run dev          # → http://localhost:3000  (opens straight into the guided setup)
npm run worker       # second terminal — video rendering, newsletters, nightly agent dreams
```

That is the whole install. The app opens as the built-in **Owner** (admin)
account and takes you through **First Light**: engine check → your website →
fix anything that's off → the quiz → creative licence and channels → your first
week of posts, already drafted.

### Install with an AI agent

Paste this into Codex or Claude Code on the machine that will run Prism:

> Clone https://github.com/memefactorydev-design/Prism-Download-Only.git into a folder called prism, run `npm install` and `npm run setup`, then start `npm run dev` and `npm run worker` in two terminals and open http://localhost:3000/welcome. If `npm run setup` reports no AI engine signed in, tell me which command to run (`claude auth login` or `codex login`) and wait for me.

## The AI engine

Prism makes one kind of call — "think about this, answer like that" — through
one door (`src/lib/llm`). Three engines can answer it:

| Engine | What it needs | Billed to |
|---|---|---|
| **Claude Code** (`claude-cli`) | `npm i -g @anthropic-ai/claude-code` then `claude auth login` | your Claude Pro/Max plan |
| **Codex** (`codex-cli`) | `npm i -g @openai/codex` then `codex login` | your ChatGPT Plus/Pro plan |
| **Anthropic API** (`anthropic-api`) | an API key on the Connections page or `ANTHROPIC_API_KEY` | per token |

`LLM_ENGINE="auto"` (the default) prefers a connected API key, then Claude Code,
then Codex. The **AI engine** card on `/connections` shows what it found, lets
you pick one, and runs a live one-line test. Prism only ever spawns the CLI you
signed in to yourself; it never reads, stores or forwards your credentials, and
never modifies the binaries.

Things to know about subscription engines:

- Every agent run, chat turn and planner pass counts against your plan's usage
  window (Claude Code reports the window on the engine card). Nightly dreams are
  capped at `DREAMS_MAX_PER_NIGHT` (default 8) and CLI sessions run at most
  `LLM_MAX_CONCURRENCY` (default 2) at a time so a busy night cannot drain it.
- Heavy automated use may exceed what a consumer plan is intended for. Read your
  provider's terms; the API-key engine is always there if you'd rather pay per token.
- Live Google-grounded research uses Gemini when a key is connected, otherwise
  Claude Code's own web search. Codex cannot search the web from `codex exec`.
- Images, video, voice, music and scraping need their own services (next section).
  Nothing in a chat subscription generates a video.

### Optional services

Either put keys in `.env` (see `.env.example`, every variable is documented) or
paste them on the app's **/connections** page, where they are stored encrypted
with `TOKEN_ENCRYPTION_KEY`. Every feature tells you which service it needs when
you try it; nothing fails silently.

| Feature | Service |
|---|---|
| Publishing to social channels | Postiz (`POSTIZ_API_KEY`) — the one integration that posts |
| Images, Google-grounded research, backup video | Gemini (`GEMINI_API_KEY`) |
| Video generation (Kling / Seedance) | fal.ai (`FAL_KEY`) |
| Voice-over, music, transcription | ElevenLabs (`ELEVENLABS_API_KEY`) |
| Ads + Ad Library research | Meta app (`META_*`) |
| Trend scraping and intel | Apify (`APIFY_TOKEN`) |
| Stock media | Pexels (`PEXELS_API_KEY`) |

### Your brand

The business every agent works for is captured once, as data, never in prompt
files: `/welcome` reads your website (copy, colours, type, photos, contact
details, social links), the supervisor agent drafts a profile you correct, and
the quiz adds what a website rarely says — areas served, price band, current
offers, competitors, keywords. The result is rendered into a **brand brief**
with fixed headings that every prompt refers to. Edit it any time on `/brand`;
"Start again" archives the agents' learned memory and reruns setup. Until setup
is done the team works brand-neutral and says so.

### Turning the login back on

`OPEN_ACCESS=1` is for evaluation and private team servers. Before exposing an
instance to the public internet set `OPEN_ACCESS="0"` and a strong
`DASHBOARD_PASSWORD` in `.env`; the first login then creates the admin account
from `ADMIN_EMAIL` / `DASHBOARD_PASSWORD`, and further users are added on **/users**.

## Hosting on a VPS

`deploy/README.md` walks through a one-command Ubuntu setup (Node 22, Caddy with
automatic HTTPS, two systemd services, backups). The script turns the login on
by default. `DEPLOY.md` covers the Vercel + Turso split for the dashboard alone.

---

## The agent team

Eleven named specialists live in `agents/<id>/` (AGENT.md + SOUL.md + SKILLS.md,
plus the shared `agents/BRAND.md` that explains how to read the brief): Scout
(ads intelligence), Harriet (Houzz), Pia (Pinterest), Isla (Instagram), Felix
(Facebook), Yara (YouTube), Kai (TikTok), Nova (viral), Otto (SEO/GEO), Magnus
(Google Business Profile), Lydia (LinkedIn/trade). Chat with them on **/agents**
(with optional live research and scraped platform intel). Each agent also owns
two files it writes itself — `MEMORY.md` (accumulated context) and `LEARNINGS.md`
(rules distilled from your 👍/👎 feedback) — updated during **nightly dream
cycles** (3am, in the worker): the agent replays its journal (`data/journal/`),
consolidates memory, and files a dream report with fresh ideas on **/dreams**.
**/intel** scrapes real platform data per specialist (competitor ads, Instagram
engagement, reviews, SERPs — 8 Apify sources) into briefs that feed chat and
dreams. **/adstudio** turns a brief into 3 ready-to-paste ad variants with
one-click images and video.

Twenty-one pipeline agents in `.claude/agents/` power the features (research,
copy, planning, editing, design). Both kinds are brand-agnostic and read the
brief; `npm test` fails if a real business name ever appears in them.

### Studio (video editor)

Upload a raw video on **Studio** and it is cut into vertical short-form reels:
ElevenLabs Scribe transcribes it with word timestamps, the `video-editor-agent`
plans the edit from the transcript and your researched viral hooks, and
**ffmpeg** (`ffmpeg-static`, no system install needed) renders each clip to
1080×1920 with burned captions. Download a clip or push it to Postiz as a draft.
Rendering runs in a **separate worker process** — run `npm run worker` alongside
`npm run dev`. If no engine is ready, a clearly-labelled heuristic fallback
planner still lets the render path run end-to-end.

Studio also does animated word-by-word captions (style templates), a virality
score (0–100) that ranks the reels, opt-in filler-word/dead-air trimming, an
opt-in **active-speaker reframe** (on-device object detection drives a panning
crop), **montage mode** across several videos (with music, beat sync and
"trailer" cuts), and **voice-over mode** (the script agent writes narration
sized to your footage; ElevenLabs reads it). Music is composed in-app with
Eleven Music or uploaded — never licensed from a third-party library.

### Templates

**Templates** (`/templates`) researches viral short-form templates for a niche
and turns them into ready-to-use content: ranked CapCut-style editing blueprints
with ready-to-post captions and hashtags for every channel. Copy any field, or
**Use in Calendar** to spin a prefilled draft.

Posts carry a **content format** (reel / post / carousel / story / short / video)
chosen per channel in the calendar composer, with format-aware media validation.

### SEO / GEO growth suite

**SEO / GEO** (`/seo`) is a three-tab growth suite: **Audit** (fetches your site
from the brand profile, scrapes SERPs for your keywords, returns a copy-ready fix
list and GEO notes), **Content** (SEO+GEO blog posts and FAQ pages, published to
WordPress or FTP), **Google Business** (scrapes the local pack for your category
and areas, drafts a full optimisation plan plus this week's posts).

### Website & landing-page builder

**Sites** (`/sites`) builds high-converting websites and landing pages: describe
it in a chat, watch it render live in a sandboxed preview, refine by chatting,
then publish — hosted in-app at `/s/<slug>`, exported as a self-contained HTML
file, or pushed live to WordPress or over FTP/SFTP.

## Stack

Single **Next.js (App Router, TypeScript, Tailwind)** full-stack app — route
handlers are the backend and the only thing that talks to external services.
**SQLite via Prisma** to start (swap to Postgres is a config change). Language
models are reached only through `src/lib/llm`.

```
src/lib/llm/            the engine layer: claude-cli | codex-cli | anthropic-api
src/lib/brand-brief.ts  BrandProfile → the brief every agent reads
src/lib/onboard.ts      website → inferred profile (+ the quiz) at /welcome
agents/                 11 named agents (+ BRAND.md: how to read the brief)
.claude/agents/         21 pipeline agents
prisma/schema.prisma    Connections (encrypted tokens), BrandProfile, Posts, MediaAssets,
                        Approvals, AgentReports, AdIdeas, RoasSnapshots, Settings…
src/lib/postiz.ts       THE single posting core — every channel publishes through this
src/lib/video/          Studio pipeline: probe, transcribe, edl, render (ffmpeg)
src/worker/             standalone worker (npm run worker): renders, newsletters, dreams
src/app/                dashboard pages + /api route handlers
tests/                  node:test suites (npm test): engine parsers, brand brief, brand guard
```

## Guardrails (non-negotiable)

1. **No hardcoded credentials.** Env vars only; `.env` is gitignored; stored tokens are AES-256-GCM encrypted at rest. CLI sign-ins stay with the CLIs.
2. **Explicit approval before money or publicity.** Anything that spends, posts publicly, or changes ad budgets creates an `Approval` record and waits for a dashboard decision.
3. **Official APIs for publishing and ads** (Postiz, Meta, Google). Trend and intel research scrape public metadata through Apify at your explicit choice, with the cost and terms shown in the UI.
4. **Honest about blockers.** A missing engine, key or app review shows as a clear status — never a silent failure or a faked success.
5. **No client brand in the tree.** Business facts live in your brand profile. Contributions that hardcode one are rejected by `npm test`.
