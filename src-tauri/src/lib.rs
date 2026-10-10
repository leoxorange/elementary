//! Elementary's backend: reads and writes `.rpstory` story packages, keeps the designer's library and the player's
//! saved game, and serves music to the frontend. The game rules and the story designer live in the frontend.

mod storage;
pub mod story;

use serde::Serialize;
use std::path::PathBuf;
use storage::{LibraryEntry, SourcedStory, Storage, StorySource};
use story::format::StoryFileError;
use story::model::{MusicTrack, Story};
use story::package::{self, PackageError, TrackStore};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

struct AppState {
    storage: Storage,
    tracks: TrackStore,
}

/// An error the frontend can show: its kind picks a localized message, and damaged files add the technical detail.
#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum CommandError {
    NotAStoryFile,
    NewerVersion,
    TooLarge,
    Damaged { detail: String },
    Io { message: String },
}

impl From<StoryFileError> for CommandError {
    fn from(error: StoryFileError) -> Self {
        match error {
            StoryFileError::NotAStoryFile => Self::NotAStoryFile,
            StoryFileError::UnsupportedVersion(_) | StoryFileError::UnsupportedFlags(_) => Self::NewerVersion,
            StoryFileError::TooLarge => Self::TooLarge,
            other => Self::Damaged { detail: other.to_string() },
        }
    }
}

impl From<PackageError> for CommandError {
    fn from(error: PackageError) -> Self {
        match error {
            PackageError::Story(error) => error.into(),
            PackageError::Io(error) => error.into(),
        }
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::Io { message: error.to_string() }
    }
}

type CommandResult<T> = Result<T, CommandError>;

// MARK: Stories

#[tauri::command]
async fn list_builtin_stories(state: State<'_, AppState>) -> CommandResult<Vec<SourcedStory>> {
    Ok(state.storage.builtin(&state.tracks))
}

#[tauri::command]
async fn load_story(state: State<'_, AppState>, source: StorySource) -> CommandResult<Story> {
    Ok(state.storage.load(&source, &state.tracks)?)
}

/// Opens a story file to play. It's played from a private copy, so a saved game can reopen it later.
#[tauri::command]
async fn open_story_to_play(state: State<'_, AppState>, path: PathBuf) -> CommandResult<SourcedStory> {
    // Read the original first, so a file that isn't a story is rejected before anything is copied.
    package::read(&path, &state.tracks)?;
    let source = state.storage.keep_played_copy(&path)?;
    let story = state.storage.load(&source, &state.tracks)?;
    Ok(SourcedStory { story, source })
}

#[tauri::command]
async fn export_story(state: State<'_, AppState>, story: Story, path: PathBuf) -> CommandResult<()> {
    Ok(package::write_archive(&story, &path, &state.tracks)?)
}

// MARK: Library

#[tauri::command]
async fn list_library(state: State<'_, AppState>) -> CommandResult<Vec<LibraryEntry>> {
    Ok(state.storage.library(&state.tracks))
}

#[tauri::command]
async fn save_to_library(state: State<'_, AppState>, story: Story) -> CommandResult<()> {
    Ok(state.storage.save_to_library(&story, &state.tracks)?)
}

#[tauri::command]
async fn delete_from_library(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    Ok(state.storage.delete_from_library(&id, &state.tracks)?)
}

/// Copies a story file into the library and returns it as read back from there.
#[tauri::command]
async fn import_to_library(state: State<'_, AppState>, path: PathBuf) -> CommandResult<Story> {
    let story = package::read(&path, &state.tracks)?;
    state.storage.save_to_library(&story, &state.tracks)?;
    Ok(state.storage.load(&StorySource::Library { id: story.id }, &state.tracks)?)
}

// MARK: Music

/// Reads an audio file into the track store and returns the new track.
#[tauri::command]
async fn import_track(state: State<'_, AppState>, path: PathBuf) -> CommandResult<MusicTrack> {
    let bytes = std::fs::read(&path)?;
    let id = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    let track = MusicTrack {
        id: id.clone(),
        name: path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        file_extension: path.extension().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default(),
        size: bytes.len() as u64,
    };
    state.tracks.add_bytes(&id, bytes);
    Ok(track)
}

/// A track's audio, as raw bytes.
#[tauri::command]
async fn track_data(state: State<'_, AppState>, id: String) -> CommandResult<Response> {
    let bytes = state.tracks.data(&id)?;
    Ok(Response::new(bytes.to_vec()))
}

// MARK: Saved game

#[tauri::command]
async fn read_save(state: State<'_, AppState>) -> CommandResult<Option<String>> {
    Ok(state.storage.read_save()?)
}

#[tauri::command]
async fn write_save(state: State<'_, AppState>, contents: String) -> CommandResult<()> {
    Ok(state.storage.write_save(&contents)?)
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let resources = app.path().resource_dir()?;
            app.manage(AppState { storage: Storage::new(data, resources), tracks: TrackStore::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_builtin_stories,
            load_story,
            open_story_to_play,
            export_story,
            list_library,
            save_to_library,
            delete_from_library,
            import_to_library,
            import_track,
            track_data,
            read_save,
            write_save,
            quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
