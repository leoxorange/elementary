// The story model, as the backend sends it. These mirror `src-tauri/src/story/model.rs`; the backend reads and
// writes `.rpstory` packages, and everything else (rules, play, design) happens here.

/// A piece of story text with its translations. The first translation is the story's source language and is used
/// whenever no better match exists. Empty means empty or “none”.
export type StoryText = Translation[];

export interface Translation {
  /// A BCP 47 language identifier such as `en` or `zh-Hans`.
  language: string;
  value: string;
}

/// A complete script: a graph of nodes wired together, the sheets the nodes refer to, and any music it embeds.
/// Play always begins at the single entrance node and follows links from one node's output to the next node's input.
export interface Story {
  /// A stable identifier for the script. Used to tell stories apart, not shown to players.
  id: string;
  author: string;
  /// The chapters, in reading order. Each node belongs to one; the sheets and music are shared by all.
  chapters: Chapter[];
  nodes: StoryNode[];
  links: StoryLink[];
  /// The character sheet: the hero, enemies, and anyone else nodes refer to.
  characters: StoryCharacter[];
  /// The item sheet: everything characters can carry or choices can hand out.
  items: Item[];
  /// The monster sheet: enemies that only need fighting stats, not a full character card.
  monsters: StoryMonster[];
  /// The location sheet: the places nodes can be set in.
  locations: StoryLocation[];
  /// The event sheet: things that can happen, recorded when an Event node fires.
  events: StoryEvent[];
  /// Two-way roads between locations on the location map.
  routes: LocationRoute[];
  tracks: MusicTrack[];
  /// The skill sheet, or `null` for the built-in catalog. A story only stores its own once it changes them.
  skills: StorySkill[] | null;
  /// The occupation sheet, or `null` for the built-in catalog.
  occupations: StoryOccupation[] | null;
}

// MARK: Skills and occupations

/// How skills are grouped on character sheets, and what an occupation's “N skills from a group” slots draw from.
export type SkillGroup = "combat" | "interpersonal" | "knowledge" | "perception" | "physical" | "technical" | "magic" | "other";

/// A skill's value before any points: a fixed number, or a characteristic divided by `divisor` (Dodge is DEX ÷ 2).
export type SkillBase = { type: "fixed"; value: number } | { type: "characteristic"; characteristic: Characteristic; divisor: number };

export type WeaponRange = "melee" | "ranged";

/// What one use of an ability costs.
export interface AbilityCost {
  mp: number;
  hp: number;
  stamina: number;
  sanity: number;
}

/// An action a skill grants by itself, like a spell: pay the cost, roll the skill, and on a success apply the effect.
export interface SkillAbility {
  effect: "damage" | "heal";
  /// Dice for the damage dealt or health restored.
  amount: DamageRoll;
  addsDamageBonus: boolean;
  /// Ignores armor, as fire or a curse would.
  piercesArmor: boolean;
  /// Whether the target can roll to dodge it.
  dodgeable: boolean;
  /// Who it affects. With one opponent, “all enemies” is that opponent.
  target: "enemy" | "allEnemies" | "self";
  cost: AbilityCost;
}

/// What a skill does in a fight.
export type SkillCombat =
  /// Only rolled by checks.
  | { type: "none" }
  /// Weapons use it. Melee attacks can be dodged or fought back; ranged ones can't, and act first. `unarmed` is the
  /// damage of attacking with it bare-handed, when that's possible (Fighting (Brawl)).
  | { type: "weapon"; range: WeaponRange; unarmed: DamageRoll | null }
  /// Rolled to get out of the way of attacks.
  | { type: "dodge" }
  | { type: "ability"; ability: SkillAbility };

/// An entry on a story's skill sheet.
export interface StorySkill {
  id: string;
  name: StoryText;
  detail: StoryText;
  symbol: string;
  group: SkillGroup;
  base: SkillBase;
  /// Taken with a specialty, such as Science (Biology).
  takesSpecialty: boolean;
  /// Only listed on a character sheet once the character has it.
  isUncommon: boolean;
  /// Whether points can go into it at character creation (Cthulhu Mythos can't).
  atCreation: boolean;
  /// Occupations set the range this skill must stay within, as with Credit Rating.
  isWealth: boolean;
  combat: SkillCombat;
}

/// One term of an occupation's skill point formula: the best of `characteristics`, times `multiplier`.
export interface PointTerm {
  characteristics: Characteristic[];
  multiplier: number;
}

/// One entry in an occupation's skill list.
export type OccupationSlot =
  | { type: "skill"; skillId: string; specialty: StoryText }
  | { type: "oneOf"; skillIds: string[] }
  | { type: "group"; group: SkillGroup; count: number }
  | { type: "any"; count: number };

/// An entry on a story's occupation sheet.
export interface StoryOccupation {
  id: string;
  name: StoryText;
  detail: StoryText;
  symbol: string;
  /// The range the wealth skill (Credit Rating) must stay within.
  wealth: [number, number];
  /// The occupation skill point formula, e.g. EDU × 2 + the better of DEX or STR × 2.
  points: PointTerm[];
  slots: OccupationSlot[];
}

/// A section of the story with its own node map.
export interface Chapter {
  id: string;
  title: StoryText;
  /// Shown next to the chapter title above every scene in the chapter, e.g. “The Hollow Calls”.
  subtitle: StoryText;
  /// A note about what happens in the chapter, for the designer.
  summary: StoryText;
}

export interface StoryNode {
  id: string;
  /// The chapter whose map the node is on.
  chapterId: string;
  /// Where the node sits on the designer canvas, in canvas points.
  position: CanvasPoint;
  /// What happens to the background music when play reaches this node.
  music: MusicCue;
  /// The location-sheet entry where the node takes place, or empty for none.
  locationId: string;
  kind: NodeKind;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export type MusicCue = { type: "keep" } | { type: "stop" } | { type: "play"; trackId: string };

/// A piece of background music embedded in the story package. The audio stays with the backend.
export interface MusicTrack {
  id: string;
  /// The original file name, shown in the designer.
  name: string;
  fileExtension: string;
  /// The audio's size in bytes.
  size: number;
}

/// A wire from one node's output port to another node's input. Each output port leads to exactly one place, while
/// an input can receive many wires, so branches can merge or loop.
export interface StoryLink {
  fromNode: string;
  fromPort: string;
  toNode: string;
}

export type NodeKind =
  | ({ type: "entrance" } & EntranceNode)
  | ({ type: "narration" } & NarrationNode)
  | ({ type: "choice" } & ChoiceNode)
  | ({ type: "check" } & CheckNode)
  | ({ type: "battle" } & BattleNode)
  | ({ type: "end" } & EndNode)
  | ({ type: "chapterStart" } & ChapterStartNode)
  | ({ type: "chapterJump" } & ChapterJumpNode)
  | ({ type: "event" } & EventNode);

export type NodeType = NodeKind["type"];

/// Where every story starts: the title, the world, the opening, and the hero.
export interface EntranceNode {
  title: StoryText;
  /// The world and situation, shown on the prologue page.
  background: StoryText;
  /// The opening narration, shown under the background.
  intro: StoryText;
  /// The character-sheet entry the player controls.
  heroId: string;
  quest: Quest;
  startDay: number;
  /// Index into the game's times of day (dawn through nightfall).
  startPhase: number;
}

export interface Quest {
  title: StoryText;
  objective: StoryText;
}

/// A passage of text with a single way forward.
export interface NarrationNode {
  presence: StoryText;
  title: StoryText;
  /// Paragraphs are separated by blank lines.
  body: StoryText;
  quote: StoryText;
}

/// A scene where the player picks one of several actions. Each option is its own output port.
export interface ChoiceNode {
  presence: StoryText;
  title: StoryText;
  body: StoryText;
  quote: StoryText;
  options: Choice[];
}

/// An option on a choice node. Actions with an `apCost` of 0 are free.
export interface Choice {
  id: string;
  title: StoryText;
  detail: StoryText;
  /// An SF Symbol name shown next to the option.
  symbol: string;
  tag: StoryText;
  apCost: number;
  effect: Effect;
}

/// Changes applied to the hero when a choice is made.
export interface Effect {
  hp: number;
  mp: number;
  stamina: number;
  xp: number;
  gold: number;
  /// Sanity gained or (usually) lost.
  sanity: number;
  /// When true, choosing this action lets time pass: the clock moves on, and the hero gets their action points back
  /// and recovers a little.
  passesTime: boolean;
  /// Replaces the current quest objective when set.
  objective: StoryText | null;
  /// Item-sheet IDs added to the hero's pack.
  gainItems: string[];
  /// Item-sheet IDs taken from the hero. A choice that takes an item is only available while the hero has it.
  loseItems: string[];
  /// The location-sheet entry the hero travels to, or `null` to stay put.
  moveTo: string | null;
}

/// A percentile roll: d100 against a characteristic or skill at a difficulty, leading to success or failure.
export interface CheckNode {
  title: StoryText;
  body: StoryText;
  target: CheckTarget;
  /// Regular needs the full value, Hard half, Extreme a fifth.
  difficulty: CheckDifficulty;
}

export type CheckTarget =
  | { type: "characteristic"; characteristic: Characteristic }
  /// A skill catalog ID. For skills with specialties, the character's best one is used.
  | { type: "skill"; skillId: string };

export type CheckDifficulty = "regular" | "hard" | "extreme";

export type Characteristic =
  | "strength"
  | "dexterity"
  | "size"
  | "appearance"
  | "constitution"
  | "intelligence"
  | "power"
  | "education"
  | "luck";

export type Characteristics = Record<Characteristic, number>;

/// A fight that lasts until either the hero or the enemy falls.
export interface BattleNode {
  presence: StoryText;
  title: StoryText;
  body: StoryText;
  /// The character- or monster-sheet entry the hero fights.
  enemyId: string;
}

/// Dice for damage, such as 1D3, 1D8 + 1, or 2D6.
export interface DamageRoll {
  count: number;
  sides: number;
  bonus: number;
}

/// An entry on the monster sheet: just what a fight needs.
export interface StoryMonster {
  id: string;
  name: StoryText;
  /// What it is, for the designer.
  detail: StoryText;
  symbol: string;
  strength: number;
  constitution: number;
  size: number;
  dexterity: number;
  power: number;
  hitPoints: number;
  /// The chance to hit with its attack, and to fight back when attacked.
  fighting: number;
  /// What the attack is called in the battle log, such as “Claw”.
  attackName: StoryText;
  damage: DamageRoll;
  /// Whether the damage bonus from STR + SIZ is added to the attack.
  addsDamageBonus: boolean;
  /// Piercing attacks (fangs, horns, spears) deal extra damage on an extreme success.
  impales: boolean;
  attacksPerRound: number;
  dodge: number;
  /// Subtracted from every hit it takes.
  armor: number;
  xpReward: number;
  goldReward: number;
}

/// Where play enters a chapter: the chapter's title card, with optional opening text.
export interface ChapterStartNode {
  body: StoryText;
  quote: StoryText;
}

/// Moves play to another chapter's start. Ends a branch the way an End node does, but the story goes on.
export interface ChapterJumpNode {
  targetChapterId: string;
}

export type Outcome = "triumph" | "neutral" | "tragedy";

/// Where a branch of the story finishes.
export interface EndNode {
  title: StoryText;
  body: StoryText;
  quote: StoryText;
  outcome: Outcome;
}

/// A place on the location sheet. Nodes set there show its name and region above the scene.
export interface StoryLocation {
  id: string;
  name: StoryText;
  /// The wider area the location is in, shown above its name. Empty keeps the previous region.
  region: StoryText;
  /// What the place is like, for the designer.
  detail: StoryText;
  symbol: string;
  /// Where the location sits on the designer's location map, in canvas points.
  position: CanvasPoint;
}

/// A two-way road between two locations, with the IDs in sorted order so a road has one representation.
export interface LocationRoute {
  first: string;
  second: string;
}

/// Something that can happen in the story, on the event sheet.
export interface StoryEvent {
  id: string;
  name: StoryText;
  /// What the event means, for the designer.
  detail: StoryText;
  symbol: string;
}

export type Occurrence = "eventually" | "perhaps";

/// A moment where an event from the event sheet may happen. When it does, its text is shown and the event is
/// recorded; when it doesn't, play passes straight on to the Doesn't Happen output without stopping.
export interface EventNode {
  title: StoryText;
  /// Shown when the event happens. Paragraphs are separated by blank lines.
  body: StoryText;
  quote: StoryText;
  /// The event-sheet entry this node makes happen.
  eventId: string;
  occurrence: Occurrence;
  /// What decides a Perhaps event. Ignored for Eventually.
  trigger: EventTrigger;
  /// Health gained or lost when the event happens. Damage that leaves the hero at 0 HP kills them.
  hp: number;
  /// The other changes to the hero when the event happens.
  mp: number;
  stamina: number;
  sanity: number;
  gold: number;
  xp: number;
}

export type TriggerMode = "chance" | "characteristics" | "priorEvent" | "time";

/// How a Perhaps event decides whether it happens. Every mode's settings are kept, so switching modes back and
/// forth in the designer doesn't lose them.
export interface EventTrigger {
  mode: TriggerMode;
  /// Percent chance, 0–100.
  chance: number;
  conditions: CharacteristicCondition[];
  /// Whether every condition must hold (and) or just one (or).
  requiresAll: boolean;
  priorEventId: string;
  /// For the time trigger: the first and last days it can happen on, 0 for no limit.
  earliestDay: number;
  latestDay: number;
  /// For the time trigger: the times of day it can happen at, as indices into the phases.
  phases: number[];
}

export type Comparison = "over" | "under";

/// A test of one characteristic, such as STR over 60.
export interface CharacteristicCondition {
  id: string;
  characteristic: Characteristic;
  comparison: Comparison;
  value: number;
}

export type ItemCategory = "weapon" | "armor" | "trinket" | "key";

/// An entry on a story's item sheet. Characters and choices refer to items by ID; the hero carries copies.
export interface Item {
  id: string;
  name: StoryText;
  /// A description of the item, shown in the pack.
  detail: StoryText;
  symbol: string;
  category: ItemCategory;
  /// Extra damage added to this weapon's hits.
  attack: number;
  /// Armor: subtracted from every hit the carrier takes in battle.
  defense: number;
  /// Counts toward how much a character can carry. Stored to two decimal places.
  weight: number;
  /// Worth in gold, for trading.
  value: number;
  /// For weapons, the Fighting or Firearms skill used to attack with it.
  skillId: string;
  damage: DamageRoll;
  /// Melee and thrown weapons add the wielder's damage bonus; firearms don't.
  addsDamageBonus: boolean;
  /// Bullets, blades, and spears deal extra damage on an extreme success.
  impales: boolean;
}

export interface StatusEffect {
  id: string;
  name: StoryText;
  symbol: string;
  turnsRemaining: number;
}

/// A skill a character has spent points on. Its value is the skill's base plus both kinds of points.
export interface SkillEntry {
  id: string;
  skillId: string;
  /// For skills that take one, e.g. “Biology” for Science. Empty otherwise.
  specialty: StoryText;
  /// Points from the occupation's budget.
  occupationPoints: number;
  /// Points from the personal-interest budget (INT × 2).
  personalPoints: number;
}

/// An entry on a story's character sheet: the hero, an enemy, or anyone else the story refers to by ID.
export interface StoryCharacter {
  id: string;
  name: StoryText;
  lineage: StoryText;
  calling: StoryText;
  summary: StoryText;
  symbol: string;
  age: number;
  /// Hit points, magic points, sanity, move rate, build, and damage bonus all derive from these.
  characteristics: Characteristics;
  /// An occupation catalog ID, or empty for a custom occupation described by `calling`.
  occupationId: string;
  /// Skills the character has spent points on. Any other skill is at its base value.
  skills: SkillEntry[];
  level: number;
  stamina: number;
  /// Action points, when playing as the hero. They come back when time passes and at each chapter start.
  ap: number;
  xp: number;
  xpToNext: number;
  gold: number;
  /// Item-sheet IDs the character starts with.
  itemIds: string[];
  /// The total item weight the character can carry; 0 means no limit.
  carryCapacity: number;
  effects: StatusEffect[];
  /// No longer used: characters fight with their skills and carried weapons. Kept so older files round-trip.
  minDamage: number;
  maxDamage: number;
  /// Granted to the hero for defeating this character.
  xpReward: number;
  goldReward: number;
}

/// Fixed output port IDs. Choice nodes use their options' IDs instead.
export const Port = {
  next: "next",
  success: "success",
  failure: "failure",
  victory: "victory",
  defeat: "defeat",
  happens: "happens",
  otherwise: "otherwise",
  /// Taken when a choice or event leaves the hero at 0 HP. Optional: unwired, the game ends with a default death.
  death: "death",
} as const;

/// The place and chapter labels shown above the scene during play, built from the location sheet and the chapter.
export interface SceneSetting {
  region: StoryText;
  location: StoryText;
  chapter: StoryText;
  part: StoryText;
}

/// Where a story being played came from.
export type StorySource =
  | { type: "builtIn"; name: string }
  | { type: "library"; id: string }
  | { type: "played"; id: string };
