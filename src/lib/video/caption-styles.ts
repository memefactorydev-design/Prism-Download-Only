// Caption style templates — DATA ONLY (no ffmpeg/ML imports) so this is safe to
// import from both the web bundle (options validation, UI dropdown) and the
// worker (ASS generation in render.ts). Colours are ASS format &HAABBGGRR
// (alpha, then blue-green-red); AA=00 is fully opaque.
//
// Every style keeps the word-synced "Opus" animation (whole line up, active
// word accented); the fields below control the look around that animation.

export interface CaptionStyle {
  id: string;
  label: string;
  primary: string; // normal word colour
  accent: string; // active word + keyword highlight colour
  outline: string; // outline/border colour
  uppercase: boolean;
  /** ASS Fontname. Must be a broadly-available family — libass falls back via fontconfig. */
  font?: string; // default "Arial"
  fontSize?: number; // default 72 (PlayRes 1080x1920)
  outlineWidth?: number; // default 5
  shadow?: number; // default 2
  marginV?: number; // default 260 — distance from the bottom edge
  /** Scale-pop the active word (~115%) — the "beast" energy. */
  pop?: boolean;
  /** BorderStyle 3: opaque box behind each line (IG-story look) instead of an outline. */
  backBox?: boolean;
}

export const CAPTION_STYLES: CaptionStyle[] = [
  // Originals (kept exactly as before, now with the pop upgrade on two of them).
  { id: "bold", label: "Bold White", primary: "&H00FFFFFF", accent: "&H0000A5FF", outline: "&H00000000", uppercase: true, pop: true }, // amber accent
  { id: "pop", label: "Yellow Pop", primary: "&H00FFFFFF", accent: "&H0000FFFF", outline: "&H00000000", uppercase: true, pop: true }, // yellow accent
  { id: "karaoke", label: "Karaoke Green", primary: "&H00FFFFFF", accent: "&H0000FF00", outline: "&H00000000", uppercase: false },
  { id: "clean", label: "Clean Minimal", primary: "&H00FFFFFF", accent: "&H00FFFFFF", outline: "&H00000000", uppercase: false },
  // Premium set.
  {
    id: "beast",
    label: "Beast Mode", // huge, loud, yellow-pop — the MrBeast/retention look
    primary: "&H00FFFFFF",
    accent: "&H0000D7FF", // gold
    outline: "&H00000000",
    uppercase: true,
    fontSize: 88,
    outlineWidth: 7,
    shadow: 3,
    pop: true,
  },
  {
    id: "luxe",
    label: "Luxe Serif", // quiet luxury — the brand's own voice, serif + soft gold
    primary: "&H00F5F5F5",
    accent: "&H0037AFD4", // muted gold (#D4AF37)
    outline: "&H00202020",
    uppercase: false,
    font: "Georgia",
    fontSize: 64,
    outlineWidth: 2,
    shadow: 0,
    marginV: 300,
  },
  {
    id: "neon",
    label: "Neon Pop", // bright cyan active word, punchy
    primary: "&H00FFFFFF",
    accent: "&H00FFFF00", // cyan
    outline: "&H00301030",
    uppercase: true,
    fontSize: 76,
    outlineWidth: 6,
    shadow: 0,
    pop: true,
  },
  {
    id: "boxed",
    label: "Boxed Story", // white-on-black caption boxes, IG-story style
    primary: "&H00FFFFFF",
    accent: "&H0000D7FF",
    outline: "&H96000000", // the box colour (semi-opaque black)
    uppercase: false,
    fontSize: 62,
    backBox: true,
    marginV: 300,
  },
];

export const DEFAULT_CAPTION_STYLE = "bold";
export const CAPTION_STYLE_IDS = CAPTION_STYLES.map((s) => s.id);

export function getCaptionStyle(id: string | null | undefined): CaptionStyle {
  return CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];
}
