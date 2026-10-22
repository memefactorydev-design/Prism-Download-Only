// Launch hygiene: honest plain-English terms. DRAFT for legal review before
// public launch — marked as such on the page.

import { Logo } from "@/components/ui/Logo";

// The operator of this instance sets SUPPORT_EMAIL in .env.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@example.com";

const SECTIONS: { h: string; p: string }[] = [
  {
    h: "What Prism is",
    p: "Prism AI is marketing software: it drafts content, edits video, analyses your ad and search performance, and publishes to your own social and advertising accounts after you approve each action. You stay the publisher of record on every platform.",
  },
  {
    h: "Your accounts, your approval",
    p: "Prism connects to accounts you own (social publishing, ad accounts, search data, email). Nothing is published and no ad budget is changed without your explicit approval in the dashboard. You are responsible for the content you approve and for complying with each platform's terms.",
  },
  {
    h: "Your content and data",
    p: "Footage, images, copy and business information you provide remain yours. You grant us the licence needed to process them (editing, analysis, generation) to deliver the service. We don't sell your data and we don't train public models on your private content.",
  },
  {
    h: "AI output",
    p: "Prism's drafts are machine-generated and can be wrong. Review before approving — that's what the approval gate is for. You're responsible for claims in content you publish.",
  },
  {
    h: "Fair use",
    p: "Plans are all-inclusive with generous fair-use allowances on heavy compute (video rendering, AI generation, research runs). We don't hard-stop you; sustained extreme use may mean we ask you to move to a plan that fits.",
  },
  {
    h: "Beta status",
    p: "Prism is in beta. We aim for high availability but don't yet offer an SLA. Early-access pricing is kept for as long as your subscription stays active.",
  },
  {
    h: "Cancellation",
    p: "Cancel any time; your plan runs to the end of the paid period. On request we delete your workspace data — see the Privacy Policy for timelines.",
  },
  {
    h: "Liability",
    p: "To the extent the law allows, our liability is capped at the fees you paid in the twelve months before the claim. Nothing in these terms limits liability that cannot lawfully be limited.",
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Logo />
      <h1 className="mt-8 font-display text-3xl font-bold tracking-[-0.02em]">Terms of Service</h1>
      <p className="mt-2 text-sm text-faint">
        Template — the operator of this instance must review and adapt these terms before offering the service to others. Governed by the laws of England and Wales unless the operator states otherwise.
      </p>
      <div className="mt-8 space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="font-display text-lg font-semibold">{s.h}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.p}</p>
          </section>
        ))}
      </div>
      <p className="mt-10 text-xs text-faint">
        Questions: <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </main>
  );
}
