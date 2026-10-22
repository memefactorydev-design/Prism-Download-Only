// Lightweight inline icon set (feather/lucide-style strokes) — no dependency.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10" />
  </svg>
);
export const IconPlug = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 2v6M15 2v6" />
    <path d="M7 8h10v3a5 5 0 0 1-10 0z" />
    <path d="M12 16v6" />
  </svg>
);
export const IconCalendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
    <path d="M16 2.5v4M8 2.5v4M3 10h18" />
  </svg>
);
export const IconMedia = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <circle cx="8.5" cy="8.5" r="1.6" />
    <path d="M21 15.5 16 10 5 21" />
  </svg>
);
export const IconClapper = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="9" width="18" height="11" rx="2" />
    <path d="M3 9l1.5-4.5L21 6l-1 3M7.5 5.2L9.5 8.6M12.5 4.7L14.5 8.2M17.5 4.2L19.2 7.6" />
  </svg>
);
export const IconStudio = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 4.4L18.5 9l-4.6 1.6L12 15l-1.9-4.4L5.5 9l4.6-1.6z" />
    <path d="M19 15l.8 1.9L22 18l-2.2.6L19 21l-.8-2.4L16 18l2.2-1.1z" />
  </svg>
);
export const IconIdeas = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 18h6M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.6c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
  </svg>
);
export const IconAds = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
export const IconSeo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
  </svg>
);
export const IconReports = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 21h18" />
    <path d="M6 21V11M12 21V4M18 21v-7" />
  </svg>
);
export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
export const IconMusic = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);
export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const IconLogout = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);
export const IconFlame = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2c1 3-1 4-1 6a3 3 0 0 0 6 0c0 4-2 6-2 8a3 3 0 0 1-6 0c0-2-2-3-2-6 0-2 2-3 3-4 1.5-1.5 3-2 4-4z" />
  </svg>
);
export const IconTemplates = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
export const IconHelp = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" />
    <path d="M12 17h.01" />
  </svg>
);
export const IconSparkles = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
    <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
  </svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const IconGlobe = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
  </svg>
);
export const IconRocket = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.8-.8.8-2 0-3s-2.2-.8-3 0z" />
    <path d="M9 12a12 12 0 0 1 8-8 8 8 0 0 1 3 3 12 12 0 0 1-8 8l-3-3z" />
    <circle cx="15" cy="9" r="1.4" />
  </svg>
);
export const IconTeam = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3.5 20c.5-3.5 2.8-5.5 5.5-5.5S14 16.5 14.5 20" />
    <circle cx="17" cy="9.5" r="2.5" />
    <path d="M15.5 14.8c2.4.2 4.3 1.9 4.9 4.7" />
  </svg>
);
export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
  </svg>
);
export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
    <path d="M17 3.5v3M18.5 5h-3" />
  </svg>
);
export const IconRadar = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    <path d="M12 12l6-6.5" />
  </svg>
);
export const IconMegaphone = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 11v2a1.5 1.5 0 0 0 1.5 1.5H6l1 5.5h2.5l-1-5.5H10l8 4V6l-8 4H4.5A1.5 1.5 0 0 0 3 11z" />
    <path d="M21 10.5v3" />
  </svg>
);
