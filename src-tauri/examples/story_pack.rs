//! Writes story JSON (as `story_json` prints it) back into a zipped `.rpstory` package. Stories with music can't be
//! packed this way, since the JSON doesn't carry the audio.
//!
//! Usage: `cargo run --example story_pack -- story.json path/to/Story.rpstory`

use elementary_lib::story::model::Story;
use elementary_lib::story::package::{self, TrackStore};

fn main() {
    let (Some(source), Some(destination)) = (std::env::args().nth(1), std::env::args().nth(2)) else {
        eprintln!("usage: story_pack <story.json> <destination .rpstory>");
        std::process::exit(2);
    };
    let json = std::fs::read_to_string(&source).unwrap_or_else(|error| {
        eprintln!("{source}: {error}");
        std::process::exit(1);
    });
    let story: Story = serde_json::from_str(&json).unwrap_or_else(|error| {
        eprintln!("{source}: {error}");
        std::process::exit(1);
    });
    if !story.tracks.is_empty() {
        eprintln!("{source} has music, which story JSON doesn't carry.");
        std::process::exit(1);
    }
    if let Err(error) = package::write_archive(&story, std::path::Path::new(&destination), &TrackStore::default()) {
        eprintln!("{error:?}");
        std::process::exit(1);
    }
}
