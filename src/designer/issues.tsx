// What each validation issue says, and the list that shows them.

import { t } from "../i18n";
import { Icon } from "../icons";
import { occupationName, skillName } from "../model/names";
import { catalogOf, wealthSkill } from "../model/skills";
import { findItem, findLocation, findNode, kindTitle } from "../model/story";
import { isBlank, resolve } from "../model/storyText";
import type { Story } from "../model/types";
import type { StoryIssue } from "../model/validator";
import { portLabel, typeName } from "./nodeTypes";

export function issueMessage(issue: StoryIssue, story: Story, language: string): string {
  const kind = issue.kind;
  const node = issue.nodeId ? findNode(story, issue.nodeId) : undefined;
  const name = (text: { language: string; value: string }[] | undefined) => (text ? resolve(text, language) : "?");
  const catalog = catalogOf(story);
  const skill = (id: string) => skillName(catalog, id, language);
  switch (kind.type) {
    case "noEntrance":
      return t("The story needs an Entrance node.");
    case "multipleEntrances":
      return t("Only one Entrance is allowed.");
    case "missingStoryTitle":
      return t("Give the story a title.");
    case "noHero":
      return t("Choose a hero from the character sheet.");
    case "missingHeroName":
      return t("Give the hero a name.");
    case "invalidHeroHealth":
      return t("The hero needs at least 1 hit point. Raise CON or SIZ.");
    case "invalidActionPoints":
      return t("Action points must be between 1 and 12.");
    case "invalidExperience":
      return t("XP to next level must be at least 1.");
    case "invalidStartPhase":
      return t("The starting day or time of day is out of range.");
    case "unconnectedOutput":
      return node ? t("The “%@” output isn’t connected.", portLabel(node.kind, kind.port, language)) : t("An output isn’t connected.");
    case "noOptions":
      return t("Add at least one option.");
    case "untitledOption":
      return t("An option has no title.");
    case "noEnemy":
      return t("Choose an enemy from the monster or character sheet.");
    case "cannotUseWeapon":
      return t("The hero carries %@ but doesn’t have its weapon skill, so they can’t attack with it.", name(findItem(story, kind.itemId)?.name));
    case "enemyNeedsHealth":
      return t("The enemy needs at least 1 hit point.");
    case "invalidEnemyDamage":
      return t("The monster’s damage needs at least one die with at least one side.");
    case "missingTrack":
      return t("The selected music track is missing.");
    case "crossChapterLink":
      return t("A wire connects nodes in different chapters. Use a Next Chapter node instead.");
    case "noJumpTarget":
      return t("Choose which chapter to continue at.");
    case "targetHasNoStart":
      return t("That chapter has no Chapter Start to continue at.");
    case "multipleChapterStarts":
      return t("A chapter can only have one Chapter Start.");
    case "heroOverloaded":
      return t("The hero’s starting items weigh more than they can carry.");
    case "unknownSkill":
      return t("“%@” isn’t a known skill.", kind.skillId);
    case "occupationPointsOverspent":
      return t("The hero has spent %lld of %lld occupation points.", kind.spent, kind.budget);
    case "personalPointsOverspent":
      return t("The hero has spent %lld of %lld personal-interest points.", kind.spent, kind.budget);
    case "notAnOccupationSkill":
      return t("Occupation points went into %@, which isn’t an occupation skill.", skill(kind.skillId));
    case "skillTooHigh":
      return t("%@ is above 99.", skill(kind.skillId));
    case "notAtCreation":
      return t("%@ can’t be bought with skill points at creation.", skill(kind.skillId));
    case "notAWeaponSkill":
      return t("The weapon %@ uses a skill that isn’t a weapon skill, so no one can attack with it.", name(findItem(story, kind.itemId)?.name));
    case "abilityWithoutDice":
      return t("The ability %@ has no dice, so it can’t do anything.", skill(kind.skillId));
    case "occupationUnknownSkill":
      return t("The occupation %@ offers “%@”, which isn’t on the skill sheet.", occupationName(catalog, kind.occupationId, language), kind.skillId);
    case "creditRatingOutOfRange":
      return t("%@ should be between %lld and %lld for this occupation.", name(wealthSkill(catalog)?.name), kind.range[0], kind.range[1]);
    case "locationNotConnected":
      return t(
        "There’s no road from %@ to %@ on the location map.",
        name(findLocation(story, kind.from)?.name),
        name(node ? findLocation(story, node.locationId)?.name : undefined),
      );
    case "moveNotConnected": {
      const option = node?.kind.type === "choice" ? node.kind.options.find((o) => o.id === kind.optionId) : undefined;
      const destination = option?.effect.moveTo ? findLocation(story, option.effect.moveTo) : undefined;
      return t("An option travels to %@, but there’s no road there from %@.", name(destination?.name), name(findLocation(story, kind.from)?.name));
    }
    case "unconnectedDeath":
      return t("If the hero dies here, the game ends with a default ending. Wire Death to an End to write your own.");
    case "noEvent":
      return t("Choose an event from the event sheet.");
    case "noPriorEvent":
      return t("Choose which event this one follows.");
    case "noConditions":
      return t("Add at least one characteristic condition, or this event never happens.");
    case "impossibleTime":
      return t("Pick at least one time of day, and make sure the last day isn’t before the first, or this event never happens.");
    case "noFreeOption":
      return t("Every option costs action points. A hero who has spent theirs is stuck here, so add a free option.");
    case "noWayToEnd":
      return t("No path from here reaches an End node.");
    case "unreachable":
      return t("Nothing leads to this node, so players will never see it.");
    case "missingTitle":
      return t("This node has no title.");
  }
}

export function IssueList({ issues, story, language, onSelect }: {
  issues: StoryIssue[];
  story: Story;
  language: string;
  onSelect?: (issue: StoryIssue) => void;
}) {
  return (
    <>
      {issues.map((issue, index) => {
        const node = issue.nodeId ? findNode(story, issue.nodeId) : undefined;
        const content = (
          <>
            <Icon
              name={issue.severity === "error" ? "xmark.octagon.fill" : "exclamationmark.triangle.fill"}
              size={14}
              style={{ color: issue.severity === "error" ? "var(--health)" : "var(--action-point)" }}
            />
            <span className="column" style={{ gap: 2 }}>
              <span>{issueMessage(issue, story, language)}</span>
              {onSelect && node && (
                <span className="caption secondary">{isBlank(kindTitle(node.kind)) ? typeName(node.kind.type) : resolve(kindTitle(node.kind), language)}</span>
              )}
            </span>
          </>
        );
        return onSelect ? (
          <button key={index} type="button" className="issue-row" onClick={() => onSelect(issue)}>
            {content}
          </button>
        ) : (
          <div key={index} className="issue-row">
            {content}
          </div>
        );
      })}
    </>
  );
}
