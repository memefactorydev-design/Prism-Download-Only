declare module "music-tempo" {
  interface MusicTempoOptions {
    minBeatInterval?: number;
    maxBeatInterval?: number;
    [key: string]: unknown;
  }
  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], options?: MusicTempoOptions);
    tempo: number; // BPM
    beats: number[]; // beat times in seconds
  }
}
