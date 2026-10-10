// Loops a story's embedded background music, cross-fading when the track changes.

import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { MusicTrack } from "./model/types";

const FADE_SECONDS = 1.2;
const VOLUME = 0.7;

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  ogg: "audio/ogg",
  caf: "audio/x-caf",
};

/// Object URLs for audio already fetched from the backend, by track ID. Tracks never change after import.
const urls = new Map<string, Promise<string>>();

function trackURL(track: MusicTrack): Promise<string> {
  let url = urls.get(track.id);
  if (!url) {
    url = api.trackData(track.id).then((data) => {
      const type = MIME_TYPES[track.fileExtension.toLowerCase()] ?? "audio/*";
      return URL.createObjectURL(new Blob([data], { type }));
    });
    url.catch(() => urls.delete(track.id));
    urls.set(track.id, url);
  }
  return url;
}

/// Ramps an element's volume to `target` over the fade duration, then calls `done`.
function fade(audio: HTMLAudioElement, target: number, done?: () => void) {
  const start = audio.volume;
  const began = performance.now();
  const step = (now: number) => {
    const progress = Math.min((now - began) / (FADE_SECONDS * 1000), 1);
    audio.volume = start + (target - start) * progress;
    if (progress < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

export class MusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private request = 0;
  currentTrackId: string | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getCurrent = () => this.currentTrackId;

  private changed() {
    for (const listener of this.listeners) listener();
  }

  /// Starts `track` (or silence when `null`), honoring the sound setting.
  play(track: MusicTrack | null | undefined, soundOn: boolean) {
    if (!soundOn || !track) {
      this.stop();
      return;
    }
    if (track.id === this.currentTrackId && this.audio && !this.audio.paused) return;

    this.fadeOutCurrent();
    this.currentTrackId = track.id;
    this.changed();
    const request = ++this.request;
    trackURL(track)
      .then((url) => {
        if (request !== this.request) return;
        const next = new Audio(url);
        next.loop = true;
        next.volume = 0;
        this.audio = next;
        return next.play().then(() => fade(next, VOLUME));
      })
      .catch((error) => {
        console.error(`Couldn't play track ${track.name}:`, error);
        if (request === this.request) {
          this.audio = null;
          this.currentTrackId = null;
          this.changed();
        }
      });
  }

  stop() {
    this.request++;
    this.fadeOutCurrent();
    if (this.currentTrackId !== null) {
      this.currentTrackId = null;
      this.changed();
    }
  }

  /// Fades the playing track out, holding on to it until the fade finishes so it doesn't cut off abruptly.
  private fadeOutCurrent() {
    const previous = this.audio;
    this.audio = null;
    if (previous) fade(previous, 0, () => previous.pause());
  }
}

/// The ID of the track a player is playing, kept up to date.
export function useCurrentTrack(player: MusicPlayer): string | null {
  return useSyncExternalStore(player.subscribe, player.getCurrent);
}
