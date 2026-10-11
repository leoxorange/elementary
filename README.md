# Elementary

A story-driven role-playing game with a node-based story designer, built with Tauri (Rust) and React + TypeScript.
It's a port of the SwiftUI app in `../RP/RolePlayer`, and it reads and writes the same `.rpstory` files.

## Run

```sh
npm install
npm run tauri dev      # develop
npm run tauri build    # package the app
npm run portable       # portable Windows build in portable/, no installer
```

The portable build is a folder (and a ZIP of it) with the executable, `WebView2Loader.dll`, and the built-in
stories. It's built with the `portable` Cargo feature, so it keeps saves, the designer's library, and the settings in
a `data` folder next to the executable instead of the app data directory.

## Layout

- `src-tauri/src/story/`: the `.rpstory` format. `format.rs` documents the binary layout of `story.bin`. The
  decoder (with migrations for older files) and the encoder match the original byte for byte. `package.rs`
  handles the ZIP package and the unpacked library folders.
- `src-tauri/src/storage.rs`: built-in stories (`src-tauri/stories/`), the designer's library, copies of opened
  files, and the autosave. All of them live in the app data directory.
- `src/model/`: the story types, rules (characteristics, skills, occupations), and the validator.
- `src/game/`: the game engine (choices, checks, battles, events, saves).
- `src/screens/`: the welcome screen and the game.
- `src/designer/`: the story designer (node canvas, location map, inspector, undo, autosave).
- `src/i18n/`: English and Simplified Chinese. `zh-Hans.json` comes from the original string catalog.

Stories name their icons with SF Symbols, as in the original app. `src/icons.tsx` draws each one with the closest
Lucide icon.

## Checks

```sh
cd src-tauri && cargo test                                         # codec round-trip and package tests
cargo run --example story_json -- stories/RebirthInParadise.rpstory  # print a story as frontend JSON
```
