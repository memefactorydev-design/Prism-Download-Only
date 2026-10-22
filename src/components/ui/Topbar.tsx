"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { FLAT_NAV } from "@/components/ui/nav-items";
import { IconStudio, IconHelp } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function Topbar({ isAdmin = true }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const hi = greeting();

  const openHelp = () => window.dispatchEvent(new CustomEvent("scc:help"));

  return (
    <header className="sticky top-0 z-30 glass">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3 sm:px-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="md:hidden">
            <Logo size={28} showProduct={false} />
          </Link>
          <p className="hidden text-sm text-muted md:block">
            {hi} — let&apos;s make something <span className="text-gradient-brand font-semibold">worth watching</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/studio" className="btn btn-primary hidden sm:inline-flex">
            <IconStudio className="h-4 w-4" />
            New reel
          </Link>
          <ThemeToggle />
          <button onClick={openHelp} className="btn btn-secondary" aria-label="Help, tips and next steps">
            <IconHelp className="h-4 w-4" />
            <span className="hidden sm:inline">Help</span>
          </button>
        </div>
      </div>

      {/* Mobile nav strip */}
      <nav className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden">
        {FLAT_NAV.filter((i) => isAdmin || !i.adminOnly).map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                active ? "bg-gradient-accent text-white" : "text-muted"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
