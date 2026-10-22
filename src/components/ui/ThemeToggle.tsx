"use client";

// Light/dark toggle for the Prism theme. Obsidian is the brand default; the
// choice persists in localStorage and is applied pre-paint by the inline boot
// script in the root layout (no flash).

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "@/components/ui/icons";

// The <html data-theme> attribute (set pre-paint by the layout boot script) is
// the source of truth; useSyncExternalStore reads it hydration-safely.
const subscribe = (cb: () => void) => {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const getTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "dark" as const);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("prism-theme", next);
    } catch {
      /* private mode — theme just won't persist */
    }
  }

  return (
    <button
      onClick={toggle}
      className="btn btn-secondary"
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? <IconMoon className="h-4 w-4" /> : <IconSun className="h-4 w-4" />}
    </button>
  );
}
