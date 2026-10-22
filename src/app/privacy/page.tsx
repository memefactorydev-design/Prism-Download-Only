// Launch hygiene: UK GDPR-shaped privacy policy. DRAFT for legal review —
// marked as such on the page.

import { Logo } from "@/components/ui/Logo";

// The operator of this instance sets SUPPORT_EMAIL in .env.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@example.com";

const SECTIONS: { h: string; p: string }[] = [
  {
    h: "Who we are",
    p: "Prism AI (“we”) means the operator of this Prism AI instance. We are the data controller for account data, and a processor for the business content and audience data you bring into your workspace.",
  },
  {
    h: "What we hold",
    p: "Account details (name, email, hashed password), the brand profile you confirm, media you upload or import, content drafts, connection tokens for services you link (stored encrypted with AES-256-GCM), performance data those services return, leads you capture, and product analytics events about how the service is used.",
  },
  {
    h: "Why we hold it (lawful bases)",
    p: "To deliver the service you contracted for (contract); to secure accounts, prevent abuse and improve the product (legitimate interests); and where you ask us to email people, on the basis you confirm you have the right to contact them (your obligation as controller of that list).",
  },
  {
    h: "Where it lives",
    p: "Your workspace data is stored on the server this instance runs on. AI processing sends relevant content to the AI engine you connected (your own Claude or ChatGPT subscription, or an API key) and to any optional services you enable, under their own terms.",
  },
  {
    h: "Who sees it",
    p: "Your workspace is isolated: other customers can't read it, and your connected accounts are yours alone. Our engineers access data only to operate the service or investigate an issue you raise.",
  },
  {
    h: "How long",
    p: "For as long as your account is active. On deletion request we remove your workspace (account, media, drafts, leads, tokens) within 30 days, keeping only what invoicing and law require.",
  },
  {
    h: "Your rights",
    p: "Access, correction, export, deletion, restriction and objection — email us and we'll act within a month. You can complain to the ICO (ico.org.uk) if you think we've got it wrong.",
  },
  {
    h: "Newsletter recipients",
    p: "Emails sent through Prism carry a one-click unsubscribe that takes effect immediately. Unsubscribes are enforced automatically; we never email an unsubscribed contact again on your behalf.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Logo />
      <h1 className="mt-8 font-display text-3xl font-bold tracking-[-0.02em]">Privacy Policy</h1>
      <p className="mt-2 text-sm text-faint">Template — the operator of this instance must review and adapt this page before offering the service to others. UK GDPR applies.</p>
      <div className="mt-8 space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="font-display text-lg font-semibold">{s.h}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.p}</p>
          </section>
        ))}
      </div>
      <p className="mt-10 text-xs text-faint">
        Data requests: <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </main>
  );
}
