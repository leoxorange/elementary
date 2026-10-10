// Plays a story graph: owns the hero, the current node, and the rules for choices, checks, and battles.

import { useSyncExternalStore } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { PHASE_KEYS } from "../model/names";
import { randomInt, requiredLevel, successLevel, SuccessLevel, targetNumber } from "../model/rules";
import {
  entrance,
  entranceNode,
  findChapter,
  findItem,
  findLocation,
  findNode,
  linkTarget,
  startNode,
} from "../model/story";
import { isBlank, textEquals } from "../model/storyText";
import type {
  Chapter,
  CheckDifficulty,
  CheckTarget,
  Choice,
  Effect,
  EventNode,
  Item,
  SceneSetting,
  Story,
  StoryNode,
  StorySource,
  StoryText,
} from "../model/types";
import { Port } from "../model/types";
import { isPlayable } from "../model/validator";
import { heroAttack, newBattle, opponent, performRound, type BattleAction, type BattleState } from "./battle";
import { carriedWeight, heroValue, storyHero, type Hero } from "./hero";

/// Why a story can't be started.
export class GameError extends Error {}

/// Why a choice can't be taken right now.
export type ChoiceBlock =
  | { type: "actionPoints"; cost: number }
  | { type: "mana" }
  | { type: "exhausted" }
  /// The choice costs more gold than the hero has.
  | { type: "gold"; cost: number; have: number }
  /// The choice takes an item the hero doesn't carry.
  | { type: "missingItem"; item: StoryText }
  /// The items the choice gives would weigh more than the hero can carry.
  | { type: "tooHeavy" };

/// The result of a check node's roll: d100 against a characteristic or skill, graded by level of success.
export interface CheckResult {
  target: CheckTarget;
  difficulty: CheckDifficulty;
  /// The d100 roll, 1–100.
  roll: number;
  /// The characteristic's or skill's full value when the roll was made.
  value: number;
}

export function checkLevel(result: CheckResult): SuccessLevel {
  return successLevel(result.roll, result.value);
}

export function checkSucceeded(result: CheckResult): boolean {
  return checkLevel(result) >= requiredLevel(result.difficulty);
}

/// The highest roll that passes the required difficulty.
export function checkTargetNumber(result: CheckResult): number {
  return targetNumber(result.value, result.difficulty);
}

export interface LogEntry {
  id: string;
  sceneTitle: StoryText;
  choiceTitle: StoryText;
  day: number;
  /// Index into the times of day.
  phaseIndex: number;
}

/// A snapshot of a game in progress, written after every action so the player can continue later. Saves refer to
/// the story rather than copying it, so a long soundtrack isn't duplicated into every save.
export interface SavedGame {
  source: StorySource;
  hero: Hero;
  nodeId: string;
  setting: SceneSetting;
  battle: BattleState | null;
  checkResult: CheckResult | null;
  musicTrackId: string | null;
  day: number;
  phaseIndex: number;
  visitedLocations: StoryText[];
  activatedEventIds: string[];
  isDead: boolean;
  log: LogEntry[];
  /// When the game was saved, in milliseconds since 1970.
  savedAt: number;
}

export async function loadSavedGame(): Promise<SavedGame | null> {
  const contents = await api.readSave();
  return contents ? (JSON.parse(contents) as SavedGame) : null;
}

const PHASE_COUNT = PHASE_KEYS.length;

function emptySetting(): SceneSetting {
  return { region: [], location: [], chapter: [], part: [] };
}

export class GameState {
  /// Tells games apart, so each one gets fresh view state.
  readonly id = crypto.randomUUID();
  readonly story: Story;
  hero: Hero;
  nodeId: string;
  /// The place and chapter labels in effect: the last location-sheet entry play passed through, and the chapter.
  setting: SceneSetting = emptySetting();
  /// The fight in progress while on a battle node.
  battle: BattleState | null = null;
  /// The roll made on the current check node, once the player has rolled.
  checkResult: CheckResult | null = null;
  /// The embedded track that should be playing, or `null` for silence.
  musicTrackId: string | null = null;
  log: LogEntry[] = [];
  day: number;
  phaseIndex: number;
  /// Unique locations visited so far, in the order they were discovered.
  visitedLocations: StoryText[] = [];
  /// Event-sheet entries that have happened, in order.
  activatedEventIds: string[] = [];
  /// The hero fell to 0 HP on a node with nothing wired to its Death output, so the game is over.
  isDead = false;
  /// Where the story came from, so a saved game can reopen it. Play-tests from the designer have none and don't
  /// touch the player's saved game.
  readonly source: StorySource | null;

  private listeners = new Set<() => void>();
  private version = 0;

  private constructor(story: Story, source: StorySource | null, hero: Hero, nodeId: string, day: number, phaseIndex: number) {
    this.story = story;
    this.source = source;
    this.hero = hero;
    this.nodeId = nodeId;
    this.day = day;
    this.phaseIndex = phaseIndex;
  }

  /// Starts a new game at the story's entrance.
  static start(story: Story, source: StorySource | null): GameState {
    const node = entranceNode(story);
    const start = entrance(story);
    const hero = storyHero(story);
    if (!isPlayable(story) || !node || !start || !hero) {
      throw new GameError(t("This story has errors. Open it in the Story Designer to fix them."));
    }
    const game = new GameState(story, source, hero, node.id, start.startDay, start.startPhase % PHASE_COUNT);
    game.enter(node.id);
    return game;
  }

  /// Resumes a saved game.
  static async resume(saved: SavedGame): Promise<GameState> {
    const story = await api.loadStory(saved.source);
    if (!isPlayable(story)) throw new GameError(t("This story has errors. Open it in the Story Designer to fix them."));
    if (!findNode(story, saved.nodeId)) throw new GameError(t("The saved game refers to a part of the story that no longer exists."));
    const game = new GameState(story, saved.source, saved.hero, saved.nodeId, saved.day, saved.phaseIndex % PHASE_COUNT);
    game.setting = saved.setting;
    game.battle = saved.battle;
    game.checkResult = saved.checkResult;
    game.musicTrackId = saved.musicTrackId;
    game.visitedLocations = saved.visitedLocations;
    game.activatedEventIds = saved.activatedEventIds ?? [];
    game.isDead = saved.isDead ?? false;
    game.log = saved.log;
    return game;
  }

  // MARK: Observing

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  get autosaves(): boolean {
    return this.source !== null;
  }

  get node(): StoryNode {
    return findNode(this.story, this.nodeId) ?? this.story.nodes[0];
  }

  /// The chapter the hero is in.
  get chapter(): Chapter | undefined {
    return findChapter(this.story, this.node.chapterId);
  }

  /// The options on the current node, or none if it isn't a choice node.
  get currentChoices(): Choice[] {
    const kind = this.node.kind;
    return !this.isDead && kind.type === "choice" ? kind.options : [];
  }

  get isFinished(): boolean {
    return this.isDead || this.node.kind.type === "end";
  }

  // MARK: Choices

  /// Explains why a choice can't be taken right now, or `null` if it can.
  unavailableReason(choice: Choice): ChoiceBlock | null {
    const hero = this.hero;
    const effect = choice.effect;
    if (hero.ap < choice.apCost) return { type: "actionPoints", cost: choice.apCost };
    if (hero.mp + effect.mp < 0) return { type: "mana" };
    if (hero.stamina + effect.stamina < 0) return { type: "exhausted" };
    if (hero.gold + effect.gold < 0) return { type: "gold", cost: -effect.gold, have: hero.gold };
    const missing = effect.loseItems.find((id) => !hero.equipment.some((i) => i.id === id));
    if (missing !== undefined) return { type: "missingItem", item: findItem(this.story, missing)?.name ?? [] };
    if (hero.carryCapacity !== null) {
      const dropped = hero.equipment.filter((i) => effect.loseItems.includes(i.id)).reduce((sum, i) => sum + Math.max(0, i.weight), 0);
      const gained = effect.gainItems
        .filter((id) => !hero.equipment.some((i) => i.id === id))
        .map((id) => findItem(this.story, id))
        .filter((i): i is Item => !!i)
        .reduce((sum, i) => sum + Math.max(0, i.weight), 0);
      if (gained > 0 && carriedWeight(hero) - dropped + gained > hero.carryCapacity) return { type: "tooHeavy" };
    }
    return null;
  }

  choose(choice: Choice) {
    if (!this.currentChoices.some((c) => c.id === choice.id) || this.unavailableReason(choice)) return;

    this.log.push({
      id: crypto.randomUUID(),
      sceneTitle: this.node.kind.type === "chapterStart" || this.node.kind.type === "chapterJump" ? [] : this.node.kind.title,
      choiceTitle: choice.title,
      day: this.day,
      phaseIndex: this.phaseIndex,
    });
    this.hero.ap -= choice.apCost;
    this.apply(choice.effect);
    if (this.hero.hp <= 0) {
      this.die();
      this.changed();
      return;
    }
    // Travel happens on the way out; the next node keeps this place unless it's set somewhere itself.
    const destination = choice.effect.moveTo ? findLocation(this.story, choice.effect.moveTo) : undefined;
    if (destination) {
      this.setting.location = destination.name;
      if (!isBlank(destination.region)) this.setting.region = destination.region;
      this.visit(destination.name);
    }
    if (choice.effect.passesTime) this.advanceTime();
    this.follow(choice.id);
    this.changed();
  }

  // MARK: Moving on

  /// Continues from nodes with a single way forward, a finished roll, or a finished battle.
  proceed() {
    if (this.isDead) return;
    const kind = this.node.kind;
    switch (kind.type) {
      case "entrance":
      case "narration":
      case "chapterStart":
        this.follow(Port.next);
        break;
      case "event":
        // Play only stops on events that happened; ones that didn't were passed through on the way in. The
        // event's damage was dealt as it happened; the player reads what happened before dying of it.
        if (this.hero.hp <= 0) this.die();
        else this.follow(kind.occurrence === "eventually" ? Port.next : Port.happens);
        break;
      case "chapterJump":
        this.enter(this.nodeId);
        break;
      case "check":
        if (!this.checkResult) return;
        this.follow(checkSucceeded(this.checkResult) ? Port.success : Port.failure);
        break;
      case "battle":
        if (this.battle?.outcome === "victory") {
          this.follow(Port.victory);
        } else if (this.battle?.outcome === "defeat") {
          // The hero survives defeat so the story can go on: with a sliver of health if they dropped to 0, or
          // with what they had left if a major wound knocked them out.
          this.hero.hp = Math.max(this.hero.hp, 1);
          this.follow(Port.defeat);
        } else {
          return;
        }
        break;
      case "choice":
      case "end":
        return;
    }
    this.changed();
  }

  rollCheck() {
    const kind = this.node.kind;
    if (kind.type !== "check" || this.checkResult) return;
    this.checkResult = {
      target: kind.target,
      difficulty: kind.difficulty,
      roll: randomInt(1, 100),
      value: heroValue(this.hero, kind.target),
    };
    this.save();
    this.changed();
  }

  perform(action: BattleAction) {
    const battle = this.battle;
    if (!battle || battle.outcome) return;
    performRound(battle, action, this.hero);
    if (battle.outcome === "victory") {
      this.apply({ ...zeroEffect(), xp: battle.enemy.xpReward, gold: battle.enemy.goldReward });
    }
    this.save();
    this.changed();
  }

  canPerform(action: BattleAction): boolean {
    if (this.battle?.outcome) return false;
    return action.type === "dodge" || heroAttack(this.hero, action) !== undefined;
  }

  // MARK: Private

  /// Lets time pass: restores action points, recovers a little mana and stamina, ticks status effects, and moves the
  /// clock to the next time of day. Only choices that pass time do this, so action points are a budget to spend.
  private advanceTime() {
    const hero = this.hero;
    hero.ap = hero.maxAP;
    // Magic points come back slowly: one each time time passes.
    hero.mp = Math.min(hero.mp + 1, hero.maxMP);
    hero.stamina = Math.min(hero.stamina + 8, hero.maxStamina);
    for (const effect of hero.effects) effect.turnsRemaining -= 1;
    hero.effects = hero.effects.filter((e) => e.turnsRemaining > 0);

    this.phaseIndex += 1;
    if (this.phaseIndex >= PHASE_COUNT) {
      this.phaseIndex = 0;
      this.day += 1;
    }
  }

  private follow(port: string) {
    const target = linkTarget(this.story, this.nodeId, port);
    if (target !== undefined) this.enter(target);
  }

  private visit(location: StoryText) {
    if (!this.visitedLocations.some((v) => textEquals(v, location))) this.visitedLocations.push(location);
  }

  private enter(id: string) {
    const next = findNode(this.story, this.resolvingPassThroughs(id));
    if (!next) return;
    this.nodeId = next.id;
    this.battle = null;
    this.checkResult = null;

    // The labels above the scene always show the chapter the hero is in.
    const chapter = findChapter(this.story, next.chapterId);
    if (chapter) {
      this.setting.chapter = chapter.title;
      this.setting.part = chapter.subtitle;
    }
    // A new chapter is a fresh start: the hero gets their action points back.
    if (next.kind.type === "chapterStart") this.hero.ap = this.hero.maxAP;
    // A location from the location sheet names the place, and its region if it has one.
    const location = next.kind.type !== "check" && next.kind.type !== "chapterJump" ? findLocation(this.story, next.locationId) : undefined;
    if (location) {
      this.setting.location = location.name;
      if (!isBlank(location.region)) this.setting.region = location.region;
    }
    if (!isBlank(this.setting.location)) this.visit(this.setting.location);

    switch (next.music.type) {
      case "keep":
        break;
      case "stop":
        this.musicTrackId = null;
        break;
      case "play":
        this.musicTrackId = next.music.trackId;
        break;
    }

    if (next.kind.type === "battle") {
      const enemy = opponent(this.story, next.kind.enemyId);
      if (enemy) this.battle = newBattle(enemy);
    }
    this.save();
  }

  /// Follows Next Chapter nodes to the chapter start they lead to, and events that don't happen to their Doesn't
  /// Happen output. Neither is shown; play lands on where they lead. Events that do happen are recorded.
  private resolvingPassThroughs(id: string): string {
    let current = id;
    // A small cap guards against chapters that only jump to each other, or events that loop back on themselves.
    for (let step = 0; step < 32; step++) {
      const kind = findNode(this.story, current)?.kind;
      if (kind?.type === "chapterJump") {
        const start = startNode(this.story, kind.targetChapterId);
        if (!start) return current;
        current = start.id;
      } else if (kind?.type === "event") {
        if (this.happens(kind)) {
          if (kind.eventId !== "" && !this.activatedEventIds.includes(kind.eventId)) this.activatedEventIds.push(kind.eventId);
          // Gold can't go below nothing; everything else is clamped as for a choice.
          const { hp, mp, stamina, sanity, xp } = kind;
          this.apply({ ...zeroEffect(), hp, mp, stamina, sanity, xp, gold: Math.max(kind.gold, -this.hero.gold) });
          return current;
        }
        const next = linkTarget(this.story, current, Port.otherwise);
        if (next === undefined) return current;
        current = next;
      } else {
        return current;
      }
    }
    return current;
  }

  /// Decides whether an event happens as play reaches it. Chance events roll again on every visit.
  private happens(event: EventNode): boolean {
    if (event.occurrence !== "perhaps") return true;
    const trigger = event.trigger;
    switch (trigger.mode) {
      case "chance":
        return randomInt(1, 100) <= trigger.chance;
      case "characteristics":
        return conditionsMet(event, this.hero);
      case "priorEvent":
        return this.activatedEventIds.includes(trigger.priorEventId);
      case "time":
        return timeMatches(trigger, this.day, this.phaseIndex);
    }
  }

  private apply(effect: Effect) {
    const hero = this.hero;
    // Damage can bring the hero to 0 HP; callers check for that and handle the death.
    hero.hp = Math.min(Math.max(hero.hp + effect.hp, 0), hero.maxHP);
    hero.mp = clamp(hero.mp + effect.mp, hero.maxMP);
    hero.stamina = clamp(hero.stamina + effect.stamina, hero.maxStamina);
    hero.gold += effect.gold;
    hero.sanity = clamp(hero.sanity + effect.sanity, hero.maxSanity);
    if (effect.objective) hero.quest.objective = effect.objective;
    hero.equipment = hero.equipment.filter((i) => !effect.loseItems.includes(i.id));
    for (const id of effect.gainItems) {
      if (hero.equipment.some((i) => i.id === id)) continue;
      const item = findItem(this.story, id);
      if (item) hero.equipment.push(structuredClone(item));
    }

    hero.xp += effect.xp;
    while (hero.xp >= hero.xpToNext) {
      hero.xp -= hero.xpToNext;
      hero.level += 1;
      hero.xpToNext = Math.trunc(hero.xpToNext * 1.25);
      hero.maxHP += 1;
      hero.hp = hero.maxHP;
    }
  }

  /// The hero fell to 0 HP outside battle. Play follows the node's Death output, or the game ends.
  private die() {
    const target = linkTarget(this.story, this.nodeId, Port.death);
    if (target === undefined) {
      this.isDead = true;
      this.save();
      return;
    }
    // A Death wire into an End finishes the story there. One that leads on is a narrow escape, like losing a
    // battle: the hero pulls through with 1 HP.
    if (findNode(this.story, target)?.kind.type !== "end") this.hero.hp = 1;
    this.enter(target);
  }

  /// Writes the autosave. A failed save shouldn't interrupt play, so errors are only logged.
  private save() {
    if (!this.source) return;
    const snapshot: SavedGame = {
      source: this.source,
      hero: this.hero,
      nodeId: this.nodeId,
      setting: this.setting,
      battle: this.battle,
      checkResult: this.checkResult,
      musicTrackId: this.musicTrackId,
      day: this.day,
      phaseIndex: this.phaseIndex,
      visitedLocations: this.visitedLocations,
      activatedEventIds: this.activatedEventIds,
      isDead: this.isDead,
      log: this.log,
      savedAt: Date.now(),
    };
    api.writeSave(JSON.stringify(snapshot)).catch((error) => console.error("Autosave failed:", error));
  }
}

function clamp(value: number, upper: number): number {
  return Math.min(Math.max(value, 0), upper);
}

function zeroEffect(): Effect {
  return { hp: 0, mp: 0, stamina: 0, xp: 0, gold: 0, sanity: 0, passesTime: false, objective: null, gainItems: [], loseItems: [], moveTo: null };
}

/// Whether the hero's characteristics meet a Perhaps event's conditions. No conditions never holds, which
/// validation points out.
export function conditionsMet(event: EventNode, hero: { characteristics: Hero["characteristics"] }): boolean {
  const conditions = event.trigger.conditions;
  if (conditions.length === 0) return false;
  const met = (c: (typeof conditions)[number]) =>
    c.comparison === "over" ? hero.characteristics[c.characteristic] > c.value : hero.characteristics[c.characteristic] < c.value;
  return event.trigger.requiresAll ? conditions.every(met) : conditions.some(met);
}

/// Whether it's within a time trigger's days and at one of its times of day. A limit of 0 is no limit.
export function timeMatches(trigger: EventNode["trigger"], day: number, phaseIndex: number): boolean {
  if (trigger.earliestDay > 0 && day < trigger.earliestDay) return false;
  if (trigger.latestDay > 0 && day > trigger.latestDay) return false;
  return trigger.phases.includes(phaseIndex);
}

/// Re-renders a component whenever the game changes.
export function useGame(game: GameState): GameState {
  useSyncExternalStore(game.subscribe, game.getVersion);
  return game;
}
