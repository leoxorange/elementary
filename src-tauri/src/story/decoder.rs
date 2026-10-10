//! Reads a `Story` from the binary format described in `format.rs`.
//!
//! Every length and index is bounds-checked, so damaged or hostile files produce a `StoryFileError` rather than a
//! panic. The decoder checks that the graph is structurally sound (links point at real nodes and ports, references
//! point at real sheet entries), but unfinished drafts are allowed: the frontend's validator decides whether a story
//! can be played.
//!
//! Tracks carry no audio size; the package reader fills it in.

use super::format::{self, ByteReader, Result, StoryFileError, node_tag, tag};
use super::model::*;
use std::collections::HashSet;

fn malformed<T>(reason: impl Into<String>) -> Result<T> {
    Err(StoryFileError::Malformed(reason.into()))
}

pub fn decode(data: &[u8]) -> Result<Story> {
    let mut header = ByteReader::new(data);
    if data.len() < format::HEADER_SIZE || header.read(4)? != format::MAGIC {
        return Err(StoryFileError::NotAStoryFile);
    }
    let version = header.read_u16_le()?;
    if version != format::VERSION {
        return Err(StoryFileError::UnsupportedVersion(version));
    }
    let flags = header.read_u16_le()?;
    if flags != 0 {
        return Err(StoryFileError::UnsupportedFlags(flags));
    }
    let payload_length = header.read_u32_le()? as usize;
    let expected_checksum = header.read_u32_le()?;
    let payload = header.read(payload_length)?;
    if !header.is_at_end() {
        return malformed("There is unexpected data after the payload.");
    }
    if format::crc32(payload) != expected_checksum {
        return Err(StoryFileError::ChecksumMismatch);
    }

    let story = decode_story(&read_chunks(payload)?)?;
    check_structure(&story)?;
    Ok(story)
}

struct Chunk<'a> {
    tag: &'a [u8],
    body: &'a [u8],
}

fn read_chunks(payload: &[u8]) -> Result<Vec<Chunk<'_>>> {
    let mut reader = ByteReader::new(payload);
    let mut chunks = vec![];
    while !reader.is_at_end() {
        let tag = reader.read(4)?;
        let length = reader.read_count()?;
        let body = reader.read(length)?;
        chunks.push(Chunk { tag, body });
    }
    Ok(chunks)
}

/// The string and language pools that every other section refers to.
#[derive(Default)]
struct Context {
    languages: Option<Vec<String>>,
    strings: Option<Vec<String>>,
}

impl Context {
    fn string(&self, reader: &mut ByteReader) -> Result<String> {
        let Some(strings) = &self.strings else {
            return malformed("A section refers to strings before the STRS section.");
        };
        let index = reader.read_count()?;
        match strings.get(index) {
            Some(value) => Ok(value.clone()),
            None => malformed("A string reference is out of range."),
        }
    }

    fn text(&self, reader: &mut ByteReader) -> Result<StoryText> {
        let Some(languages) = &self.languages else {
            return malformed("A section refers to languages before the LANG section.");
        };
        let count = reader.read_count()?;
        if count > languages.len() {
            return malformed("A text has more translations than there are languages.");
        }
        let mut text = StoryText::default();
        for _ in 0..count {
            let index = reader.read_count()?;
            let Some(language) = languages.get(index) else {
                return malformed("A language reference is out of range.");
            };
            if text.get(language).is_some() {
                return malformed(format!("A text has two {language} translations."));
            }
            let value = self.string(reader)?;
            text.set(language, value);
        }
        Ok(text)
    }
}

/// Reads a `varuint` count followed by that many elements.
fn read_array<'a, T>(reader: &mut ByteReader<'a>, mut element: impl FnMut(&mut ByteReader<'a>) -> Result<T>) -> Result<Vec<T>> {
    let count = reader.read_count()?;
    // Every element takes at least one byte, so a count larger than what's left is certainly corrupt.
    if count > reader.remaining() {
        return Err(StoryFileError::Truncated);
    }
    let mut elements = Vec::with_capacity(count);
    for _ in 0..count {
        elements.push(element(reader)?);
    }
    Ok(elements)
}

/// Item and character records are length-prefixed so newer files can append fields.
fn read_record<'a>(reader: &mut ByteReader<'a>) -> Result<ByteReader<'a>> {
    let length = reader.read_count()?;
    Ok(ByteReader::new(reader.read(length)?))
}

fn ensure_unique<T>(existing: &Option<T>, chunk_tag: &[u8]) -> Result<()> {
    if existing.is_some() {
        return malformed(format!("The {} section appears more than once.", format::tag_name(chunk_tag)));
    }
    Ok(())
}

fn decode_story(chunks: &[Chunk]) -> Result<Story> {
    let mut context = Context::default();
    let mut metadata: Option<(String, String)> = None;
    let mut chapters: Option<Vec<Chapter>> = None;
    let mut items: Option<Vec<Item>> = None;
    let mut characters: Option<Vec<StoryCharacter>> = None;
    let mut monsters: Option<Vec<StoryMonster>> = None;
    // Weapons from files written before weapons had combat stats.
    let mut legacy_weapons: HashSet<String> = HashSet::new();
    let mut locations: Option<Vec<StoryLocation>> = None;
    let mut events: Option<Vec<StoryEvent>> = None;
    let mut skills: Option<Vec<StorySkill>> = None;
    let mut occupations: Option<Vec<StoryOccupation>> = None;
    let mut routes: Option<Vec<LocationRoute>> = None;
    let mut tracks: Option<Vec<MusicTrack>> = None;
    let mut nodes: Option<Vec<StoryNode>> = None;
    let mut legacy_settings: Vec<(String, SceneSetting)> = vec![];
    let mut links: Option<Vec<StoryLink>> = None;

    for chunk in chunks {
        let mut reader = ByteReader::new(chunk.body);
        let r = &mut reader;
        match chunk.tag {
            t if t == tag::LANGUAGES => {
                ensure_unique(&context.languages, t)?;
                context.languages = Some(read_array(r, |r| r.read_inline_string())?);
            }
            t if t == tag::STRINGS => {
                ensure_unique(&context.strings, t)?;
                context.strings = Some(read_array(r, |r| r.read_inline_string())?);
            }
            t if t == tag::METADATA => {
                ensure_unique(&metadata, t)?;
                metadata = Some((context.string(r)?, context.string(r)?));
            }
            t if t == tag::CHAPTERS => {
                ensure_unique(&chapters, t)?;
                chapters = Some(read_array(r, |r| {
                    let mut body = read_record(r)?;
                    let id = context.string(&mut body)?;
                    let title = context.text(&mut body)?;
                    let summary = context.text(&mut body)?;
                    // Files from before chapter subtitles end here.
                    let subtitle = if body.is_at_end() { StoryText::default() } else { context.text(&mut body)? };
                    Ok(Chapter { id, title, subtitle, summary })
                })?);
            }
            t if t == tag::ITEMS => {
                ensure_unique(&items, t)?;
                items = Some(read_array(r, |r| {
                    let mut body = read_record(r)?;
                    let (item, is_legacy) = read_item(&mut body, &context)?;
                    if is_legacy && item.category == ItemCategory::Weapon {
                        legacy_weapons.insert(item.id.clone());
                    }
                    Ok(item)
                })?);
            }
            t if t == tag::MONSTERS => {
                ensure_unique(&monsters, t)?;
                monsters = Some(read_array(r, |r| read_monster(&mut read_record(r)?, &context))?);
            }
            t if t == tag::CHARACTERS => {
                ensure_unique(&characters, t)?;
                characters = Some(read_array(r, |r| read_character(&mut read_record(r)?, &context))?);
            }
            t if t == tag::LOCATIONS => {
                ensure_unique(&locations, t)?;
                let mut placed = read_array(r, |r| {
                    let mut body = read_record(r)?;
                    let mut location = StoryLocation {
                        id: context.string(&mut body)?,
                        name: context.text(&mut body)?,
                        region: context.text(&mut body)?,
                        detail: context.text(&mut body)?,
                        symbol: context.string(&mut body)?,
                        position: CanvasPoint::default(),
                    };
                    // Drafts from before the location map end here; they're laid out in a grid instead.
                    if !body.is_at_end() {
                        location.position = CanvasPoint { x: body.read_int()? as f64, y: body.read_int()? as f64 };
                    }
                    Ok(location)
                })?;
                if placed.len() > 1 && placed.iter().all(|l| l.position == CanvasPoint::default()) {
                    for (index, location) in placed.iter_mut().enumerate() {
                        location.position = grid_slot(index);
                    }
                }
                locations = Some(placed);
            }
            t if t == tag::ROUTES => {
                ensure_unique(&routes, t)?;
                routes = Some(read_array(r, |r| Ok(LocationRoute::new(context.string(r)?, context.string(r)?)))?);
            }
            t if t == tag::EVENTS => {
                ensure_unique(&events, t)?;
                events = Some(read_array(r, |r| {
                    let mut body = read_record(r)?;
                    Ok(StoryEvent {
                        id: context.string(&mut body)?,
                        name: context.text(&mut body)?,
                        detail: context.text(&mut body)?,
                        symbol: context.string(&mut body)?,
                    })
                })?);
            }
            t if t == tag::SKILLS => {
                ensure_unique(&skills, t)?;
                skills = Some(read_array(r, |r| read_skill(&mut read_record(r)?, &context))?);
            }
            t if t == tag::OCCUPATIONS => {
                ensure_unique(&occupations, t)?;
                occupations = Some(read_array(r, |r| read_occupation(&mut read_record(r)?, &context))?);
            }
            t if t == tag::TRACKS => {
                ensure_unique(&tracks, t)?;
                tracks = Some(read_array(r, |r| {
                    Ok(MusicTrack {
                        id: context.string(r)?,
                        name: context.string(r)?,
                        file_extension: context.string(r)?,
                        size: 0,
                    })
                })?);
            }
            t if t == tag::NODES => {
                ensure_unique(&nodes, t)?;
                nodes = Some(read_array(r, |r| {
                    let (node, setting) = read_node(r, &context)?;
                    if let Some(setting) = setting {
                        legacy_settings.push((node.id.clone(), setting));
                    }
                    Ok(node)
                })?);
            }
            t if t == tag::LINKS => {
                ensure_unique(&links, t)?;
                links = Some(read_array(r, |r| {
                    Ok(StoryLink { from_node: context.string(r)?, from_port: context.string(r)?, to_node: context.string(r)? })
                })?);
            }
            // Unknown chunks come from newer writers; skipping them keeps this reader working.
            _ => continue,
        }
        if !reader.is_at_end() {
            return malformed(format!("The {} section has trailing data.", format::tag_name(chunk.tag)));
        }
    }

    let (id, author) = metadata.ok_or_else(|| StoryFileError::MissingChunk("META".into()))?;
    let nodes = nodes.ok_or_else(|| StoryFileError::MissingChunk("NODE".into()))?;
    let links = links.ok_or_else(|| StoryFileError::MissingChunk("LINK".into()))?;
    let chapters = chapters.filter(|c| !c.is_empty()).ok_or_else(|| StoryFileError::MissingChunk("CHPT".into()))?;
    let mut story = Story {
        id,
        author,
        chapters,
        nodes,
        links,
        characters: characters.unwrap_or_default(),
        items: items.unwrap_or_default(),
        monsters: monsters.unwrap_or_default(),
        locations: locations.unwrap_or_default(),
        events: events.unwrap_or_default(),
        routes: routes.unwrap_or_default(),
        tracks: tracks.unwrap_or_default(),
        skills,
        occupations,
    };
    migrate_settings(legacy_settings, &mut story);
    migrate_legacy_weapons(&legacy_weapons, &mut story);
    Ok(story)
}

fn grid_slot(index: usize) -> CanvasPoint {
    CanvasPoint { x: (index % 4) as f64 * 240.0, y: (index / 4) as f64 * 140.0 }
}

/// Weapons from older files only had a flat attack bonus. They're given the weapon skill their carriers are best
/// at (Fighting (Brawl) if nobody carries them) and 1D6 damage, keeping the old bonus on top.
fn migrate_legacy_weapons(legacy: &HashSet<String>, story: &mut Story) {
    for index in 0..story.items.len() {
        let id = story.items[index].id.clone();
        if !legacy.contains(&id) {
            continue;
        }
        let mut best: Option<(String, i64)> = None;
        for character in story.characters.iter().filter(|c| c.item_ids.contains(&id)) {
            for skill in &character.skills {
                if skill.skill_id == "fightingBrawl" {
                    continue;
                }
                let Some(base) = weapon_skill_base(&skill.skill_id) else { continue };
                let value = base + skill.occupation_points + skill.personal_points;
                if best.as_ref().is_none_or(|(_, b)| value > *b) {
                    best = Some((skill.skill_id.clone(), value));
                }
            }
        }
        let item = &mut story.items[index];
        item.skill_id = best.as_ref().map(|b| b.0.clone()).unwrap_or_else(|| "fightingBrawl".into());
        item.adds_damage_bonus = !best.is_some_and(|b| b.0.starts_with("firearms"));
    }
}

/// Older files stored a scene setting on each node. Its place becomes a location-sheet entry, with roads wherever
/// play moves between two of them, and its chapter and part labels fill in the chapter's title and subtitle.
fn migrate_settings(settings: Vec<(String, SceneSetting)>, story: &mut Story) {
    if settings.is_empty() {
        return;
    }
    let mut created: Vec<String> = vec![];
    for (node_id, setting) in settings {
        let Some(index) = story.nodes.iter().position(|n| n.id == node_id) else { continue };
        let chapter_id = story.nodes[index].chapter_id.clone();
        if let Some(chapter) = story.chapters.iter_mut().find(|c| c.id == chapter_id) {
            if chapter.title.is_blank() && !setting.chapter.is_blank() {
                chapter.title = setting.chapter.clone();
            }
            if chapter.subtitle.is_blank() && !setting.part.is_blank() {
                chapter.subtitle = setting.part.clone();
            }
        }
        let node = &story.nodes[index];
        if setting.location.is_blank() || !node.kind.has_location() || !node.location_id.is_empty() {
            continue;
        }
        if let Some(existing) = story.locations.iter().find(|l| l.name == setting.location && l.region == setting.region) {
            story.nodes[index].location_id = existing.id.clone();
        } else {
            // Deterministic IDs, so the same old file always converts the same way.
            let mut number = story.locations.len() + 1;
            while story.location(&format!("place{number}")).is_some() {
                number += 1;
            }
            let id = format!("place{number}");
            story.locations.push(StoryLocation {
                id: id.clone(),
                name: setting.location,
                region: setting.region,
                detail: StoryText::default(),
                symbol: "mappin.and.ellipse".into(),
                position: CanvasPoint::default(),
            });
            story.nodes[index].location_id = id.clone();
            created.push(id);
        }
    }
    if created.is_empty() {
        return;
    }

    // Lay the new places out in a grid after any existing ones.
    let existing = story.locations.len() - created.len();
    for (offset, id) in created.iter().enumerate() {
        if let Some(location) = story.locations.iter_mut().find(|l| &l.id == id) {
            location.position = grid_slot(existing + offset);
        }
    }
    // The old settings never needed roads, so build one for every move play makes between places.
    let arriving = story.arriving_locations();
    let mut new_routes = vec![];
    for node in &story.nodes {
        if !node.kind.has_location() || story.location(&node.location_id).is_none() {
            continue;
        }
        for from in arriving.get(&node.id).into_iter().flatten() {
            if *from == node.location_id {
                continue;
            }
            let route = LocationRoute::new(from.clone(), node.location_id.clone());
            if !story.routes.contains(&route) && !new_routes.contains(&route) {
                new_routes.push(route);
            }
        }
    }
    story.routes.extend(new_routes);
}

/// Rejects graphs that would confuse the designer or the game, such as wires to nodes that don't exist.
fn check_structure(story: &Story) -> Result<()> {
    let mut node_ids = HashSet::new();
    for node in &story.nodes {
        if !node_ids.insert(node.id.as_str()) {
            return malformed(format!("Two nodes share the ID “{}”.", node.id));
        }
        let ports = node.kind.output_ports();
        if ports.iter().collect::<HashSet<_>>().len() != ports.len() {
            return malformed(format!("Node “{}” has two outputs with the same ID.", node.id));
        }
    }
    check_unique(story.chapters.iter().map(|c| c.id.clone()), "chapters")?;
    let chapter_ids: HashSet<&str> = story.chapters.iter().map(|c| c.id.as_str()).collect();
    if let Some(node) = story.nodes.iter().find(|n| !chapter_ids.contains(n.chapter_id.as_str())) {
        return malformed(format!("Node “{}” is in chapter “{}”, which doesn't exist.", node.id, node.chapter_id));
    }
    check_unique(story.tracks.iter().map(|t| t.id.clone()), "music tracks")?;
    check_unique(story.tracks.iter().map(MusicTrack::package_path), "music files")?;
    check_unique(story.items.iter().map(|i| i.id.clone()), "items")?;
    // Battle nodes refer to characters and monsters by ID alone, so IDs are unique across both sheets.
    check_unique(
        story.characters.iter().map(|c| c.id.clone()).chain(story.monsters.iter().map(|m| m.id.clone())),
        "characters and monsters",
    )?;
    check_unique(story.locations.iter().map(|l| l.id.clone()), "locations")?;
    check_unique(story.events.iter().map(|e| e.id.clone()), "events")?;

    let item_ids: HashSet<&str> = story.items.iter().map(|i| i.id.as_str()).collect();
    let character_ids: HashSet<&str> = story.characters.iter().map(|c| c.id.as_str()).collect();
    let opponent_ids: HashSet<&str> = character_ids.iter().copied().chain(story.monsters.iter().map(|m| m.id.as_str())).collect();
    let location_ids: HashSet<&str> = story.locations.iter().map(|l| l.id.as_str()).collect();
    let event_ids: HashSet<&str> = story.events.iter().map(|e| e.id.as_str()).collect();

    let check_items = |ids: &mut dyn Iterator<Item = &String>, owner: &str| -> Result<()> {
        for id in ids {
            if !item_ids.contains(id.as_str()) {
                return malformed(format!("{owner} refers to item “{id}”, which isn't on the item sheet."));
            }
        }
        Ok(())
    };
    let check_event = |id: &str, owner: &str| -> Result<()> {
        if !id.is_empty() && !event_ids.contains(id) {
            return malformed(format!("{owner} refers to event “{id}”, which isn't on the event sheet."));
        }
        Ok(())
    };

    for character in &story.characters {
        check_items(&mut character.item_ids.iter(), &format!("Character “{}”", character.id))?;
    }
    let mut seen_routes = HashSet::new();
    for route in &story.routes {
        if !location_ids.contains(route.first.as_str()) || !location_ids.contains(route.second.as_str()) {
            return malformed("A road refers to a location that isn't on the location sheet.");
        }
        if route.first == route.second || !seen_routes.insert(route) {
            return malformed("The location map has a duplicate road or one that leads nowhere.");
        }
    }
    for node in &story.nodes {
        let owner = format!("Node “{}”", node.id);
        if !node.location_id.is_empty() && !location_ids.contains(node.location_id.as_str()) {
            return malformed(format!(
                "Node “{}” refers to location “{}”, which isn't on the location sheet.",
                node.id, node.location_id
            ));
        }
        match &node.kind {
            NodeKind::Event(event) => {
                check_event(&event.event_id, &owner)?;
                check_event(&event.trigger.prior_event_id, &owner)?;
            }
            // An empty reference is an unfinished draft, which validation reports; a dangling one is damage.
            NodeKind::Entrance(entrance) => {
                if !entrance.hero_id.is_empty() && !character_ids.contains(entrance.hero_id.as_str()) {
                    return malformed(format!(
                        "{owner} refers to character “{}”, which isn't on the character sheet.",
                        entrance.hero_id
                    ));
                }
            }
            NodeKind::Battle(battle) => {
                if !battle.enemy_id.is_empty() && !opponent_ids.contains(battle.enemy_id.as_str()) {
                    return malformed(format!(
                        "Node “{}” fights “{}”, which isn't on the character or monster sheet.",
                        node.id, battle.enemy_id
                    ));
                }
            }
            NodeKind::ChapterJump(jump) => {
                if !jump.target_chapter_id.is_empty() && !chapter_ids.contains(jump.target_chapter_id.as_str()) {
                    return malformed(format!(
                        "Node “{}” leads to chapter “{}”, which doesn't exist.",
                        node.id, jump.target_chapter_id
                    ));
                }
            }
            NodeKind::Choice(choice) => {
                for option in &choice.options {
                    check_items(&mut option.effect.gain_items.iter().chain(&option.effect.lose_items), &owner)?;
                    if let Some(destination) = &option.effect.move_to {
                        if !location_ids.contains(destination.as_str()) {
                            return malformed(format!(
                                "Node “{}” travels to location “{destination}”, which isn't on the location sheet.",
                                node.id
                            ));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let mut used_ports = HashSet::new();
    for link in &story.links {
        let from = story.nodes.iter().find(|n| n.id == link.from_node);
        let to = story.nodes.iter().find(|n| n.id == link.to_node);
        let (Some(from), Some(to)) = (from, to) else {
            return malformed("A link refers to a node that doesn't exist.");
        };
        if !from.kind.output_ports().contains(&link.from_port) {
            return malformed(format!("A link starts from an output that node “{}” doesn't have.", from.id));
        }
        if !to.kind.has_input() {
            return malformed(format!("A link leads into node “{}”, which has no input.", to.id));
        }
        if !used_ports.insert((link.from_node.as_str(), link.from_port.as_str())) {
            return malformed(format!("An output of node “{}” is wired twice.", from.id));
        }
    }
    Ok(())
}

fn check_unique(ids: impl Iterator<Item = String>, what: &str) -> Result<()> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id.clone()) {
            return malformed(format!("Two {what} share the ID “{id}”."));
        }
    }
    Ok(())
}

// MARK: Sheets

/// Reads an item, and whether it came from a file written before weapons had combat stats.
fn read_item(reader: &mut ByteReader, context: &Context) -> Result<(Item, bool)> {
    let id = context.string(reader)?;
    let name = context.text(reader)?;
    let detail = context.text(reader)?;
    let symbol = context.string(reader)?;
    let Some(category) = ItemCategory::from_u8(reader.read_u8()?) else {
        return malformed(format!("Item “{id}” has an unknown category."));
    };
    let mut item = Item {
        id,
        name,
        detail,
        symbol,
        category,
        attack: reader.read_int()?,
        defense: reader.read_int()?,
        weight: reader.read_int()? as f64 / 100.0,
        value: reader.read_int()?,
        skill_id: String::new(),
        damage: DamageRoll { count: 1, sides: 6, bonus: 0 },
        adds_damage_bonus: true,
        impales: false,
    };
    if reader.is_at_end() {
        return Ok((item, true));
    }
    item.skill_id = context.string(reader)?;
    item.damage = read_damage(reader)?;
    item.adds_damage_bonus = reader.read_bool()?;
    item.impales = reader.read_bool()?;
    Ok((item, false))
}

fn read_damage(reader: &mut ByteReader) -> Result<DamageRoll> {
    let damage = DamageRoll { count: reader.read_int()?, sides: reader.read_int()?, bonus: reader.read_int()? };
    // Keep dice small enough that rolling them can't stall or overflow.
    if !(0..=100).contains(&damage.count) || !(0..=1000).contains(&damage.sides) || damage.bonus.abs() > 10_000 {
        return malformed("A damage roll is out of range.");
    }
    Ok(damage)
}

fn read_characteristic(reader: &mut ByteReader) -> Result<Characteristic> {
    Characteristic::from_u8(reader.read_u8()?).ok_or_else(|| StoryFileError::Malformed("A characteristic is unknown.".into()))
}

fn read_group(reader: &mut ByteReader) -> Result<SkillGroup> {
    SkillGroup::from_u8(reader.read_u8()?).ok_or_else(|| StoryFileError::Malformed("A skill group is unknown.".into()))
}

fn read_skill(reader: &mut ByteReader, context: &Context) -> Result<StorySkill> {
    let id = context.string(reader)?;
    let name = context.text(reader)?;
    let detail = context.text(reader)?;
    let symbol = context.string(reader)?;
    let group = read_group(reader)?;
    let base = match reader.read_u8()? {
        0 => SkillBase::Fixed { value: reader.read_int()? },
        1 => SkillBase::Characteristic { characteristic: read_characteristic(reader)?, divisor: reader.read_int()? },
        _ => return malformed(format!("Skill “{id}” has an unknown base value.")),
    };
    let takes_specialty = reader.read_bool()?;
    let is_uncommon = reader.read_bool()?;
    let at_creation = reader.read_bool()?;
    let is_wealth = reader.read_bool()?;
    let combat = match reader.read_u8()? {
        0 => SkillCombat::None,
        1 => {
            let range = match reader.read_u8()? {
                0 => WeaponRange::Melee,
                1 => WeaponRange::Ranged,
                _ => return malformed(format!("Skill “{id}” has an unknown weapon range.")),
            };
            let unarmed = if reader.read_bool()? { Some(read_damage(reader)?) } else { None };
            SkillCombat::Weapon { range, unarmed }
        }
        2 => SkillCombat::Dodge,
        3 => {
            let effect = match reader.read_u8()? {
                0 => AbilityEffect::Damage,
                1 => AbilityEffect::Heal,
                _ => return malformed(format!("Skill “{id}” has an unknown ability effect.")),
            };
            let amount = read_damage(reader)?;
            let adds_damage_bonus = reader.read_bool()?;
            let pierces_armor = reader.read_bool()?;
            let dodgeable = reader.read_bool()?;
            let target = match reader.read_u8()? {
                0 => AbilityTarget::Enemy,
                1 => AbilityTarget::AllEnemies,
                2 => AbilityTarget::User,
                _ => return malformed(format!("Skill “{id}” has an unknown ability target.")),
            };
            let cost =
                AbilityCost { mp: reader.read_int()?, hp: reader.read_int()?, stamina: reader.read_int()?, sanity: reader.read_int()? };
            SkillCombat::Ability { ability: SkillAbility { effect, amount, adds_damage_bonus, pierces_armor, dodgeable, target, cost } }
        }
        _ => return malformed(format!("Skill “{id}” has an unknown combat use.")),
    };
    Ok(StorySkill { id, name, detail, symbol, group, base, takes_specialty, is_uncommon, at_creation, is_wealth, combat })
}

fn read_occupation(reader: &mut ByteReader, context: &Context) -> Result<StoryOccupation> {
    let id = context.string(reader)?;
    let name = context.text(reader)?;
    let detail = context.text(reader)?;
    let symbol = context.string(reader)?;
    let wealth = [reader.read_int()?, reader.read_int()?];
    let points = read_array(reader, |r| {
        let multiplier = r.read_int()?;
        Ok(PointTerm { characteristics: read_array(r, read_characteristic)?, multiplier })
    })?;
    let slots = read_array(reader, |r| {
        Ok(match r.read_u8()? {
            0 => OccupationSlot::Skill { skill_id: context.string(r)?, specialty: context.text(r)? },
            1 => OccupationSlot::OneOf { skill_ids: read_array(r, |r| context.string(r))? },
            2 => OccupationSlot::Group { group: read_group(r)?, count: r.read_int()? },
            3 => OccupationSlot::Any { count: r.read_int()? },
            _ => return malformed(format!("Occupation “{id}” has an unknown kind of skill slot.")),
        })
    })?;
    Ok(StoryOccupation { id, name, detail, symbol, wealth, points, slots })
}

fn read_monster(reader: &mut ByteReader, context: &Context) -> Result<StoryMonster> {
    let mut monster = StoryMonster::new(context.string(reader)?);
    monster.name = context.text(reader)?;
    monster.detail = context.text(reader)?;
    monster.symbol = context.string(reader)?;
    monster.strength = reader.read_int()?;
    monster.constitution = reader.read_int()?;
    monster.size = reader.read_int()?;
    monster.dexterity = reader.read_int()?;
    monster.power = reader.read_int()?;
    monster.hit_points = reader.read_int()?;
    monster.fighting = reader.read_int()?;
    monster.attack_name = context.text(reader)?;
    monster.damage = read_damage(reader)?;
    monster.adds_damage_bonus = reader.read_bool()?;
    monster.impales = reader.read_bool()?;
    monster.attacks_per_round = reader.read_int()?;
    monster.dodge = reader.read_int()?;
    monster.armor = reader.read_int()?;
    monster.xp_reward = reader.read_int()?;
    monster.gold_reward = reader.read_int()?;
    Ok(monster)
}

fn read_character(reader: &mut ByteReader, context: &Context) -> Result<StoryCharacter> {
    let mut character = StoryCharacter::new(context.string(reader)?);
    character.name = context.text(reader)?;
    character.lineage = context.text(reader)?;
    character.calling = context.text(reader)?;
    character.summary = context.text(reader)?;
    character.symbol = context.string(reader)?;
    character.level = reader.read_int()?;
    character.age = reader.read_int()?;
    character.stamina = reader.read_int()?;
    character.ap = reader.read_int()?;
    character.xp = reader.read_int()?;
    character.xp_to_next = reader.read_int()?;
    character.gold = reader.read_int()?;
    character.min_damage = reader.read_int()?;
    character.max_damage = reader.read_int()?;
    character.xp_reward = reader.read_int()?;
    character.gold_reward = reader.read_int()?;
    for characteristic in Characteristic::ALL {
        let value = reader.read_int()?;
        character.characteristics.set(characteristic, value);
    }
    character.occupation_id = context.string(reader)?;
    character.skills = read_array(reader, |r| {
        Ok(SkillEntry {
            id: context.string(r)?,
            skill_id: context.string(r)?,
            specialty: context.text(r)?,
            occupation_points: r.read_int()?,
            personal_points: r.read_int()?,
        })
    })?;
    character.item_ids = read_array(reader, |r| context.string(r))?;
    character.effects = read_array(reader, |r| {
        Ok(StatusEffect {
            id: context.string(r)?,
            name: context.text(r)?,
            symbol: context.string(r)?,
            turns_remaining: r.read_int()?,
        })
    })?;
    character.carry_capacity = reader.read_int()? as f64 / 100.0;
    Ok(character)
}

// MARK: Nodes

/// Reads a node, and the legacy scene setting older files stored on it if it had any values.
fn read_node(reader: &mut ByteReader, context: &Context) -> Result<(StoryNode, Option<SceneSetting>)> {
    let raw_kind = reader.read_u8()?;
    // Each node is length-prefixed; reading from a sub-reader lets newer files append fields we ignore.
    let mut body = read_record(reader)?;
    let b = &mut body;

    let id = context.string(b)?;
    let position = CanvasPoint { x: b.read_int()? as f64, y: b.read_int()? as f64 };
    let music = match b.read_u8()? {
        0 => MusicCue::Keep,
        1 => MusicCue::Stop,
        2 => MusicCue::Play { track_id: context.string(b)? },
        _ => return malformed("A node has an unknown music cue."),
    };

    let mut setting: Option<SceneSetting> = None;
    let mut kind = match raw_kind {
        node_tag::ENTRANCE => {
            let title = context.text(b)?;
            let background = context.text(b)?;
            let intro = context.text(b)?;
            setting = Some(read_setting(b, context)?);
            NodeKind::Entrance(EntranceNode {
                title,
                background,
                intro,
                hero_id: context.string(b)?,
                quest: Quest { title: context.text(b)?, objective: context.text(b)? },
                start_day: b.read_int()?,
                start_phase: b.read_int()?,
            })
        }
        node_tag::NARRATION => {
            setting = Some(read_setting(b, context)?);
            NodeKind::Narration(NarrationNode {
                presence: context.text(b)?,
                title: context.text(b)?,
                body: context.text(b)?,
                quote: context.text(b)?,
            })
        }
        node_tag::CHOICE => {
            setting = Some(read_setting(b, context)?);
            NodeKind::Choice(ChoiceNode {
                presence: context.text(b)?,
                title: context.text(b)?,
                body: context.text(b)?,
                quote: context.text(b)?,
                options: read_array(b, |r| read_choice(r, context))?,
            })
        }
        node_tag::CHECK => {
            setting = Some(read_setting(b, context)?);
            let title = context.text(b)?;
            let text = context.text(b)?;
            let target = match b.read_u8()? {
                0 => match Characteristic::from_u8(b.read_u8()?) {
                    Some(characteristic) => CheckTarget::Characteristic { characteristic },
                    None => return malformed(format!("Check node “{id}” has an unknown characteristic.")),
                },
                1 => CheckTarget::Skill { skill_id: context.string(b)? },
                _ => return malformed(format!("Check node “{id}” has an unknown kind of target.")),
            };
            let Some(difficulty) = CheckDifficulty::from_u8(b.read_u8()?) else {
                return malformed(format!("Check node “{id}” has an unknown difficulty."));
            };
            NodeKind::Check(CheckNode { title, body: text, target, difficulty })
        }
        node_tag::BATTLE => {
            setting = Some(read_setting(b, context)?);
            NodeKind::Battle(BattleNode {
                presence: context.text(b)?,
                title: context.text(b)?,
                body: context.text(b)?,
                enemy_id: context.string(b)?,
            })
        }
        node_tag::END => {
            let title = context.text(b)?;
            let text = context.text(b)?;
            let quote = context.text(b)?;
            let outcome = match b.read_u8()? {
                0 => Outcome::Triumph,
                1 => Outcome::Neutral,
                2 => Outcome::Tragedy,
                _ => return malformed(format!("End node “{id}” has an unknown outcome.")),
            };
            NodeKind::End(EndNode { title, body: text, quote, outcome })
        }
        node_tag::CHAPTER_START => {
            setting = Some(read_setting(b, context)?);
            NodeKind::ChapterStart(ChapterStartNode { body: context.text(b)?, quote: context.text(b)? })
        }
        node_tag::CHAPTER_JUMP => NodeKind::ChapterJump(ChapterJumpNode { target_chapter_id: context.string(b)? }),
        node_tag::EVENT => NodeKind::Event(read_event(b, &id, context)?),
        _ => return malformed(format!("Node “{id}” has an unknown kind ({raw_kind}).")),
    };
    let chapter_id = context.string(b)?;
    // Files written before locations existed end here.
    let location_id = if b.is_at_end() { String::new() } else { context.string(b)? };
    // Event nodes written before events could do damage end here.
    if let NodeKind::Event(event) = &mut kind {
        if !b.is_at_end() {
            event.hp = b.read_int()?;
        }
        // Event nodes that change only health and don't use the time trigger end here.
        if !b.is_at_end() {
            event.mp = b.read_int()?;
            event.stamina = b.read_int()?;
            event.sanity = b.read_int()?;
            event.gold = b.read_int()?;
            event.xp = b.read_int()?;
            event.trigger.earliest_day = b.read_int()?;
            event.trigger.latest_day = b.read_int()?;
            let mask = b.read_u8()?;
            event.trigger.phases = (0..PHASE_COUNT).filter(|p| mask & (1 << p) != 0).collect();
        }
    }
    // Choice nodes written before options could travel end here.
    if let NodeKind::Choice(choice) = &mut kind {
        if !b.is_at_end() {
            let destinations = read_array(b, |r| context.string(r))?;
            for (option, destination) in choice.options.iter_mut().zip(destinations) {
                option.effect.move_to = if destination.is_empty() { None } else { Some(destination) };
            }
        }
    }
    let node = StoryNode { id, chapter_id, position, music, location_id, kind };
    let setting = setting.filter(|s| ![&s.region, &s.location, &s.chapter, &s.part].iter().all(|t| t.is_empty()));
    Ok((node, setting))
}

fn read_event(reader: &mut ByteReader, node_id: &str, context: &Context) -> Result<EventNode> {
    let title = context.text(reader)?;
    let body = context.text(reader)?;
    let quote = context.text(reader)?;
    let event_id = context.string(reader)?;
    let occurrence = match reader.read_u8()? {
        0 => Some(Occurrence::Eventually),
        1 => Some(Occurrence::Perhaps),
        _ => None,
    };
    let mode = match reader.read_u8()? {
        0 => Some(TriggerMode::Chance),
        1 => Some(TriggerMode::Characteristics),
        2 => Some(TriggerMode::PriorEvent),
        3 => Some(TriggerMode::Time),
        _ => None,
    };
    let (Some(occurrence), Some(mode)) = (occurrence, mode) else {
        return malformed(format!("Event node “{node_id}” has an unknown kind of trigger."));
    };
    let chance = reader.read_int()?;
    let requires_all = reader.read_bool()?;
    let conditions = read_array(reader, |r| {
        let id = context.string(r)?;
        let characteristic = Characteristic::from_u8(r.read_u8()?);
        let comparison = match r.read_u8()? {
            0 => Some(Comparison::Over),
            1 => Some(Comparison::Under),
            _ => None,
        };
        let (Some(characteristic), Some(comparison)) = (characteristic, comparison) else {
            return malformed(format!("Event node “{node_id}” has an unknown condition."));
        };
        Ok(CharacteristicCondition { id, characteristic, comparison, value: r.read_int()? })
    })?;
    let prior_event_id = context.string(reader)?;
    Ok(EventNode {
        title,
        body,
        quote,
        event_id,
        occurrence,
        trigger: EventTrigger {
            mode,
            chance,
            conditions,
            requires_all,
            prior_event_id,
            earliest_day: 0,
            latest_day: 0,
            phases: all_phases(),
        },
        hp: 0,
        mp: 0,
        stamina: 0,
        sanity: 0,
        gold: 0,
        xp: 0,
    })
}

fn read_setting(reader: &mut ByteReader, context: &Context) -> Result<SceneSetting> {
    Ok(SceneSetting {
        region: context.text(reader)?,
        location: context.text(reader)?,
        chapter: context.text(reader)?,
        part: context.text(reader)?,
    })
}

fn read_choice(reader: &mut ByteReader, context: &Context) -> Result<Choice> {
    let id = context.string(reader)?;
    let title = context.text(reader)?;
    let detail = context.text(reader)?;
    let symbol = context.string(reader)?;
    let tag = context.text(reader)?;
    let ap_cost = reader.read_int()?;
    let mut effect = Effect {
        hp: reader.read_int()?,
        mp: reader.read_int()?,
        stamina: reader.read_int()?,
        xp: reader.read_int()?,
        gold: reader.read_int()?,
        sanity: reader.read_int()?,
        passes_time: reader.read_bool()?,
        ..Effect::default()
    };
    let objective = context.text(reader)?;
    effect.objective = if objective.is_empty() { None } else { Some(objective) };
    effect.gain_items = read_array(reader, |r| context.string(r))?;
    effect.lose_items = read_array(reader, |r| context.string(r))?;
    Ok(Choice { id, title, detail, symbol, tag, ap_cost, effect })
}
