//! Prints a `.rpstory` package (zipped or unpacked) as the JSON the frontend receives.
//!
//! Usage: `cargo run --example story_json -- path/to/Story.rpstory`

use elementary_lib::story::package::{self, TrackStore};

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: story_json <path to .rpstory>");
        std::process::exit(2);
    };
    match package::read(std::path::Path::new(&path), &TrackStore::default()) {
        Ok(story) => println!("{}", serde_json::to_string_pretty(&story).expect("stories serialize")),
        Err(error) => {
            eprintln!("{error:?}");
            std::process::exit(1);
        }
    }
}
