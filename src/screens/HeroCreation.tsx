// Before a story begins: play the story's own hero, or create one by the Call of Cthulhu rules. Creating takes four
// steps (characteristics, occupation, skills, identity); the story still supplies starting items, gold, and action
// points.

import { createContext, useContext, useState, type ReactNode } from "react";
import { errorMessage } from "../api";
import { Alert, FormRow, FormSection, isTyping, NumberInput, Segmented, Stepper, useKeyboard } from "../components/ui";
import { GameState } from "../game/gameState";
import {
  AGE_RANGE,
  autoSpend,
  canTakeOccupationPoints,
  characteristicIssues,
  chooseOccupation,
  clearPoints,
  creationSkillIds,
  entryFor,
  newDraft,
  POINT_BUY_RANGE,
  POINT_BUY_TOTAL,
  pointBuySpent,
  pointBuyStart,
  setPoints,
  skillProblems,
  type CharacteristicMethod,
} from "../game/heroCreation";
import { t } from "../i18n";
import { Icon } from "../icons";
import { characteristicName, formulaText, occupationName, occupationSkillsText, skillName } from "../model/names";
import {
  ABBREVIATIONS,
  build,
  CHARACTERISTICS,
  damageBonus,
  damageBonusLabel,
  div,
  hitPoints,
  magicPoints,
  moveRate,
  rollCharacteristics,
  startingSanity,
} from "../model/rules";
import {
  catalogOf,
  entryValue,
  formulaPoints,
  occupationPointBudget,
  occupationPointsSpent,
  occupationSkillIds,
  personalPointBudget,
  personalPointsSpent,
  skillBase,
  skillValue,
  wealthSkill,
  type SkillCatalog,
} from "../model/skills";
import { findItem, heroCharacter } from "../model/story";
import { isBlank, plainText, resolve } from "../model/storyText";
import type { Characteristic, Story, StoryCharacter, StorySource } from "../model/types";
import type { IssueKind } from "../model/validator";
import { useSettings } from "../settings";

/// The story's skills and occupations, for every step.
const CatalogContext = createContext<SkillCatalog | null>(null);

function useCatalog(): SkillCatalog {
  return useContext(CatalogContext)!;
}

type Step = "choose" | "characteristics" | "occupation" | "skills" | "identity";
const CREATION_STEPS: Exclude<Step, "choose">[] = ["characteristics", "occupation", "skills", "identity"];

function stepTitle(step: Exclude<Step, "choose">): string {
  return { characteristics: t("Characteristics"), occupation: t("Occupation"), skills: t("Skills"), identity: t("Identity") }[step];
}

export function HeroCreation({ story, source, onStart, onBack }: {
  story: Story;
  source: StorySource | null;
  onStart: (game: GameState) => void;
  onBack: () => void;
}) {
  const { uiLanguage } = useSettings();
  // Only playable stories get here, and those always have a hero.
  const template = heroCharacter(story)!;
  const catalog = catalogOf(story);
  const [step, setStep] = useState<Step>("choose");
  const [draft, setDraft] = useState(() => newDraft(template));
  const [method, setMethod] = useState<CharacteristicMethod>("roll");
  const [name, setName] = useState("");
  const [background, setBackground] = useState("");
  const [error, setError] = useState<string | null>(null);

  const update = (change: (draft: StoryCharacter) => void) =>
    setDraft((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });

  const start = (character?: StoryCharacter) => {
    try {
      onStart(GameState.start(story, source, character));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const finished = (): StoryCharacter => ({
    ...draft,
    name: plainText(name.trim(), uiLanguage),
    lineage: background.trim() === "" ? [] : plainText(background.trim(), uiLanguage),
  });

  const canLeave: Record<Exclude<Step, "choose">, boolean> = {
    characteristics: characteristicIssues(draft, method).length === 0,
    occupation: catalog.occupation(draft.occupationId) !== undefined,
    skills: catalog.occupation(draft.occupationId) !== undefined && skillProblems(catalog, draft).length === 0,
    identity: name.trim() !== "",
  };
  const index = step === "choose" ? -1 : CREATION_STEPS.indexOf(step);
  const back = () => (index <= 0 ? (step === "choose" ? onBack() : setStep("choose")) : setStep(CREATION_STEPS[index - 1]));
  const next = () => {
    if (step === "choose" || !canLeave[step]) return;
    if (step === "identity") start(finished());
    else setStep(CREATION_STEPS[index + 1]);
  };

  useKeyboard((event) => {
    if (error) return;
    if (event.key === "Escape") {
      back();
      return true;
    }
    if (event.key === "Enter" && step !== "choose" && (!isTyping(event) || step === "identity")) {
      next();
      return true;
    }
  });

  return (
    <CatalogContext.Provider value={catalog}>
    <div className="welcome creator-host">
      <div className="creator">
        <div className="row" style={{ gap: 12 }}>
          <button type="button" className="btn btn-glass" onClick={back}>
            <Icon name="chevron.left" size={14} />
            {t("Back")}
          </button>
          {step !== "choose" && (
            <div className="creator-steps">
              {CREATION_STEPS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className={`creator-step ${s === step ? "current" : i < index ? "done" : ""}`}
                  disabled={i >= index}
                  onClick={() => setStep(s)}
                >
                  {i < index ? <Icon name="checkmark" size={11} /> : <span className="mono-digits">{i + 1}</span>}
                  {stepTitle(s)}
                </button>
              ))}
            </div>
          )}
        </div>

        {step === "choose" && <ChooseHero story={story} template={template} onPlayStoryHero={() => start()} onCreate={() => setStep("characteristics")} />}
        {step === "characteristics" && <CharacteristicsStep draft={draft} method={method} setMethod={setMethod} update={update} />}
        {step === "occupation" && <OccupationStep draft={draft} update={update} />}
        {step === "skills" && <SkillsStep draft={draft} update={update} />}
        {step === "identity" && (
          <IdentityStep story={story} draft={draft} name={name} setName={setName} background={background} setBackground={setBackground} update={update} />
        )}

        {step !== "choose" && (
          <div className="row" style={{ gap: 12 }}>
            <span className="spacer" />
            <button type="button" className="btn btn-prominent btn-xl" disabled={!canLeave[step]} onClick={next}>
              {step === "identity" ? (
                <>
                  <Icon name="play.fill" size={15} />
                  {t("Begin Story")}
                </>
              ) : (
                <>
                  {t("Next")}
                  <Icon name="chevron.right" size={15} />
                </>
              )}
            </button>
          </div>
        )}
      </div>
      {error && <Alert title={t("Couldn't start story")} message={error} onDismiss={() => setError(null)} />}
    </div>
    </CatalogContext.Provider>
  );
}

function StepHeader({ title, subtitle, accessory }: { title: string; subtitle: string; accessory?: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
      <div className="column" style={{ gap: 6 }}>
        <h2>{title}</h2>
        <span className="secondary">{subtitle}</span>
      </div>
      <span className="spacer" />
      {accessory}
    </div>
  );
}

// MARK: Choosing

function ChooseHero({ story, template, onPlayStoryHero, onCreate }: {
  story: Story;
  template: StoryCharacter;
  onPlayStoryHero: () => void;
  onCreate: () => void;
}) {
  const { uiLanguage } = useSettings();
  const catalog = useCatalog();
  const name = resolve(template.name, uiLanguage);
  const job = catalog.occupation(template.occupationId);
  const role = job ? occupationName(catalog, job.id, uiLanguage) : !isBlank(template.calling) ? resolve(template.calling, uiLanguage) : null;
  return (
    <>
      <StepHeader title={t("Who will you play?")} subtitle={t("Take the story’s own hero, or make one of your own.")} />
      <div className="creator-body">
        <div className="hero-options">
          <button type="button" className="hero-option glass glass-interactive" onClick={onPlayStoryHero}>
            <div className="row" style={{ gap: 14 }}>
              <div className="avatar" aria-hidden>
                {Array.from(name)[0] ?? ""}
              </div>
              <div className="column" style={{ gap: 3, minWidth: 0 }}>
                <span className="title">{name}</span>
                <span className="callout secondary">{[role, t("Age %lld", template.age)].filter(Boolean).join(" · ")}</span>
              </div>
            </div>
            {!isBlank(template.summary) && <span className="secondary">{resolve(template.summary, uiLanguage)}</span>}
            <CharacteristicStrip character={template} />
            <span className="cta">
              <Icon name="play.fill" size={13} />
              {t("Play as %@", name)}
            </span>
          </button>
          <button type="button" className="hero-option glass glass-interactive" onClick={onCreate}>
            <div className="row" style={{ gap: 14 }}>
              <div className="avatar" aria-hidden>
                <Icon name="person.badge.plus" size={26} />
              </div>
              <span className="title">{t("Create your own hero")}</span>
            </div>
            <span className="secondary">
              {t("Roll your characteristics, choose an occupation, and spend skill points by the Call of Cthulhu rules. Different skills open different paths through the story.")}
            </span>
            <span className="callout tertiary">{t("You’ll still start with what the story gives its hero: %@.", storyKit(story, template, uiLanguage))}</span>
            <span className="cta">
              <Icon name="person.badge.plus" size={14} />
              {t("Create a Hero")}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}

/// What a created hero inherits from the story's hero, e.g. “Phone directory, Flashlight, 3 AP”.
function storyKit(story: Story, template: StoryCharacter, language: string): string {
  const items = template.itemIds.map((id) => findItem(story, id)).flatMap((item) => (item ? [resolve(item.name, language)] : []));
  const parts = [...items, t("%lld AP", template.ap)];
  if (template.gold > 0) parts.push(t("%lld gold", template.gold));
  return parts.join(t(", "));
}

function CharacteristicStrip({ character }: { character: StoryCharacter }) {
  return (
    <div className="characteristic-strip">
      {CHARACTERISTICS.map((c) => (
        <span key={c} className="column" style={{ alignItems: "center", gap: 1 }}>
          <span className="abbr">{ABBREVIATIONS[c]}</span>
          <span className="mono-digits">{character.characteristics[c]}</span>
        </span>
      ))}
    </div>
  );
}

// MARK: Characteristics

function CharacteristicsStep({ draft, method, setMethod, update }: {
  draft: StoryCharacter;
  method: CharacteristicMethod;
  setMethod: (method: CharacteristicMethod) => void;
  update: (change: (draft: StoryCharacter) => void) => void;
}) {
  const values = draft.characteristics;
  const left = POINT_BUY_TOTAL - pointBuySpent(values);
  const switchMethod = (m: CharacteristicMethod) => {
    if (m === method) return;
    setMethod(m);
    update((d) => void (d.characteristics = m === "pointBuy" ? pointBuyStart(d.characteristics.luck) : rollCharacteristics()));
  };
  const accessory =
    method === "roll" ? (
      <button type="button" className="btn btn-glass btn-large" onClick={() => update((d) => void (d.characteristics = rollCharacteristics()))}>
        <Icon name="dice" size={15} />
        {t("Roll Again")}
      </button>
    ) : (
      <span className="mono-digits" style={{ fontWeight: 600, color: left < 0 ? "var(--health)" : undefined }}>
        {t("%lld of %lld points left", left, POINT_BUY_TOTAL)}
      </span>
    );

  return (
    <>
      <StepHeader
        title={t("Characteristics")}
        subtitle={
          method === "roll"
            ? t("Rolled as 3D6 × 5, or (2D6 + 6) × 5 for SIZ, INT, and EDU. Roll as often as you like.")
            : t("Spread %lld points over every characteristic but Luck, each from %lld to %lld. Luck is rolled.", POINT_BUY_TOTAL, POINT_BUY_RANGE[0], POINT_BUY_RANGE[1])
        }
        accessory={accessory}
      />
      <div className="creator-body">
        <Segmented
          value={method}
          options={[
            { value: "roll", label: t("Roll dice") },
            { value: "pointBuy", label: t("Point buy") },
          ]}
          onChange={switchMethod}
          style={{ alignSelf: "flex-start" }}
        />
        <div className="creator-characteristics">
          {CHARACTERISTICS.map((c) => (
            <CharacteristicBox
              key={c}
              characteristic={c}
              value={values[c]}
              adjustable={method === "pointBuy" && c !== "luck"}
              canRaise={left >= 5}
              onChange={(v) => update((d) => void (d.characteristics[c] = v))}
            />
          ))}
        </div>
        <DerivedValues character={draft} />
      </div>
    </>
  );
}

function CharacteristicBox({ characteristic, value, adjustable, canRaise, onChange }: {
  characteristic: Characteristic;
  value: number;
  adjustable: boolean;
  canRaise: boolean;
  onChange: (value: number) => void;
}) {
  const [low, high] = POINT_BUY_RANGE;
  return (
    <div className="characteristic-box">
      <span className="abbr">{ABBREVIATIONS[characteristic]}</span>
      <span className="value">{value}</span>
      <span className="parts">
        {characteristicName(characteristic)} · {div(value, 2)} · {div(value, 5)}
      </span>
      {adjustable && <Stepper value={value} min={low} max={canRaise ? high : value} step={5} label={characteristicName(characteristic)} onChange={onChange} />}
    </div>
  );
}

function DerivedValues({ character }: { character: StoryCharacter }) {
  const c = character.characteristics;
  const chips: [string, string][] = [
    [t("Hit points"), String(hitPoints(c))],
    [t("Magic points"), String(magicPoints(c))],
    [t("Sanity"), String(startingSanity(c))],
    [t("Move"), String(moveRate(c, character.age))],
    [t("Build"), String(build(c))],
    [t("Damage bonus"), damageBonusLabel(damageBonus(c.strength + c.size))],
  ];
  return (
    <div className="derived-chips">
      {chips.map(([title, value]) => (
        <div key={title} className="derived-chip">
          <span className="value">{value}</span>
          <span className="title">{title}</span>
        </div>
      ))}
    </div>
  );
}

// MARK: Occupation

function OccupationStep({ draft, update }: { draft: StoryCharacter; update: (change: (draft: StoryCharacter) => void) => void }) {
  const { uiLanguage } = useSettings();
  const catalog = useCatalog();
  const wealth = wealthSkill(catalog);
  const name = (id: string) => occupationName(catalog, id, uiLanguage);
  const sorted = [...catalog.occupations].sort((a, b) => name(a.id).localeCompare(name(b.id), uiLanguage));
  return (
    <>
      <StepHeader title={t("Occupation")} subtitle={t("Your occupation sets your occupation skill points and which skills they can go into.")} />
      <div className="creator-body">
        <div className="occupation-list">
          {sorted.map((job) => {
            const selected = job.id === draft.occupationId;
            return (
              <button
                key={job.id}
                type="button"
                className={`occupation-row glass glass-interactive ${selected ? "glass-tinted" : ""}`}
                aria-pressed={selected}
                onClick={() => !selected && update((d) => chooseOccupation(catalog, d, job.id))}
              >
                <span className="column" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                  <span className="row title" style={{ gap: 8 }}>
                    {name(job.id)}
                    {selected && <Icon name="checkmark" size={15} className="accent" />}
                  </span>
                  <span className="caption secondary">{occupationSkillsText(catalog, job, uiLanguage)}</span>
                </span>
                <span className="column" style={{ gap: 2, alignItems: "flex-end", flexShrink: 0 }}>
                  <span className="mono-digits" style={{ fontWeight: 600, fontSize: 17 }}>
                    {formulaPoints(job.points, draft.characteristics)}
                  </span>
                  <span className="caption tertiary">{formulaText(job.points)}</span>
                  {wealth && (
                    <span className="caption tertiary">
                      {resolve(wealth.name, uiLanguage)} {job.wealth[0]}–{job.wealth[1]}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// MARK: Skills

function SkillsStep({ draft, update }: { draft: StoryCharacter; update: (change: (draft: StoryCharacter) => void) => void }) {
  const { uiLanguage } = useSettings();
  const catalog = useCatalog();
  const job = catalog.occupation(draft.occupationId)!;
  const occupationLeft = occupationPointBudget(catalog, draft) - occupationPointsSpent(draft);
  const personalLeft = personalPointBudget(draft) - personalPointsSpent(draft);
  const allowed = creationSkillIds(catalog, job.id);
  const occupationIds = occupationSkillIds(catalog, job).filter((id) => allowed.includes(id));
  const name = (id: string) => skillName(catalog, id, uiLanguage);
  const otherIds = allowed.filter((id) => !occupationIds.includes(id)).sort((a, b) => name(a).localeCompare(name(b), uiLanguage));
  const problems = skillProblems(catalog, draft);

  return (
    <>
      <StepHeader
        title={t("Skills")}
        subtitle={t("Occupation points go into %@’s skills; personal points (INT × 2) into any skill. Skills can’t go above 99.", occupationName(catalog, job.id, uiLanguage))}
        accessory={
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-glass" onClick={() => update((d) => clearPoints(catalog, d))}>
              <Icon name="arrow.counterclockwise" size={13} />
              {t("Clear Points")}
            </button>
            <button type="button" className="btn btn-glass" disabled={occupationLeft <= 0 && personalLeft <= 0} onClick={() => update((d) => autoSpend(catalog, d))}>
              <Icon name="wand.and.stars" size={13} />
              {t("Spend for Me")}
            </button>
          </div>
        }
      />
      <div className="row" style={{ gap: 12 }}>
        <Budget title={t("Occupation points")} left={occupationLeft} total={occupationPointBudget(catalog, draft)} />
        <Budget title={t("Personal points")} left={personalLeft} total={personalPointBudget(draft)} />
      </div>
      {problems.length > 0 && (
        <div className="column callout" style={{ gap: 4, color: "var(--warning)" }}>
          {problems.map((problem, i) => (
            <span key={i} className="row" style={{ gap: 6 }}>
              <Icon name="exclamationmark.triangle" size={13} />
              {problemText(problem, name)}
            </span>
          ))}
        </div>
      )}
      <div className="creator-body">
        <SkillTable title={t("Occupation skills")} ids={occupationIds} draft={draft} update={update} />
        <SkillTable title={t("Other skills")} ids={otherIds} draft={draft} update={update} />
      </div>
    </>
  );
}

function problemText(problem: IssueKind, skillName: (id: string) => string): string {
  switch (problem.type) {
    case "occupationPointsOverspent":
      return t("You’ve spent %lld occupation points but have %lld.", problem.spent, problem.budget);
    case "personalPointsOverspent":
      return t("You’ve spent %lld personal points but have %lld.", problem.spent, problem.budget);
    case "skillTooHigh":
      return t("%@ is above 99.", skillName(problem.skillId));
    case "creditRatingOutOfRange":
      return t("Credit Rating must be from %lld to %lld for this occupation.", problem.range[0], problem.range[1]);
    case "notAnOccupationSkill":
      return t("%@ isn’t one of your occupation’s skills.", skillName(problem.skillId));
    default:
      return t("These skills break the character creation rules.");
  }
}

function Budget({ title, left, total }: { title: string; left: number; total: number }) {
  return (
    <div className="budget glass">
      <span className="caption secondary">{title}</span>
      <span className="mono-digits" style={{ fontSize: 18, fontWeight: 600, color: left < 0 ? "var(--health)" : undefined }}>
        {t("%lld of %lld left", left, total)}
      </span>
    </div>
  );
}

function SkillTable({ title, ids, draft, update }: {
  title: string;
  ids: string[];
  draft: StoryCharacter;
  update: (change: (draft: StoryCharacter) => void) => void;
}) {
  return (
    <FormSection header={title}>
      <div className="skill-line head">
        <span>{t("Skill")}</span>
        <span>{t("Base")}</span>
        <span>{t("Occupation")}</span>
        <span>{t("Personal")}</span>
        <span>{t("Total")}</span>
      </div>
      {ids.map((id) => (
        <SkillLine key={id} skillId={id} draft={draft} update={update} />
      ))}
    </FormSection>
  );
}

function SkillLine({ skillId, draft, update }: { skillId: string; draft: StoryCharacter; update: (change: (draft: StoryCharacter) => void) => void }) {
  const { uiLanguage } = useSettings();
  const catalog = useCatalog();
  const entry = entryFor(draft, skillId);
  const base = skillBase(catalog, skillId, draft.characteristics);
  const value = entry ? entryValue(catalog, entry, draft.characteristics) : skillValue(catalog, [], draft.characteristics, skillId);
  const occupationBudget = occupationPointBudget(catalog, draft);
  const personalBudget = personalPointBudget(draft);
  const points = (key: "occupationPoints" | "personalPoints", budget: number) => (
    <span className="row" style={{ gap: 4 }}>
      <NumberInput
        className="narrow"
        value={entry?.[key] ?? 0}
        min={0}
        max={budget}
        ariaLabel={`${skillName(catalog, skillId, uiLanguage)} ${key === "occupationPoints" ? t("Occupation") : t("Personal")}`}
        onChange={(v) => update((d) => setPoints(catalog, d, skillId, key, v))}
      />
      <Stepper value={entry?.[key] ?? 0} min={0} max={budget} step={5} onChange={(v) => update((d) => setPoints(catalog, d, skillId, key, v))} />
    </span>
  );
  return (
    <div className="skill-line">
      <span style={{ minWidth: 0 }}>
        {skillName(catalog, skillId, uiLanguage)}
        {entry && !isBlank(entry.specialty) && <span className="secondary"> ({resolve(entry.specialty, uiLanguage)})</span>}
      </span>
      <span className="mono-digits secondary">{base}</span>
      {canTakeOccupationPoints(catalog, draft, skillId) ? points("occupationPoints", occupationBudget) : <span className="tertiary">—</span>}
      {points("personalPoints", personalBudget)}
      <span className="mono-digits" style={{ fontWeight: 600, color: value > 99 ? "var(--health)" : undefined }}>
        {value}
        <span className="caption tertiary"> {div(value, 2)}·{div(value, 5)}</span>
      </span>
    </div>
  );
}

// MARK: Identity

function IdentityStep({ story, draft, name, setName, background, setBackground, update }: {
  story: Story;
  draft: StoryCharacter;
  name: string;
  setName: (name: string) => void;
  background: string;
  setBackground: (background: string) => void;
  update: (change: (draft: StoryCharacter) => void) => void;
}) {
  const { uiLanguage } = useSettings();
  const catalog = useCatalog();
  const job = catalog.occupation(draft.occupationId);
  const best = [...draft.skills]
    .map((entry) => ({ entry, value: entryValue(catalog, entry, draft.characteristics) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  return (
    <>
      <StepHeader title={t("Identity")} subtitle={t("Name your hero. Age only changes how fast they move once they’re past 40.")} />
      <div className="creator-body">
        <FormSection>
          <FormRow label={t("Name")}>
            <input
              className="text-field"
              value={name}
              autoFocus
              placeholder={t("Required")}
              aria-label={t("Name")}
              onChange={(e) => setName(e.target.value)}
            />
          </FormRow>
          <FormRow label={t("Age")}>
            <NumberInput value={draft.age} min={AGE_RANGE[0]} max={AGE_RANGE[1]} ariaLabel={t("Age")} onChange={(v) => update((d) => void (d.age = v))} />
            <Stepper value={draft.age} min={AGE_RANGE[0]} max={AGE_RANGE[1]} label={t("Age")} onChange={(v) => update((d) => void (d.age = v))} />
          </FormRow>
          <FormRow label={t("Background")}>
            <input
              className="text-field"
              value={background}
              placeholder={t("Optional, e.g. Grew up by the sea")}
              aria-label={t("Background")}
              onChange={(e) => setBackground(e.target.value)}
            />
          </FormRow>
        </FormSection>

        <div className="hero-summary glass">
          <div className="row" style={{ gap: 14 }}>
            <div className="avatar" aria-hidden>
              {Array.from(name.trim())[0] ?? "?"}
            </div>
            <div className="column" style={{ gap: 3, minWidth: 0 }}>
              <span className="serif" style={{ fontSize: 26 }}>
                {name.trim() || t("Your hero")}
              </span>
              <span className="callout secondary">
                {[job ? occupationName(catalog, job.id, uiLanguage) : null, background.trim() || null, t("Age %lld", draft.age)].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>
          <CharacteristicStrip character={draft} />
          <DerivedValues character={draft} />
          <div className="best-skills">
            {best.map(({ entry, value }) => (
              <span key={entry.id} className="skill-chip">
                {skillName(catalog, entry.skillId, uiLanguage)} <span className="mono-digits accent">{value}</span>
              </span>
            ))}
          </div>
          <span className="caption tertiary">{t("From the story: %@.", storyKit(story, draft, uiLanguage))}</span>
        </div>
      </div>
    </>
  );
}
