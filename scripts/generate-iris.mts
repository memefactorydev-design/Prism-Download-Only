// One-off: generate Iris's avatar (Prism's AI guide) via Nano Banana and save
// a 512px square to public/iris.png. Needs a Gemini key in .env.
// Run: npx tsx --env-file=.env --tsconfig tsconfig.json scripts/generate-iris.mts

import path from "node:path";
import { geminiImage } from "@/lib/gemini";
import sharp from "sharp";

const PROMPT =
  "Character avatar, square 1:1, centered, fits a circular crop. A friendly non-human mascot: a small floating TRIANGULAR PRISM crystal (a pyramid-like triangle shape, echoing a minimalist triangle logo) — translucent obsidian glass with soft internal spectrum refraction, thin bands of red-orange-yellow-green-blue-violet light bending through the facets — with one large friendly softly-glowing white-cyan eye set into its front face. A faint rainbow aurora spills from its lower edge. Deep obsidian background (#0b0b12), soft vignette, subtle bloom, clean studio lighting. Premium modern 3D-render tech-mascot style — cute but not cartoonish. No text, no letters, no watermark, no human features besides the single eye.";

const img = await geminiImage(PROMPT);
const png = await sharp(img.buffer).resize(512, 512, { fit: "cover" }).png().toBuffer();
const out = path.resolve(process.cwd(), "public", "iris.png");
await sharp(png).toFile(out);
console.log("iris.png written to", out, png.byteLength, "bytes");
