//! Where stories and saved games live on disk.
//!
//! - Built-in stories ship as zipped packages in the app's resources.
//! - The designer's library keeps each script as an unpacked package folder in the app data directory, so
//!   autosaving after an edit rewrites only the small `story.bin` and never recopies the music.
//! - Files opened with More… are copied into the app data directory, so a saved game can reopen them after the
//!   original moves.
//! - The single autosave slot is a JSON file the frontend writes and reads as a whole.

use crate::story::model::{Story, percent_encode_alphanumerics};
use crate::story::package::{self, FILE_EXTENSION, PackageError, STORY_ENTRY, TrackStore};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Where a story being played came from.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StorySource {
    /// A story shipped with the app, by file name without the extension.
    BuiltIn { name: String },
    /// A script in the story designer's library, by story ID.
    Library { id: String },
    /// A private copy of a file opened with More…, kept so the game can be resumed after the original moves.
    Played { id: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcedStory {
    pub story: Story,
    pub source: StorySource,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub story: Story,
    /// When the script was last saved, in milliseconds since 1970.
    pub modified: f64,
}

pub struct Storage {
    data: PathBuf,
    resources: PathBuf,
}

impl Storage {
    pub fn new(data: PathBuf, resources: PathBuf) -> Self {
        Self { data, resources }
    }

    fn builtin_folder(&self) -> PathBuf {
        self.resources.join("stories")
    }

    fn library_folder(&self) -> PathBuf {
        self.data.join("Stories")
    }

    /// The package folder for a script. Story IDs are free-form, so they're encoded into a safe folder name.
    pub fn library_path(&self, story_id: &str) -> PathBuf {
        self.library_folder().join(format!("{}.{FILE_EXTENSION}", percent_encode_alphanumerics(story_id)))
    }

    fn played_path(&self, id: &str) -> PathBuf {
        self.data.join("Played").join(format!("{}.{FILE_EXTENSION}", percent_encode_alphanumerics(id)))
    }

    fn save_path(&self) -> PathBuf {
        self.data.join("Autosave.json")
    }

    pub fn path(&self, source: &StorySource) -> PathBuf {
        match source {
            StorySource::BuiltIn { name } => self.builtin_folder().join(format!("{name}.{FILE_EXTENSION}")),
            StorySource::Library { id } => self.library_path(id),
            StorySource::Played { id } => self.played_path(id),
        }
    }

    pub fn load(&self, source: &StorySource, tracks: &TrackStore) -> Result<Story, PackageError> {
        package::read(&self.path(source), tracks)
    }

    // MARK: Built-in stories

    /// Every story shipped with the app, ordered by story ID. Damaged files are skipped.
    pub fn builtin(&self, tracks: &TrackStore) -> Vec<SourcedStory> {
        let mut stories: Vec<SourcedStory> = story_files(&self.builtin_folder())
            .filter_map(|path| {
                let name = path.file_stem()?.to_string_lossy().into_owned();
                let story = package::read(&path, tracks).ok()?;
                Some(SourcedStory { story, source: StorySource::BuiltIn { name } })
            })
            .collect();
        stories.sort_by(|a, b| a.story.id.cmp(&b.story.id));
        stories
    }

    // MARK: Library

    /// Every readable script in the library, most recently edited first. Damaged scripts are skipped.
    pub fn library(&self, tracks: &TrackStore) -> Vec<LibraryEntry> {
        let mut entries: Vec<LibraryEntry> = story_files(&self.library_folder())
            .filter_map(|path| {
                let story = package::read(&path, tracks).ok()?;
                let modified = fs::metadata(path.join(STORY_ENTRY))
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0.0, |d| d.as_millis() as f64);
                Some(LibraryEntry { story, modified })
            })
            .collect();
        entries.sort_by(|a, b| b.modified.total_cmp(&a.modified));
        entries
    }

    pub fn save_to_library(&self, story: &Story, tracks: &TrackStore) -> Result<(), PackageError> {
        package::write_folder(story, &self.library_path(&story.id), tracks)
    }

    pub fn delete_from_library(&self, story_id: &str, tracks: &TrackStore) -> io::Result<()> {
        let folder = self.library_path(story_id);
        // Another script may share this one's music (a duplicate, say), so keep any audio still read from here.
        for entry in fs::read_dir(folder.join("music")).into_iter().flatten().flatten() {
            tracks.rescue(&entry.path());
        }
        fs::remove_dir_all(folder)
    }

    // MARK: Played copies

    /// Copies an opened file into the app data directory so a saved game can find it again.
    pub fn keep_played_copy(&self, path: &Path) -> io::Result<StorySource> {
        let id = uuid::Uuid::new_v4().to_string().to_uppercase();
        let destination = self.played_path(&id);
        fs::create_dir_all(destination.parent().unwrap())?;
        if path.is_dir() {
            copy_folder(path, &destination)?;
        } else {
            fs::copy(path, &destination)?;
        }
        Ok(StorySource::Played { id })
    }

    // MARK: Saved game

    pub fn read_save(&self) -> io::Result<Option<String>> {
        match fs::read_to_string(self.save_path()) {
            Ok(contents) => Ok(Some(contents)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn write_save(&self, contents: &str) -> io::Result<()> {
        fs::create_dir_all(&self.data)?;
        let temporary = self.save_path().with_extension("json.tmp");
        fs::write(&temporary, contents)?;
        fs::rename(temporary, self.save_path())
    }
}

/// The `.rpstory` files and folders directly inside `folder`.
fn story_files(folder: &Path) -> impl Iterator<Item = PathBuf> {
    fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e == FILE_EXTENSION))
}

fn copy_folder(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_folder(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
