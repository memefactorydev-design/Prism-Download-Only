"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Logo } from "@/components/ui/Logo";
import { VERSION } from "@/lib/brand";
import { navForRole, OVERVIEW, type NavItem } from "@/components/ui/nav-items";

function NavLink({ href, label, icon: Icon, active }: NavItem & { active: boolean }) {
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors ${
        active ? "text-white" : "text-muted hover:text-foreground"
      }`}
    >
      {active && (
        <motion.span
          layoutId="nav-pill"
          className="absolute inset-0 -z-10 rounded-xl bg-gradient-accent shadow-glow"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      {!active && (
        <span className="absolute inset-0 -z-10 rounded-xl bg-accent-soft opacity-0 transition-opacity group-hover:opacity-100" />
      )}
      <Icon className="h-[18px] w-[18px] transition-transform group-hover:scale-110" />
      {label}
    </Link>
  );
}

export function Sidebar({ isAdmin = true }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-background/60 px-3 py-5 backdrop-blur-xl md:flex">
      <Link href="/" className="mb-6 px-1.5">
        <Logo size={34} />
      </Link>

      <NavLink {...OVERVIEW} active={isActive("/")} />

      <nav className="mt-3 flex flex-1 flex-col gap-5 overflow-y-auto">
        {navForRole(isAdmin).map((group) => (
          <div key={group.section}>
            <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {group.section}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} {...item} active={isActive(item.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-4 flex items-center justify-between px-2.5 text-[11px] text-faint">
        <span>Local · single-user</span>
        <span className="rounded-full border border-border px-1.5 py-0.5">{VERSION}</span>
      </div>
    </aside>
  );
}
