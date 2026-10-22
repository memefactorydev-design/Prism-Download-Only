import type { Metadata } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { APP_NAME, TAGLINE } from "@/lib/brand";
import "./globals.css";

// Prism type system: Inter Tight carries the product AND the display voice
// (Apple-adjacent, confident); Fraunces italic is the single editorial accent;
// JetBrains Mono for data. (Brand pack: prism-ai-brand-concept.)
const interTight = Inter_Tight({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-brand",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["italic"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: `${APP_NAME} — ${TAGLINE}`,
  description:
    "One upload, refracted into everything. Prism turns raw footage and live trends into platform-ready content — then posts it, promotes it, and reports back.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${interTight.variable} ${jetbrainsMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        {/* Apply the saved theme before first paint — obsidian is the default. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('prism-theme')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
