// Shared navigation model for the sidebar (desktop) and topbar (mobile).
import {
  IconHelp,
  IconHome,
  IconPlug,
  IconCalendar,
  IconMedia,
  IconStudio,
  IconIdeas,
  IconAds,
  IconSeo,
  IconReports,
  IconTemplates,
  IconGlobe,
  IconTeam,
  IconMoon,
  IconRadar,
  IconMegaphone,
  IconClapper,
  IconSparkles,
  IconSend,
} from "@/components/ui/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactElement;
  adminOnly?: boolean; // hidden from "member" accounts (proxy enforces server-side too)
};

export const OVERVIEW: NavItem = { href: "/", label: "Overview", icon: IconHome };

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Team",
    items: [
      { href: "/agents", label: "Agents", icon: IconTeam },
      { href: "/dreams", label: "Dreams", icon: IconMoon },
      { href: "/intel", label: "Market Pulse", icon: IconRadar },
    ],
  },
  {
    section: "Create",
    items: [
      { href: "/director", label: "Director", icon: IconClapper },
      { href: "/studio", label: "Studio", icon: IconStudio },
      { href: "/adstudio", label: "Ad Maker", icon: IconMegaphone },
      { href: "/templates", label: "Templates", icon: IconTemplates },
      { href: "/sites", label: "Sites", icon: IconGlobe },
      { href: "/media", label: "Media", icon: IconMedia },
      { href: "/calendar", label: "Calendar", icon: IconCalendar },
      { href: "/review", label: "Review", icon: IconSparkles },
      { href: "/ideas", label: "Winning Ads", icon: IconIdeas },
    ],
  },
  {
    section: "Grow",
    items: [
      { href: "/leads", label: "Leads", icon: IconTeam },
      { href: "/newsletter", label: "Newsletter", icon: IconSend },
      { href: "/ads", label: "Ads", icon: IconAds },
      { href: "/seo", label: "SEO / GEO", icon: IconSeo },
      { href: "/reports", label: "Reports", icon: IconReports },
    ],
  },
  {
    section: "Setup",
    items: [
      { href: "/brand", label: "Your brand", icon: IconSparkles },
      { href: "/connections", label: "Connections", icon: IconPlug },
      { href: "/usage", label: "Usage", icon: IconReports },
      { href: "/users", label: "Team", icon: IconTeam, adminOnly: true },
      { href: "/tickets", label: "Tickets", icon: IconHelp, adminOnly: true },
    ],
  },
];

export const FLAT_NAV: NavItem[] = [OVERVIEW, ...NAV.flatMap((g) => g.items)];

/** Nav filtered for the signed-in role. */
export function navForRole(isAdmin: boolean): { section: string; items: NavItem[] }[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || !i.adminOnly) })).filter((g) => g.items.length);
}
