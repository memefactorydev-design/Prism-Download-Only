// ElevenLabs voice list for the Studio voice-over picker. Graceful when the
// connection is missing: { enabled: false } rather than an error, so the UI can
// point at the Connections page.

import { getSecrets } from "@/lib/connections";
import { listVoices } from "@/lib/elevenlabs";

export async function GET() {
  const secrets = await getSecrets("elevenlabs");
  if (!secrets?.apiKey) return Response.json({ enabled: false, voices: [] });
  try {
    const voices = await listVoices();
    return Response.json({ enabled: true, voices, defaultVoiceId: secrets.voiceId ?? null });
  } catch (err) {
    return Response.json(
      { enabled: false, voices: [], error: err instanceof Error ? err.message : String(err) },
      { status: 200 }
    );
  }
}
