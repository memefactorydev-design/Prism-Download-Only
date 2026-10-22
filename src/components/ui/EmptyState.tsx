import Image from "next/image";
import type { ReactNode } from "react";

/**
 * A calm, on-brand empty state — a piece of the prism art (Gemini/Nano Banana,
 * obsidian + the indigo→amber spectrum) drifting slowly behind the surface,
 * with a title, a line of guidance, and an optional call to action.
 * Used where a board has nothing to show yet.
 */
export function EmptyState({
  title,
  image = "/prism-hero.webp",
  action,
  children,
  className = "",
}: {
  title: string;
  /** Board-specific art under /public (defaults to the prism hero). */
  image?: string;
  /** An optional CTA row (buttons/links) rendered under the guidance. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card animate-in relative overflow-hidden ${className}`}>
      {/* Prism art, fading into the card so it reads as ambient, not a photo.
          Opacity is themed via .prism-empty-art ([data-theme] aware). */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <Image
          src={image}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 720px"
          className="prism-empty-art prism-ambient object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/55 to-transparent" />
      </div>
      <div className="relative px-6 py-10 sm:px-8 sm:py-14">
        <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
        {children && <div className="mt-2 max-w-xl text-sm text-muted">{children}</div>}
        {action && <div className="mt-5 flex flex-wrap items-center gap-3">{action}</div>}
      </div>
    </div>
  );
}
