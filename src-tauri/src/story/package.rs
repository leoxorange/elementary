//! The `.rpstory` package: a ZIP archive (like `.docx` or `.epub`) holding the story and its music as separate files.
//!
//! ```text
//! MyStory.rpstory
//! ├── mimetype         "application/x-roleplay-story", stored first and uncompressed so tools can sniff it
//! ├── manifest.json    Human-readable summary: title, author, languages, counts, and track list
//! ├── story.bin        The graph plus the character and item sheets (`format.rs`), deflated
//! └── music/<id>.<ext> One file per track, stored uncompressed (audio is already compressed)
//! ```
//!
//! The same layout is used unpacked, as a folder, for scripts in the designer's library. That way autosaving
//! rewrites only `story.bin`, and a track is written once when it's imported instead of on every edit.
//!
//! Reading decodes `story.bin` right away, but each track's audio stays where it is: the `TrackStore` remembers
//! where to find it and reads it only when it's played, saved, or exported.

use super::format::StoryFileError;
use super::model::{MusicTrack, Story};
use super::{decoder, encoder};
use serde_json::json;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use zip::write::SimpleFileOptions;

pub const MIMETYPE: &str = "application/x-roleplay-story";
pub const FILE_EXTENSION: &str = "rpstory";
const MIMETYPE_ENTRY: &str = "mimetype";
const MANIFEST_ENTRY: &str = "manifest.json";
pub const STORY_ENTRY: &str = "story.bin";

/// `story.bin` is text and structure; anything this large is not a real story.
const STORY_LIMIT: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub enum PackageError {
    Story(StoryFileError),
    Io(io::Error),
}

impl From<StoryFileError> for PackageError {
    fn from(error: StoryFileError) -> Self {
        Self::Story(error)
    }
}

impl From<io::Error> for PackageError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<zip::result::ZipError> for PackageError {
    fn from(error: zip::result::ZipError) -> Self {
        match error {
            zip::result::ZipError::Io(error) => Self::Io(error),
            zip::result::ZipError::FileNotFound => Self::Story(StoryFileError::NotAStoryFile),
            other => Self::Story(StoryFileError::Malformed(format!("The archive is damaged ({other}).")))
        }
    }
}

pub type Result<T> = std::result::Result<T, PackageError>;

// MARK: - Track store

/// Where a track's audio can be read from.
#[derive(Clone, Debug)]
enum TrackSource {
    /// A file in an unpacked package folder.
    File(PathBuf),
    /// An entry in a zipped package.
    Zip { archive: PathBuf, entry: String },
    /// Audio held in memory: a fresh import, or a track whose file was removed but may come back with undo.
    Bytes(Arc<Vec<u8>>),
}

/// Remembers where every track the app has seen keeps its audio, by track ID.
///
/// Tracks never change after import, so a track ID always means the same audio, even when a story is duplicated
/// and both copies refer to it.
#[derive(Default)]
pub struct TrackStore {
    sources: Mutex<HashMap<String, TrackSource>>,
}

impl TrackStore {
    fn register(&self, id: &str, source: TrackSource) {
        self.sources.lock().unwrap().insert(id.to_string(), source);
    }

    pub fn add_bytes(&self, id: &str, bytes: Vec<u8>) {
        self.sources.lock().unwrap().insert(id.to_string(), TrackSource::Bytes(Arc::new(bytes)));
    }

    /// The track's audio.
    pub fn data(&self, id: &str) -> io::Result<Arc<Vec<u8>>> {
        let source = self.sources.lock().unwrap().get(id).cloned();
        match source {
            Some(TrackSource::Bytes(bytes)) => Ok(bytes),
            Some(TrackSource::File(path)) => Ok(Arc::new(fs::read(path)?)),
            Some(TrackSource::Zip { archive, entry }) => {
                let mut archive = zip::ZipArchive::new(File::open(archive)?).map_err(io::Error::other)?;
                let mut file = archive.by_name(&entry).map_err(io::Error::other)?;
                let mut bytes = Vec::with_capacity(file.size() as usize);
                file.read_to_end(&mut bytes)?;
                Ok(Arc::new(bytes))
            }
            None => Err(io::Error::new(io::ErrorKind::NotFound, format!("The audio for track “{id}” is missing."))),
        }
    }

    /// Before a file is deleted, keeps the audio of any track that is read from it, so undo can bring it back.
    pub fn rescue(&self, path: &Path) {
        let mut sources = self.sources.lock().unwrap();
        for source in sources.values_mut() {
            if let TrackSource::File(file) = source {
                if file == path {
                    if let Ok(bytes) = fs::read(&*file) {
                        *source = TrackSource::Bytes(Arc::new(bytes));
                    }
                }
            }
        }
    }
}

// MARK: - Reading

/// Reads a zipped package or an unpacked package folder.
pub fn read(path: &Path, tracks: &TrackStore) -> Result<Story> {
    if path.is_dir() {
        return read_folder(path, tracks);
    }

    let mut file = File::open(path)?;
    let mut signature = [0u8; 4];
    if file.read_exact(&mut signature).is_err() || signature != [0x50, 0x4B, 0x03, 0x04] {
        return Err(StoryFileError::NotAStoryFile.into());
    }

    let mut archive = zip::ZipArchive::new(File::open(path)?)?;
    let mut story = {
        let mut entry = archive.by_name(STORY_ENTRY).map_err(|_| StoryFileError::NotAStoryFile)?;
        if entry.size() > STORY_LIMIT {
            return Err(StoryFileError::TooLarge.into());
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|_| StoryFileError::ChecksumMismatch)?;
        decoder::decode(&bytes)?
    };
    for track in &mut story.tracks {
        let entry_name = track.package_path();
        let entry = archive
            .by_name(&entry_name)
            .map_err(|_| StoryFileError::Malformed(format!("The package is missing “{entry_name}”.")))?;
        track.size = entry.size();
        tracks.register(&track.id, TrackSource::Zip { archive: path.to_path_buf(), entry: entry_name });
    }
    Ok(story)
}

fn read_folder(folder: &Path, tracks: &TrackStore) -> Result<Story> {
    let mut story = decoder::decode(&fs::read(folder.join(STORY_ENTRY))?)?;
    for track in &mut story.tracks {
        let path = folder.join(track.package_path());
        track.size = fs::metadata(&path)?.len();
        tracks.register(&track.id, TrackSource::File(path));
    }
    Ok(story)
}

// MARK: - Writing

/// Writes a zipped package for sharing. The archive is built in a temporary file next to the destination and
/// moved into place, so an existing package (which may be what a story being played reads its music from) is
/// never left half-written.
pub fn write_archive(story: &Story, destination: &Path, tracks: &TrackStore) -> Result<()> {
    let folder = destination.parent().unwrap_or(Path::new("."));
    let temporary = folder.join(format!(".{}.{FILE_EXTENSION}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut writer = zip::ZipWriter::new(File::create(&temporary)?);
        let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        writer.start_file(MIMETYPE_ENTRY, stored)?;
        writer.write_all(MIMETYPE.as_bytes())?;
        writer.start_file(MANIFEST_ENTRY, deflated)?;
        writer.write_all(&manifest(story))?;
        writer.start_file(STORY_ENTRY, deflated)?;
        writer.write_all(&encoder::encode(story)?)?;
        for track in &story.tracks {
            writer.start_file(track.package_path(), stored)?;
            writer.write_all(&tracks.data(&track.id)?)?;
        }
        writer.finish()?.sync_all()?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    fs::rename(&temporary, destination)?;
    // Tracks that were read from the file just replaced still are, so point them at the new entries.
    for track in &story.tracks {
        tracks.register(&track.id, TrackSource::Zip { archive: destination.to_path_buf(), entry: track.package_path() });
    }
    Ok(())
}

/// Writes an unpacked package folder. Tracks already on disk are left alone and removed tracks are deleted, so
/// saving after a text edit only rewrites `story.bin` and the manifest.
pub fn write_folder(story: &Story, folder: &Path, tracks: &TrackStore) -> Result<()> {
    let music = folder.join("music");
    fs::create_dir_all(&music)?;

    write_atomically(&folder.join(MIMETYPE_ENTRY), MIMETYPE.as_bytes())?;
    write_atomically(&folder.join(STORY_ENTRY), &encoder::encode(story)?)?;
    write_atomically(&folder.join(MANIFEST_ENTRY), &manifest(story))?;

    let mut keep = vec![];
    for track in &story.tracks {
        let path = folder.join(track.package_path());
        if !path.exists() {
            write_atomically(&path, &tracks.data(&track.id)?)?;
            tracks.register(&track.id, TrackSource::File(path.clone()));
        }
        keep.push(path);
    }
    for entry in fs::read_dir(&music)?.flatten() {
        let path = entry.path();
        if !keep.contains(&path) {
            tracks.rescue(&path);
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path).inspect_err(|_| {
        let _ = fs::remove_file(&temporary);
    })
}

/// A readable summary for people and tools poking inside the package. The game reads `story.bin`, not this.
pub fn manifest(story: &Story) -> Vec<u8> {
    let title: serde_json::Map<String, serde_json::Value> =
        story.title().0.iter().map(|t| (t.language.clone(), json!(t.value))).collect();
    let mut languages: Vec<String> = vec![];
    let node_titles: Vec<_> = story.nodes.iter().map(|n| n.kind.title()).collect();
    for language in story.title().languages().chain(node_titles.iter().flat_map(|t| t.languages())) {
        if !languages.iter().any(|l| l == language) {
            languages.push(language.to_string());
        }
    }
    let manifest = json!({
        "format": FILE_EXTENSION,
        "formatVersion": super::format::VERSION,
        "id": story.id,
        "title": title,
        "author": story.author,
        "languages": languages,
        "nodes": story.nodes.len(),
        "characters": story.characters.len(),
        "items": story.items.len(),
        "tracks": story.tracks.iter().map(|t: &MusicTrack| json!({
            "id": t.id, "name": t.name, "path": t.package_path(), "bytes": t.size
        })).collect::<Vec<_>>(),
    });
    serde_json::to_vec_pretty(&manifest).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_and_folder_round_trip_with_music() {
        let store = TrackStore::default();
        let source = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/stories/RebirthInParadise.rpstory"));
        let mut story = read(source, &store).unwrap();
        let audio = vec![7u8; 4096];
        store.add_bytes("tune1", audio.clone());
        story.tracks.push(MusicTrack { id: "tune1".into(), name: "Tune".into(), file_extension: "mp3".into(), size: 4096 });

        let scratch = std::env::temp_dir().join(format!("elementary-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&scratch).unwrap();
        let archive = scratch.join("Copy.rpstory");
        write_archive(&story, &archive, &store).unwrap();
        let reread = read(&archive, &store).unwrap();
        assert_eq!(reread, story);
        assert_eq!(*store.data("tune1").unwrap(), audio);

        let folder = scratch.join("Folder.rpstory");
        write_folder(&story, &folder, &store).unwrap();
        assert_eq!(read(&folder, &store).unwrap(), story);

        // Removing the track deletes its file but keeps the audio, so undo can restore it.
        let mut without = story.clone();
        without.tracks.clear();
        write_folder(&without, &folder, &store).unwrap();
        assert!(!folder.join("music/tune1.mp3").exists());
        write_folder(&story, &folder, &store).unwrap();
        assert_eq!(fs::read(folder.join("music/tune1.mp3")).unwrap(), audio);

        fs::remove_dir_all(&scratch).unwrap();
    }
}
