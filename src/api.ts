// Calls into the Rust backend, which reads and writes story packages, the library, and the saved game.

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n";
import type { MusicTrack, Story, StorySource } from "./model/types";

export interface SourcedStory {
  story: Story;
  source: StorySource;
}

export interface LibraryEntry {
  story: Story;
  /// When the script was last saved, in milliseconds since 1970.
  modified: number;
}

/// An error from the backend. Its kind picks a message; damaged files add the technical detail.
type CommandError =
  | { kind: "notAStoryFile" }
  | { kind: "newerVersion" }
  | { kind: "tooLarge" }
  | { kind: "damaged"; detail: string }
  | { kind: "io"; message: string };

function isCommandError(error: unknown): error is CommandError {
  return typeof error === "object" && error !== null && "kind" in error;
}

/// A message for any error, in the app's language.
export function errorMessage(error: unknown): string {
  if (isCommandError(error)) {
    switch (error.kind) {
      case "notAStoryFile":
        return t("This isn’t a story file.");
      case "newerVersion":
        return t("This story was made with a newer version of the app.");
      case "tooLarge":
        return t("The story is too large.");
      case "damaged":
        return t("The story file is damaged.") + "\n\n" + error.detail;
      case "io":
        return error.message;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export const api = {
  builtinStories: () => invoke<SourcedStory[]>("list_builtin_stories"),
  loadStory: (source: StorySource) => invoke<Story>("load_story", { source }),
  openStoryToPlay: (path: string) => invoke<SourcedStory>("open_story_to_play", { path }),
  exportStory: (story: Story, path: string) => invoke<void>("export_story", { story, path }),

  library: () => invoke<LibraryEntry[]>("list_library"),
  saveToLibrary: (story: Story) => invoke<void>("save_to_library", { story }),
  deleteFromLibrary: (id: string) => invoke<void>("delete_from_library", { id }),
  importToLibrary: (path: string) => invoke<Story>("import_to_library", { path }),

  importTrack: (path: string) => invoke<MusicTrack>("import_track", { path }),
  trackData: (id: string) => invoke<ArrayBuffer>("track_data", { id }),

  readSave: () => invoke<string | null>("read_save"),
  writeSave: (contents: string) => invoke<void>("write_save", { contents }),

  quit: () => invoke<void>("quit"),
};

// MARK: File dialogs

const storyFilter = () => [{ name: t("Story files"), extensions: ["rpstory"] }];

/// Asks for a `.rpstory` file to open.
export async function chooseStoryFile(): Promise<string | null> {
  const path = await open({ multiple: false, directory: false, filters: storyFilter() });
  return typeof path === "string" ? path : null;
}

/// Asks where to save an exported story.
export async function chooseExportPath(defaultName: string): Promise<string | null> {
  const safeName = defaultName.replace(/[/\\:]/g, "-");
  return save({ defaultPath: `${safeName}.rpstory`, filters: storyFilter() });
}

/// Asks for audio files to import as music.
export async function chooseAudioFiles(): Promise<string[]> {
  const paths = await open({
    multiple: true,
    directory: false,
    filters: [{ name: t("Audio"), extensions: ["mp3", "m4a", "aac", "wav", "aiff", "aif", "flac", "ogg", "caf"] }],
  });
  return Array.isArray(paths) ? paths : typeof paths === "string" ? [paths] : [];
}
