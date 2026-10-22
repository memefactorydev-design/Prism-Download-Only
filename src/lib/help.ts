// Per-section help: a one-line "what this does", concrete tips & tricks, and
// suggested next steps. Powers the Help drawer (context-aware by route).

export interface HelpLink {
  label: string;
  href: string;
}
export interface HelpEntry {
  title: string;
  blurb: string;
  tips: string[];
  nextSteps: HelpLink[];
}

const DEFAULT: HelpEntry = {
  title: "Prism AI",
  blurb: "Research what's working, create it with AI, and publish across every channel — all in one place.",
  tips: [
    "Connect your services first (Connections) — every feature fails loudly with a clear message until its service is linked.",
    "Everything you post goes through an approval gate on the Calendar — nothing publishes without your say-so.",
    "The ✨ buttons are AI actions; look for them in Studio, Templates and the Calendar composer.",
  ],
  nextSteps: [
    { label: "Set up your connections", href: "/connections" },
    { label: "Cut your first reel in Studio", href: "/studio" },
  ],
};

export const HELP: Record<string, HelpEntry> = {
  "/agents": {
    title: "Agents — your marketing team",
    blurb:
      "Eleven named specialists (Houzz to LinkedIn) you brief like colleagues. They know the brand, their platform, and everything they've learned from you.",
    tips: [
      "Tick 'live research' to let an agent search the live web (Google-grounded, with sources).",
      "👍/👎 any reply — a 👎 with a short note is the fastest way to teach an agent; it becomes a rule in its LEARNINGS.md overnight.",
      "📌 Remember pins a reply straight into the agent's memory; 🧠 Memory lets you read and edit what it knows.",
      "'platform intel' appears when the agent has a fresh Market Pulse brief — its replies then use real platform data.",
    ],
    nextSteps: [
      { label: "Scrape platform intel", href: "/intel" },
      { label: "See what they dreamed", href: "/dreams" },
    ],
  },
  "/dreams": {
    title: "Dreams — the learning loop",
    blurb:
      "Every night at 3am (while the worker runs) all 26 agents — the named team and the pipeline specialists — replay their day, consolidate it into memory, and wake sharper.",
    tips: [
      "Dreams only happen when there's new activity — work with an agent first, then dream.",
      "Pipeline agents (video editor, trend researchers, SEO…) learn from their runs and from your decisions: shortlisting ideas, using templates, approving or rejecting posts all teach them.",
      "The 💡 idea chips in each dream are tomorrow's content plan, for free.",
      "Use 'Dream now' to skip the wait; 'whole team' dreams everyone with new activity.",
      "Set DREAM_HOUR in .env to change the 3am default.",
    ],
    nextSteps: [{ label: "Brief an agent", href: "/agents" }],
  },
  "/intel": {
    title: "Market Pulse — live market briefs",
    blurb:
      "Ten listening posts, one per specialist: competitor ads, Instagram engagement, Google reviews, Pinterest, YouTube, TikTok and live search results — distilled into sharp briefs.",
    tips: [
      "Each run becomes a brief kept for a week — it feeds the specialist's chat and overnight learning.",
      "Nova's 'Viral pulse' reads four platforms in one sweep — the biggest run, best used weekly.",
      "Runs use research credits — a light plan comfortably covers a weekly rhythm.",
      "Magnus needs real Google Maps place URLs — paste your locations' and competitors' links.",
    ],
    nextSteps: [
      { label: "Connect Prism Radar", href: "/connections" },
      { label: "Ask the specialist about its brief", href: "/agents" },
    ],
  },
  "/adstudio": {
    title: "Ad Maker — ads from a one-line brief",
    blurb:
      "Pick a platform and objective → you get 3 ready-to-run ad concepts, each one click from a finished image or video built on your own photos.",
    tips: [
      "Tick 'Scout researches first' for live competitor intelligence in the brief — slower, better.",
      "Generated images and videos land in Media automatically — attach them to Calendar posts.",
      "Every variant carries editable image/video prompts — tweak before generating.",
      "Prism Lens powers the visuals; Prism Mind writes the copy.",
    ],
    nextSteps: [
      { label: "Connect Prism Lens", href: "/connections" },
      { label: "Schedule a variant", href: "/calendar" },
    ],
  },
  "/": {
    title: "Overview",
    blurb: "Your home base — jump into any tool and track what still needs setting up.",
    tips: [
      "Work the Getting-started checklist top-to-bottom for the fastest path to your first published post.",
      "Cards with a spark badge are the AI-powered highlights — start there.",
      "The Connections strip shows what's live; grey means that feature is waiting on a key.",
    ],
    nextSteps: [
      { label: "Finish connecting services", href: "/connections" },
      { label: "Open Studio", href: "/studio" },
    ],
  },
  "/studio": {
    title: "Studio — AI video editor",
    blurb: "Drop raw footage and the AI cuts ranked, captioned vertical reels — or mixes several clips into a montage.",
    tips: [
      "Run Viral trend research first (TikTok / Instagram / YouTube / LinkedIn) — its patterns steer the edit.",
      "Pick a Template to make the cut follow a proven viral blueprint.",
      "Toggle 'Mix montage' to combine 2+ videos; add a music track for a beat-synced trailer.",
      "Reels are ranked by an AI virality score — the 🔥 badge — so the best clips float to the top.",
      "Every clip has Save (download) and Send-to-channel (creates a Calendar draft).",
    ],
    nextSteps: [
      { label: "Research viral templates", href: "/templates" },
      { label: "Schedule a finished clip", href: "/calendar" },
    ],
  },
  "/templates": {
    title: "Templates — viral blueprints",
    blurb: "Research viral formats for any niche and get reproducible editing recipes plus ready-to-post copy per channel.",
    tips: [
      "Enter the exact niche you want (e.g. 'wedding photography') — the agent stays on your niche, it won't default to sports.",
      "Each template ships captions + hashtags for Instagram, TikTok, Facebook, YouTube and LinkedIn — switch platform tabs and Copy.",
      "'Use in Studio' auto-generates a reel from your footage following the blueprint.",
      "'Use in Calendar' drops a prefilled draft (caption in the caption field, hashtags in the hashtag field).",
    ],
    nextSteps: [
      { label: "Apply a template in Studio", href: "/studio" },
      { label: "Schedule from a template", href: "/calendar" },
    ],
  },
  "/sites": {
    title: "Website & landing-page builder",
    blurb: "Design world-class, high-converting sites and landing pages — chat to build, preview live, then publish.",
    tips: [
      "Create a site, then just describe it in chat — a complete page comes back and renders live in the preview.",
      "Keep chatting to refine (\"make the hero darker\", \"add a testimonials section\", \"stronger CTA\") — each turn edits the current page.",
      "Use the Preview/Code tabs and Desktop/Mobile toggle to check the build; add more pages with Add page.",
      "Publish in-app (served at /s/<slug>), Export the HTML, or push live to WordPress / FTP (connect those first).",
    ],
    nextSteps: [
      { label: "Connect WordPress / FTP to publish", href: "/connections" },
      { label: "Optimise the page's SEO", href: "/seo" },
    ],
  },
  "/media": {
    title: "Media library",
    blurb: "Your uploaded images and videos, reusable across posts and montages.",
    tips: [
      "Upload here once, then attach the same asset to any post on the Calendar.",
      "Large source footage for Studio is uploaded on the Studio page (it streams multi-GB files).",
    ],
    nextSteps: [{ label: "Compose a post", href: "/calendar" }],
  },
  "/calendar": {
    title: "Content calendar",
    blurb: "Draft → submit → approve → scheduled to your channels. Nothing publishes without your approval.",
    tips: [
      "Pick a Channel then a Format (reel / post / carousel / story / short / video) — options change per channel.",
      "Hit ✨ Optimise for <channel> to have AI rewrite the caption + hashtags to that platform's style and current trends.",
      "YouTube posts need a Title; carousels need 2+ media; reels/shorts need one video — the composer tells you.",
      "Submit for approval, then Approve to schedule it. A failed schedule stays visible with the reason so you can retry.",
    ],
    nextSteps: [
      { label: "Generate content in Studio", href: "/studio" },
      { label: "Grab captions from Templates", href: "/templates" },
    ],
  },
  "/ideas": {
    title: "Winning Ads",
    blurb: "Ranked ad-idea briefs grounded in Meta Ad Library evidence and your own ROAS history.",
    tips: [
      "Add an optional focus (e.g. 'event videography') to steer the research.",
      "Ideas are tailored across all channels including YouTube; each names its best-fit platform.",
      "Long-running competitor ads are weighted higher — they're a strong signal the creative works.",
    ],
    nextSteps: [{ label: "Turn an idea into a reel", href: "/studio" }],
  },
  "/ads": {
    title: "Meta ads",
    blurb: "Read-first ROAS and spend insights; any campaign change is gated on your approval + Meta App Review.",
    tips: [
      "Connect Meta on Connections to pull live insights.",
      "Campaign writes surface a clear 'pending App Review' state — never a silent failure.",
    ],
    nextSteps: [{ label: "Review connections", href: "/connections" }],
  },
  "/seo": {
    title: "SEO / GEO growth suite",
    blurb: "Rank higher in Google organic, Google Business Profile and LLM answers (GEO) — audit, content, and local, in three tabs.",
    tips: [
      "Audit: reads your site + live search results → a prioritised, copy-ready fix list, keywords, content ideas and GEO notes.",
      "Content: generate SEO+GEO blog posts & FAQ pages (answer-first, with schema), then publish to WordPress/FTP or copy.",
      "Google Business: research the local pack and get a full profile plan + this week's posts — send them to the Calendar to publish, or copy-paste manually.",
      "Connect WordPress / FTP on Connections to push content and pages live.",
    ],
    nextSteps: [
      { label: "Connect WordPress / FTP", href: "/connections" },
      { label: "Build a landing page", href: "/sites" },
    ],
  },
  "/reports": {
    title: "Reports",
    blurb: "A weekly supervisor report that aggregates everything with recommendations.",
    tips: ["Generate it after you've run research and posted a few times — it reasons over your recent activity."],
    nextSteps: [{ label: "Post more from Studio", href: "/studio" }],
  },
  "/connections": {
    title: "Connections",
    blurb: "The setup wizard — plug in the engines behind Prism. Keys are encrypted at rest.",
    tips: [
      "Start with Prism Mind (the AI engine — a sign-in on this machine or an API key) and Prism Beam (publishing) — those unlock the most.",
      "Prism Radar powers trend and template research; Prism Score composes your music.",
      "Each card checks your key works before saving it.",
    ],
    nextSteps: [{ label: "Once connected, open Studio", href: "/studio" }],
  },
};

export function helpFor(pathname: string): HelpEntry {
  if (pathname === "/") return HELP["/"];
  const key = Object.keys(HELP).find((k) => k !== "/" && pathname.startsWith(k));
  return key ? HELP[key] : DEFAULT;
}
