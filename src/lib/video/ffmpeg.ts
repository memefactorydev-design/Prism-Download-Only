// Thin wrapper around the bundled ffmpeg/ffprobe binaries (ffmpeg-static /
// @ffprobe-installer — prebuilt, no Homebrew/cmake needed; ffprobe-static was
// dropped because its darwin/arm64 package ships an x86_64 binary, which dies
// with EBADARCH on Apple-silicon Macs without Rosetta). Everything in the video
// pipeline shells out through here so there is one place that owns binary paths
// and process handling. Errors surface ffmpeg's stderr loudly — never silent.

import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

export const FFMPEG_PATH: string = ffmpegStatic as unknown as string;
export const FFPROBE_PATH: string = ffprobeInstaller.path;

if (!FFMPEG_PATH) {
  throw new Error("ffmpeg-static did not resolve a binary path — reinstall dependencies.");
}

interface RunOptions {
  /** When true, resolve with the captured stdout Buffer (e.g. ffprobe JSON, raw PCM). */
  captureStdout?: boolean;
  /** Optional callback fed ffmpeg's stderr lines for progress parsing. */
  onStderr?: (chunk: string) => void;
}

/** Run a binary with args; reject with stderr context on a non-zero exit. */
function run(bin: string, args: string[], opts: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      if (opts.captureStdout) stdout.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      // Keep memory bounded for very long renders.
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
      opts.onStderr?.(s);
    });
    child.on("error", (err) => reject(new Error(`Failed to launch ${bin}: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500).trim()}`));
    });
  });
}

export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<Buffer> {
  // FFMPEG_DEBUG=1 prints every invocation — invaluable when a filter graph misbehaves.
  if (process.env.FFMPEG_DEBUG) console.log("[ffmpeg]", args.join(" "));
  return run(FFMPEG_PATH, args, opts);
}

export function runFfprobe(args: string[]): Promise<Buffer> {
  return run(FFPROBE_PATH, args, { captureStdout: true });
}
