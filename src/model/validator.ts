// Checks a story graph against the rules a playable story must follow.

import { hitPoints } from "./rules";
import {
  allowsOccupationPoints,
  characterSkillValue,
  entryValue,
  occupation,
  occupationPointBudget,
  occupationPointsSpent,
  personalPointBudget,
  personalPointsSpent,
  skillDefinition,
} from "./skills";
import {
  arrivingLocations,
  findChapter,
  findCharacter,
  findEvent,
  findItem,
  findLocation,
  findMonster,
  findNode,
  findTrack,
  hasLocation,
  kindTitle,
  linkTarget,
  neighbors,
  nodesIn,
  outputPorts,
  startNode,
} from "./story";
import { isBlank } from "./storyText";
import type { Item, Story, StoryCharacter } from "./types";
import { Port } from "./types";

export type IssueKind =
  | { type: "noEntrance" }
  | { type: "multipleEntrances" }
  | { type: "missingStoryTitle" }
  /// The entrance hasn't picked a hero from the character sheet.
  | { type: "noHero" }
  | { type: "missingHeroName" }
  | { type: "invalidHeroHealth" }
  | { type: "invalidActionPoints" }
  | { type: "invalidExperience" }
  | { type: "invalidStartPhase" }
  | { type: "unconnectedOutput"; port: string }
  | { type: "noOptions" }
  | { type: "untitledOption"; optionId: string }
  /// The hero carries a weapon they don't have the skill for, so they can't attack with it.
  | { type: "cannotUseWeapon"; itemId: string }
  /// A battle hasn't picked an enemy from the character or monster sheet.
  | { type: "noEnemy" }
  | { type: "enemyNeedsHealth" }
  | { type: "invalidEnemyDamage" }
  | { type: "missingTrack" }
  /// A wire joins nodes in different chapters; chapters connect through Next Chapter nodes instead.
  | { type: "crossChapterLink" }
  /// A Next Chapter node hasn't picked where to go.
  | { type: "noJumpTarget" }
  /// A Next Chapter node leads to a chapter with no Chapter Start.
  | { type: "targetHasNoStart" }
  | { type: "multipleChapterStarts" }
  /// The hero's starting items weigh more than they can carry.
  | { type: "heroOverloaded" }
  /// A check rolls against a skill that isn't in the skill list.
  | { type: "unknownSkill"; skillId: string }
  | { type: "occupationPointsOverspent"; spent: number; budget: number }
  | { type: "personalPointsOverspent"; spent: number; budget: number }
  /// Occupation points went into a skill the occupation doesn't list.
  | { type: "notAnOccupationSkill"; skillId: string }
  /// A skill above 99, which isn't allowed at character creation.
  | { type: "skillTooHigh"; skillId: string }
  /// Points in Mythos, which can't be bought at creation.
  | { type: "mythosAtCreation" }
  /// The hero's Credit Rating is outside their occupation's range.
  | { type: "creditRatingOutOfRange"; range: [number, number] }
  /// A node that can kill the hero has nothing wired to its Death output.
  | { type: "unconnectedDeath" }
  /// A node is set at a location with no road from where the hero arrives from.
  | { type: "locationNotConnected"; from: string }
  /// A choice option travels to a location with no road from where the hero is.
  | { type: "moveNotConnected"; optionId: string; from: string }
  | { type: "noEvent" }
  | { type: "noPriorEvent" }
  | { type: "noConditions" }
  /// A time trigger with no times of day, or whose last day is before its first, never fires.
  | { type: "impossibleTime" }
  /// Every option costs action points, so a hero who has spent theirs is stuck: AP only comes back with time.
  | { type: "noFreeOption" }
  /// Play can reach this node but can never reach an end from it.
  | { type: "noWayToEnd" }
  | { type: "unreachable" }
  | { type: "missingTitle" };

/// A problem found in a story graph. Errors make the story unplayable; warnings are worth a look but don't block play.
export interface StoryIssue {
  severity: "error" | "warning";
  nodeId?: string;
  kind: IssueKind;
}

export function validate(story: Story): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const error = (kind: IssueKind, nodeId?: string) => issues.push({ severity: "error", nodeId, kind });
  const warning = (kind: IssueKind, nodeId?: string) => issues.push({ severity: "warning", nodeId, kind });

  const entrances = story.nodes.filter((n) => n.kind.type === "entrance");
  if (entrances.length === 0) error({ type: "noEntrance" });
  for (const extra of entrances.slice(1)) error({ type: "multipleEntrances" }, extra.id);

  for (const link of story.links) {
    const from = findNode(story, link.fromNode);
    const to = findNode(story, link.toNode);
    if (from && to && from.chapterId !== to.chapterId) error({ type: "crossChapterLink" }, from.id);
  }
  for (const chapter of story.chapters) {
    for (const extra of nodesIn(story, chapter.id).filter((n) => n.kind.type === "chapterStart").slice(1)) {
      error({ type: "multipleChapterStarts" }, extra.id);
    }
  }

  const arriving = arrivingLocations(story);
  const sorted = (set: Set<string> | undefined) => [...(set ?? [])].sort();
  for (const node of story.nodes) {
    if (hasLocation(node.kind) && findLocation(story, node.locationId)) {
      const from = sorted(arriving.get(node.id)).find((id) => id !== node.locationId && !neighbors(story, id).has(node.locationId));
      if (from !== undefined) warning({ type: "locationNotConnected", from }, node.id);
    }
    for (const port of outputPorts(node.kind)) {
      if (linkTarget(story, node.id, port) !== undefined) continue;
      if (port === Port.death) warning({ type: "unconnectedDeath" }, node.id);
      else error({ type: "unconnectedOutput", port }, node.id);
    }
    if (node.music.type === "play" && !findTrack(story, node.music.trackId)) error({ type: "missingTrack" }, node.id);

    const kind = node.kind;
    switch (kind.type) {
      case "entrance": {
        if (isBlank(kind.title)) error({ type: "missingStoryTitle" }, node.id);
        const hero = findCharacter(story, kind.heroId);
        if (hero) {
          if (isBlank(hero.name)) error({ type: "missingHeroName" }, node.id);
          // Hit points are (CON + SIZ) ÷ 10, so very low CON and SIZ leave the hero with none.
          if (hitPoints(hero.characteristics) <= 0) error({ type: "invalidHeroHealth" }, node.id);
          // The AP meter draws one pip per point, so keep the maximum to something that fits on screen.
          if (hero.ap < 1 || hero.ap > 12) error({ type: "invalidActionPoints" }, node.id);
          if (hero.xpToNext <= 0) error({ type: "invalidExperience" }, node.id);
          const carried = hero.itemIds.map((id) => findItem(story, id)).filter((i): i is Item => !!i);
          const load = carried.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
          if (hero.carryCapacity > 0 && load > hero.carryCapacity) warning({ type: "heroOverloaded" }, node.id);
          for (const issue of skillIssues(hero)) warning(issue, node.id);
          for (const item of carried.filter((i) => i.category === "weapon")) {
            if (item.skillId === "" || !hero.skills.some((s) => s.skillId === item.skillId)) {
              warning({ type: "cannotUseWeapon", itemId: item.id }, node.id);
            }
          }
        } else {
          error({ type: "noHero" }, node.id);
        }
        if (kind.startPhase < 0 || kind.startPhase >= 5 || kind.startDay < 1) error({ type: "invalidStartPhase" }, node.id);
        break;
      }
      case "choice": {
        if (kind.options.length === 0) error({ type: "noOptions" }, node.id);
        for (const option of kind.options) {
          if (isBlank(option.title)) warning({ type: "untitledOption", optionId: option.id }, node.id);
        }
        if (kind.options.length > 0 && kind.options.every((o) => o.apCost > 0)) warning({ type: "noFreeOption" }, node.id);
        const here = findLocation(story, node.locationId) ? new Set([node.locationId]) : arriving.get(node.id);
        for (const option of kind.options) {
          const destination = option.effect.moveTo;
          if (!destination || !findLocation(story, destination)) continue;
          const from = sorted(here).find((id) => id !== destination && !neighbors(story, id).has(destination));
          if (from !== undefined) warning({ type: "moveNotConnected", optionId: option.id, from }, node.id);
        }
        break;
      }
      case "battle": {
        const enemy = findCharacter(story, kind.enemyId);
        const monster = findMonster(story, kind.enemyId);
        if (enemy) {
          if (hitPoints(enemy.characteristics) <= 0) error({ type: "enemyNeedsHealth" }, node.id);
        } else if (monster) {
          if (monster.hitPoints <= 0) error({ type: "enemyNeedsHealth" }, node.id);
          if (monster.damage.count < 1 || monster.damage.sides < 1) error({ type: "invalidEnemyDamage" }, node.id);
        } else {
          error({ type: "noEnemy" }, node.id);
        }
        break;
      }
      case "chapterJump":
        if (kind.targetChapterId === "" || !findChapter(story, kind.targetChapterId)) error({ type: "noJumpTarget" }, node.id);
        else if (!startNode(story, kind.targetChapterId)) error({ type: "targetHasNoStart" }, node.id);
        break;
      case "check":
        if (kind.target.type === "skill" && !skillDefinition(kind.target.skillId)) {
          error({ type: "unknownSkill", skillId: kind.target.skillId }, node.id);
        }
        break;
      case "event":
        if (kind.eventId === "" || !findEvent(story, kind.eventId)) error({ type: "noEvent" }, node.id);
        if (kind.occurrence === "perhaps") {
          if (kind.trigger.mode === "characteristics" && kind.trigger.conditions.length === 0) error({ type: "noConditions" }, node.id);
          if (kind.trigger.mode === "priorEvent" && !findEvent(story, kind.trigger.priorEventId)) error({ type: "noPriorEvent" }, node.id);
          if (kind.trigger.mode === "time") {
            const { earliestDay, latestDay, phases } = kind.trigger;
            if (phases.length === 0 || (earliestDay > 0 && latestDay > 0 && latestDay < earliestDay)) error({ type: "impossibleTime" }, node.id);
          }
        }
        break;
      case "end":
      case "narration":
      case "chapterStart":
        break;
    }

    // Chapter starts are titled by their chapter and jumps by their target, and narration often just continues the
    // scene, so only other nodes need titles.
    const needsTitle = !["entrance", "chapterStart", "chapterJump", "narration"].includes(kind.type);
    if (needsTitle && isBlank(kindTitle(kind))) warning({ type: "missingTitle" }, node.id);
  }

  // Reachability: forward from the entrance, and backward from every end.
  const start = entrances[0];
  if (start) {
    const reachable = reachableNodes(story, [start.id], true);
    const canFinish = reachableNodes(story, story.nodes.filter((n) => n.kind.type === "end").map((n) => n.id), false);
    for (const node of story.nodes) {
      if (!reachable.has(node.id)) {
        // An unused Chapter Start just means that chapter is never entered; its nodes are reported instead.
        if (node.kind.type !== "entrance" && node.kind.type !== "chapterStart") warning({ type: "unreachable" }, node.id);
      } else if (!canFinish.has(node.id)) {
        error({ type: "noWayToEnd" }, node.id);
      }
    }
  }
  return issues;
}

/// Character-creation checks for the hero's skills.
function skillIssues(hero: StoryCharacter): IssueKind[] {
  const issues: IssueKind[] = [];
  const job = occupation(hero.occupationId);
  if (occupationPointsSpent(hero) > occupationPointBudget(hero)) {
    issues.push({ type: "occupationPointsOverspent", spent: occupationPointsSpent(hero), budget: occupationPointBudget(hero) });
  }
  if (personalPointsSpent(hero) > personalPointBudget(hero)) {
    issues.push({ type: "personalPointsOverspent", spent: personalPointsSpent(hero), budget: personalPointBudget(hero) });
  }
  const reported = new Set<string>();
  const once = (key: string) => !reported.has(key) && (reported.add(key), true);
  for (const entry of hero.skills) {
    if (!skillDefinition(entry.skillId)) {
      if (once("unknown" + entry.skillId)) issues.push({ type: "unknownSkill", skillId: entry.skillId });
      continue;
    }
    if (job && entry.occupationPoints > 0 && !allowsOccupationPoints(job, entry.skillId) && once("occ" + entry.skillId)) {
      issues.push({ type: "notAnOccupationSkill", skillId: entry.skillId });
    }
    if (entryValue(entry, hero.characteristics) > 99 && once("high" + entry.skillId)) {
      issues.push({ type: "skillTooHigh", skillId: entry.skillId });
    }
    if (entry.skillId === "mythos" && entry.occupationPoints + entry.personalPoints > 0) issues.push({ type: "mythosAtCreation" });
  }
  if (job) {
    const credit = characterSkillValue(hero, "creditRating");
    if (credit < job.creditRating[0] || credit > job.creditRating[1]) issues.push({ type: "creditRatingOutOfRange", range: job.creditRating });
  }
  return issues;
}

/// Whether the story can be played: it has no errors.
export function isPlayable(story: Story): boolean {
  return !validate(story).some((i) => i.severity === "error");
}

function reachableNodes(story: Story, starts: string[], forward: boolean): Set<string> {
  // Wires within chapters, plus the jump from each Next Chapter node to its target's start.
  const edges: [string, string][] = story.links.map((l) => [l.fromNode, l.toNode]);
  for (const node of story.nodes) {
    if (node.kind.type === "chapterJump") {
      const target = startNode(story, node.kind.targetChapterId);
      if (target) edges.push([node.id, target.id]);
    }
  }
  const next = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const [a, b] = forward ? [from, to] : [to, from];
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  }
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    for (const neighbor of next.get(queue.pop()!) ?? []) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return seen;
}
