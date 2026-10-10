// The right-hand panel: edits the selected node or sheet entry, or the story as a whole when nothing is selected.

import type { Draft } from "immer";
import { useRef, useState, type ReactNode } from "react";
import { api, chooseAudioFiles, errorMessage } from "../api";
import {
  Alert,
  ButtonRow,
  Disclosure,
  FormRow,
  FormSection,
  NumberField,
  NumberInput,
  Popover,
  Segmented,
  Select,
  showMenuBelow,
  ToggleRow,
  type SelectGroup,
  type SelectOption,
} from "../components/ui";
import { conditionsMet } from "../game/gameState";
import { opponent } from "../game/battle";
import { formatBytes, formatOrList, t } from "../i18n";
import { Icon, PICKABLE_SYMBOLS } from "../icons";
import {
  categoryName,
  characteristicName,
  checkTargetName,
  comparisonName,
  difficultyName,
  occupationName,
  occurrenceName,
  outcomeName,
  PHASE_KEYS,
  phaseName,
  skillName,
  specialtyName,
  timeWindowSummary,
  triggerModeName,
} from "../model/names";
import {
  ABBREVIATIONS,
  build,
  CHARACTERISTICS,
  CHECK_DIFFICULTIES,
  damageBonus,
  damageBonusLabel,
  div,
  hitPoints,
  magicPoints,
  moveRate,
  rollCharacteristics,
  startingSanity,
  targetNumber,
} from "../model/rules";
import {
  allowsOccupationPoints,
  baseValue,
  CUSTOM_POINTS,
  entryValue,
  occupation,
  occupationPointBudget,
  occupationPointsSpent,
  OCCUPATIONS,
  personalPointBudget,
  personalPointsSpent,
  skillDefinition,
  SKILLS,
  valueForTarget,
  type Occupation,
  type SkillPointFormula,
} from "../model/skills";
import {
  entrance,
  findChapter,
  findCharacter,
  findEvent,
  findItem,
  findLocation,
  findMonster,
  findNode,
  hasLocation,
  heroCharacter,
  kindTitle,
  makeId,
  makeRoute,
  neighbors,
  routeConnects,
  routeEquals,
  routeOther,
  startNode,
  storyTitle,
} from "../model/story";
import { isBlank, localizedText, resolve, translation, withTranslation } from "../model/storyText";
import type {
  Characteristic,
  CharacteristicCondition,
  DamageRoll,
  Item,
  ItemCategory,
  LocationRoute,
  MusicCue,
  MusicTrack,
  NodeKind,
  NodeType,
  Outcome,
  Story,
  StoryCharacter,
  StoryLocation,
  StoryNode,
  StoryText,
  TriggerMode,
} from "../model/types";
import { MusicPlayer, useCurrentTrack } from "../music";
import { useSettings } from "../settings";
import { useDocument, type StoryDocument } from "./document";
import { IssueList } from "./issues";
import { newOption, typeColor, typeName, typeSummary, typeSymbol } from "./nodeTypes";

type KindOf<T extends NodeType> = Extract<NodeKind, { type: T }>;
type KindUpdate<T extends NodeType> = (change: (kind: Draft<KindOf<T>>) => void) => void;

export function Inspector({ document, preview }: { document: StoryDocument; preview: MusicPlayer }) {
  useDocument(document);
  const selection = document.selection;
  const story = document.story;
  let content: ReactNode;
  if (selection?.type === "node" && findNode(story, selection.id)) {
    content = <NodeEditor key={selection.id} document={document} nodeId={selection.id} preview={preview} />;
  } else if (selection?.type === "nodes") {
    content = <MultipleNodes document={document} nodeIds={selection.ids} />;
  } else if (selection?.type === "character" && findCharacter(story, selection.id)) {
    content = <CharacterEditor key={selection.id} document={document} characterId={selection.id} />;
  } else if (selection?.type === "item" && findItem(story, selection.id)) {
    content = <ItemEditor key={selection.id} document={document} itemId={selection.id} />;
  } else if (selection?.type === "monster" && findMonster(story, selection.id)) {
    content = <MonsterEditor key={selection.id} document={document} monsterId={selection.id} />;
  } else if (selection?.type === "location" && findLocation(story, selection.id)) {
    content = <LocationEditor key={selection.id} document={document} locationId={selection.id} />;
  } else if (selection?.type === "event" && findEvent(story, selection.id)) {
    content = <EventEditor key={selection.id} document={document} eventId={selection.id} />;
  } else if (selection?.type === "route") {
    content = <RouteView document={document} route={selection.route} />;
  } else {
    content = <StoryOverview document={document} preview={preview} />;
  }
  return <aside className="inspector">{content}</aside>;
}

// MARK: - Fields

/// Edits one language of a story text. When that language is missing, the source text shows as a placeholder.
export function LocalizedField({ title, text, language, multiline, prompt, onChange }: {
  title: string;
  text: StoryText;
  language: string;
  multiline?: boolean;
  prompt?: string;
  onChange: (text: StoryText) => void;
}) {
  const value = translation(text, language) ?? "";
  const placeholder = translation(text, language) === undefined && !isBlank(text) ? resolve(text, language) : prompt;
  const change = (next: string) => onChange(withTranslation(text, language, next === "" ? undefined : next));
  if (multiline) {
    return (
      <FormRow stack>
        <span>{title}</span>
        <textarea className="text-field" value={value} placeholder={placeholder} aria-label={title} rows={4} onChange={(e) => change(e.target.value)} />
      </FormRow>
    );
  }
  return (
    <FormRow label={title}>
      <input className="text-field" value={value} placeholder={placeholder} aria-label={title} style={{ maxWidth: "64%" }} onChange={(e) => change(e.target.value)} />
    </FormRow>
  );
}

/// A name field shown large next to the entry's icon, at the top of a sheet editor.
function NameRow({ symbol, onSymbol, text, language, onChange, prompt }: {
  symbol: string;
  onSymbol: (symbol: string) => void;
  text: StoryText;
  language: string;
  onChange: (text: StoryText) => void;
  prompt?: string;
}) {
  return (
    <FormRow>
      <SymbolField symbol={symbol} onChange={onSymbol} large />
      <input
        className="text-field inline-title"
        value={translation(text, language) ?? ""}
        placeholder={translation(text, language) === undefined && !isBlank(text) ? resolve(text, language) : (prompt ?? t("Name"))}
        aria-label={t("Name")}
        onChange={(e) => onChange(withTranslation(text, language, e.target.value === "" ? undefined : e.target.value))}
      />
    </FormRow>
  );
}

/// An icon, picked from a grid or typed as an SF Symbol name (the format story files use).
function SymbolField({ symbol, onChange, large }: { symbol: string; onChange: (symbol: string) => void; large?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" className={`symbol-button ${large ? "large" : ""}`} title={t("Change icon")} onClick={() => setOpen((o) => !o)}>
        <Icon name={symbol === "" ? "questionmark" : symbol} size={large ? 19 : 15} />
      </button>
      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} width={316}>
          <div className="column" style={{ gap: 10, padding: 14 }}>
            <span style={{ fontWeight: 600 }}>{t("Icon")}</span>
            <div className="symbol-grid">
              {PICKABLE_SYMBOLS.map((name) => (
                <button key={name} type="button" title={name} className={name === symbol ? "selected" : ""} onClick={() => onChange(name)}>
                  <Icon name={name} size={16} />
                </button>
              ))}
            </div>
            <span className="caption secondary">{t("SF Symbol name")}</span>
            <input className="text-field" value={symbol} placeholder="sparkles" onChange={(e) => onChange(e.target.value)} />
          </div>
        </Popover>
      )}
    </>
  );
}

function DecimalField({ title, value, onChange, max }: { title: string; value: number; onChange: (value: number) => void; max: number }) {
  return <NumberField title={title} value={value} onChange={onChange} min={0} max={max} step={0.5} decimals={2} />;
}

/// Dice for damage: count, sides, and a flat bonus, e.g. 1D8+1.
function DamageRollField({ title, value, onChange }: { title: string; value: DamageRoll; onChange: (value: DamageRoll) => void }) {
  return (
    <FormRow label={title}>
      <span className="row mono-digits" style={{ gap: 4 }}>
        <NumberInput className="narrow" value={value.count} min={1} max={20} ariaLabel={t("Dice")} onChange={(count) => onChange({ ...value, count })} />
        D
        <NumberInput className="narrow" value={value.sides} min={1} max={100} ariaLabel={t("Sides")} onChange={(sides) => onChange({ ...value, sides })} />
        +
        <NumberInput className="narrow" value={value.bonus} min={-99} max={99} ariaLabel={t("Bonus")} onChange={(bonus) => onChange({ ...value, bonus })} />
      </span>
    </FormRow>
  );
}

function SelectRow({ title, value, options, onChange }: {
  title: string;
  value: string;
  options: (SelectOption | SelectGroup)[];
  onChange: (value: string) => void;
}) {
  return (
    <FormRow label={title}>
      <Select value={value} options={options} onChange={onChange} ariaLabel={title} />
    </FormRow>
  );
}

function SegmentedRow<T extends string | boolean>({ title, value, options, onChange }: {
  title: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <FormRow label={title}>
      <Segmented value={value} options={options} onChange={onChange} style={{ minWidth: "58%" }} />
    </FormRow>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="form-row">
      <span className="form-note">{children}</span>
    </div>
  );
}

function nameOf(text: StoryText, language: string): string {
  return isBlank(text) ? t("Unnamed") : resolve(text, language);
}

/// A row that jumps to a node on the canvas.
function NodeLink({ node, document }: { node: StoryNode; document: StoryDocument }) {
  const type = node.kind.type;
  return (
    <div role="button" className="form-row button-row" style={{ color: "var(--text)" }} onClick={() => (document.selection = { type: "node", id: node.id })}>
      <Icon name={typeSymbol(type)} size={14} style={{ color: typeColor(type) }} />
      {isBlank(kindTitle(node.kind)) ? typeName(type) : resolve(kindTitle(node.kind), document.language)}
    </div>
  );
}

function UsageSection({ nodes, document, empty }: { nodes: StoryNode[]; document: StoryDocument; empty?: string }) {
  return (
    <FormSection header={t("Used By")}>
      {nodes.length === 0 && (
        <FormRow>
          <span className="secondary">{empty ?? t("No node uses this yet.")}</span>
        </FormRow>
      )}
      {nodes.map((node) => (
        <NodeLink key={node.id} node={node} document={document} />
      ))}
    </FormSection>
  );
}

/// A list of item-sheet references with a menu to add more.
function ItemReferenceList({ title, itemIds, items, language, onChange }: {
  title: string;
  itemIds: string[];
  items: Item[];
  language: string;
  onChange: (ids: string[]) => void;
}) {
  const available = items.filter((i) => !itemIds.includes(i.id));
  return (
    <>
      <FormRow label={title}>
        <button
          type="button"
          className="btn btn-borderless"
          onClick={(e) =>
            showMenuBelow(
              e.currentTarget,
              available.length === 0
                ? [{ note: t("Add items to the item sheet first.") }]
                : available.map((item) => ({ label: resolve(item.name, language), icon: item.symbol, action: () => onChange([...itemIds, item.id]) })),
            )
          }
        >
          <Icon name="plus" size={13} />
          {t("Add")}
        </button>
      </FormRow>
      {itemIds.map((id) => {
        const item = items.find((i) => i.id === id);
        return (
          <FormRow key={id}>
            <span className="row" style={{ gap: 8, flex: 1, color: item ? undefined : "var(--text-secondary)" }}>
              <Icon name={item ? item.symbol : "questionmark.square.dashed"} size={14} />
              {item ? resolve(item.name, language) : t("Missing item")}
            </span>
            <RemoveButton title={t("Remove")} onClick={() => onChange(itemIds.filter((i) => i !== id))} />
          </FormRow>
        );
      })}
    </>
  );
}

function RemoveButton({ title, onClick, symbol = "minus.circle" }: { title: string; onClick: () => void; symbol?: string }) {
  return (
    <button type="button" className="btn btn-borderless" title={title} aria-label={title} onClick={onClick}>
      <Icon name={symbol} size={15} />
    </button>
  );
}

// MARK: - Node editor

function NodeEditor({ document, nodeId, preview }: { document: StoryDocument; nodeId: string; preview: MusicPlayer }) {
  const node = findNode(document.story, nodeId)!;
  const type = node.kind.type;
  const language = document.language;
  const update = (change: (kind: Draft<NodeKind>) => void) => document.updateNode(nodeId, (n) => change(n.kind));

  let editor: ReactNode;
  switch (node.kind.type) {
    case "entrance":
      editor = <EntranceEditor kind={node.kind} update={update as KindUpdate<"entrance">} document={document} />;
      break;
    case "narration":
      editor = <NarrationEditor kind={node.kind} update={update as KindUpdate<"narration">} language={language} />;
      break;
    case "choice": {
      const here = findLocation(document.story, node.locationId) ? new Set([node.locationId]) : (document.arriving.get(nodeId) ?? new Set<string>());
      editor = <ChoiceEditor kind={node.kind} update={update as KindUpdate<"choice">} document={document} here={here} />;
      break;
    }
    case "check":
      editor = <CheckEditor kind={node.kind} update={update as KindUpdate<"check">} document={document} />;
      break;
    case "battle":
      editor = <BattleEditor kind={node.kind} update={update as KindUpdate<"battle">} document={document} />;
      break;
    case "end":
      editor = <EndEditor kind={node.kind} update={update as KindUpdate<"end">} language={language} />;
      break;
    case "chapterStart":
      editor = <ChapterStartEditor kind={node.kind} update={update as KindUpdate<"chapterStart">} document={document} chapterId={node.chapterId} />;
      break;
    case "chapterJump":
      editor = <ChapterJumpEditor kind={node.kind} update={update as KindUpdate<"chapterJump">} document={document} />;
      break;
    case "event":
      editor = <EventNodeEditor kind={node.kind} update={update as KindUpdate<"event">} document={document} />;
      break;
  }

  return (
    <div className="form">
      <FormSection>
        <div className="inspector-heading">
          <Icon name={typeSymbol(type)} size={18} style={{ color: typeColor(type), marginTop: 2 }} />
          <span className="column" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{typeName(type)}</span>
            <span className="caption secondary">{typeSummary(type)}</span>
          </span>
        </div>
        {document.issuesFor(nodeId).length > 0 && <IssueList issues={document.issuesFor(nodeId)} story={document.story} language={language} />}
      </FormSection>

      {editor}

      {hasLocation(node.kind) && (
        <LocationReferenceSection
          selection={node.locationId}
          onChange={(id) => document.updateNode(nodeId, (n) => void (n.locationId = id))}
          document={document}
          arriving={document.arriving.get(nodeId) ?? new Set()}
        />
      )}

      <MusicSection music={node.music} tracks={document.story.tracks} preview={preview} onChange={(music) => document.updateNode(nodeId, (n) => void (n.music = music))} />

      <FormSection>
        {type !== "entrance" && type !== "chapterStart" && (
          <ButtonRow symbol="plus.square.on.square" title={t("Duplicate Node")} onClick={() => document.duplicateNode(nodeId)} />
        )}
        <ButtonRow symbol="trash" title={t("Delete Node")} destructive onClick={() => document.deleteNode(nodeId)} />
      </FormSection>
    </div>
  );
}

// MARK: Several nodes

function MultipleNodes({ document, nodeIds }: { document: StoryDocument; nodeIds: string[] }) {
  const nodes = document.story.nodes.filter((n) => nodeIds.includes(n.id));
  const types: NodeType[] = ["entrance", "chapterStart", "narration", "choice", "check", "event", "battle", "end", "chapterJump"];
  return (
    <div className="form">
      <FormSection footer={t("Drag any selected node to move them together. ⇧-click a node to add or remove it.")}>
        <FormRow>
          <Icon name="square.on.square" size={16} />
          <span style={{ fontWeight: 600 }}>{t("%lld nodes selected", nodes.length)}</span>
        </FormRow>
        {types.map((type) => {
          const count = nodes.filter((n) => n.kind.type === type).length;
          return count === 0 ? null : (
            <FormRow
              key={type}
              label={
                <span className="row" style={{ gap: 8 }}>
                  <Icon name={typeSymbol(type)} size={14} style={{ color: typeColor(type) }} />
                  {typeName(type)}
                </span>
              }
            >
              <span className="value">{count}</span>
            </FormRow>
          );
        })}
      </FormSection>
      <FormSection>
        <ButtonRow symbol="xmark.circle" title={t("Deselect All")} onClick={() => (document.selection = null)} />
        <ButtonRow symbol="trash" title={t("Delete Selected Nodes")} destructive onClick={() => document.deleteNodes(nodeIds)} />
      </FormSection>
    </div>
  );
}

// MARK: Kind editors

function EntranceEditor({ kind, update, document }: { kind: KindOf<"entrance">; update: KindUpdate<"entrance">; document: StoryDocument }) {
  const language = document.language;
  return (
    <>
      <FormSection header={t("Story")}>
        <LocalizedField title={t("Title")} text={kind.title} language={language} onChange={(v) => update((k) => void (k.title = v))} />
        <FormRow label={t("Author")}>
          <input className="text-field" style={{ maxWidth: "64%" }} value={document.story.author} aria-label={t("Author")} onChange={(e) => document.setAuthor(e.target.value)} />
        </FormRow>
        <LocalizedField
          title={t("Background")}
          text={kind.background}
          language={language}
          multiline
          prompt={t("The world, the stakes, and what came before.")}
          onChange={(v) => update((k) => void (k.background = v))}
        />
        <LocalizedField
          title={t("Introduction")}
          text={kind.intro}
          language={language}
          multiline
          prompt={t("The opening moment the player steps into.")}
          onChange={(v) => update((k) => void (k.intro = v))}
        />
        <NumberField title={t("Starting day")} value={kind.startDay} min={1} max={999} onChange={(v) => update((k) => void (k.startDay = v))} />
        <SelectRow
          title={t("Time of day")}
          value={String(kind.startPhase)}
          options={PHASE_KEYS.map((key, index) => ({ value: String(index), label: t(key) }))}
          onChange={(v) => update((k) => void (k.startPhase = Number(v)))}
        />
      </FormSection>

      <CharacterReferenceSection
        title={t("Hero")}
        selection={kind.heroId}
        onChange={(id) => update((k) => void (k.heroId = id))}
        document={document}
        footer={t("The character the player controls. Characteristics, stats, and starting items come from the character sheet.")}
      />

      <FormSection header={t("Quest")}>
        <LocalizedField title={t("Quest")} text={kind.quest.title} language={language} onChange={(v) => update((k) => void (k.quest.title = v))} />
        <LocalizedField title={t("Objective")} text={kind.quest.objective} language={language} onChange={(v) => update((k) => void (k.quest.objective = v))} />
      </FormSection>
    </>
  );
}

/// Picks a character-sheet entry for a node, with shortcuts to edit it or create a new one.
function CharacterReferenceSection({ title, selection, onChange, document, footer }: {
  title: string;
  selection: string;
  onChange: (id: string) => void;
  document: StoryDocument;
  footer: string;
}) {
  const language = document.language;
  const character = findCharacter(document.story, selection);
  const options: SelectOption[] = [
    ...(character ? [] : [{ value: selection, label: t("None") }]),
    ...document.story.characters.map((c) => ({ value: c.id, label: nameOf(c.name, language) })),
  ];
  return (
    <FormSection header={title} footer={footer}>
      <SelectRow title={t("Character")} value={selection} options={options} onChange={onChange} />
      {character && (
        <>
          <FormRow>
            <span className="tile-icon" style={{ width: 36, height: 36, borderRadius: 10 }}>
              <Icon name={character.symbol} size={18} />
            </span>
            <span className="column" style={{ gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{resolve(character.name, language)}</span>
              <span className="caption secondary">
                {t("Level %lld · %lld HP · DEX %lld", character.level, hitPoints(character.characteristics), character.characteristics.dexterity)}
              </span>
            </span>
          </FormRow>
          <ButtonRow symbol="pencil" title={t("Edit Character")} onClick={() => (document.selection = { type: "character", id: character.id })} />
        </>
      )}
      <ButtonRow
        symbol="person.badge.plus"
        title={t("New Character")}
        onClick={() => {
          const current = document.selection;
          const id = document.addCharacter();
          onChange(id);
          document.selection = current;
        }}
      />
    </FormSection>
  );
}

function NarrationEditor({ kind, update, language }: { kind: KindOf<"narration">; update: KindUpdate<"narration">; language: string }) {
  return (
    <FormSection header={t("Passage")}>
      <LocalizedField title={t("Title")} text={kind.title} language={language} prompt={t("Optional")} onChange={(v) => update((k) => void (k.title = v))} />
      <LocalizedField
        title={t("Text")}
        text={kind.body}
        language={language}
        multiline
        prompt={t("Separate paragraphs with a blank line.")}
        onChange={(v) => update((k) => void (k.body = v))}
      />
      <LocalizedField title={t("Quote")} text={kind.quote} language={language} prompt={t("Optional line of dialogue")} onChange={(v) => update((k) => void (k.quote = v))} />
      <LocalizedField
        title={t("Presence")}
        text={kind.presence}
        language={language}
        prompt={t("Optional, e.g. “Someone is watching”")}
        onChange={(v) => update((k) => void (k.presence = v))}
      />
    </FormSection>
  );
}

/// Where the hero is at a node, for suggesting places one road away.
interface PlaceContext {
  locations: StoryLocation[];
  /// The places the hero can be at; empty when nothing before sets one.
  here: Set<string>;
  /// `here` plus everywhere one road away from it.
  nearby: Set<string>;
  language: string;
}

function placeContext(story: Story, here: Set<string>, language: string): PlaceContext {
  const nearby = new Set(here);
  for (const id of here) for (const neighbor of neighbors(story, id)) nearby.add(neighbor);
  return { locations: story.locations, here, nearby, language };
}

/// Picker rows for the location sheet: nearby places first, then the rest.
function placeOptions(places: PlaceContext): (SelectOption | SelectGroup)[] {
  const row = (location: StoryLocation): SelectOption => ({
    value: location.id,
    label: places.here.has(location.id) ? t("%@ · here now", resolve(location.name, places.language)) : nameOf(location.name, places.language),
  });
  if (places.here.size === 0) return places.locations.map(row);
  return [
    { group: t("Nearby"), options: places.locations.filter((l) => places.nearby.has(l.id)).map(row) },
    { group: t("Other locations"), options: places.locations.filter((l) => !places.nearby.has(l.id)).map(row) },
  ];
}

function ChoiceEditor({ kind, update, document, here }: { kind: KindOf<"choice">; update: KindUpdate<"choice">; document: StoryDocument; here: Set<string> }) {
  const language = document.language;
  const maxAP = heroCharacter(document.story)?.ap ?? 12;
  const places = placeContext(document.story, here, language);
  return (
    <>
      <FormSection header={t("Scene")}>
        <LocalizedField title={t("Title")} text={kind.title} language={language} onChange={(v) => update((k) => void (k.title = v))} />
        <LocalizedField
          title={t("Text")}
          text={kind.body}
          language={language}
          multiline
          prompt={t("Separate paragraphs with a blank line.")}
          onChange={(v) => update((k) => void (k.body = v))}
        />
        <LocalizedField title={t("Quote")} text={kind.quote} language={language} prompt={t("Optional line of dialogue")} onChange={(v) => update((k) => void (k.quote = v))} />
        <LocalizedField
          title={t("Presence")}
          text={kind.presence}
          language={language}
          prompt={t("Optional, e.g. “Someone is watching”")}
          onChange={(v) => update((k) => void (k.presence = v))}
        />
      </FormSection>

      {kind.options.map((option, index) => (
        <OptionEditor
          key={option.id}
          option={option}
          index={index}
          count={kind.options.length}
          language={language}
          maxAP={maxAP}
          items={document.story.items}
          places={places}
          update={(change) => update((k) => change(k.options[index]))}
          onMove={(offset) =>
            update((k) => {
              const other = index + offset;
              [k.options[index], k.options[other]] = [k.options[other], k.options[index]];
            })
          }
          onRemove={() => update((k) => void k.options.splice(index, 1))}
        />
      ))}

      <FormSection footer={t("Each option is an output on the node. Wire it to where that choice leads.")}>
        <ButtonRow symbol="plus" title={t("Add Option")} onClick={() => update((k) => void k.options.push(newOption()))} />
      </FormSection>
    </>
  );
}

function OptionEditor({ option, index, count, language, maxAP, items, places, update, onMove, onRemove }: {
  option: KindOf<"choice">["options"][number];
  index: number;
  count: number;
  language: string;
  maxAP: number;
  items: Item[];
  places: PlaceContext;
  update: (change: (option: Draft<KindOf<"choice">["options"][number]>) => void) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  const effect = option.effect;
  const itemChanges = effect.gainItems.length + effect.loseItems.length;
  const header = (
    <>
      <span>{t("Option %lld", index + 1)}</span>
      <span className="spacer" />
      <button type="button" className="btn btn-borderless" disabled={index === 0} title={t("Move Up")} onClick={() => onMove(-1)}>
        <Icon name="chevron.up" size={14} />
      </button>
      <button type="button" className="btn btn-borderless" disabled={index === count - 1} title={t("Move Down")} onClick={() => onMove(1)}>
        <Icon name="chevron.down" size={14} />
      </button>
      <button type="button" className="btn btn-borderless" title={t("Remove Option")} onClick={onRemove}>
        <Icon name="trash" size={14} />
      </button>
    </>
  );
  const moveOptions: SelectOption[] = [{ value: "", label: t("Stay here") }];
  if (effect.moveTo && !places.locations.some((l) => l.id === effect.moveTo)) moveOptions.push({ value: effect.moveTo, label: t("Missing location") });

  return (
    <FormSection header={header}>
      <FormRow>
        <SymbolField symbol={option.symbol} onChange={(s) => update((o) => void (o.symbol = s))} />
        <input
          className="text-field"
          value={translation(option.title, language) ?? ""}
          placeholder={isBlank(option.title) ? t("What the player does") : resolve(option.title, language)}
          aria-label={t("Title")}
          onChange={(e) => update((o) => void (o.title = withTranslation(option.title, language, e.target.value === "" ? undefined : e.target.value)))}
        />
      </FormRow>
      <LocalizedField title={t("Detail")} text={option.detail} language={language} prompt={t("A hint about what happens")} onChange={(v) => update((o) => void (o.detail = v))} />
      <LocalizedField title={t("Tag")} text={option.tag} language={language} prompt={t("Combat · High risk")} onChange={(v) => update((o) => void (o.tag = v))} />
      <FormRow label={t("Action points")}>
        <span className="value">{option.apCost === 0 ? t("Free") : t("%lld AP", option.apCost)}</span>
        <StepperOnly value={option.apCost} min={0} max={maxAP} onChange={(v) => update((o) => void (o.apCost = v))} />
      </FormRow>
      {places.locations.length > 0 && (
        <SelectRow
          title={t("Travel to")}
          value={effect.moveTo ?? ""}
          options={[...moveOptions, ...placeOptions(places)]}
          onChange={(v) => update((o) => void (o.effect.moveTo = v === "" ? null : v))}
        />
      )}
      <Disclosure title={t("Effects")}>
        <NumberField title={t("Health")} value={effect.hp} min={-999} max={999} onChange={(v) => update((o) => void (o.effect.hp = v))} />
        <NumberField title={t("Mana")} value={effect.mp} min={-999} max={999} onChange={(v) => update((o) => void (o.effect.mp = v))} />
        <NumberField title={t("Stamina")} value={effect.stamina} min={-999} max={999} onChange={(v) => update((o) => void (o.effect.stamina = v))} />
        <NumberField title={t("Experience")} value={effect.xp} min={-9999} max={9999} onChange={(v) => update((o) => void (o.effect.xp = v))} />
        <NumberField title={t("Gold")} value={effect.gold} min={-9999} max={9999} onChange={(v) => update((o) => void (o.effect.gold = v))} />
        <NumberField title={t("Sanity")} value={effect.sanity} min={-99} max={99} onChange={(v) => update((o) => void (o.effect.sanity = v))} />
        <ToggleRow title={t("Passes time")} on={effect.passesTime} onChange={(v) => update((o) => void (o.effect.passesTime = v))} />
        <LocalizedField
          title={t("New objective")}
          text={effect.objective ?? []}
          language={language}
          prompt={t("Leave empty to keep the current one")}
          onChange={(v) => update((o) => void (o.effect.objective = v.length === 0 ? null : v))}
        />
        <Note>
          {t(
            "Negative mana, stamina, and gold are costs: while the hero has less than the option takes, it’s shown but can’t be picked. It becomes available again once they have enough.",
          )}
        </Note>
        {effect.hp < 0 && <Note>{t("Damage that leaves the hero at 0 HP kills them. The node gets a Death output; if it isn’t wired, the game ends.")}</Note>}
      </Disclosure>
      <Disclosure title={itemChanges === 0 ? t("Items") : t("Items · %lld", itemChanges)}>
        <ItemReferenceList title={t("Gives")} itemIds={effect.gainItems} items={items} language={language} onChange={(ids) => update((o) => void (o.effect.gainItems = ids))} />
        <ItemReferenceList title={t("Takes")} itemIds={effect.loseItems} items={items} language={language} onChange={(ids) => update((o) => void (o.effect.loseItems = ids))} />
        <Note>{t("An option that takes an item is only available while the hero carries it.")}</Note>
      </Disclosure>
    </FormSection>
  );
}

function StepperOnly({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <span className="stepper">
      <button type="button" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="−">
        <Icon name="minus" size={11} />
      </button>
      <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label="+">
        <Icon name="plus" size={11} />
      </button>
    </span>
  );
}

function characteristicOptions(): SelectOption[] {
  return CHARACTERISTICS.map((c) => ({ value: c, label: `${ABBREVIATIONS[c]} · ${characteristicName(c)}` }));
}

function CheckEditor({ kind, update, document }: { kind: KindOf<"check">; update: KindUpdate<"check">; document: StoryDocument }) {
  const language = document.language;
  const hero = heroCharacter(document.story);
  const rollsSkill = kind.target.type === "skill";
  return (
    <FormSection
      header={t("Check")}
      footer={t(
        "The game rolls d100 and succeeds at or under the target: the full value for Regular, half for Hard, a fifth for Extreme. 01 is always a critical success; 100 is always a fumble, and so is 96–99 when the value is under 50.",
      )}
    >
      <LocalizedField title={t("Title")} text={kind.title} language={language} onChange={(v) => update((k) => void (k.title = v))} />
      <LocalizedField
        title={t("Text")}
        text={kind.body}
        language={language}
        multiline
        prompt={t("What the hero is attempting.")}
        onChange={(v) => update((k) => void (k.body = v))}
      />
      <SegmentedRow
        title={t("Roll against")}
        value={rollsSkill}
        options={[
          { value: false, label: t("Characteristic") },
          { value: true, label: t("Skill") },
        ]}
        onChange={(skill) =>
          update((k) => void (k.target = skill ? { type: "skill", skillId: "spotHidden" } : { type: "characteristic", characteristic: "dexterity" }))
        }
      />
      {kind.target.type === "skill" ? (
        <SelectRow
          title={t("Skill")}
          value={kind.target.skillId}
          options={SKILLS.map((s) => ({ value: s.id, label: skillName(s.id) }))}
          onChange={(id) => update((k) => void (k.target = { type: "skill", skillId: id }))}
        />
      ) : (
        <SelectRow
          title={t("Characteristic")}
          value={kind.target.characteristic}
          options={characteristicOptions()}
          onChange={(c) => update((k) => void (k.target = { type: "characteristic", characteristic: c as Characteristic }))}
        />
      )}
      <SegmentedRow
        title={t("Difficulty")}
        value={kind.difficulty}
        options={CHECK_DIFFICULTIES.map((d) => ({ value: d, label: difficultyName(d) }))}
        onChange={(d) => update((k) => void (k.difficulty = d))}
      />
      {hero && (
        <FormRow label={t("Hero’s chance")}>
          <span className="value">
            {(() => {
              const value = valueForTarget(hero.skills, hero.characteristics, kind.target);
              return t("%lld%% (%@ %lld)", targetNumber(value, kind.difficulty), checkTargetName(kind.target), value);
            })()}
          </span>
        </FormRow>
      )}
    </FormSection>
  );
}

function BattleEditor({ kind, update, document }: { kind: KindOf<"battle">; update: KindUpdate<"battle">; document: StoryDocument }) {
  const language = document.language;
  return (
    <>
      <FormSection header={t("Battle")}>
        <LocalizedField title={t("Title")} text={kind.title} language={language} onChange={(v) => update((k) => void (k.title = v))} />
        <LocalizedField
          title={t("Text")}
          text={kind.body}
          language={language}
          multiline
          prompt={t("How the fight begins.")}
          onChange={(v) => update((k) => void (k.body = v))}
        />
        <LocalizedField title={t("Presence")} text={kind.presence} language={language} prompt={t("Hostile presence")} onChange={(v) => update((k) => void (k.presence = v))} />
      </FormSection>
      <OpponentReferenceSection selection={kind.enemyId} onChange={(id) => update((k) => void (k.enemyId = id))} document={document} />
    </>
  );
}

/// Picks a battle's enemy from the monster or character sheet.
function OpponentReferenceSection({ selection, onChange, document }: { selection: string; onChange: (id: string) => void; document: StoryDocument }) {
  const story = document.story;
  const language = document.language;
  const heroId = entrance(story)?.heroId;
  const enemy = opponent(story, selection);
  const isMonster = findMonster(story, selection) !== undefined;
  const options: (SelectOption | SelectGroup)[] = [
    ...(enemy ? [] : [{ value: selection, label: t("None") }]),
    { group: t("Monsters"), options: story.monsters.map((m) => ({ value: m.id, label: nameOf(m.name, language) })) },
    { group: t("Characters"), options: story.characters.filter((c) => c.id !== heroId).map((c) => ({ value: c.id, label: nameOf(c.name, language) })) },
  ];
  return (
    <FormSection
      header={t("Enemy")}
      footer={t(
        "Fought in rounds; the side with the higher DEX acts first. The hero can punch, attack with a carried weapon they have the skill for, or dodge. The fight ends when either side drops to 0 HP or is knocked out by a major wound. Wire Victory and Defeat to what happens next; a defeated hero carries on with at least 1 HP.",
      )}
    >
      <SelectRow title={t("Enemy")} value={selection} options={options} onChange={onChange} />
      {enemy && (
        <>
          <FormRow label={t("Fights with")}>
            <span className="value">
              {isBlank(enemy.attack.name) ? t("bare hands") : resolve(enemy.attack.name, language)} · {enemy.attack.skill}% · {damageLabelOf(enemy.attack.damage)}
            </span>
          </FormRow>
          <FormRow label={t("Health and defense")}>
            <span className="value">{t("%lld HP · Dodge %lld%% · Armor %lld", enemy.hp, enemy.dodge, enemy.armor)}</span>
          </FormRow>
          <ButtonRow
            symbol="pencil"
            title={isMonster ? t("Edit Monster") : t("Edit Character")}
            onClick={() => (document.selection = isMonster ? { type: "monster", id: selection } : { type: "character", id: selection })}
          />
        </>
      )}
      <ButtonRow
        symbol="pawprint"
        title={t("New Monster")}
        onClick={() => {
          const current = document.selection;
          const id = document.addMonster();
          onChange(id);
          document.selection = current;
        }}
      />
    </FormSection>
  );
}

function damageLabelOf(roll: DamageRoll): string {
  const dice = `${roll.count}D${roll.sides}`;
  return roll.bonus > 0 ? `${dice}+${roll.bonus}` : roll.bonus < 0 ? `${dice}−${-roll.bonus}` : dice;
}

function ChapterStartEditor({ kind, update, document, chapterId }: {
  kind: KindOf<"chapterStart">;
  update: KindUpdate<"chapterStart">;
  document: StoryDocument;
  chapterId: string;
}) {
  const language = document.language;
  const chapter = findChapter(document.story, chapterId);
  return (
    <FormSection header={t("Chapter")} footer={t("Players see the chapter title as a title card. Next Chapter nodes elsewhere lead here.")}>
      <LocalizedField
        title={t("Chapter title")}
        text={chapter?.title ?? []}
        language={language}
        onChange={(v) => document.updateChapter(chapterId, (c) => void (c.title = v))}
      />
      <LocalizedField
        title={t("Subtitle")}
        text={chapter?.subtitle ?? []}
        language={language}
        prompt={t("Optional, e.g. “The Hollow Calls”")}
        onChange={(v) => document.updateChapter(chapterId, (c) => void (c.subtitle = v))}
      />
      <LocalizedField
        title={t("Opening text")}
        text={kind.body}
        language={language}
        multiline
        prompt={t("Optional. Shown under the chapter title before play continues.")}
        onChange={(v) => update((k) => void (k.body = v))}
      />
      <LocalizedField title={t("Quote")} text={kind.quote} language={language} prompt={t("Optional line of dialogue")} onChange={(v) => update((k) => void (k.quote = v))} />
    </FormSection>
  );
}

function ChapterJumpEditor({ kind, update, document }: { kind: KindOf<"chapterJump">; update: KindUpdate<"chapterJump">; document: StoryDocument }) {
  const story = document.story;
  const target = findChapter(story, kind.targetChapterId);
  const options: SelectOption[] = [
    ...(target ? [] : [{ value: kind.targetChapterId, label: t("None") }]),
    ...story.chapters.map((c, i) => ({ value: c.id, label: `${i + 1}. ${isBlank(c.title) ? t("Untitled chapter") : resolve(c.title, document.language)}` })),
  ];
  return (
    <FormSection
      header={t("Next Chapter")}
      footer={t("Ends this branch and continues at the chosen chapter’s Chapter Start. Characters, items, and progress carry over.")}
    >
      <SelectRow title={t("Continue at")} value={kind.targetChapterId} options={options} onChange={(id) => update((k) => void (k.targetChapterId = id))} />
      {target && (
        <ButtonRow
          symbol="arrowshape.turn.up.right"
          title={t("Go to Chapter")}
          onClick={() => {
            document.setCurrentChapter(target.id);
            const start = startNode(document.story, target.id);
            document.selection = start ? { type: "node", id: start.id } : null;
          }}
        />
      )}
    </FormSection>
  );
}

function EventNodeEditor({ kind, update, document }: { kind: KindOf<"event">; update: KindUpdate<"event">; document: StoryDocument }) {
  const language = document.language;
  const story = document.story;
  const trigger = kind.trigger;
  const hero = heroCharacter(story);

  let footer: string;
  if (kind.occurrence === "eventually") footer = t("Always happens when play reaches this node.");
  else if (trigger.mode === "chance")
    footer = t("Rolls d100 each time play reaches this node. When it doesn’t happen, play moves straight on through Doesn’t Happen without stopping.");
  else if (trigger.mode === "characteristics")
    footer = t(
      "Happens when the hero’s characteristics meet the conditions. When they don’t, play moves straight on through Doesn’t Happen without stopping.",
    );
  else if (trigger.mode === "time")
    footer = t(
      "Happens when play reaches this node within the days and at one of the times of day chosen. Time only moves on through options that pass time. When it doesn’t happen, play moves straight on through Doesn’t Happen without stopping.",
    );
  else footer = t("Always happens if the chosen event has already happened; otherwise play moves straight on through Doesn’t Happen without stopping.");

  const updateCondition = (index: number, change: (c: Draft<CharacteristicCondition>) => void) => update((k) => change(k.trigger.conditions[index]));

  return (
    <>
      <FormSection header={t("Event")}>
        <LocalizedField title={t("Title")} text={kind.title} language={language} onChange={(v) => update((k) => void (k.title = v))} />
        <LocalizedField
          title={t("Text")}
          text={kind.body}
          language={language}
          multiline
          prompt={t("What the player sees when it happens.")}
          onChange={(v) => update((k) => void (k.body = v))}
        />
        <LocalizedField title={t("Quote")} text={kind.quote} language={language} prompt={t("Optional line of dialogue")} onChange={(v) => update((k) => void (k.quote = v))} />
      </FormSection>

      <FormSection header={t("Effects")} footer={t("Applied when the event happens. Mana, stamina, and sanity stay within the hero’s limits, and gold can’t drop below zero.")}>
        <NumberField title={t("Health")} value={kind.hp} min={-999} max={999} onChange={(v) => update((k) => void (k.hp = v))} />
        <NumberField title={t("Mana")} value={kind.mp} min={-999} max={999} onChange={(v) => update((k) => void (k.mp = v))} />
        <NumberField title={t("Stamina")} value={kind.stamina} min={-999} max={999} onChange={(v) => update((k) => void (k.stamina = v))} />
        <NumberField title={t("Sanity")} value={kind.sanity} min={-99} max={99} onChange={(v) => update((k) => void (k.sanity = v))} />
        <NumberField title={t("Gold")} value={kind.gold} min={-9999} max={9999} onChange={(v) => update((k) => void (k.gold = v))} />
        <NumberField title={t("Experience")} value={kind.xp} min={-9999} max={9999} onChange={(v) => update((k) => void (k.xp = v))} />
        {kind.hp < 0 && (
          <Note>
            {t(
              "If this leaves the hero at 0 HP, they die: play takes the Death output after the player reads the event, or the game ends if it isn’t wired.",
            )}
          </Note>
        )}
      </FormSection>

      <EventReferenceSection
        title={t("Makes Happen")}
        selection={kind.eventId}
        onChange={(id) => update((k) => void (k.eventId = id))}
        document={document}
        footer={t("The event from the event sheet. When this node fires, the event is recorded as having happened.")}
      />

      <FormSection header={t("When It Happens")} footer={footer}>
        <SegmentedRow
          title={t("Type")}
          value={kind.occurrence}
          options={(["eventually", "perhaps"] as const).map((o) => ({ value: o, label: occurrenceName(o) }))}
          onChange={(o) => update((k) => void (k.occurrence = o))}
        />
        {kind.occurrence === "perhaps" && (
          <>
            <SelectRow
              title={t("Happens by")}
              value={trigger.mode}
              options={(["chance", "characteristics", "priorEvent", "time"] as TriggerMode[]).map((m) => ({ value: m, label: triggerModeName(m) }))}
              onChange={(m) => update((k) => void (k.trigger.mode = m as TriggerMode))}
            />
            {trigger.mode === "chance" && (
              <NumberField title={t("Chance (%)")} value={trigger.chance} min={0} max={100} onChange={(v) => update((k) => void (k.trigger.chance = v))} />
            )}
            {trigger.mode === "characteristics" && (
              <>
                {trigger.conditions.map((condition, index) => (
                  <FormRow key={condition.id}>
                    <Select
                      value={condition.characteristic}
                      options={characteristicOptions()}
                      ariaLabel={t("Characteristic")}
                      style={{ width: "auto", flex: 1 }}
                      onChange={(c) => updateCondition(index, (d) => void (d.characteristic = c as Characteristic))}
                    />
                    <Select
                      value={condition.comparison}
                      options={(["over", "under"] as const).map((c) => ({ value: c, label: comparisonName(c) }))}
                      ariaLabel={t("Comparison")}
                      style={{ width: 90 }}
                      onChange={(c) => updateCondition(index, (d) => void (d.comparison = c as CharacteristicCondition["comparison"]))}
                    />
                    <NumberInput
                      className="narrow"
                      value={condition.value}
                      min={0}
                      max={999}
                      ariaLabel={t("Value")}
                      onChange={(v) => updateCondition(index, (d) => void (d.value = v))}
                    />
                    <RemoveButton title={t("Remove Condition")} onClick={() => update((k) => void k.trigger.conditions.splice(index, 1))} />
                  </FormRow>
                ))}
                <ButtonRow
                  symbol="plus"
                  title={t("Add Condition")}
                  onClick={() => update((k) => void k.trigger.conditions.push({ id: makeId(), characteristic: "strength", comparison: "over", value: 50 }))}
                />
                {trigger.conditions.length > 1 && (
                  <SegmentedRow
                    title={t("Must meet")}
                    value={trigger.requiresAll}
                    options={[
                      { value: true, label: t("All (and)") },
                      { value: false, label: t("Any (or)") },
                    ]}
                    onChange={(v) => update((k) => void (k.trigger.requiresAll = v))}
                  />
                )}
                {/* Characteristics don't change during play, so the hero's outcome is known up front. */}
                {hero && trigger.conditions.length > 0 && (
                  <FormRow label={t("Hero")}>
                    <span className="value">{conditionsMet(kind, hero) ? t("Happens for this hero") : t("Doesn’t happen for this hero")}</span>
                  </FormRow>
                )}
              </>
            )}
            {trigger.mode === "priorEvent" && (
              <SelectRow
                title={t("After event")}
                value={trigger.priorEventId}
                options={[
                  ...(findEvent(story, trigger.priorEventId) ? [] : [{ value: trigger.priorEventId, label: t("None") }]),
                  ...story.events.map((e) => ({ value: e.id, label: nameOf(e.name, language) })),
                ]}
                onChange={(id) => update((k) => void (k.trigger.priorEventId = id))}
              />
            )}
            {trigger.mode === "time" && (
              <>
                <NumberField title={t("From day")} value={trigger.earliestDay} min={0} max={9999} onChange={(v) => update((k) => void (k.trigger.earliestDay = v))} />
                <NumberField title={t("Until day")} value={trigger.latestDay} min={0} max={9999} onChange={(v) => update((k) => void (k.trigger.latestDay = v))} />
                {PHASE_KEYS.map((_, phase) => (
                  <ToggleRow
                    key={phase}
                    title={phaseName(phase)}
                    on={trigger.phases.includes(phase)}
                    onChange={(on) =>
                      update((k) => {
                        const phases = k.trigger.phases.filter((p) => p !== phase);
                        k.trigger.phases = on ? [...phases, phase].sort((a, b) => a - b) : phases;
                      })
                    }
                  />
                ))}
                <FormRow label={t("Window")}>
                  <span className="value">{timeWindowSummary(trigger)}</span>
                </FormRow>
                <Note>{t("A day of 0 means no limit.")}</Note>
              </>
            )}
          </>
        )}
      </FormSection>
    </>
  );
}

/// Picks an event-sheet entry for an Event node, with shortcuts to edit it or create a new one.
function EventReferenceSection({ title, selection, onChange, document, footer }: {
  title: string;
  selection: string;
  onChange: (id: string) => void;
  document: StoryDocument;
  footer: string;
}) {
  const language = document.language;
  const event = findEvent(document.story, selection);
  return (
    <FormSection header={title} footer={footer}>
      <SelectRow
        title={t("Event")}
        value={selection}
        options={[
          ...(event ? [] : [{ value: selection, label: t("None") }]),
          ...document.story.events.map((e) => ({ value: e.id, label: nameOf(e.name, language) })),
        ]}
        onChange={onChange}
      />
      {event && (
        <>
          {!isBlank(event.detail) && <Note>{resolve(event.detail, language)}</Note>}
          <ButtonRow symbol="pencil" title={t("Edit Event")} onClick={() => (document.selection = { type: "event", id: event.id })} />
        </>
      )}
      <ButtonRow
        symbol="plus"
        title={t("New Event")}
        onClick={() => {
          const current = document.selection;
          const id = document.addEvent();
          onChange(id);
          document.selection = current;
        }}
      />
    </FormSection>
  );
}

/// Picks the location-sheet entry a node is set at, with shortcuts to edit it or create a new one.
function LocationReferenceSection({ selection, onChange, document, arriving }: {
  selection: string;
  onChange: (id: string) => void;
  document: StoryDocument;
  arriving: Set<string>;
}) {
  const story = document.story;
  const language = document.language;
  const location = findLocation(story, selection);
  const options: (SelectOption | SelectGroup)[] = [
    { value: "", label: t("None") },
    ...(selection !== "" && !location ? [{ value: selection, label: t("Missing location") }] : []),
    ...placeOptions(placeContext(story, arriving, language)),
  ];
  const arrivingNames = [...arriving]
    .map((id) => findLocation(story, id))
    .filter((l): l is StoryLocation => !!l)
    .map((l) => resolve(l.name, language))
    .sort();
  return (
    <FormSection
      header={t("Location")}
      footer={t(
        "Where this node takes place, from the location sheet. Players see its name and region above the scene. With none, the previous scene’s location carries on. Places one road away on the location map are listed first.",
      )}
    >
      <SelectRow title={t("Location")} value={selection} options={options} onChange={onChange} />
      {arrivingNames.length > 0 && (
        <FormRow label={t("Arriving from")}>
          <span className="value">{formatOrList(arrivingNames)}</span>
        </FormRow>
      )}
      {location && (
        <>
          {!isBlank(location.region) && (
            <FormRow label={t("Region")}>
              <span className="value">{resolve(location.region, language)}</span>
            </FormRow>
          )}
          <ButtonRow symbol="pencil" title={t("Edit Location")} onClick={() => (document.selection = { type: "location", id: location.id })} />
        </>
      )}
      <ButtonRow
        symbol="mappin.and.ellipse"
        title={t("New Location")}
        onClick={() => {
          const current = document.selection;
          const id = document.addLocation();
          onChange(id);
          document.selection = current;
        }}
      />
    </FormSection>
  );
}

function EndEditor({ kind, update, language }: { kind: KindOf<"end">; update: KindUpdate<"end">; language: string }) {
  return (
    <FormSection header={t("Ending")}>
      <LocalizedField title={t("Title")} text={kind.title} language={language} onChange={(v) => update((k) => void (k.title = v))} />
      <LocalizedField
        title={t("Text")}
        text={kind.body}
        language={language}
        multiline
        prompt={t("How this branch of the story concludes.")}
        onChange={(v) => update((k) => void (k.body = v))}
      />
      <LocalizedField title={t("Quote")} text={kind.quote} language={language} prompt={t("Optional closing line")} onChange={(v) => update((k) => void (k.quote = v))} />
      <SelectRow
        title={t("Outcome")}
        value={kind.outcome}
        options={(["triumph", "neutral", "tragedy"] as Outcome[]).map((o) => ({ value: o, label: outcomeName(o) }))}
        onChange={(o) => update((k) => void (k.outcome = o as Outcome))}
      />
    </FormSection>
  );
}

// MARK: - Character sheet

function CharacterEditor({ document, characterId }: { document: StoryDocument; characterId: string }) {
  const character = findCharacter(document.story, characterId)!;
  const language = document.language;
  const isHero = entrance(document.story)?.heroId === characterId;
  const update = (change: (c: Draft<StoryCharacter>) => void) => document.updateCharacter(characterId, change);

  return (
    <div className="form">
      <FormSection
        header={
          <span className="row" style={{ gap: 6 }}>
            <Icon name={isHero ? "star.fill" : "person"} size={13} />
            {isHero ? t("Hero") : t("Character")}
          </span>
        }
      >
        <NameRow
          symbol={character.symbol}
          onSymbol={(s) => update((c) => void (c.symbol = s))}
          text={character.name}
          language={language}
          onChange={(v) => update((c) => void (c.name = v))}
        />
        <LocalizedField title={t("Background")} text={character.lineage} language={language} prompt={t("Half-elf")} onChange={(v) => update((c) => void (c.lineage = v))} />
        <LocalizedField
          title={t("Description")}
          text={character.summary}
          language={language}
          multiline
          prompt={t("Who they are, for your own reference.")}
          onChange={(v) => update((c) => void (c.summary = v))}
        />
      </FormSection>

      <CharacteristicsSection character={character} update={update} />
      <OccupationSection character={character} update={update} language={language} />
      <SkillsSection character={character} update={update} language={language} />

      <FormSection header={t("Stats")}>
        <NumberField title={t("Age")} value={character.age} min={1} max={999} onChange={(v) => update((c) => void (c.age = v))} />
        <NumberField title={t("Level")} value={character.level} min={1} max={99} onChange={(v) => update((c) => void (c.level = v))} />
        <NumberField title={t("Stamina")} value={character.stamina} min={0} max={9999} onChange={(v) => update((c) => void (c.stamina = v))} />
      </FormSection>

      <FormSection
        header={t("As the Hero")}
        footer={t("Used when this character is the Entrance's hero. Carry capacity is the total item weight they can hold; 0 means no limit.")}
      >
        <NumberField title={t("Action points")} value={character.ap} min={1} max={12} onChange={(v) => update((c) => void (c.ap = v))} />
        <NumberField title={t("Experience")} value={character.xp} min={0} max={999_999} onChange={(v) => update((c) => void (c.xp = v))} />
        <NumberField title={t("XP to next level")} value={character.xpToNext} min={1} max={999_999} onChange={(v) => update((c) => void (c.xpToNext = v))} />
        <NumberField title={t("Gold")} value={character.gold} min={0} max={999_999} onChange={(v) => update((c) => void (c.gold = v))} />
        <DecimalField title={t("Carry capacity")} value={character.carryCapacity} max={99_999} onChange={(v) => update((c) => void (c.carryCapacity = v))} />
      </FormSection>

      <FormSection
        header={t("As an Enemy")}
        footer={t(
          "When a Battle node picks this character, they fight like the hero: with the best carried weapon they have the skill for, or bare hands with Fighting (Brawl). They dodge with their Dodge skill, and carried armor protects them.",
        )}
      >
        <NumberField title={t("XP reward")} value={character.xpReward} min={0} max={99_999} onChange={(v) => update((c) => void (c.xpReward = v))} />
        <NumberField title={t("Gold reward")} value={character.goldReward} min={0} max={99_999} onChange={(v) => update((c) => void (c.goldReward = v))} />
      </FormSection>

      <FormSection footer={t("Pick from the item sheet. Weapons add attack and armor adds defense in battle.")}>
        <ItemReferenceList
          title={t("Starting items")}
          itemIds={character.itemIds}
          items={document.story.items}
          language={language}
          onChange={(ids) => update((c) => void (c.itemIds = ids))}
        />
      </FormSection>

      <FormSection header={t("Status Effects")}>
        {character.effects.map((effect, index) => (
          <FormRow key={effect.id}>
            <SymbolField symbol={effect.symbol} onChange={(s) => update((c) => void (c.effects[index].symbol = s))} />
            <input
              className="text-field"
              value={translation(effect.name, language) ?? ""}
              placeholder={resolve(effect.name, language) || t("Name")}
              aria-label={t("Name")}
              onChange={(e) =>
                update((c) => void (c.effects[index].name = withTranslation(effect.name, language, e.target.value === "" ? undefined : e.target.value)))
              }
            />
            <span className="caption secondary" style={{ whiteSpace: "nowrap" }}>
              {t("%lld turns", effect.turnsRemaining)}
            </span>
            <StepperOnly value={effect.turnsRemaining} min={1} max={99} onChange={(v) => update((c) => void (c.effects[index].turnsRemaining = v))} />
            <RemoveButton title={t("Remove")} onClick={() => update((c) => void c.effects.splice(index, 1))} />
          </FormRow>
        ))}
        <ButtonRow
          symbol="plus"
          title={t("Add Status Effect")}
          onClick={() => update((c) => void c.effects.push({ id: makeId(), name: [], symbol: "sparkles", turnsRemaining: 3 }))}
        />
      </FormSection>

      <UsageSection nodes={document.nodesUsing(characterId)} document={document} />

      <FormSection>
        <ButtonRow symbol="plus.square.on.square" title={t("Duplicate Character")} onClick={() => document.duplicateCharacter(characterId)} />
        <ButtonRow symbol="trash" title={t("Delete Character")} destructive onClick={() => document.deleteCharacter(characterId)} />
      </FormSection>
    </div>
  );
}

/// The nine characteristics, with half and fifth values, a dice roller, and the values derived from them.
function CharacteristicsSection({ character, update }: { character: StoryCharacter; update: (change: (c: Draft<StoryCharacter>) => void) => void }) {
  const values = character.characteristics;
  return (
    <>
      <FormSection
        header={t("Characteristics")}
        footer={t("Rolled as 3D6 × 5, or (2D6 + 6) × 5 for SIZ, INT, and EDU. People usually range from 15 to 90; monsters can go higher.")}
      >
        {CHARACTERISTICS.map((characteristic) => (
          <FormRow
            key={characteristic}
            label={
              <span className="row" style={{ gap: 8 }}>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 600, width: 38, fontSize: 12.5 }}>{ABBREVIATIONS[characteristic]}</span>
                <span className="secondary">{characteristicName(characteristic)}</span>
              </span>
            }
          >
            <span className="caption secondary mono-digits">{t("½ %lld  ⅕ %lld", div(values[characteristic], 2), div(values[characteristic], 5))}</span>
            <NumberInput
              className="narrow"
              value={values[characteristic]}
              min={0}
              max={999}
              ariaLabel={characteristicName(characteristic)}
              onChange={(v) => update((c) => void (c.characteristics[characteristic] = v))}
            />
            <StepperStep value={values[characteristic]} step={5} min={0} max={999} onChange={(v) => update((c) => void (c.characteristics[characteristic] = v))} />
          </FormRow>
        ))}
        <ButtonRow symbol="dice" title={t("Roll Characteristics")} onClick={() => update((c) => void (c.characteristics = rollCharacteristics()))} />
      </FormSection>

      <FormSection
        header={t("Derived")}
        footer={t(
          "HP = (CON + SIZ) ÷ 10. MP = POW ÷ 5. Sanity starts at POW. Move rate compares STR and DEX with SIZ and drops with age from 40. Build and damage bonus come from STR + SIZ.",
        )}
      >
        <DerivedRow title={t("Hit points")} value={hitPoints(values)} />
        <DerivedRow title={t("Magic points")} value={magicPoints(values)} />
        <DerivedRow title={t("Sanity")} value={startingSanity(values)} />
        <DerivedRow title={t("Move rate")} value={moveRate(values, character.age)} />
        <DerivedRow title={t("Build")} value={build(values)} />
        <DerivedRow title={t("Damage bonus")} value={damageBonusLabel(damageBonus(values.strength + values.size))} />
      </FormSection>
    </>
  );
}

function StepperStep({ value, step, min, max, onChange }: { value: number; step: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <button type="button" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} aria-label="−">
        <Icon name="minus" size={11} />
      </button>
      <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} aria-label="+">
        <Icon name="plus" size={11} />
      </button>
    </span>
  );
}

function DerivedRow({ title, value }: { title: string; value: number | string }) {
  return (
    <FormRow label={title}>
      <span className="value">{value}</span>
    </FormRow>
  );
}

// MARK: Occupation and skills

/// Text descriptions of occupation rules for the designer.
function formulaText(formula: SkillPointFormula): string {
  if (formula.others.length === 0) return "EDU × 4";
  return `EDU × 2 + ${formula.others.map((c) => ABBREVIATIONS[c]).join("/")} × 2`;
}

function occupationSkillsText(job: Occupation): string {
  return job.skills
    .map((slot) => {
      switch (slot.type) {
        case "skill":
          return slot.specialty ? `${skillName(slot.id)} (${specialtyName(slot.specialty)})` : skillName(slot.id);
        case "oneOf":
          return slot.ids.map(skillName).join(t(" or "));
        case "interpersonal":
          return t("%lld interpersonal (Charm, Fast Talk, Intimidate, Persuade)", slot.count);
        case "any":
          return t("%lld other skills of your choice", slot.count);
      }
    })
    .join(t(", "));
}

/// The occupation: picks the skill point formula, credit rating range, and occupation skills.
function OccupationSection({ character, update, language }: {
  character: StoryCharacter;
  update: (change: (c: Draft<StoryCharacter>) => void) => void;
  language: string;
}) {
  const job = occupation(character.occupationId);
  const sorted = OCCUPATIONS.map((o) => ({ value: o.id, label: occupationName(o.id) })).sort((a, b) => a.label.localeCompare(b.label, language));

  const addOccupationSkills = (o: Occupation) => {
    const wanted: { id: string; specialty?: string }[] = [{ id: "creditRating" }];
    for (const slot of o.skills) {
      if (slot.type === "skill") wanted.push({ id: slot.id, specialty: slot.specialty });
      else if (slot.type === "oneOf") wanted.push({ id: slot.ids[0] });
    }
    update((c) => {
      for (const { id, specialty } of wanted) {
        const text: StoryText = specialty ? localizedText(specialty, language) : [];
        // Skip skills already on the list, matching specialty too (Science (Biology) vs Science (Physics)).
        const exists = c.skills.some((entry) => entry.skillId === id && (specialty === undefined || translation(entry.specialty, language) === translation(text, language)));
        if (!exists) c.skills.push({ id: makeId(), skillId: id, specialty: text, occupationPoints: 0, personalPoints: 0 });
      }
    });
  };

  return (
    <FormSection
      header={t("Occupation")}
      footer={
        job
          ? t("Occupation points go into the occupation’s skills and Credit Rating, which must stay within the range above.")
          : t("A custom occupation earns EDU × 4 occupation points, which can go into any skill.")
      }
    >
      <SelectRow
        title={t("Occupation")}
        value={character.occupationId}
        options={[{ value: "", label: t("Custom") }, ...sorted]}
        onChange={(id) => update((c) => void (c.occupationId = id))}
      />
      {job ? (
        <>
          <FormRow label={t("Credit rating")}>
            <span className="value">
              {job.creditRating[0]}–{job.creditRating[1]}
            </span>
          </FormRow>
          <FormRow label={t("Occupation points")}>
            <span className="value">
              {formulaText(job.points)} = {occupationPointBudget(character)}
            </span>
          </FormRow>
          <FormRow stack>
            <span>{t("Occupation skills")}</span>
            <span className="callout secondary">{occupationSkillsText(job)}</span>
          </FormRow>
          <ButtonRow
            symbol="text.badge.plus"
            title={t("Add Occupation Skills")}
            help={t("Adds this occupation’s named skills and Credit Rating to the list, ready for points.")}
            onClick={() => addOccupationSkills(job)}
          />
        </>
      ) : (
        <>
          <LocalizedField title={t("Occupation name")} text={character.calling} language={language} prompt={t("Spellblade")} onChange={(v) => update((c) => void (c.calling = v))} />
          <FormRow label={t("Occupation points")}>
            <span className="value">
              {formulaText(CUSTOM_POINTS)} = {occupationPointBudget(character)}
            </span>
          </FormRow>
        </>
      )}
    </FormSection>
  );
}

/// The character's skills: base value plus occupation and personal points, with both budgets.
function SkillsSection({ character, update, language }: {
  character: StoryCharacter;
  update: (change: (c: Draft<StoryCharacter>) => void) => void;
  language: string;
}) {
  const job = occupation(character.occupationId);
  const occupationLeft = occupationPointBudget(character) - occupationPointsSpent(character);
  const personalLeft = personalPointBudget(character) - personalPointsSpent(character);

  /// Spreads unspent points evenly, keeping every skill at 99 or below and Mythos at 0.
  const autoDistribute = () =>
    update((c) => {
      const characteristics = c.characteristics;
      const spread = (points: number, indices: number[], key: "occupationPoints" | "personalPoints") => {
        let remaining = points;
        let open = [...indices];
        while (remaining > 0 && open.length > 0) {
          const share = Math.max(1, Math.trunc(remaining / open.length));
          for (const index of open) {
            const room = 99 - entryValue(c.skills[index], characteristics);
            const given = Math.max(0, Math.min(share, room, remaining));
            c.skills[index][key] += given;
            remaining -= given;
          }
          open = open.filter((index) => 99 - entryValue(c.skills[index], characteristics) > 0);
          if (share === 1 && remaining > 0 && open.length === 0) break;
        }
      };
      const eligible = c.skills.map((_, i) => i).filter((i) => c.skills[i].skillId !== "mythos");
      const occupationSkills = eligible.filter((i) => (job ? allowsOccupationPoints(job, c.skills[i].skillId) : true));
      const snapshot = c as StoryCharacter;
      spread(occupationPointBudget(snapshot) - occupationPointsSpent(snapshot), occupationSkills, "occupationPoints");
      spread(personalPointBudget(snapshot) - personalPointsSpent(snapshot), eligible, "personalPoints");
      // Keep Credit Rating inside the occupation's range.
      const credit = c.skills.find((s) => s.skillId === "creditRating");
      if (job && credit) {
        const value = entryValue(credit, characteristics);
        if (value > job.creditRating[1]) {
          const excess = value - job.creditRating[1];
          const fromPersonal = Math.min(excess, credit.personalPoints);
          credit.personalPoints -= fromPersonal;
          credit.occupationPoints -= excess - fromPersonal;
        }
      }
    });

  return (
    <FormSection
      header={t("Skills")}
      footer={t(
        "Each skill is its base value plus occupation and personal-interest points (INT × 2). Skills not listed stay at their base. Skills can’t go above 99, and Mythos can’t be bought at creation.",
      )}
    >
      <FormRow>
        <BudgetLabel title={t("Occupation")} left={occupationLeft} budget={occupationPointBudget(character)} />
        <BudgetLabel title={t("Personal")} left={personalLeft} budget={personalPointBudget(character)} />
      </FormRow>
      {character.skills.map((entry, index) => (
        <SkillEntryRow
          key={entry.id}
          character={character}
          index={index}
          language={language}
          isOccupationSkill={job ? allowsOccupationPoints(job, entry.skillId) : true}
          update={update}
        />
      ))}
      <FormRow>
        <button
          type="button"
          className="btn btn-borderless"
          onClick={(e) =>
            showMenuBelow(
              e.currentTarget,
              SKILLS.map((s) => ({
                label: skillName(s.id),
                action: () => update((c) => void c.skills.push({ id: makeId(), skillId: s.id, specialty: [], occupationPoints: 0, personalPoints: 0 })),
              })),
            )
          }
        >
          <Icon name="plus" size={13} />
          {t("Add Skill")}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-borderless"
          title={t("Spreads the unspent points across the listed skills: occupation points over occupation skills, personal points over all of them.")}
          onClick={autoDistribute}
        >
          <Icon name="wand.and.stars" size={13} />
          {t("Auto-distribute")}
        </button>
        <button
          type="button"
          className="btn btn-borderless"
          onClick={() =>
            update((c) => {
              for (const skill of c.skills) {
                skill.occupationPoints = 0;
                skill.personalPoints = 0;
              }
            })
          }
        >
          <Icon name="arrow.counterclockwise" size={13} />
          {t("Clear Points")}
        </button>
      </FormRow>
    </FormSection>
  );
}

function BudgetLabel({ title, left, budget }: { title: string; left: number; budget: number }) {
  return (
    <span className="column" style={{ gap: 2, flex: 1 }}>
      <span className="caption secondary">{title}</span>
      <span className="mono-digits" style={{ fontWeight: 600, color: left < 0 ? "var(--health)" : undefined }}>
        {t("%lld of %lld left", left, budget)}
      </span>
    </span>
  );
}

function SkillEntryRow({ character, index, language, isOccupationSkill, update }: {
  character: StoryCharacter;
  index: number;
  language: string;
  isOccupationSkill: boolean;
  update: (change: (c: Draft<StoryCharacter>) => void) => void;
}) {
  const entry = character.skills[index];
  const definition = skillDefinition(entry.skillId);
  const base = definition ? baseValue(definition.base, character.characteristics) : 0;
  const total = entryValue(entry, character.characteristics);
  const set = (change: (e: Draft<StoryCharacter["skills"][number]>) => void) => update((c) => change(c.skills[index]));
  return (
    <FormRow stack>
      <span className="row" style={{ gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{definition ? skillName(entry.skillId) : entry.skillId}</span>
        {isOccupationSkill && (
          <span title={t("Occupation skill")} className="accent" style={{ display: "inline-flex" }}>
            <Icon name="briefcase" size={12} />
          </span>
        )}
        <span className="spacer" />
        <span className="mono-digits" style={{ fontWeight: 600, color: total > 99 ? "var(--health)" : undefined }}>
          {total}
        </span>
        <span className="caption secondary mono-digits">
          {div(total, 2)} · {div(total, 5)}
        </span>
        <RemoveButton title={t("Remove")} onClick={() => update((c) => void c.skills.splice(index, 1))} />
      </span>
      {definition?.takesSpecialty && (
        <input
          className="text-field caption"
          value={translation(entry.specialty, language) ?? ""}
          placeholder={isBlank(entry.specialty) ? t("Specialty, e.g. Biology") : resolve(entry.specialty, language)}
          aria-label={t("Specialty")}
          onChange={(e) => set((s) => void (s.specialty = withTranslation(entry.specialty, language, e.target.value === "" ? undefined : e.target.value)))}
        />
      )}
      <span className="row caption secondary mono-digits" style={{ gap: 6, flexWrap: "wrap" }}>
        {t("Base %lld", base)}
        <span>+</span>
        {t("Occupation")}
        <span style={{ opacity: !isOccupationSkill && entry.occupationPoints === 0 ? 0.4 : 1, pointerEvents: !isOccupationSkill && entry.occupationPoints === 0 ? "none" : undefined }}>
          <NumberInput className="narrow" value={entry.occupationPoints} min={0} max={999} ariaLabel={t("Occupation")} onChange={(v) => set((s) => void (s.occupationPoints = v))} />
        </span>
        <span>+</span>
        {t("Personal")}
        <NumberInput className="narrow" value={entry.personalPoints} min={0} max={999} ariaLabel={t("Personal")} onChange={(v) => set((s) => void (s.personalPoints = v))} />
      </span>
    </FormRow>
  );
}

// MARK: - Items

function ItemEditor({ document, itemId }: { document: StoryDocument; itemId: string }) {
  const item = findItem(document.story, itemId)!;
  const language = document.language;
  const update = (change: (i: Draft<Item>) => void) => document.updateItem(itemId, change);
  const carriers = document.charactersCarrying(itemId);
  const nodes = document.nodesHandingOut(itemId);
  const weaponSkills = SKILLS.filter((s) => s.id.startsWith("fighting") || s.id.startsWith("firearms"));

  return (
    <div className="form">
      <FormSection header={t("Item")}>
        <NameRow symbol={item.symbol} onSymbol={(s) => update((i) => void (i.symbol = s))} text={item.name} language={language} onChange={(v) => update((i) => void (i.name = v))} />
        <LocalizedField
          title={t("Description")}
          text={item.detail}
          language={language}
          multiline
          prompt={t("What it is and what it does, shown in the pack.")}
          onChange={(v) => update((i) => void (i.detail = v))}
        />
        <SelectRow
          title={t("Category")}
          value={item.category}
          options={(["weapon", "armor", "trinket", "key"] as ItemCategory[]).map((c) => ({ value: c, label: categoryName(c) }))}
          onChange={(c) => update((i) => void (i.category = c as ItemCategory))}
        />
      </FormSection>

      <FormSection header={t("Basics")} footer={t("Weight counts against a character’s carry capacity. Value is the item’s worth in gold, for trading.")}>
        <DecimalField title={t("Weight")} value={item.weight} max={9999} onChange={(v) => update((i) => void (i.weight = v))} />
        <NumberField title={t("Value")} value={item.value} min={0} max={999_999} onChange={(v) => update((i) => void (i.value = v))} />
      </FormSection>

      {item.category === "weapon" && (
        <FormSection
          header={t("Weapon")}
          footer={t(
            "A character can attack with a weapon only if its skill is on their sheet. Melee weapons usually add the wielder’s damage bonus (from STR + SIZ); firearms don’t. Impaling weapons — blades, spears, bullets — deal extra damage on an extreme success. Firearms can’t be dodged and let the shooter act first.",
          )}
        >
          <SelectRow
            title={t("Skill")}
            value={item.skillId}
            options={[...(item.skillId === "" ? [{ value: "", label: t("None") }] : []), ...weaponSkills.map((s) => ({ value: s.id, label: skillName(s.id) }))]}
            onChange={(id) => update((i) => void (i.skillId = id))}
          />
          <DamageRollField title={t("Damage")} value={item.damage} onChange={(v) => update((i) => void (i.damage = v))} />
          <NumberField title={t("Bonus damage")} value={item.attack} min={0} max={99} onChange={(v) => update((i) => void (i.attack = v))} />
          <ToggleRow title={t("Adds damage bonus")} on={item.addsDamageBonus} onChange={(v) => update((i) => void (i.addsDamageBonus = v))} />
          <ToggleRow title={t("Impales")} on={item.impales} onChange={(v) => update((i) => void (i.impales = v))} />
        </FormSection>
      )}

      <FormSection header={t("Protection")} footer={t("Armor is subtracted from every hit the carrier takes.")}>
        <NumberField title={t("Armor")} value={item.defense} min={0} max={99} onChange={(v) => update((i) => void (i.defense = v))} />
      </FormSection>

      {(carriers.length > 0 || nodes.length > 0) && (
        <FormSection header={t("Used By")}>
          {carriers.map((character) => (
            <div
              key={character.id}
              role="button"
              className="form-row button-row"
              style={{ color: "var(--text)" }}
              onClick={() => (document.selection = { type: "character", id: character.id })}
            >
              <Icon name={character.symbol} size={14} />
              {resolve(character.name, language)}
            </div>
          ))}
          {nodes.map((node) => (
            <NodeLink key={node.id} node={node} document={document} />
          ))}
        </FormSection>
      )}

      <FormSection>
        <ButtonRow symbol="plus.square.on.square" title={t("Duplicate Item")} onClick={() => document.duplicateItem(itemId)} />
        <ButtonRow symbol="trash" title={t("Delete Item")} destructive onClick={() => document.deleteItem(itemId)} />
      </FormSection>
    </div>
  );
}

// MARK: - Monsters

function MonsterEditor({ document, monsterId }: { document: StoryDocument; monsterId: string }) {
  const monster = findMonster(document.story, monsterId)!;
  const language = document.language;
  const update = (change: (m: Draft<typeof monster>) => void) => document.updateMonster(monsterId, change);
  const suggested = div(monster.constitution + monster.size, 10);

  return (
    <div className="form">
      <FormSection header={t("Monster")}>
        <NameRow
          symbol={monster.symbol}
          onSymbol={(s) => update((m) => void (m.symbol = s))}
          text={monster.name}
          language={language}
          onChange={(v) => update((m) => void (m.name = v))}
        />
        <LocalizedField
          title={t("Description")}
          text={monster.detail}
          language={language}
          multiline
          prompt={t("What it is and how it fights, for your own reference.")}
          onChange={(v) => update((m) => void (m.detail = v))}
        />
      </FormSection>

      <FormSection
        header={t("Characteristics")}
        footer={t("DEX decides who acts first. CON is rolled to stay standing after a major wound. STR + SIZ sets the damage bonus.")}
      >
        <NumberField title="STR" value={monster.strength} min={0} max={999} onChange={(v) => update((m) => void (m.strength = v))} />
        <NumberField title="CON" value={monster.constitution} min={0} max={999} onChange={(v) => update((m) => void (m.constitution = v))} />
        <NumberField title="SIZ" value={monster.size} min={0} max={999} onChange={(v) => update((m) => void (m.size = v))} />
        <NumberField title="DEX" value={monster.dexterity} min={0} max={999} onChange={(v) => update((m) => void (m.dexterity = v))} />
        <NumberField title="POW" value={monster.power} min={0} max={999} onChange={(v) => update((m) => void (m.power = v))} />
        <DerivedRow title={t("Damage bonus")} value={damageBonusLabel(damageBonus(monster.strength + monster.size))} />
      </FormSection>

      <FormSection
        header={t("Defense")}
        footer={t("Armor is subtracted from every hit it takes. When attacked, it dodges if Dodge is higher than Fighting, and fights back otherwise.")}
      >
        <NumberField title={t("Hit points")} value={monster.hitPoints} min={1} max={9999} onChange={(v) => update((m) => void (m.hitPoints = v))} />
        <ButtonRow symbol="equal.circle" title={t("Set from CON and SIZ (%lld)", suggested)} onClick={() => update((m) => void (m.hitPoints = Math.max(1, suggested)))} />
        <NumberField title={t("Armor")} value={monster.armor} min={0} max={99} onChange={(v) => update((m) => void (m.armor = v))} />
        <NumberField title={t("Dodge (%)")} value={monster.dodge} min={0} max={99} onChange={(v) => update((m) => void (m.dodge = v))} />
      </FormSection>

      <FormSection
        header={t("Attack")}
        footer={t(
          "Fighting is the chance to hit, and to win when fighting back. An extreme success deals maximum damage; impaling attacks roll their damage again on top.",
        )}
      >
        <LocalizedField title={t("Attack name")} text={monster.attackName} language={language} prompt={t("Claw")} onChange={(v) => update((m) => void (m.attackName = v))} />
        <NumberField title={t("Fighting (%)")} value={monster.fighting} min={1} max={99} onChange={(v) => update((m) => void (m.fighting = v))} />
        <DamageRollField title={t("Damage")} value={monster.damage} onChange={(v) => update((m) => void (m.damage = v))} />
        <ToggleRow title={t("Adds damage bonus")} on={monster.addsDamageBonus} onChange={(v) => update((m) => void (m.addsDamageBonus = v))} />
        <ToggleRow title={t("Impales")} on={monster.impales} onChange={(v) => update((m) => void (m.impales = v))} />
        <NumberField title={t("Attacks per round")} value={monster.attacksPerRound} min={1} max={4} onChange={(v) => update((m) => void (m.attacksPerRound = v))} />
      </FormSection>

      <FormSection header={t("Rewards")}>
        <NumberField title={t("XP reward")} value={monster.xpReward} min={0} max={99_999} onChange={(v) => update((m) => void (m.xpReward = v))} />
        <NumberField title={t("Gold reward")} value={monster.goldReward} min={0} max={99_999} onChange={(v) => update((m) => void (m.goldReward = v))} />
      </FormSection>

      <UsageSection nodes={document.nodesUsing(monsterId)} document={document} />

      <FormSection>
        <ButtonRow symbol="plus.square.on.square" title={t("Duplicate Monster")} onClick={() => document.duplicateMonster(monsterId)} />
        <ButtonRow symbol="trash" title={t("Delete Monster")} destructive onClick={() => document.deleteMonster(monsterId)} />
      </FormSection>
    </div>
  );
}

// MARK: - Locations

function LocationEditor({ document, locationId }: { document: StoryDocument; locationId: string }) {
  const location = findLocation(document.story, locationId)!;
  const language = document.language;
  const update = (change: (l: Draft<StoryLocation>) => void) => document.updateLocation(locationId, change);
  return (
    <div className="form">
      <FormSection header={t("Location")}>
        <NameRow
          symbol={location.symbol}
          onSymbol={(s) => update((l) => void (l.symbol = s))}
          text={location.name}
          language={language}
          onChange={(v) => update((l) => void (l.name = v))}
        />
        <LocalizedField title={t("Region")} text={location.region} language={language} prompt={t("The Northern Reaches")} onChange={(v) => update((l) => void (l.region = v))} />
        <LocalizedField
          title={t("Description")}
          text={location.detail}
          language={language}
          multiline
          prompt={t("What the place is like, for your own reference.")}
          onChange={(v) => update((l) => void (l.detail = v))}
        />
      </FormSection>

      <RoadsSection document={document} locationId={locationId} />
      <UsageSection nodes={document.nodesAt(locationId)} document={document} empty={t("No node is set here yet.")} />

      <FormSection>
        <ButtonRow symbol="plus.square.on.square" title={t("Duplicate Location")} onClick={() => document.duplicateLocation(locationId)} />
        <ButtonRow symbol="trash" title={t("Delete Location")} destructive onClick={() => document.deleteLocation(locationId)} />
      </FormSection>
    </div>
  );
}

/// The roads leading out of a location, with a menu to build more. The same as drawing them on the map.
function RoadsSection({ document, locationId }: { document: StoryDocument; locationId: string }) {
  const story = document.story;
  const language = document.language;
  const roads = story.routes.filter((r) => routeConnects(r, locationId));
  const unconnected = story.locations.filter((l) => l.id !== locationId && !roads.some((r) => routeEquals(r, makeRoute(locationId, l.id))));
  return (
    <FormSection
      header={t("Roads")}
      footer={t("Roads go both ways. Nodes set here suggest these places first, and warn when the story moves somewhere with no road.")}
    >
      {roads.map((road) => {
        const other = findLocation(story, routeOther(road, locationId));
        if (!other) return null;
        return (
          <FormRow key={`${road.first}:${road.second}`}>
            <span role="button" className="row" style={{ gap: 8, flex: 1, cursor: "pointer" }} onClick={() => (document.selection = { type: "location", id: other.id })}>
              <Icon name={other.symbol} size={14} />
              {resolve(other.name, language)}
            </span>
            <RemoveButton title={t("Remove Road")} onClick={() => document.disconnectRoute(road)} />
          </FormRow>
        );
      })}
      <FormRow>
        <button
          type="button"
          className="btn btn-borderless"
          onClick={(e) =>
            showMenuBelow(
              e.currentTarget,
              unconnected.length === 0
                ? [{ note: t("Every other place is already connected.") }]
                : unconnected.map((other) => ({
                    label: resolve(other.name, language),
                    icon: other.symbol,
                    action: () => document.connectLocations(locationId, other.id),
                  })),
            )
          }
        >
          <Icon name="point.topleft.down.to.point.bottomright.curvepath" size={13} />
          {t("Add Road To")}
        </button>
      </FormRow>
    </FormSection>
  );
}

/// Shown when a road on the location map is selected.
function RouteView({ document, route }: { document: StoryDocument; route: LocationRoute }) {
  const story = document.story;
  const language = document.language;
  const names = [route.first, route.second].map((id) => {
    const location = findLocation(story, id);
    return location ? resolve(location.name, language) : "?";
  });
  return (
    <div className="form">
      <FormSection footer={t("Roads go both ways.")}>
        <FormRow>
          <Icon name="point.topleft.down.to.point.bottomright.curvepath" size={16} />
          <span style={{ fontWeight: 600 }}>{t("Road between %@ and %@", names[0], names[1])}</span>
        </FormRow>
        {[route.first, route.second].map((id) => {
          const location = findLocation(story, id);
          return location ? (
            <div key={id} role="button" className="form-row button-row" style={{ color: "var(--text)" }} onClick={() => (document.selection = { type: "location", id })}>
              <Icon name={location.symbol} size={14} />
              {resolve(location.name, language)}
            </div>
          ) : null;
        })}
      </FormSection>
      <FormSection>
        <ButtonRow symbol="trash" title={t("Remove Road")} destructive onClick={() => document.disconnectRoute(route)} />
      </FormSection>
    </div>
  );
}

// MARK: - Events

function EventEditor({ document, eventId }: { document: StoryDocument; eventId: string }) {
  const event = findEvent(document.story, eventId)!;
  const language = document.language;
  const update = (change: (e: Draft<typeof event>) => void) => document.updateEvent(eventId, change);
  return (
    <div className="form">
      <FormSection
        header={t("Event")}
        footer={t("Place Event nodes on the map to make this happen. Perhaps events elsewhere can be set to follow it.")}
      >
        <NameRow symbol={event.symbol} onSymbol={(s) => update((e) => void (e.symbol = s))} text={event.name} language={language} onChange={(v) => update((e) => void (e.name = v))} />
        <LocalizedField
          title={t("Description")}
          text={event.detail}
          language={language}
          multiline
          prompt={t("What this event means for the story, for your own reference.")}
          onChange={(v) => update((e) => void (e.detail = v))}
        />
      </FormSection>
      <UsageSection nodes={document.nodesInvolving(eventId)} document={document} empty={t("No Event node uses this event yet.")} />
      <FormSection>
        <ButtonRow symbol="plus.square.on.square" title={t("Duplicate Event")} onClick={() => document.duplicateEvent(eventId)} />
        <ButtonRow symbol="trash" title={t("Delete Event")} destructive onClick={() => document.deleteEvent(eventId)} />
      </FormSection>
    </div>
  );
}

// MARK: - Music

function musicValue(music: MusicCue): string {
  return music.type === "play" ? `play:${music.trackId}` : music.type;
}

function MusicSection({ music, tracks, preview, onChange }: { music: MusicCue; tracks: MusicTrack[]; preview: MusicPlayer; onChange: (music: MusicCue) => void }) {
  const track = music.type === "play" ? tracks.find((tr) => tr.id === music.trackId) : undefined;
  const options: (SelectOption | SelectGroup)[] = [
    { value: "keep", label: t("Keep current music") },
    { value: "stop", label: t("Silence") },
    ...(music.type === "play" && !track ? [{ value: musicValue(music), label: t("None") }] : []),
    ...(tracks.length > 0 ? [{ group: t("Music Library"), options: tracks.map((tr) => ({ value: `play:${tr.id}`, label: tr.name })) }] : []),
  ];
  return (
    <FormSection header={t("Background Music")} footer={tracks.length === 0 ? t("Import tracks from the story overview (click an empty spot on the canvas).") : undefined}>
      <SelectRow
        title={t("When this node starts")}
        value={musicValue(music)}
        options={options}
        onChange={(value) => onChange(value.startsWith("play:") ? { type: "play", trackId: value.slice(5) } : { type: value as "keep" | "stop" })}
      />
      {track && (
        <FormRow>
          <TrackPreviewButton track={track} preview={preview} withTitle />
        </FormRow>
      )}
    </FormSection>
  );
}

function TrackPreviewButton({ track, preview, withTitle }: { track: MusicTrack; preview: MusicPlayer; withTitle?: boolean }) {
  const current = useCurrentTrack(preview);
  const { soundOn } = useSettings();
  const isPlaying = current === track.id;
  const title = isPlaying ? t("Stop Preview") : t("Preview");
  return (
    <button
      type="button"
      className="btn btn-borderless"
      disabled={!soundOn && !isPlaying}
      title={soundOn ? title : t("Sound is off. Turn it on to preview music.")}
      aria-label={title}
      onClick={() => (isPlaying ? preview.stop() : preview.play(track, soundOn))}
    >
      <Icon name={isPlaying ? "stop.fill" : "play.fill"} size={13} />
      {withTitle && title}
    </button>
  );
}

// MARK: - Story overview

function StoryOverview({ document, preview }: { document: StoryDocument; preview: MusicPlayer }) {
  const [importError, setImportError] = useState<string | null>(null);
  const story = document.story;
  const language = document.language;
  const title = storyTitle(story);

  const importMusic = async () => {
    try {
      for (const path of await chooseAudioFiles()) document.addTrack(await api.importTrack(path));
    } catch (e) {
      setImportError(errorMessage(e));
    }
  };

  return (
    <div className="form">
      <FormSection footer={t("Select a node to edit it. Drag from a node’s output socket to another node to connect them.")}>
        <FormRow>
          <span style={{ fontSize: 20, fontWeight: 600 }}>{isBlank(title) ? t("Untitled Story") : resolve(title, language)}</span>
        </FormRow>
        <FormRow label={t("Author")}>
          <input className="text-field" style={{ maxWidth: "64%" }} value={story.author} aria-label={t("Author")} onChange={(e) => document.setAuthor(e.target.value)} />
        </FormRow>
        <DerivedRow title={t("Nodes")} value={story.nodes.length} />
        <DerivedRow title={t("Connections")} value={story.links.length} />
      </FormSection>

      <FormSection header={t("Problems")}>
        {document.issues.length === 0 ? (
          <div className="issue-row accent">
            <Icon name="checkmark.seal" size={14} />
            {t("Ready to play")}
          </div>
        ) : (
          <IssueList
            issues={document.issues}
            story={story}
            language={language}
            onSelect={(issue) => {
              if (issue.nodeId) document.selection = { type: "node", id: issue.nodeId };
            }}
          />
        )}
      </FormSection>

      <FormSection header={t("Music Library")} footer={t("Tracks are stored inside the story file, so they travel with it when shared.")}>
        {story.tracks.map((track) => (
          <FormRow key={track.id}>
            <span className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
              <Icon name="music.note" size={14} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</span>
            </span>
            <span className="caption secondary">{formatBytes(track.size)}</span>
            <TrackPreviewButton track={track} preview={preview} />
            <RemoveButton
              title={t("Remove")}
              symbol="trash"
              onClick={() => {
                if (preview.currentTrackId === track.id) preview.stop();
                document.removeTrack(track.id);
              }}
            />
          </FormRow>
        ))}
        <ButtonRow symbol="square.and.arrow.down" title={t("Import Music…")} onClick={importMusic} />
      </FormSection>

      {importError && <Alert title={t("Couldn't import music")} message={importError} onDismiss={() => setImportError(null)} />}
    </div>
  );
}
