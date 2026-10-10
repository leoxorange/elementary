//! The binary story format (`story.bin` inside a `.rpstory` package), version 1.
//!
//! A package (see `package.rs`) holds this file plus the music it refers to.
//!
//! ## Layout
//!
//! A file is a fixed 16-byte header followed by a payload made of chunks. Multi-byte header fields are little-endian.
//!
//! ```text
//! Offset  Size  Field
//!      0     4  Magic "RPSF" (0x52 0x50 0x53 0x46)
//!      4     2  Format version (currently 1). Readers reject versions they don't know.
//!      6     2  Flags. Reserved; writers set 0 and readers reject non-zero values.
//!      8     4  Payload length in bytes.
//!     12     4  CRC-32 (IEEE 802.3, as used by zlib) of the payload.
//!     16     …  Payload: a sequence of chunks.
//! ```
//!
//! Each chunk is a four-character ASCII tag, a `varuint` byte length, and that many bytes of body.
//! Readers skip chunks with tags they don't recognize.
//!
//! | Tag    | Required | Contents |
//! |--------|----------|----------|
//! | `LANG` | yes      | `varuint` count, then that many inline strings (BCP 47 identifiers). |
//! | `STRS` | yes      | `varuint` count, then that many inline strings. Every other string in the file is an index into this pool, so repeated strings are stored once. |
//! | `META` | yes      | `ref` story id, `ref` author |
//! | `CHPT` | yes      | `varuint` count, then chapter records: `ref` id, `text` title, `text` summary, `text` subtitle. Listed in reading order. |
//! | `ITEM` | no       | `varuint` count, then item records: `ref` id, `text` name, `text` description, `ref` symbol, `u8` category, `int` bonus damage, `int` armor, `int` weight in hundredths, `int` value, `ref` weapon skill id, damage (`int` dice count, `int` sides, `int` bonus), `bool` adds damage bonus, `bool` impales |
//! | `MONS` | no       | `varuint` count, then monster records (see `encoder::write_monster`) |
//! | `CHAR` | no       | `varuint` count, then character records (see `encoder::write_character`) |
//! | `LOCS` | no       | `varuint` count, then location records: `ref` id, `text` name, `text` region, `text` description, `ref` symbol, `int` x, `int` y (location map position) |
//! | `ROUT` | no       | `varuint` count, then two-way roads between locations: `ref` location id, `ref` location id |
//! | `EVNT` | no       | `varuint` count, then event records: `ref` id, `text` name, `text` description, `ref` symbol |
//! | `SKIL` | no       | `varuint` count, then skill records (see `encoder::write_skill`). Absent means the built-in catalog. |
//! | `OCCU` | no       | `varuint` count, then occupation records (see `encoder::write_occupation`). Absent means the built-in catalog. |
//! | `TRKS` | no       | `varuint` count, then tracks: `ref` id, `ref` name, `ref` file extension. The audio is the package entry `music/<id>.<extension>`. |
//! | `NODE` | yes      | `varuint` count, then node records (below) |
//! | `LINK` | yes      | `varuint` count, then links: `ref` from node, `ref` from port, `ref` to node |
//!
//! `LANG` and `STRS` must come before the chunks that refer to them.
//!
//! ## Node records
//!
//! Chapter, item, character, location, and event records are a `varuint` length followed by the body; nodes are a
//! `u8` kind, a `varuint` body length, and the body. Every node body starts with `ref` id, `int` x, `int` y (canvas
//! position), and a music cue (`u8` 0 = keep, 1 = stop, 2 = play followed by a `ref` track id), then the kind's
//! fields as written by the encoder, then the `ref` chapter id, then the `ref` location id (empty for none;
//! older files end before it, which reads as none). Event nodes then add `int` hp change (0 when absent), and, only
//! when any of them is used, `int` mp, stamina, sanity, gold, and xp changes, the time trigger's `int` earliest day
//! and `int` latest day (0 for no limit), and `u8` phases (bit *n* set when it can happen at time of day *n*: 0 dawn,
//! 1 morning, 2 midday, 3 dusk, 4 nightfall); absent, they read as no change, no day limits, and every phase. Choice
//! nodes add each option's destination (`varuint` count, then `ref` location id per option in order, empty to stay).
//! Readers ignore bytes left over at the end of a record.
//!
//! Entrance, Narration, Choice, Check, Battle, and Chapter Start bodies include a legacy *setting*:
//! `text` region, location, chapter, part. Writers leave all four empty; places now come from the location sheet
//! and labels from the chapter. Readers turn values from older files into location-sheet entries, chapter titles,
//! and chapter subtitles.
//!
//! | Kind | Node |
//! |------|------|
//! | 0 | Entrance |
//! | 1 | Narration |
//! | 2 | Choice |
//! | 3 | Check |
//! | 4 | Battle |
//! | 5 | End |
//! | 6 | Chapter Start: setting, `text` body, `text` quote |
//! | 7 | Next Chapter: `ref` target chapter id |
//! | 8 | Event: `text` title, body, quote; `ref` event id; `u8` occurrence (0 eventually, 1 perhaps); trigger |
//!
//! An event's trigger is `u8` mode (0 chance, 1 characteristics, 2 prior event, 3 time; 3 is newer than the original
//! app, which can't read stories that use it), `int` chance percent, `bool`
//! requires all conditions, conditions (`varuint` count, then `ref` id, `u8` characteristic, `u8` comparison
//! (0 over, 1 under), `int` value), and `ref` prior event id. Every mode's settings are written, whichever is chosen.
//!
//! ## Primitive types
//!
//! - `varuint`: an unsigned integer in LEB128 (7 bits per byte, least significant group first, high bit = more bytes follow).
//! - `int`: a signed integer, ZigZag-mapped and then written as a `varuint`.
//! - `bool` / `u8`: one byte.
//! - inline string: `varuint` byte length followed by UTF-8 bytes.
//! - `ref`: a `varuint` index into the `STRS` pool.
//! - `text`: localized text. A `varuint` count of translations, then for each one a `varuint` index into `LANG`
//!   and a `ref` to its value. The first translation is the fallback. Zero translations means empty or “none”.

use std::fmt;

pub const MAGIC: &[u8; 4] = b"RPSF";
pub const VERSION: u16 = 1;
pub const HEADER_SIZE: usize = 16;

pub mod tag {
    pub const LANGUAGES: &[u8; 4] = b"LANG";
    pub const STRINGS: &[u8; 4] = b"STRS";
    pub const METADATA: &[u8; 4] = b"META";
    pub const CHAPTERS: &[u8; 4] = b"CHPT";
    pub const ITEMS: &[u8; 4] = b"ITEM";
    pub const CHARACTERS: &[u8; 4] = b"CHAR";
    pub const MONSTERS: &[u8; 4] = b"MONS";
    pub const LOCATIONS: &[u8; 4] = b"LOCS";
    pub const EVENTS: &[u8; 4] = b"EVNT";
    pub const SKILLS: &[u8; 4] = b"SKIL";
    pub const OCCUPATIONS: &[u8; 4] = b"OCCU";
    pub const ROUTES: &[u8; 4] = b"ROUT";
    pub const TRACKS: &[u8; 4] = b"TRKS";
    pub const NODES: &[u8; 4] = b"NODE";
    pub const LINKS: &[u8; 4] = b"LINK";
}

/// Node kind tags, in file order.
pub mod node_tag {
    pub const ENTRANCE: u8 = 0;
    pub const NARRATION: u8 = 1;
    pub const CHOICE: u8 = 2;
    pub const CHECK: u8 = 3;
    pub const BATTLE: u8 = 4;
    pub const END: u8 = 5;
    pub const CHAPTER_START: u8 = 6;
    pub const CHAPTER_JUMP: u8 = 7;
    pub const EVENT: u8 = 8;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoryFileError {
    NotAStoryFile,
    UnsupportedVersion(u16),
    UnsupportedFlags(u16),
    ChecksumMismatch,
    Truncated,
    Malformed(String),
    MissingChunk(String),
    TooLarge,
}

impl fmt::Display for StoryFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAStoryFile => write!(f, "This isn't a story file."),
            Self::UnsupportedVersion(version) => {
                write!(f, "Story file version {version} isn't supported by this version of the app.")
            }
            Self::UnsupportedFlags(flags) => {
                write!(f, "The story file uses unsupported features (flags 0x{flags:x}).")
            }
            Self::ChecksumMismatch => write!(f, "The story file is damaged (checksum mismatch)."),
            Self::Truncated => write!(f, "The story file ends unexpectedly."),
            Self::Malformed(reason) => write!(f, "The story file is malformed: {reason}"),
            Self::MissingChunk(tag) => write!(f, "The story file is missing its {tag} section."),
            Self::TooLarge => write!(f, "The story is too large (over 4 GB)."),
        }
    }
}

impl std::error::Error for StoryFileError {}

pub type Result<T> = std::result::Result<T, StoryFileError>;

pub fn tag_name(tag: &[u8]) -> String {
    String::from_utf8_lossy(tag).into_owned()
}

// MARK: - CRC-32

const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut index = 0;
    while index < 256 {
        let mut value = index as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 == 1 { 0xEDB8_8320 ^ (value >> 1) } else { value >> 1 };
            bit += 1;
        }
        table[index] = value;
        index += 1;
    }
    table
};

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in bytes {
        crc = CRC_TABLE[((crc ^ byte as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

// MARK: - Byte writer

/// Appends primitive values to a growing byte buffer.
#[derive(Default)]
pub struct ByteWriter {
    pub bytes: Vec<u8>,
}

impl ByteWriter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn write(&mut self, raw: &[u8]) {
        self.bytes.extend_from_slice(raw);
    }

    pub fn write_u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    pub fn write_u16_le(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    pub fn write_u32_le(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    pub fn write_varuint(&mut self, value: u64) {
        let mut remaining = value;
        loop {
            let mut byte = (remaining & 0x7F) as u8;
            remaining >>= 7;
            if remaining != 0 {
                byte |= 0x80;
            }
            self.bytes.push(byte);
            if remaining == 0 {
                break;
            }
        }
    }

    pub fn write_count(&mut self, value: usize) {
        self.write_varuint(value as u64);
    }

    /// Writes a signed integer using ZigZag encoding so small negative numbers stay small.
    pub fn write_int(&mut self, value: i64) {
        self.write_varuint(((value << 1) ^ (value >> 63)) as u64);
    }

    pub fn write_bool(&mut self, value: bool) {
        self.bytes.push(value as u8);
    }

    pub fn write_inline_string(&mut self, value: &str) {
        self.write_count(value.len());
        self.bytes.extend_from_slice(value.as_bytes());
    }

    /// Writes a `varuint` length followed by another writer's bytes.
    pub fn write_record(&mut self, body: &ByteWriter) {
        self.write_count(body.bytes.len());
        self.write(&body.bytes);
    }
}

// MARK: - Byte reader

/// Reads primitive values from a byte buffer, returning errors instead of panicking on bad input.
pub struct ByteReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteReader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    pub fn is_at_end(&self) -> bool {
        self.offset >= self.bytes.len()
    }

    pub fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    pub fn read(&mut self, count: usize) -> Result<&'a [u8]> {
        if count > self.remaining() {
            return Err(StoryFileError::Truncated);
        }
        let slice = &self.bytes[self.offset..self.offset + count];
        self.offset += count;
        Ok(slice)
    }

    pub fn read_u8(&mut self) -> Result<u8> {
        Ok(self.read(1)?[0])
    }

    pub fn read_u16_le(&mut self) -> Result<u16> {
        let raw = self.read(2)?;
        Ok(u16::from_le_bytes([raw[0], raw[1]]))
    }

    pub fn read_u32_le(&mut self) -> Result<u32> {
        let raw = self.read(4)?;
        Ok(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]))
    }

    pub fn read_varuint(&mut self) -> Result<u64> {
        let mut result = 0u64;
        let mut shift = 0u64;
        loop {
            let byte = self.read_u8()?;
            if !(shift < 64 && (shift < 63 || byte & 0x7E == 0)) {
                return Err(StoryFileError::Malformed("An integer is too large.".into()));
            }
            result |= ((byte & 0x7F) as u64) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
            shift += 7;
        }
    }

    /// Reads a `varuint` that is used as a count, length, or index.
    pub fn read_count(&mut self) -> Result<usize> {
        let value = self.read_varuint()?;
        if value > i32::MAX as u64 {
            return Err(StoryFileError::Malformed("A count is out of range.".into()));
        }
        Ok(value as usize)
    }

    pub fn read_int(&mut self) -> Result<i64> {
        let raw = self.read_varuint()?;
        Ok(((raw >> 1) as i64) ^ -((raw & 1) as i64))
    }

    pub fn read_bool(&mut self) -> Result<bool> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(StoryFileError::Malformed("A boolean has an invalid value.".into())),
        }
    }

    pub fn read_inline_string(&mut self) -> Result<String> {
        let length = self.read_count()?;
        let raw = self.read(length)?;
        String::from_utf8(raw.to_vec()).map_err(|_| StoryFileError::Malformed("A string isn't valid UTF-8.".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_zlib() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn integers_round_trip() {
        let values = [0i64, 1, -1, 63, -64, 1_000_000, -1_000_000, i64::MAX, i64::MIN];
        let mut writer = ByteWriter::new();
        for value in values {
            writer.write_int(value);
        }
        let mut reader = ByteReader::new(&writer.bytes);
        for value in values {
            assert_eq!(reader.read_int().unwrap(), value);
        }
        assert!(reader.is_at_end());
    }
}
