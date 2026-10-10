// The center reading area: shows the current node and whatever the player can do there.

import { useRef, useState } from "react";
import { isTyping, Popover, SectionLabel, useKeyboard, VitalBar } from "../../components/ui";
import {
  canAfford,
  heroAbilities,
  heroActsFirst,
  heroDodge,
  heroUnarmed,
  heroWeaponAttacks,
  type AbilityResult,
  type Attack,
  type AttackResult,
  type BattleAction,
  type BattleEvent,
  type BattleState,
} from "../../game/battle";
import {
  checkLevel,
  checkSucceeded,
  checkTargetNumber,
  type ChoiceBlock,
  type GameState,
} from "../../game/gameState";
import { heroValue } from "../../game/hero";
import { t, tIn } from "../../i18n";
import { Icon } from "../../icons";
import { checkTargetName, difficultyName, skillName, successLevelName } from "../../model/names";
import { damageBonus, damageBonusLabel, damageLabel, isZeroBonus, targetNumber, type DamageBonus } from "../../model/rules";
import { isBlank, paragraphs, resolve } from "../../model/storyText";
import type { AbilityCost, Chapter, CheckNode, Choice, Outcome, SkillAbility, StoryText } from "../../model/types";
import { storyLanguageFor, useSettings } from "../../settings";
import { StoryLogList } from "./GameView";

export function StoryPanel({ game, onMainMenu, onPlayAgain }: { game: GameState; onMainMenu: () => void; onPlayAgain: () => void }) {
  const { uiLanguage } = useSettings();
  const [showsLog, setShowsLog] = useState(false);
  const logButton = useRef<HTMLButtonElement>(null);
  const node = game.node;
  const kind = node.kind;
  const setting = game.setting;

  const presence: StoryText = kind.type === "narration" || kind.type === "choice" || kind.type === "battle" ? kind.presence : [];

  // Return proceeds; number keys pick choices and battle actions; E ends the turn.
  useKeyboard((event) => {
    if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter") {
      if (game.isFinished) {
        onMainMenu();
        return true;
      }
      if (kind.type === "check") {
        if (game.checkResult) game.proceed();
        else game.rollCheck();
        return true;
      }
      if (kind.type === "battle") {
        if (game.battle?.outcome) game.proceed();
        return true;
      }
      if (kind.type !== "choice") {
        game.proceed();
        return true;
      }
    }
    const number = Number(event.key);
    if (Number.isInteger(number) && number >= 1 && number <= 9) {
      if (kind.type === "choice") {
        const choice = game.currentChoices[number - 1];
        if (choice) game.choose(choice);
        return true;
      }
      if (kind.type === "battle" && game.battle && !game.battle.outcome) {
        const action = battleActions(game)[number - 1];
        if (action && game.canPerform(action)) game.perform(action);
        return true;
      }
    }
  });

  return (
    <div className="story-scroll">
      <div className="scene-header">
        <div className="column" style={{ gap: 6 }}>
          {!isBlank(setting.region) && <SectionLabel color="var(--accent)">{resolve(setting.region, uiLanguage)}</SectionLabel>}
          {!isBlank(setting.location) && (
            <span className="scene-location">
              <Icon name="mappin.and.ellipse" size={18} />
              {resolve(setting.location, uiLanguage)}
            </span>
          )}
        </div>
        <span className="spacer" />
        {!isBlank(presence) && (
          <span className="presence glass">
            <Icon name="eye" size={14} />
            {resolve(presence, uiLanguage)}
          </span>
        )}
      </div>

      <div className="panel-card scene-card" key={game.nodeId + (game.isDead ? ":dead" : "")}>
        <div className="row">
          <div className="row" style={{ gap: 8 }}>
            {!isBlank(setting.chapter) && <SectionLabel color="var(--text-secondary)">{resolve(setting.chapter, uiLanguage)}</SectionLabel>}
            {!isBlank(setting.chapter) && !isBlank(setting.part) && <span className="section-label">/</span>}
            {!isBlank(setting.part) && <SectionLabel color="var(--text-secondary)">{resolve(setting.part, uiLanguage)}</SectionLabel>}
          </div>
          <span className="spacer" />
          <button ref={logButton} type="button" className="btn btn-plain callout" onClick={() => setShowsLog((s) => !s)}>
            <Icon name="clock.arrow.circlepath" size={14} />
            {t("Story log")}
          </button>
          {showsLog && (
            <Popover anchor={logButton.current} onClose={() => setShowsLog(false)} width={360} maxHeight={420}>
              <StoryLogList entries={game.log} />
            </Popover>
          )}
        </div>

        {game.isDead ? <DeathEnding onMainMenu={onMainMenu} onPlayAgain={onPlayAgain} /> : <NodeContent game={game} onMainMenu={onMainMenu} onPlayAgain={onPlayAgain} />}
      </div>
    </div>
  );
}

/// Shown when the hero dies on a node whose Death output isn't wired anywhere.
function DeathEnding({ onMainMenu, onPlayAgain }: { onMainMenu: () => void; onPlayAgain: () => void }) {
  const { uiLanguage } = useSettings();
  const language = storyLanguageFor(uiLanguage);
  return (
    <>
      <div style={{ marginTop: 16 }}>
        <EndBadge outcome="tragedy" />
      </div>
      <Passage
        title={[{ language, value: tIn(language, "You have died") }]}
        text={[{ language, value: tIn(language, "Your wounds were too grave. Here your story ends.") }]}
        quote={[]}
      />
      <EndButtons onMainMenu={onMainMenu} onPlayAgain={onPlayAgain} />
    </>
  );
}

function EndButtons({ onMainMenu, onPlayAgain }: { onMainMenu: () => void; onPlayAgain: () => void }) {
  return (
    <div className="row" style={{ gap: 12, marginTop: 32 }}>
      <button type="button" className="btn btn-glass btn-large" onClick={onPlayAgain}>
        <Icon name="arrow.counterclockwise" size={15} />
        {t("Play again")}
      </button>
      <ProceedButton title={t("Main menu")} onClick={onMainMenu} />
    </div>
  );
}

function NodeContent({ game, onMainMenu, onPlayAgain }: { game: GameState; onMainMenu: () => void; onPlayAgain: () => void }) {
  const kind = game.node.kind;
  const proceed = () => game.proceed();
  switch (kind.type) {
    case "entrance":
      return (
        <>
          <Passage title={kind.title} text={kind.background} quote={[]} />
          {!isBlank(kind.intro) && <Passage title={[]} text={kind.intro} quote={[]} />}
          <ProceedButton title={t("Begin the story")} onClick={proceed} top={32} />
        </>
      );
    case "narration":
      return (
        <>
          <Passage title={kind.title} text={kind.body} quote={kind.quote} />
          <ProceedButton title={t("Continue")} onClick={proceed} top={32} />
        </>
      );
    case "choice":
      return (
        <>
          <Passage title={kind.title} text={kind.body} quote={kind.quote} />
          <Choices game={game} options={kind.options} />
        </>
      );
    case "check":
      return (
        <>
          <Passage title={kind.title} text={kind.body} quote={[]} />
          <CheckPanel game={game} check={kind} />
        </>
      );
    case "battle":
      return (
        <>
          <Passage title={kind.title} text={kind.body} quote={[]} />
          {game.battle && <BattlePanel game={game} battle={game.battle} />}
        </>
      );
    case "chapterStart": {
      const chapter = game.chapter;
      const index = chapter ? game.story.chapters.findIndex((c) => c.id === chapter.id) : -1;
      return (
        <>
          <ChapterTitleCard chapter={chapter} number={index >= 0 ? index + 1 : undefined} />
          <Passage title={[]} text={kind.body} quote={kind.quote} />
          <ProceedButton title={t("Begin chapter")} onClick={proceed} top={32} />
        </>
      );
    }
    case "event":
      return (
        <>
          <Passage title={kind.title} text={kind.body} quote={kind.quote} />
          <ProceedButton title={t("Continue")} onClick={proceed} top={32} />
        </>
      );
    case "chapterJump":
      // Jumps resolve to the next chapter's start, so this only shows if that chapter has none.
      return <ProceedButton title={t("Continue")} onClick={proceed} top={32} />;
    case "end":
      return (
        <>
          <div style={{ marginTop: 16 }}>
            <EndBadge outcome={kind.outcome} />
          </div>
          <Passage title={kind.title} text={kind.body} quote={kind.quote} />
          <EndButtons onMainMenu={onMainMenu} onPlayAgain={onPlayAgain} />
        </>
      );
  }
}

// MARK: Pieces

/// The opening card of a chapter: its number and title, large.
function ChapterTitleCard({ chapter, number }: { chapter?: Chapter; number?: number }) {
  const { uiLanguage } = useSettings();
  return (
    <div className="chapter-card" style={{ paddingTop: 20 }}>
      {number !== undefined && <div className="number">{t("Chapter %lld", number)}</div>}
      {chapter && !isBlank(chapter.title) && <div className="title">{resolve(chapter.title, uiLanguage)}</div>}
      <div className="rule" />
    </div>
  );
}

/// A node's title, paragraphs, and closing quote. Empty parts are left out.
function Passage({ title, text, quote }: { title: StoryText; text: StoryText; quote: StoryText }) {
  const { uiLanguage } = useSettings();
  const parts = paragraphs(text, uiLanguage);
  return (
    <>
      {!isBlank(title) && <h2 className="passage-title">{resolve(title, uiLanguage)}</h2>}
      {parts.length > 0 && (
        <div className="passage-text">
          {parts.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      )}
      {!isBlank(quote) && (
        <div className="passage-quote">
          <span className="bar" />
          <span>{resolve(quote, uiLanguage)}</span>
        </div>
      )}
    </>
  );
}

/// The primary “keep going” button on nodes with a single way forward.
function ProceedButton({ title, onClick, top }: { title: string; onClick: () => void; top?: number }) {
  return (
    <div style={top ? { marginTop: top } : undefined}>
      <button type="button" className="btn btn-prominent btn-large" onClick={onClick}>
        {title}
        <Icon name="arrow.right" size={15} />
      </button>
    </div>
  );
}

function EndBadge({ outcome }: { outcome: Outcome }) {
  const title = outcome === "triumph" ? t("The End · Triumph") : outcome === "tragedy" ? t("The End · Tragedy") : t("The End");
  return (
    <span className={`end-badge ${outcome === "tragedy" ? "tragedy" : ""}`}>
      <Icon name={outcome === "tragedy" ? "moon.fill" : "sparkles"} size={13} />
      {title}
    </span>
  );
}

// MARK: Choices

function Choices({ game, options }: { game: GameState; options: Choice[] }) {
  return (
    <div className="column" style={{ gap: 14, marginTop: 32 }}>
      <div className="row" style={{ gap: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{t("What will you do?")}</span>
        <span className="spacer" />
        <APMeter current={game.hero.ap} maximum={game.hero.maxAP} />
      </div>
      <div className="column" style={{ gap: 12 }}>
        {options.map((choice, index) => (
          <ChoiceRow key={choice.id} index={index + 1} choice={choice} block={game.unavailableReason(choice)} onChoose={() => game.choose(choice)} />
        ))}
      </div>
    </div>
  );
}

function ChoiceRow({ index, choice, block, onChoose }: { index: number; choice: Choice; block: ChoiceBlock | null; onChoose: () => void }) {
  const { uiLanguage } = useSettings();
  return (
    <button type="button" className="choice-row glass glass-interactive" disabled={block !== null} onClick={onChoose}>
      <span className="index">{index}</span>
      <Icon name={choice.symbol} size={20} className="choice-icon" style={{ width: 28 }} />
      <span className="column" style={{ gap: 3, flex: 1, minWidth: 0 }}>
        <span className="title">{resolve(choice.title, uiLanguage)}</span>
        <span className={`detail ${block ? "blocked" : ""}`}>{block ? blockText(block, uiLanguage) : resolve(choice.detail, uiLanguage)}</span>
      </span>
      <span className="tag">{resolve(choice.tag, uiLanguage)}</span>
      <APCostBadge cost={choice.apCost} />
      <Icon name="arrow.up.right" size={15} className="go secondary" />
    </button>
  );
}

function blockText(block: ChoiceBlock, language: string): string {
  switch (block.type) {
    case "actionPoints":
      return t("Needs %lld AP — it comes back when time passes.", block.cost);
    case "mana":
      return t("Not enough mana.");
    case "exhausted":
      return t("You're too exhausted.");
    case "gold":
      return t("Needs %lld gold — you have %lld.", block.cost, block.have);
    case "missingItem":
      return t("Requires %@.", resolve(block.item, language));
    case "tooHeavy":
      return t("Too heavy to carry.");
  }
}

/// Shows what a choice costs: “Free” or a number of action points.
function APCostBadge({ cost }: { cost: number }) {
  if (cost === 0) return <span className="ap-badge free">{t("Free")}</span>;
  return (
    <span className="ap-badge">
      <Icon name="bolt.fill" size={11} />
      {t("%lld AP", cost)}
    </span>
  );
}

/// Row of pips showing remaining action points this turn.
function APMeter({ current, maximum }: { current: number; maximum: number }) {
  return (
    <div className="ap-meter" aria-label={t("Action points: %lld of %lld", current, maximum)}>
      <Icon name="bolt.fill" size={13} style={{ color: "var(--action-point)" }} />
      {Array.from({ length: Math.max(0, maximum) }, (_, pip) => (
        <span key={pip} className={`pip ${pip < current ? "full" : ""}`} />
      ))}
      <span className="callout secondary mono-digits" style={{ marginLeft: 4 }}>
        {t("%lld/%lld AP", current, maximum)}
      </span>
    </div>
  );
}

// MARK: Check

function CheckPanel({ game, check }: { game: GameState; check: CheckNode }) {
  const { uiLanguage } = useSettings();
  const value = heroValue(game.catalog, game.hero, check.target);
  const target = targetNumber(value, check.difficulty);
  const result = game.checkResult;
  const targetName = checkTargetName(game.catalog, check.target, uiLanguage);
  return (
    <div className="inset-panel" style={{ marginTop: 28 }}>
      <div className="row" style={{ gap: 14 }}>
        <span className="tile-icon accent">
          <Icon name="dice" size={22} />
        </span>
        <div className="column" style={{ gap: 3 }}>
          <span style={{ fontWeight: 600 }}>{t("%@ %@ roll", difficultyName(check.difficulty), targetName)}</span>
          <span className="callout secondary">{t("Roll d100 at or under %lld (%@ %lld).", target, targetName, value)}</span>
        </div>
      </div>
      {result ? (
        <>
          <div className="row" style={{ gap: 12 }}>
            <span className="roll-number" style={{ color: checkSucceeded(result) ? "var(--accent)" : "var(--warning)" }}>
              {String(result.roll).padStart(2, "0")}
            </span>
            <div className="column" style={{ gap: 2 }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: checkSucceeded(result) ? "var(--accent)" : "var(--warning)" }}>
                {successLevelName(checkLevel(result))}
              </span>
              <span className="callout secondary">{t("Needed %lld or less", checkTargetNumber(result))}</span>
            </div>
          </div>
          <ProceedButton title={t("Continue")} onClick={() => game.proceed()} />
        </>
      ) : (
        <ProceedButton title={t("Roll the dice")} onClick={() => game.rollCheck()} />
      )}
    </div>
  );
}

// MARK: Battle

/// The actions on offer, in button order: bare hands, each usable weapon, each known ability, then dodge if the
/// story has a dodge skill.
function battleActions(game: GameState): BattleAction[] {
  const catalog = game.catalog;
  return [
    { type: "punch" },
    ...heroWeaponAttacks(catalog, game.hero).map((w) => ({ type: "weapon" as const, itemId: w.item.id })),
    ...heroAbilities(catalog, game.hero).map((a) => ({ type: "ability" as const, skillId: a.skillId })),
    ...(heroDodge(catalog, game.hero) !== undefined ? [{ type: "dodge" as const }] : []),
  ];
}

/// An ability's effect and cost, e.g. “2D6 · all enemies · 4 MP”.
function abilityLabel(ability: SkillAbility): string {
  const target = { enemy: t("one enemy"), allEnemies: t("all enemies"), self: t("yourself") }[ability.target];
  const amount = ability.effect === "heal" ? t("heals %@", damageLabel(ability.amount)) : damageLabel(ability.amount);
  return [amount, target, costLabel(ability.cost)].filter(Boolean).join(" · ");
}

function costLabel(cost: AbilityCost): string {
  const parts: string[] = [];
  if (cost.mp > 0) parts.push(t("%lld MP", cost.mp));
  if (cost.hp > 0) parts.push(t("%lld HP", cost.hp));
  if (cost.stamina > 0) parts.push(t("%lld stamina", cost.stamina));
  if (cost.sanity > 0) parts.push(t("%lld SAN", cost.sanity));
  return parts.join(" + ");
}

/// Damage as dice, e.g. “1D8+2+1D4”.
function attackDamageLabel(attack: Attack, bonus: DamageBonus): string {
  let label = damageLabel(attack.damage);
  if (attack.bonus !== 0) label += attack.bonus > 0 ? `+${attack.bonus}` : `−${-attack.bonus}`;
  if (attack.addsDamageBonus && !isZeroBonus(bonus)) {
    const text = damageBonusLabel(bonus);
    label += text.startsWith("+") || text.startsWith("−") ? text : "+" + text;
  }
  return label;
}

function BattlePanel({ game, battle }: { game: GameState; battle: BattleState }) {
  const { uiLanguage } = useSettings();
  const hero = game.hero;
  const enemyName = resolve(battle.enemy.name, uiLanguage);
  const catalog = game.catalog;
  const heroBonus = damageBonus(hero.characteristics.strength + hero.characteristics.size);
  const fists = heroUnarmed(catalog, hero);
  const weapons = heroWeaponAttacks(catalog, hero);
  const abilities = heroAbilities(catalog, hero);
  const dodge = heroDodge(catalog, hero);
  const heroFirst = heroActsFirst(catalog, battle, { type: "punch" }, hero);

  const actionButton = (action: BattleAction, index: number, symbol: string, title: string, detail: string) => (
    <button
      key={index}
      type="button"
      className="battle-action glass glass-interactive"
      disabled={!game.canPerform(action)}
      onClick={() => game.perform(action)}
      title={`${index} · ${title} · ${detail}`}
    >
      <Icon name={symbol} size={20} />
      <span className="name">{title}</span>
      <span className="detail">{detail}</span>
    </button>
  );

  return (
    <div className="inset-panel" style={{ marginTop: 28 }}>
      <div className="row" style={{ gap: 16 }}>
        <span className="tile-icon" style={{ width: 56, height: 56, borderRadius: 14, color: "var(--health)", background: "rgba(var(--health-rgb), 0.12)" }}>
          <Icon name={battle.enemy.symbol} size={26} />
        </span>
        <div className="column" style={{ gap: 8, flex: 1 }}>
          <div className="row">
            <span className="serif" style={{ fontSize: 22 }}>
              {enemyName}
            </span>
            <span className="spacer" />
            <span className="callout secondary">{t("Round %lld", battle.round)}</span>
          </div>
          <VitalBar title={t("Enemy health")} symbol="heart" value={battle.enemyHP} maximum={Math.max(battle.enemy.hp, 1)} tint="var(--health)" />
          <span className="caption secondary mono-digits">
            {t("Fighting %lld%% · Dodge %lld%% · Armor %lld", battle.enemy.attack.skill, battle.enemy.dodge, battle.enemy.armor)}
          </span>
        </div>
      </div>

      {battle.outcome ? (
        <>
          <div className="row" style={{ gap: 10, fontSize: 18, fontWeight: 600, color: battle.outcome === "victory" ? "var(--accent)" : "var(--warning)" }}>
            <Icon name={battle.outcome === "victory" ? "trophy" : "heart.slash"} size={20} />
            {battle.outcome === "victory" ? t("Victory! %@ is defeated.", enemyName) : t("Defeat. %@ stands over you.", enemyName)}
          </div>
          <ProceedButton title={t("Continue")} onClick={() => game.proceed()} />
        </>
      ) : (
        <>
          <div className="row callout secondary" style={{ gap: 8 }}>
            <Icon name="figure.run" size={15} />
            {heroFirst
              ? t("You act first (DEX %lld vs %lld).", hero.characteristics.dexterity, battle.enemy.dexterity)
              : t("%@ acts first (DEX %lld vs %lld).", enemyName, battle.enemy.dexterity, hero.characteristics.dexterity)}
          </div>
          <div className="battle-actions">
            {actionButton(
              { type: "punch" },
              1,
              "hand.raised.fingers.spread",
              fists.skillId ? skillName(catalog, fists.skillId, uiLanguage) : t("Punch"),
              `${fists.skill}% · ${attackDamageLabel(fists, heroBonus)}`,
            )}
            {weapons.map((weapon, offset) => {
              const line = `${weapon.attack.skill}% · ${attackDamageLabel(weapon.attack, heroBonus)}`;
              return actionButton(
                { type: "weapon", itemId: weapon.item.id },
                offset + 2,
                weapon.item.symbol || "wand.and.sparkles",
                resolve(weapon.item.name, uiLanguage),
                weapon.attack.ranged ? t("%@ · fires first", line) : line,
              );
            })}
            {abilities.map((known, offset) =>
              actionButton(
                { type: "ability", skillId: known.skillId },
                weapons.length + offset + 2,
                known.symbol || "sparkles",
                resolve(known.name, uiLanguage),
                canAfford(hero, known.ability.cost)
                  ? `${known.value}% · ${abilityLabel(known.ability)}`
                  : t("Can’t pay %@", costLabel(known.ability.cost)),
              ),
            )}
            {dodge !== undefined &&
              actionButton({ type: "dodge" }, weapons.length + abilities.length + 2, "figure.walk.motion", t("Dodge"), t("%lld%% · wins ties", dodge))}
          </div>
        </>
      )}

      <div className="column" style={{ gap: 6 }}>
        {battle.events.slice(-8).reverse().map((event) => (
          <span key={event.id} className="callout secondary">
            {eventText(event, enemyName, uiLanguage)}
          </span>
        ))}
      </div>
    </div>
  );
}

function weaponName(weapon: StoryText, language: string): string {
  return isBlank(weapon) ? t("bare hands") : resolve(weapon, language);
}

function eventText(event: BattleEvent, enemyName: string, language: string): string {
  const kind = event.kind;
  switch (kind.type) {
    case "heroDodging":
      return t("You stay light on your feet, ready to dodge.");
    case "ability":
      return abilityText(resolve(kind.name, language), kind.roll, kind.skill, kind.result, enemyName);
    case "attack":
      return kind.attacker === "hero"
        ? heroAttackText(weaponName(kind.weapon, language), kind.roll, kind.skill, kind.result, enemyName)
        : enemyAttackText(weaponName(kind.weapon, language), kind.roll, kind.skill, kind.result, enemyName);
    case "majorWound":
      if (kind.side === "hero") {
        return kind.stayedUp
          ? t("A major wound! You stay on your feet (CON %lld vs %lld).", kind.roll, kind.constitution)
          : t("A major wound! You black out (CON %lld vs %lld).", kind.roll, kind.constitution);
      }
      return kind.stayedUp
        ? t("A major wound! %@ staggers but stays up (CON %lld vs %lld).", enemyName, kind.roll, kind.constitution)
        : t("A major wound! %@ collapses (CON %lld vs %lld).", enemyName, kind.roll, kind.constitution);
    case "victory":
      return t("%@ falls.", enemyName);
    case "defeat":
      return t("You fall.");
  }
}

function abilityText(ability: string, roll: number, skill: number, result: AbilityResult, enemyName: string): string {
  switch (result.type) {
    case "hit":
      return result.extreme
        ? t("%@ (%lld vs %lld) strikes with full force for %lld damage!", ability, roll, skill, result.damage)
        : t("%@ (%lld vs %lld) hits for %lld damage.", ability, roll, skill, result.damage);
    case "healed":
      return t("%@ (%lld vs %lld) restores %lld HP.", ability, roll, skill, result.amount);
    case "failed":
      return t("%@ fails (%lld vs %lld).", ability, roll, skill);
    case "dodged":
      return t("%@ evades your %@ (%lld vs %lld).", enemyName, ability, result.roll, result.skill);
  }
}

function heroAttackText(weapon: string, roll: number, skill: number, result: AttackResult, enemyName: string): string {
  switch (result.type) {
    case "hit":
      if (result.damage === 0) return t("You hit with %@ (%lld vs %lld), but it doesn’t get through.", weapon, roll, skill);
      return result.extreme
        ? t("An extreme success with %@ (%lld vs %lld) for %lld damage!", weapon, roll, skill, result.damage)
        : t("You hit with %@ (%lld vs %lld) for %lld damage.", weapon, roll, skill, result.damage);
    case "missed":
      return t("You miss with %@ (%lld vs %lld).", weapon, roll, skill);
    case "dodged":
      return t("%@ dodges your attack (%lld vs %lld).", enemyName, result.roll, result.skill);
    case "countered":
      return t("%@ fights back and hits you for %lld (%lld vs %lld).", enemyName, result.damage, result.roll, result.skill);
  }
}

function enemyAttackText(weapon: string, roll: number, skill: number, result: AttackResult, enemyName: string): string {
  switch (result.type) {
    case "hit":
      if (result.damage === 0) return t("%@ hits you with %@, but your armor holds.", enemyName, weapon);
      return result.extreme
        ? t("%@ lands a brutal blow with %@ (%lld vs %lld) for %lld damage!", enemyName, weapon, roll, skill, result.damage)
        : t("%@ hits you with %@ (%lld vs %lld) for %lld damage.", enemyName, weapon, roll, skill, result.damage);
    case "missed":
      return t("%@ misses with %@ (%lld vs %lld).", enemyName, weapon, roll, skill);
    case "dodged":
      return t("You dodge %@’s attack (%lld vs %lld).", enemyName, result.roll, result.skill);
    case "countered":
      return t("You fight back and hit %@ for %lld (%lld vs %lld).", enemyName, result.damage, result.roll, result.skill);
  }
}
