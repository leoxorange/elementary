//! The story model: a graph of nodes wired together, plus the sheets the nodes refer to.
//!
//! These types travel to the frontend as JSON (camelCase field names); the frontend holds the game rules and the
//! designer, and this side reads and writes `.rpstory` packages. Only the rules the codec itself needs (output
//! ports, arriving locations for legacy migration) are repeated here.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// A piece of story text with its translations. The first translation is the story's source language and is used
/// whenever no better match exists.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(transparent)]
pub struct StoryText(pub Vec<Translation>);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Translation {
    /// A BCP 47 language identifier such as `en` or `zh-Hans`.
    pub language: String,
    pub value: String,
}

impl StoryText {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// True when no translation has any visible characters.
    pub fn is_blank(&self) -> bool {
        self.0.iter().all(|t| t.value.trim().is_empty())
    }

    pub fn languages(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|t| t.language.as_str())
    }

    pub fn get(&self, language: &str) -> Option<&str> {
        self.0.iter().find(|t| t.language == language).map(|t| t.value.as_str())
    }

    pub fn set(&mut self, language: &str, value: String) {
        match self.0.iter_mut().find(|t| t.language == language) {
            Some(existing) => existing.value = value,
            None => self.0.push(Translation { language: language.to_string(), value }),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    pub id: String,
    pub author: String,
    pub chapters: Vec<Chapter>,
    pub nodes: Vec<StoryNode>,
    pub links: Vec<StoryLink>,
    pub characters: Vec<StoryCharacter>,
    pub items: Vec<Item>,
    pub monsters: Vec<StoryMonster>,
    pub locations: Vec<StoryLocation>,
    pub events: Vec<StoryEvent>,
    pub routes: Vec<LocationRoute>,
    pub tracks: Vec<MusicTrack>,
}

impl Story {
    pub fn entrance(&self) -> Option<&EntranceNode> {
        self.nodes.iter().find_map(|node| match &node.kind {
            NodeKind::Entrance(entrance) => Some(entrance),
            _ => None,
        })
    }

    pub fn title(&self) -> StoryText {
        self.entrance().map(|e| e.title.clone()).unwrap_or_default()
    }

    pub fn location(&self, id: &str) -> Option<&StoryLocation> {
        self.locations.iter().find(|l| l.id == id)
    }

    pub fn start_node(&self, chapter_id: &str) -> Option<&StoryNode> {
        self.nodes
            .iter()
            .find(|n| n.chapter_id == chapter_id && matches!(n.kind, NodeKind::ChapterStart(_)))
    }

    /// For every node, the locations the hero can be at when play arrives there: the location of the nearest
    /// node before it, or the destination of the choice option taken, along every branch that leads in.
    pub fn arriving_locations(&self) -> HashMap<String, BTreeSet<String>> {
        let mut nodes_by_id: HashMap<&str, &StoryNode> = HashMap::new();
        for node in &self.nodes {
            nodes_by_id.entry(node.id.as_str()).or_insert(node);
        }
        let mut successors: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
        for link in &self.links {
            successors.entry(link.from_node.as_str()).or_default().push((link.to_node.as_str(), link.from_port.as_str()));
        }
        for node in &self.nodes {
            if let NodeKind::ChapterJump(jump) = &node.kind {
                if let Some(start) = self.start_node(&jump.target_chapter_id) {
                    successors.entry(node.id.as_str()).or_default().push((start.id.as_str(), ""));
                }
            }
        }
        let location_ids: BTreeSet<&str> = self.locations.iter().map(|l| l.id.as_str()).collect();

        // Propagate until nothing changes. Sets only grow and are bounded by the location sheet, so this ends.
        let mut arriving: HashMap<String, BTreeSet<String>> = HashMap::new();
        let mut queue: Vec<&StoryNode> = self.nodes.iter().collect();
        while let Some(node) = queue.pop() {
            let here: BTreeSet<String> = if node.kind.has_location() && location_ids.contains(node.location_id.as_str()) {
                [node.location_id.clone()].into()
            } else {
                arriving.get(&node.id).cloned().unwrap_or_default()
            };
            for &(next, port) in successors.get(node.id.as_str()).map(Vec::as_slice).unwrap_or(&[]) {
                // A choice option that travels somewhere leaves from its destination instead.
                let mut leaving = here.clone();
                if let NodeKind::Choice(choice) = &node.kind {
                    if let Some(destination) = choice.options.iter().find(|o| o.id == port).and_then(|o| o.effect.move_to.as_ref()) {
                        if location_ids.contains(destination.as_str()) {
                            leaving = [destination.clone()].into();
                        }
                    }
                }
                if leaving.is_empty() {
                    continue;
                }
                let before = arriving.entry(next.to_string()).or_default();
                let count = before.len();
                before.extend(leaving);
                if before.len() != count {
                    if let Some(successor) = nodes_by_id.get(next) {
                        queue.push(successor);
                    }
                }
            }
        }
        arriving
    }
}

/// A section of the story with its own node map.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: StoryText,
    pub subtitle: StoryText,
    pub summary: StoryText,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryNode {
    pub id: String,
    pub chapter_id: String,
    pub position: CanvasPoint,
    pub music: MusicCue,
    pub location_id: String,
    pub kind: NodeKind,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct CanvasPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MusicCue {
    Keep,
    Stop,
    Play {
        #[serde(rename = "trackId")]
        track_id: String,
    },
}

/// A piece of background music embedded in the story package. The audio itself stays on disk (see `TrackStore`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrack {
    pub id: String,
    pub name: String,
    pub file_extension: String,
    /// The audio's size in bytes.
    #[serde(default)]
    pub size: u64,
}

impl MusicTrack {
    /// Where the track lives inside a package, e.g. `music/3f2a91c0.m4a`.
    pub fn package_path(&self) -> String {
        let safe_id = if self.id.chars().all(|c| c.is_alphanumeric() || c == '-') {
            self.id.clone()
        } else {
            percent_encode_alphanumerics(&self.id)
        };
        let safe_extension = if self.file_extension.chars().all(char::is_alphanumeric) {
            self.file_extension.clone()
        } else {
            "audio".to_string()
        };
        format!("music/{safe_id}.{safe_extension}")
    }
}

/// Percent-encodes everything except alphanumerics, like Foundation's `addingPercentEncoding(.alphanumerics)`.
pub fn percent_encode_alphanumerics(value: &str) -> String {
    let mut encoded = String::new();
    for c in value.chars() {
        if c.is_alphanumeric() {
            encoded.push(c);
        } else {
            let mut buffer = [0u8; 4];
            for byte in c.encode_utf8(&mut buffer).bytes() {
                encoded.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    encoded
}

/// A wire from one node's output port to another node's input.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct StoryLink {
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NodeKind {
    Entrance(EntranceNode),
    Narration(NarrationNode),
    Choice(ChoiceNode),
    Check(CheckNode),
    Battle(BattleNode),
    End(EndNode),
    ChapterStart(ChapterStartNode),
    ChapterJump(ChapterJumpNode),
    Event(EventNode),
}

pub mod port {
    pub const NEXT: &str = "next";
    pub const SUCCESS: &str = "success";
    pub const FAILURE: &str = "failure";
    pub const VICTORY: &str = "victory";
    pub const DEFEAT: &str = "defeat";
    pub const HAPPENS: &str = "happens";
    pub const OTHERWISE: &str = "otherwise";
    pub const DEATH: &str = "death";
}

impl NodeKind {
    /// Entrances and chapter starts are where play begins, so nothing can be wired into them.
    pub fn has_input(&self) -> bool {
        !matches!(self, Self::Entrance(_) | Self::ChapterStart(_))
    }

    /// Checks happen wherever the hero already is, and Next Chapter nodes are never shown.
    pub fn has_location(&self) -> bool {
        !matches!(self, Self::Check(_) | Self::ChapterJump(_))
    }

    /// The IDs of this node's output ports, in display order.
    pub fn output_ports(&self) -> Vec<String> {
        let fixed = |ports: &[&str]| ports.iter().map(|p| p.to_string()).collect::<Vec<_>>();
        match self {
            Self::Entrance(_) | Self::Narration(_) | Self::ChapterStart(_) => fixed(&[port::NEXT]),
            Self::Choice(choice) => {
                let mut ports: Vec<String> = choice.options.iter().map(|o| o.id.clone()).collect();
                if choice.options.iter().any(|o| o.effect.hp < 0) {
                    ports.push(port::DEATH.into());
                }
                ports
            }
            Self::Check(_) => fixed(&[port::SUCCESS, port::FAILURE]),
            Self::Battle(_) => fixed(&[port::VICTORY, port::DEFEAT]),
            Self::Event(event) => {
                let mut ports = if event.occurrence == Occurrence::Eventually {
                    fixed(&[port::NEXT])
                } else {
                    fixed(&[port::HAPPENS, port::OTHERWISE])
                };
                if event.hp < 0 {
                    ports.push(port::DEATH.into());
                }
                ports
            }
            Self::End(_) | Self::ChapterJump(_) => vec![],
        }
    }

    /// The node's headline.
    pub fn title(&self) -> StoryText {
        match self {
            Self::Entrance(n) => n.title.clone(),
            Self::Narration(n) => n.title.clone(),
            Self::Choice(n) => n.title.clone(),
            Self::Check(n) => n.title.clone(),
            Self::Battle(n) => n.title.clone(),
            Self::End(n) => n.title.clone(),
            Self::Event(n) => n.title.clone(),
            Self::ChapterStart(_) | Self::ChapterJump(_) => StoryText::default(),
        }
    }
}

/// The place and chapter labels older story files stored on each node.
#[derive(Clone, Debug, Default)]
pub struct SceneSetting {
    pub region: StoryText,
    pub location: StoryText,
    pub chapter: StoryText,
    pub part: StoryText,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EntranceNode {
    pub title: StoryText,
    pub background: StoryText,
    pub intro: StoryText,
    pub hero_id: String,
    pub quest: Quest,
    pub start_day: i64,
    pub start_phase: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Quest {
    pub title: StoryText,
    pub objective: StoryText,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NarrationNode {
    pub presence: StoryText,
    pub title: StoryText,
    pub body: StoryText,
    pub quote: StoryText,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceNode {
    pub presence: StoryText,
    pub title: StoryText,
    pub body: StoryText,
    pub quote: StoryText,
    pub options: Vec<Choice>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub title: StoryText,
    pub detail: StoryText,
    pub symbol: String,
    pub tag: StoryText,
    pub ap_cost: i64,
    pub effect: Effect,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub hp: i64,
    pub mp: i64,
    pub stamina: i64,
    pub xp: i64,
    pub gold: i64,
    pub sanity: i64,
    pub passes_time: bool,
    pub objective: Option<StoryText>,
    pub gain_items: Vec<String>,
    pub lose_items: Vec<String>,
    pub move_to: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckNode {
    pub title: StoryText,
    pub body: StoryText,
    pub target: CheckTarget,
    pub difficulty: CheckDifficulty,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CheckTarget {
    Characteristic { characteristic: Characteristic },
    Skill {
        #[serde(rename = "skillId")]
        skill_id: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CheckDifficulty {
    Regular,
    Hard,
    Extreme,
}

impl CheckDifficulty {
    pub fn from_u8(value: u8) -> Option<Self> {
        [Self::Regular, Self::Hard, Self::Extreme].get(value as usize).copied()
    }
}

/// The nine characteristics, in file order.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Characteristic {
    Strength,
    Dexterity,
    Size,
    Appearance,
    Constitution,
    Intelligence,
    Power,
    Education,
    Luck,
}

impl Characteristic {
    pub const ALL: [Self; 9] = [
        Self::Strength,
        Self::Dexterity,
        Self::Size,
        Self::Appearance,
        Self::Constitution,
        Self::Intelligence,
        Self::Power,
        Self::Education,
        Self::Luck,
    ];

    pub fn from_u8(value: u8) -> Option<Self> {
        Self::ALL.get(value as usize).copied()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Characteristics {
    pub strength: i64,
    pub dexterity: i64,
    pub size: i64,
    pub appearance: i64,
    pub constitution: i64,
    pub intelligence: i64,
    pub power: i64,
    pub education: i64,
    pub luck: i64,
}

impl Default for Characteristics {
    fn default() -> Self {
        Self {
            strength: 50,
            dexterity: 50,
            size: 65,
            appearance: 50,
            constitution: 50,
            intelligence: 65,
            power: 50,
            education: 65,
            luck: 50,
        }
    }
}

impl Characteristics {
    pub fn get(&self, characteristic: Characteristic) -> i64 {
        match characteristic {
            Characteristic::Strength => self.strength,
            Characteristic::Dexterity => self.dexterity,
            Characteristic::Size => self.size,
            Characteristic::Appearance => self.appearance,
            Characteristic::Constitution => self.constitution,
            Characteristic::Intelligence => self.intelligence,
            Characteristic::Power => self.power,
            Characteristic::Education => self.education,
            Characteristic::Luck => self.luck,
        }
    }

    pub fn set(&mut self, characteristic: Characteristic, value: i64) {
        match characteristic {
            Characteristic::Strength => self.strength = value,
            Characteristic::Dexterity => self.dexterity = value,
            Characteristic::Size => self.size = value,
            Characteristic::Appearance => self.appearance = value,
            Characteristic::Constitution => self.constitution = value,
            Characteristic::Intelligence => self.intelligence = value,
            Characteristic::Power => self.power = value,
            Characteristic::Education => self.education = value,
            Characteristic::Luck => self.luck = value,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BattleNode {
    pub presence: StoryText,
    pub title: StoryText,
    pub body: StoryText,
    pub enemy_id: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DamageRoll {
    pub count: i64,
    pub sides: i64,
    pub bonus: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryMonster {
    pub id: String,
    pub name: StoryText,
    pub detail: StoryText,
    pub symbol: String,
    pub strength: i64,
    pub constitution: i64,
    pub size: i64,
    pub dexterity: i64,
    pub power: i64,
    pub hit_points: i64,
    pub fighting: i64,
    pub attack_name: StoryText,
    pub damage: DamageRoll,
    pub adds_damage_bonus: bool,
    pub impales: bool,
    pub attacks_per_round: i64,
    pub dodge: i64,
    pub armor: i64,
    pub xp_reward: i64,
    pub gold_reward: i64,
}

impl StoryMonster {
    pub fn new(id: String) -> Self {
        Self {
            id,
            name: StoryText::default(),
            detail: StoryText::default(),
            symbol: "pawprint.fill".into(),
            strength: 50,
            constitution: 50,
            size: 50,
            dexterity: 50,
            power: 50,
            hit_points: 10,
            fighting: 40,
            attack_name: StoryText::default(),
            damage: DamageRoll { count: 1, sides: 6, bonus: 0 },
            adds_damage_bonus: true,
            impales: false,
            attacks_per_round: 1,
            dodge: 25,
            armor: 0,
            xp_reward: 30,
            gold_reward: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChapterStartNode {
    pub body: StoryText,
    pub quote: StoryText,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChapterJumpNode {
    pub target_chapter_id: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Triumph,
    Neutral,
    Tragedy,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EndNode {
    pub title: StoryText,
    pub body: StoryText,
    pub quote: StoryText,
    pub outcome: Outcome,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryLocation {
    pub id: String,
    pub name: StoryText,
    pub region: StoryText,
    pub detail: StoryText,
    pub symbol: String,
    pub position: CanvasPoint,
}

/// A two-way road between two locations. The IDs are kept in sorted order, so a road has one representation
/// whichever end it was drawn from.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct LocationRoute {
    pub first: String,
    pub second: String,
}

impl LocationRoute {
    pub fn new(a: String, b: String) -> Self {
        if a <= b { Self { first: a, second: b } } else { Self { first: b, second: a } }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryEvent {
    pub id: String,
    pub name: StoryText,
    pub detail: StoryText,
    pub symbol: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Occurrence {
    Eventually,
    Perhaps,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventNode {
    pub title: StoryText,
    pub body: StoryText,
    pub quote: StoryText,
    pub event_id: String,
    pub occurrence: Occurrence,
    pub trigger: EventTrigger,
    /// Changes to the hero when the event happens.
    pub hp: i64,
    #[serde(default)]
    pub mp: i64,
    #[serde(default)]
    pub stamina: i64,
    #[serde(default)]
    pub sanity: i64,
    #[serde(default)]
    pub gold: i64,
    #[serde(default)]
    pub xp: i64,
}

impl EventNode {
    /// Whether the node uses anything beyond health and the original triggers, which files store after the health
    /// change. Nodes that don't are written exactly as before.
    pub fn has_extension(&self) -> bool {
        [self.mp, self.stamina, self.sanity, self.gold, self.xp].iter().any(|&v| v != 0)
            || self.trigger.earliest_day != 0
            || self.trigger.latest_day != 0
            || self.trigger.phases != all_phases()
    }
}

/// The number of times of day: Dawn, Morning, Midday, Dusk, Nightfall.
pub const PHASE_COUNT: u8 = 5;

pub fn all_phases() -> Vec<u8> {
    (0..PHASE_COUNT).collect()
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    Chance,
    Characteristics,
    PriorEvent,
    Time,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventTrigger {
    pub mode: TriggerMode,
    pub chance: i64,
    pub conditions: Vec<CharacteristicCondition>,
    pub requires_all: bool,
    pub prior_event_id: String,
    /// The first day the event can happen on, or 0 for no limit.
    #[serde(default)]
    pub earliest_day: i64,
    /// The last day the event can happen on, or 0 for no limit.
    #[serde(default)]
    pub latest_day: i64,
    /// The times of day (indices, in order) the event can happen at.
    #[serde(default = "all_phases")]
    pub phases: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Comparison {
    Over,
    Under,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CharacteristicCondition {
    pub id: String,
    pub characteristic: Characteristic,
    pub comparison: Comparison,
    pub value: i64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ItemCategory {
    Weapon,
    Armor,
    Trinket,
    Key,
}

impl ItemCategory {
    pub fn from_u8(value: u8) -> Option<Self> {
        [Self::Weapon, Self::Armor, Self::Trinket, Self::Key].get(value as usize).copied()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: StoryText,
    pub detail: StoryText,
    pub symbol: String,
    pub category: ItemCategory,
    pub attack: i64,
    pub defense: i64,
    pub weight: f64,
    pub value: i64,
    pub skill_id: String,
    pub damage: DamageRoll,
    pub adds_damage_bonus: bool,
    pub impales: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusEffect {
    pub id: String,
    pub name: StoryText,
    pub symbol: String,
    pub turns_remaining: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    pub id: String,
    pub skill_id: String,
    pub specialty: StoryText,
    pub occupation_points: i64,
    pub personal_points: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryCharacter {
    pub id: String,
    pub name: StoryText,
    pub lineage: StoryText,
    pub calling: StoryText,
    pub summary: StoryText,
    pub symbol: String,
    pub age: i64,
    pub characteristics: Characteristics,
    pub occupation_id: String,
    pub skills: Vec<SkillEntry>,
    pub level: i64,
    pub stamina: i64,
    pub ap: i64,
    pub xp: i64,
    pub xp_to_next: i64,
    pub gold: i64,
    pub item_ids: Vec<String>,
    pub carry_capacity: f64,
    pub effects: Vec<StatusEffect>,
    pub min_damage: i64,
    pub max_damage: i64,
    pub xp_reward: i64,
    pub gold_reward: i64,
}

impl StoryCharacter {
    pub fn new(id: String) -> Self {
        Self {
            id,
            name: StoryText::default(),
            lineage: StoryText::default(),
            calling: StoryText::default(),
            summary: StoryText::default(),
            symbol: "person.fill".into(),
            age: 25,
            characteristics: Characteristics::default(),
            occupation_id: String::new(),
            skills: vec![],
            level: 1,
            stamina: 50,
            ap: 3,
            xp: 0,
            xp_to_next: 100,
            gold: 0,
            item_ids: vec![],
            carry_capacity: 30.0,
            effects: vec![],
            min_damage: 4,
            max_damage: 9,
            xp_reward: 50,
            gold_reward: 0,
        }
    }
}

/// Base values of the weapon skills, which the decoder needs to migrate weapons from older files.
pub fn weapon_skill_base(skill_id: &str) -> Option<i64> {
    Some(match skill_id {
        "fightingBrawl" => 25,
        "fightingAxe" => 15,
        "fightingChainsaw" => 10,
        "fightingFlail" => 10,
        "fightingGarrote" => 15,
        "fightingSpear" => 20,
        "fightingSword" => 20,
        "fightingWhip" => 5,
        "firearmsHandgun" => 20,
        "firearmsRifle" => 25,
        "firearmsBow" => 15,
        "firearmsFlamethrower" => 10,
        "firearmsHeavyWeapons" => 10,
        "firearmsMachineGun" => 10,
        "firearmsSubmachineGun" => 15,
        _ => return None,
    })
}
