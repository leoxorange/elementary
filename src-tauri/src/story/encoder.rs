//! Serializes a `Story` into the binary format described in `format.rs` (the package's `story.bin`).
//! Music isn't included: the package stores each track as its own entry.
//!
//! Drafts with validation errors can still be saved, so the designer never loses work; only playing requires a
//! story without errors.

use super::format::{self, ByteWriter, Result, StoryFileError, node_tag, tag};
use super::model::*;
use std::collections::HashMap;

pub fn encode(story: &Story) -> Result<Vec<u8>> {
    let mut context = Context::default();
    // The entrance title's first language becomes the source language, listed first in LANG.
    if let Some(language) = story.title().languages().next() {
        context.language(language);
    }

    // Write the body chunks first so every string and language they use is interned, then emit the pools ahead
    // of them.
    let mut metadata = ByteWriter::new();
    metadata.write_count(context.string(&story.id));
    metadata.write_count(context.string(&story.author));

    let mut chapters = ByteWriter::new();
    chapters.write_count(story.chapters.len());
    for chapter in &story.chapters {
        let mut body = ByteWriter::new();
        body.write_count(context.string(&chapter.id));
        write_text(&chapter.title, &mut body, &mut context);
        write_text(&chapter.summary, &mut body, &mut context);
        write_text(&chapter.subtitle, &mut body, &mut context);
        chapters.write_record(&body);
    }

    let mut items = ByteWriter::new();
    items.write_count(story.items.len());
    for item in &story.items {
        let mut body = ByteWriter::new();
        write_item(item, &mut body, &mut context);
        items.write_record(&body);
    }

    let mut characters = ByteWriter::new();
    characters.write_count(story.characters.len());
    for character in &story.characters {
        let mut body = ByteWriter::new();
        write_character(character, &mut body, &mut context);
        characters.write_record(&body);
    }

    let mut monsters = ByteWriter::new();
    monsters.write_count(story.monsters.len());
    for monster in &story.monsters {
        let mut body = ByteWriter::new();
        write_monster(monster, &mut body, &mut context);
        monsters.write_record(&body);
    }

    let mut locations = ByteWriter::new();
    locations.write_count(story.locations.len());
    for location in &story.locations {
        let mut body = ByteWriter::new();
        body.write_count(context.string(&location.id));
        for text in [&location.name, &location.region, &location.detail] {
            write_text(text, &mut body, &mut context);
        }
        body.write_count(context.string(&location.symbol));
        body.write_int(canvas_coordinate(location.position.x));
        body.write_int(canvas_coordinate(location.position.y));
        locations.write_record(&body);
    }

    let mut events = ByteWriter::new();
    events.write_count(story.events.len());
    for event in &story.events {
        let mut body = ByteWriter::new();
        body.write_count(context.string(&event.id));
        write_text(&event.name, &mut body, &mut context);
        write_text(&event.detail, &mut body, &mut context);
        body.write_count(context.string(&event.symbol));
        events.write_record(&body);
    }

    let mut routes = ByteWriter::new();
    routes.write_count(story.routes.len());
    for route in &story.routes {
        routes.write_count(context.string(&route.first));
        routes.write_count(context.string(&route.second));
    }

    let mut tracks = ByteWriter::new();
    tracks.write_count(story.tracks.len());
    for track in &story.tracks {
        tracks.write_count(context.string(&track.id));
        tracks.write_count(context.string(&track.name));
        tracks.write_count(context.string(&track.file_extension));
    }

    // The skill and occupation sheets are only written when the story has its own.
    let skills = story.skills.as_ref().map(|skills| {
        let mut chunk = ByteWriter::new();
        chunk.write_count(skills.len());
        for skill in skills {
            let mut body = ByteWriter::new();
            write_skill(skill, &mut body, &mut context);
            chunk.write_record(&body);
        }
        chunk
    });
    let occupations = story.occupations.as_ref().map(|occupations| {
        let mut chunk = ByteWriter::new();
        chunk.write_count(occupations.len());
        for occupation in occupations {
            let mut body = ByteWriter::new();
            write_occupation(occupation, &mut body, &mut context);
            chunk.write_record(&body);
        }
        chunk
    });

    let mut nodes = ByteWriter::new();
    nodes.write_count(story.nodes.len());
    for node in &story.nodes {
        let mut body = ByteWriter::new();
        let kind_tag = write_node(node, &mut body, &mut context);
        body.write_count(context.string(&node.chapter_id));
        body.write_count(context.string(&node.location_id));
        if let NodeKind::Event(event) = &node.kind {
            body.write_int(event.hp);
            // The other changes and the time trigger, only when used, so older stories keep their exact bytes.
            if event.has_extension() {
                for value in [event.mp, event.stamina, event.sanity, event.gold, event.xp] {
                    body.write_int(value);
                }
                body.write_int(event.trigger.earliest_day);
                body.write_int(event.trigger.latest_day);
                body.write_u8(event.trigger.phases.iter().filter(|&&p| p < PHASE_COUNT).fold(0, |mask, &p| mask | 1 << p));
            }
        }
        if let NodeKind::Choice(choice) = &node.kind {
            // Each option's destination, in option order. Kept out of the option records so older files still read.
            body.write_count(choice.options.len());
            for option in &choice.options {
                body.write_count(context.string(option.effect.move_to.as_deref().unwrap_or("")));
            }
        }
        nodes.write_u8(kind_tag);
        nodes.write_record(&body);
    }

    let mut links = ByteWriter::new();
    links.write_count(story.links.len());
    for link in &story.links {
        links.write_count(context.string(&link.from_node));
        links.write_count(context.string(&link.from_port));
        links.write_count(context.string(&link.to_node));
    }

    let mut languages = ByteWriter::new();
    languages.write_count(context.languages.len());
    for language in &context.languages {
        languages.write_inline_string(language);
    }

    let mut strings = ByteWriter::new();
    strings.write_count(context.strings.len());
    for string in &context.strings {
        strings.write_inline_string(string);
    }

    let mut chunk_list = vec![
        (tag::LANGUAGES, &languages),
        (tag::STRINGS, &strings),
        (tag::METADATA, &metadata),
        (tag::CHAPTERS, &chapters),
        (tag::ITEMS, &items),
        (tag::CHARACTERS, &characters),
        (tag::MONSTERS, &monsters),
        (tag::LOCATIONS, &locations),
        (tag::EVENTS, &events),
    ];
    if let Some(skills) = &skills {
        chunk_list.push((tag::SKILLS, skills));
    }
    if let Some(occupations) = &occupations {
        chunk_list.push((tag::OCCUPATIONS, occupations));
    }
    chunk_list.extend([(tag::ROUTES, &routes), (tag::TRACKS, &tracks), (tag::NODES, &nodes), (tag::LINKS, &links)]);

    let mut payload = ByteWriter::new();
    for (chunk_tag, body) in chunk_list {
        payload.write(chunk_tag);
        payload.write_record(body);
    }

    let Ok(payload_length) = u32::try_from(payload.bytes.len()) else {
        return Err(StoryFileError::TooLarge);
    };

    let mut file = ByteWriter::new();
    file.write(format::MAGIC);
    file.write_u16_le(format::VERSION);
    file.write_u16_le(0);
    file.write_u32_le(payload_length);
    file.write_u32_le(format::crc32(&payload.bytes));
    file.write(&payload.bytes);
    Ok(file.bytes)
}

// MARK: Nodes

fn write_node(node: &StoryNode, writer: &mut ByteWriter, context: &mut Context) -> u8 {
    writer.write_count(context.string(&node.id));
    writer.write_int(canvas_coordinate(node.position.x));
    writer.write_int(canvas_coordinate(node.position.y));
    match &node.music {
        MusicCue::Keep => writer.write_u8(0),
        MusicCue::Stop => writer.write_u8(1),
        MusicCue::Play { track_id } => {
            writer.write_u8(2);
            writer.write_count(context.string(track_id));
        }
    }

    match &node.kind {
        NodeKind::Entrance(entrance) => {
            // `text` title, background, intro; setting; `ref` hero character; `text` quest title, objective;
            // `int` start day, start phase.
            write_text(&entrance.title, writer, context);
            write_text(&entrance.background, writer, context);
            write_text(&entrance.intro, writer, context);
            write_legacy_setting(writer);
            writer.write_count(context.string(&entrance.hero_id));
            write_text(&entrance.quest.title, writer, context);
            write_text(&entrance.quest.objective, writer, context);
            writer.write_int(entrance.start_day);
            writer.write_int(entrance.start_phase);
            node_tag::ENTRANCE
        }
        NodeKind::Narration(narration) => {
            // Setting; `text` presence, title, body, quote.
            write_legacy_setting(writer);
            for text in [&narration.presence, &narration.title, &narration.body, &narration.quote] {
                write_text(text, writer, context);
            }
            node_tag::NARRATION
        }
        NodeKind::Choice(choice) => {
            // Setting; `text` presence, title, body, quote; `varuint` option count, then options.
            write_legacy_setting(writer);
            for text in [&choice.presence, &choice.title, &choice.body, &choice.quote] {
                write_text(text, writer, context);
            }
            writer.write_count(choice.options.len());
            for option in &choice.options {
                write_choice(option, writer, context);
            }
            node_tag::CHOICE
        }
        NodeKind::Check(check) => {
            // Setting; `text` title, body; target (`u8` 0 then `u8` characteristic, or `u8` 1 then `ref` skill id);
            // `u8` difficulty.
            write_legacy_setting(writer);
            write_text(&check.title, writer, context);
            write_text(&check.body, writer, context);
            match &check.target {
                CheckTarget::Characteristic { characteristic } => {
                    writer.write_u8(0);
                    writer.write_u8(*characteristic as u8);
                }
                CheckTarget::Skill { skill_id } => {
                    writer.write_u8(1);
                    writer.write_count(context.string(skill_id));
                }
            }
            writer.write_u8(check.difficulty as u8);
            node_tag::CHECK
        }
        NodeKind::Battle(battle) => {
            // Setting; `text` presence, title, body; `ref` enemy character.
            write_legacy_setting(writer);
            for text in [&battle.presence, &battle.title, &battle.body] {
                write_text(text, writer, context);
            }
            writer.write_count(context.string(&battle.enemy_id));
            node_tag::BATTLE
        }
        NodeKind::End(end) => {
            // `text` title, body, quote; `u8` outcome.
            for text in [&end.title, &end.body, &end.quote] {
                write_text(text, writer, context);
            }
            writer.write_u8(end.outcome as u8);
            node_tag::END
        }
        NodeKind::ChapterStart(start) => {
            // Setting; `text` body, quote.
            write_legacy_setting(writer);
            write_text(&start.body, writer, context);
            write_text(&start.quote, writer, context);
            node_tag::CHAPTER_START
        }
        NodeKind::ChapterJump(jump) => {
            // `ref` target chapter.
            writer.write_count(context.string(&jump.target_chapter_id));
            node_tag::CHAPTER_JUMP
        }
        NodeKind::Event(event) => {
            // `text` title, body, quote; `ref` event; `u8` occurrence; trigger.
            for text in [&event.title, &event.body, &event.quote] {
                write_text(text, writer, context);
            }
            writer.write_count(context.string(&event.event_id));
            writer.write_u8(event.occurrence as u8);
            let trigger = &event.trigger;
            writer.write_u8(trigger.mode as u8);
            writer.write_int(trigger.chance);
            writer.write_bool(trigger.requires_all);
            writer.write_count(trigger.conditions.len());
            for condition in &trigger.conditions {
                writer.write_count(context.string(&condition.id));
                writer.write_u8(condition.characteristic as u8);
                writer.write_u8(condition.comparison as u8);
                writer.write_int(condition.value);
            }
            writer.write_count(context.string(&trigger.prior_event_id));
            node_tag::EVENT
        }
    }
}

/// Canvas positions are stored as whole points; clamping keeps a stray infinity or NaN from causing trouble.
fn canvas_coordinate(value: f64) -> i64 {
    if !value.is_finite() {
        return 0;
    }
    value.clamp(-1_000_000.0, 1_000_000.0).round() as i64
}

/// The legacy setting slot (`text` region, location, chapter, part), always empty: four zero-translation texts.
fn write_legacy_setting(writer: &mut ByteWriter) {
    for _ in 0..4 {
        writer.write_count(0);
    }
}

/// Item: `ref` id, `text` name, `text` description, `ref` symbol name, `u8` category, `int` bonus damage, `int`
/// armor, `int` weight in hundredths, `int` value, `ref` weapon skill id, damage (`int` count, sides, bonus), `bool`
/// adds damage bonus, `bool` impales. New attributes go at the end.
fn write_item(item: &Item, writer: &mut ByteWriter, context: &mut Context) {
    writer.write_count(context.string(&item.id));
    write_text(&item.name, writer, context);
    write_text(&item.detail, writer, context);
    writer.write_count(context.string(&item.symbol));
    writer.write_u8(item.category as u8);
    writer.write_int(item.attack);
    writer.write_int(item.defense);
    writer.write_int(hundredths(item.weight));
    writer.write_int(item.value);
    writer.write_count(context.string(&item.skill_id));
    write_damage(&item.damage, writer);
    writer.write_bool(item.adds_damage_bonus);
    writer.write_bool(item.impales);
}

fn write_damage(damage: &DamageRoll, writer: &mut ByteWriter) {
    writer.write_int(damage.count);
    writer.write_int(damage.sides);
    writer.write_int(damage.bonus);
}

/// Skill: `ref` id; `text` name, description; `ref` symbol; `u8` group; base (`u8` 0 then `int` value, or 1 then
/// `u8` characteristic and `int` divisor); `bool` takes specialty, uncommon, buyable at creation, wealth; combat use as
/// `u8` 0 none, 1 weapon (`u8` range 0 melee / 1 ranged, `bool` bare-handed, then its damage if so), 2 dodge, or
/// 3 ability (`u8` effect 0 damage / 1 heal, damage, `bool` adds damage bonus, pierces armor, dodgeable, `u8` target
/// 0 enemy / 1 all enemies / 2 self, `int` MP, HP, stamina, and sanity cost).
fn write_skill(skill: &StorySkill, writer: &mut ByteWriter, context: &mut Context) {
    writer.write_count(context.string(&skill.id));
    write_text(&skill.name, writer, context);
    write_text(&skill.detail, writer, context);
    writer.write_count(context.string(&skill.symbol));
    writer.write_u8(skill.group as u8);
    match &skill.base {
        SkillBase::Fixed { value } => {
            writer.write_u8(0);
            writer.write_int(*value);
        }
        SkillBase::Characteristic { characteristic, divisor } => {
            writer.write_u8(1);
            writer.write_u8(*characteristic as u8);
            writer.write_int(*divisor);
        }
    }
    for flag in [skill.takes_specialty, skill.is_uncommon, skill.at_creation, skill.is_wealth] {
        writer.write_bool(flag);
    }
    match &skill.combat {
        SkillCombat::None => writer.write_u8(0),
        SkillCombat::Weapon { range, unarmed } => {
            writer.write_u8(1);
            writer.write_u8(*range as u8);
            writer.write_bool(unarmed.is_some());
            if let Some(damage) = unarmed {
                write_damage(damage, writer);
            }
        }
        SkillCombat::Dodge => writer.write_u8(2),
        SkillCombat::Ability { ability } => {
            writer.write_u8(3);
            writer.write_u8(ability.effect as u8);
            write_damage(&ability.amount, writer);
            for flag in [ability.adds_damage_bonus, ability.pierces_armor, ability.dodgeable] {
                writer.write_bool(flag);
            }
            writer.write_u8(ability.target as u8);
            for cost in [ability.cost.mp, ability.cost.hp, ability.cost.stamina, ability.cost.sanity] {
                writer.write_int(cost);
            }
        }
    }
}

/// Occupation: `ref` id; `text` name, description; `ref` symbol; `int` lowest and highest wealth; point terms
/// (`varuint` count, then `int` multiplier and `varuint` count of `u8` characteristics, the best of which is used);
/// skill slots (`varuint` count, then `u8` 0 skill with `ref` skill id and `text` specialty, 1 one of with a
/// `varuint` count of `ref` skill ids, 2 group with `u8` group and `int` count, or 3 any with `int` count).
fn write_occupation(occupation: &StoryOccupation, writer: &mut ByteWriter, context: &mut Context) {
    writer.write_count(context.string(&occupation.id));
    write_text(&occupation.name, writer, context);
    write_text(&occupation.detail, writer, context);
    writer.write_count(context.string(&occupation.symbol));
    writer.write_int(occupation.wealth[0]);
    writer.write_int(occupation.wealth[1]);
    writer.write_count(occupation.points.len());
    for term in &occupation.points {
        writer.write_int(term.multiplier);
        writer.write_count(term.characteristics.len());
        for characteristic in &term.characteristics {
            writer.write_u8(*characteristic as u8);
        }
    }
    writer.write_count(occupation.slots.len());
    for slot in &occupation.slots {
        match slot {
            OccupationSlot::Skill { skill_id, specialty } => {
                writer.write_u8(0);
                writer.write_count(context.string(skill_id));
                write_text(specialty, writer, context);
            }
            OccupationSlot::OneOf { skill_ids } => {
                writer.write_u8(1);
                writer.write_count(skill_ids.len());
                for id in skill_ids {
                    writer.write_count(context.string(id));
                }
            }
            OccupationSlot::Group { group, count } => {
                writer.write_u8(2);
                writer.write_u8(*group as u8);
                writer.write_int(*count);
            }
            OccupationSlot::Any { count } => {
                writer.write_u8(3);
                writer.write_int(*count);
            }
        }
    }
}

/// Monster: `ref` id; `text` name, description; `ref` symbol name; `int` STR, CON, SIZ, DEX, POW, hit points,
/// fighting; `text` attack name; damage (`int` count, sides, bonus); `bool` adds damage bonus, impales; `int`
/// attacks per round, dodge, armor, XP reward, gold reward. New attributes go at the end.
fn write_monster(monster: &StoryMonster, writer: &mut ByteWriter, context: &mut Context) {
    writer.write_count(context.string(&monster.id));
    write_text(&monster.name, writer, context);
    write_text(&monster.detail, writer, context);
    writer.write_count(context.string(&monster.symbol));
    for value in [
        monster.strength,
        monster.constitution,
        monster.size,
        monster.dexterity,
        monster.power,
        monster.hit_points,
        monster.fighting,
    ] {
        writer.write_int(value);
    }
    write_text(&monster.attack_name, writer, context);
    write_damage(&monster.damage, writer);
    writer.write_bool(monster.adds_damage_bonus);
    writer.write_bool(monster.impales);
    for value in [monster.attacks_per_round, monster.dodge, monster.armor, monster.xp_reward, monster.gold_reward] {
        writer.write_int(value);
    }
}

/// Fractional quantities such as weight are stored as whole hundredths.
fn hundredths(value: f64) -> i64 {
    if !value.is_finite() {
        return 0;
    }
    (value.clamp(0.0, 1_000_000.0) * 100.0).round() as i64
}

/// Character: `ref` id; `text` name, lineage, calling, summary; `ref` symbol name; `int` level, age, stamina, ap,
/// xp, xpToNext, gold, minDamage, maxDamage, xpReward, goldReward; `int` × 9 characteristics in `Characteristic`
/// order (STR, DEX, SIZ, APP, CON, INT, POW, EDU, LUC); `ref` occupation id (empty for custom); skills (`varuint`
/// count, then `ref` entry id, `ref` skill id, `text` specialty, `int` occupation points, `int` personal points);
/// starting items (`varuint` count of `ref` item ids); status effects (`varuint` count, then `ref` id, `text` name,
/// `ref` symbol name, `int` turns remaining); `int` carry capacity in hundredths. New attributes go at the end.
fn write_character(character: &StoryCharacter, writer: &mut ByteWriter, context: &mut Context) {
    writer.write_count(context.string(&character.id));
    for text in [&character.name, &character.lineage, &character.calling, &character.summary] {
        write_text(text, writer, context);
    }
    writer.write_count(context.string(&character.symbol));
    for value in [
        character.level,
        character.age,
        character.stamina,
        character.ap,
        character.xp,
        character.xp_to_next,
        character.gold,
        character.min_damage,
        character.max_damage,
        character.xp_reward,
        character.gold_reward,
    ] {
        writer.write_int(value);
    }
    for characteristic in Characteristic::ALL {
        writer.write_int(character.characteristics.get(characteristic));
    }
    writer.write_count(context.string(&character.occupation_id));
    writer.write_count(character.skills.len());
    for skill in &character.skills {
        writer.write_count(context.string(&skill.id));
        writer.write_count(context.string(&skill.skill_id));
        write_text(&skill.specialty, writer, context);
        writer.write_int(skill.occupation_points);
        writer.write_int(skill.personal_points);
    }

    writer.write_count(character.item_ids.len());
    for id in &character.item_ids {
        writer.write_count(context.string(id));
    }

    writer.write_count(character.effects.len());
    for effect in &character.effects {
        writer.write_count(context.string(&effect.id));
        write_text(&effect.name, writer, context);
        writer.write_count(context.string(&effect.symbol));
        writer.write_int(effect.turns_remaining);
    }
    writer.write_int(hundredths(character.carry_capacity));
}

/// Option: `ref` id; `text` title, detail; `ref` symbol name; `text` tag; `int` AP cost; effect (`int` hp, mp,
/// stamina, xp, gold, sanity; `bool` passes time; `text` objective, empty for none; `varuint` count of gained `ref`
/// item ids; `varuint` count of lost `ref` item ids). The option's id is also its output port.
fn write_choice(choice: &Choice, writer: &mut ByteWriter, context: &mut Context) {
    writer.write_count(context.string(&choice.id));
    write_text(&choice.title, writer, context);
    write_text(&choice.detail, writer, context);
    writer.write_count(context.string(&choice.symbol));
    write_text(&choice.tag, writer, context);
    writer.write_int(choice.ap_cost);

    let effect = &choice.effect;
    for value in [effect.hp, effect.mp, effect.stamina, effect.xp, effect.gold, effect.sanity] {
        writer.write_int(value);
    }
    writer.write_bool(effect.passes_time);
    write_text(effect.objective.as_ref().unwrap_or(&StoryText::default()), writer, context);
    for ids in [&effect.gain_items, &effect.lose_items] {
        writer.write_count(ids.len());
        for id in ids {
            writer.write_count(context.string(id));
        }
    }
}

// MARK: Text

fn write_text(text: &StoryText, writer: &mut ByteWriter, context: &mut Context) {
    writer.write_count(text.0.len());
    for translation in &text.0 {
        writer.write_count(context.language(&translation.language));
        writer.write_count(context.string(&translation.value));
    }
}

// MARK: Pools

/// Interns languages and strings so each distinct value is stored once.
#[derive(Default)]
struct Context {
    languages: Vec<String>,
    strings: Vec<String>,
    language_indices: HashMap<String, usize>,
    string_indices: HashMap<String, usize>,
}

impl Context {
    fn language(&mut self, identifier: &str) -> usize {
        intern(identifier, &mut self.languages, &mut self.language_indices)
    }

    fn string(&mut self, value: &str) -> usize {
        intern(value, &mut self.strings, &mut self.string_indices)
    }
}

fn intern(value: &str, pool: &mut Vec<String>, indices: &mut HashMap<String, usize>) -> usize {
    if let Some(&index) = indices.get(value) {
        return index;
    }
    pool.push(value.to_string());
    indices.insert(value.to_string(), pool.len() - 1);
    pool.len() - 1
}

#[cfg(test)]
mod tests {
    use super::super::decoder;

    /// The bundled story decodes, and re-encoding it reproduces the original bytes exactly.
    #[test]
    fn bundled_story_round_trips() {
        let file = std::fs::File::open(concat!(env!("CARGO_MANIFEST_DIR"), "/stories/RebirthInParadise.rpstory")).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut original = vec![];
        std::io::Read::read_to_end(&mut archive.by_name("story.bin").unwrap(), &mut original).unwrap();

        let story = decoder::decode(&original).unwrap();
        assert_eq!(story.nodes.len(), 239);
        let encoded = super::encode(&story).unwrap();
        assert_eq!(decoder::decode(&encoded).unwrap(), story);
        assert_eq!(encoded, original, "re-encoding should be byte-for-byte identical");
    }

    /// A story's own skill and occupation sheets survive a round trip, in every variant.
    #[test]
    fn skill_and_occupation_sheets_round_trip() {
        use super::super::model::*;
        let file = std::fs::File::open(concat!(env!("CARGO_MANIFEST_DIR"), "/stories/RebirthInParadise.rpstory")).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut original = vec![];
        std::io::Read::read_to_end(&mut archive.by_name("story.bin").unwrap(), &mut original).unwrap();
        let mut story = decoder::decode(&original).unwrap();
        assert!(story.skills.is_none() && story.occupations.is_none(), "the bundled story uses the built-in catalog");

        let text = |value: &str| StoryText(vec![Translation { language: "en".into(), value: value.into() }]);
        let skill = |id: &str, combat: SkillCombat, base: SkillBase| StorySkill {
            id: id.into(),
            name: text(id),
            detail: text("detail"),
            symbol: "flame.fill".into(),
            group: SkillGroup::Magic,
            base,
            takes_specialty: id == "lore",
            is_uncommon: true,
            at_creation: false,
            is_wealth: id == "wealth",
            combat,
        };
        let d6 = DamageRoll { count: 2, sides: 6, bonus: 1 };
        story.skills = Some(vec![
            skill("lore", SkillCombat::None, SkillBase::Fixed { value: 5 }),
            skill("brawl", SkillCombat::Weapon { range: WeaponRange::Melee, unarmed: Some(d6) }, SkillBase::Fixed { value: 25 }),
            skill("bow", SkillCombat::Weapon { range: WeaponRange::Ranged, unarmed: None }, SkillBase::Fixed { value: 15 }),
            skill("dodge", SkillCombat::Dodge, SkillBase::Characteristic { characteristic: Characteristic::Dexterity, divisor: 2 }),
            skill(
                "fireball",
                SkillCombat::Ability {
                    ability: SkillAbility {
                        effect: AbilityEffect::Damage,
                        amount: d6,
                        adds_damage_bonus: false,
                        pierces_armor: true,
                        dodgeable: true,
                        target: AbilityTarget::AllEnemies,
                        cost: AbilityCost { mp: 4, hp: 0, stamina: 5, sanity: 1 },
                    },
                },
                SkillBase::Characteristic { characteristic: Characteristic::Power, divisor: 5 },
            ),
            skill(
                "mend",
                SkillCombat::Ability {
                    ability: SkillAbility {
                        effect: AbilityEffect::Heal,
                        amount: d6,
                        adds_damage_bonus: false,
                        pierces_armor: false,
                        dodgeable: false,
                        target: AbilityTarget::User,
                        cost: AbilityCost::default(),
                    },
                },
                SkillBase::Fixed { value: 1 },
            ),
        ]);
        story.occupations = Some(vec![StoryOccupation {
            id: "mage".into(),
            name: text("Mage"),
            detail: StoryText::default(),
            symbol: "sparkles".into(),
            wealth: [10, 40],
            points: vec![
                PointTerm { characteristics: vec![Characteristic::Education], multiplier: 2 },
                PointTerm { characteristics: vec![Characteristic::Power, Characteristic::Intelligence], multiplier: 2 },
            ],
            slots: vec![
                OccupationSlot::Skill { skill_id: "fireball".into(), specialty: text("Fire") },
                OccupationSlot::OneOf { skill_ids: vec!["bow".into(), "brawl".into()] },
                OccupationSlot::Group { group: SkillGroup::Magic, count: 2 },
                OccupationSlot::Any { count: 1 },
            ],
        }]);
        let encoded = super::encode(&story).unwrap();
        assert_eq!(decoder::decode(&encoded).unwrap(), story);

        let json = serde_json::to_value(&story).unwrap();
        assert_eq!(json["skills"][5]["combat"]["ability"]["target"], "self");
        assert_eq!(serde_json::from_value::<Story>(json).unwrap(), story);
    }

    /// An event's other changes and its time trigger survive a round trip.
    #[test]
    fn event_extension_round_trips() {
        use super::super::model::{NodeKind, TriggerMode};
        let file = std::fs::File::open(concat!(env!("CARGO_MANIFEST_DIR"), "/stories/RebirthInParadise.rpstory")).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut original = vec![];
        std::io::Read::read_to_end(&mut archive.by_name("story.bin").unwrap(), &mut original).unwrap();

        let mut story = decoder::decode(&original).unwrap();
        let event = story
            .nodes
            .iter_mut()
            .find_map(|n| if let NodeKind::Event(e) = &mut n.kind { Some(e) } else { None })
            .unwrap();
        event.trigger.mode = TriggerMode::Time;
        event.trigger.earliest_day = 2;
        event.trigger.latest_day = 4;
        event.trigger.phases = vec![3, 4];
        (event.mp, event.stamina, event.sanity, event.gold, event.xp) = (-1, -10, -5, 20, 15);
        let encoded = super::encode(&story).unwrap();
        assert_eq!(decoder::decode(&encoded).unwrap(), story);
    }
}
