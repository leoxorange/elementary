// The story designer: node palette and sheets, canvas, and inspector, with play-testing and export.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, chooseExportPath, errorMessage } from "../api";
import { Alert, Confirm, contextMenu, FormRow, FormSection, isCommand, Popover, Segmented, useKeyboard } from "../components/ui";
import { GameState } from "../game/gameState";
import { t } from "../i18n";
import { Icon } from "../icons";
import { categoryName } from "../model/names";
import { hitPoints } from "../model/rules";
import { entrance, entranceNode, findNode, nodesIn, storyTitle } from "../model/story";
import { isBlank, resolve } from "../model/storyText";
import type { Item, NodeType } from "../model/types";
import { MusicPlayer } from "../music";
import { LanguageMenuButton } from "../screens/game/GameView";
import { storyLanguageFor, useSettings } from "../settings";
import { useDocument, type StoryDocument } from "./document";
import { Inspector, LocalizedField } from "./Inspector";
import { IssueList } from "./issues";
import { LocationCanvas } from "./LocationCanvas";
import { NODE_TYPE_DRAG, NodeCanvas, NodeMetrics } from "./NodeCanvas";
import { isPlaceable, NODE_TYPES, typeColor, typeName, typeSummary, typeSymbol, withAlpha } from "./nodeTypes";

type SidebarTab = "nodes" | "characters" | "monsters" | "items" | "locations" | "events";

const TABS: { id: SidebarTab; name: string; symbol: string }[] = [
  { id: "nodes", name: "Nodes", symbol: "square.grid.2x2" },
  { id: "characters", name: "Characters", symbol: "person.2" },
  { id: "monsters", name: "Monsters", symbol: "pawprint" },
  { id: "items", name: "Items", symbol: "shippingbox" },
  { id: "locations", name: "Locations", symbol: "map" },
  { id: "events", name: "Events", symbol: "sparkles" },
];

export function DesignerView({ document, onClose, onPlaytest }: {
  document: StoryDocument;
  onClose: () => void;
  onPlaytest: (game: GameState) => void;
}) {
  useDocument(document);
  const [tab, setTab] = useState<SidebarTab>("nodes");
  const [showsIssues, setShowsIssues] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const issuesButton = useRef<HTMLButtonElement>(null);
  const preview = useMemo(() => new MusicPlayer(), []);
  const { uiLanguage, soundOn, setSoundOn } = useSettings();

  // The designer shares the game's settings: text is written in the app's language, and previews honor Sound.
  useEffect(() => document.setLanguage(storyLanguageFor(uiLanguage)), [document, uiLanguage]);
  useEffect(() => {
    if (!soundOn) preview.stop();
  }, [soundOn, preview]);
  useEffect(
    () => () => {
      preview.stop();
      document.saveNow();
    },
    [document, preview],
  );

  // Selecting a sheet entry elsewhere (such as “Edit Character” in the inspector) shows its tab.
  const selection = document.selection;
  useEffect(() => {
    switch (selection?.type) {
      case "character":
        return setTab("characters");
      case "item":
        return setTab("items");
      case "monster":
        return setTab("monsters");
      case "location":
      case "route":
        return setTab("locations");
      case "event":
        return setTab("events");
      // Jumping to a node (from a sheet's Used By list, say) brings back the story map.
      case "node":
      case "nodes":
        return setTab((current) => (current === "locations" ? "nodes" : current));
    }
  }, [selection]);

  const errorCount = document.issues.filter((i) => i.severity === "error").length;
  const warningCount = document.issues.length - errorCount;
  const title = resolve(storyTitle(document.story), document.language);
  const exportName = title === "" ? t("Untitled Story") : title;

  const playtest = () => {
    if (errorCount > 0) {
      setShowsIssues(true);
      return;
    }
    try {
      preview.stop();
      document.saveNow();
      onPlaytest(GameState.start(document.story, null));
    } catch (e) {
      setError({ title: t("Something went wrong"), message: errorMessage(e) });
    }
  };

  const exportStory = async () => {
    try {
      const path = await chooseExportPath(exportName);
      if (path) await api.exportStory(document.story, path);
    } catch (e) {
      setError({ title: t("Couldn't export story"), message: errorMessage(e) });
    }
  };

  const close = () => {
    document.saveNow();
    onClose();
  };

  useKeyboard((event) => {
    if (!isCommand(event)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      // Text fields keep their own undo.
      if ((event.target as HTMLElement).tagName === "INPUT" || (event.target as HTMLElement).tagName === "TEXTAREA") return;
      document.undo();
      return true;
    }
    if ((key === "z" && event.shiftKey) || key === "y") {
      if ((event.target as HTMLElement).tagName === "INPUT" || (event.target as HTMLElement).tagName === "TEXTAREA") return;
      document.redo();
      return true;
    }
    if (key === "r") {
      playtest();
      return true;
    }
  });

  return (
    <div className="screen">
      <div className="designer-toolbar">
        <button type="button" className="btn btn-glass btn-large" onClick={close}>
          <Icon name="chevron.left" size={14} />
          {t("Scripts")}
        </button>
        <div className="column" style={{ gap: 1, minWidth: 0 }}>
          <span className="section-label" style={{ color: "var(--text-secondary)" }}>
            {t("Story Designer")}
          </span>
          <span className="serif" style={{ fontSize: 19, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {exportName}
          </span>
        </div>
        <span className="spacer" />
        {document.lastSaveError && (
          <span className="caption" style={{ color: "var(--health)" }} title={document.lastSaveError}>
            <Icon name="exclamationmark.triangle" size={14} />
          </span>
        )}
        <div className="icon-group">
          <button
            type="button"
            className="btn btn-glass btn-icon"
            title={t("Sound")}
            aria-label={soundOn ? t("Sound On") : t("Sound Off")}
            onClick={() => setSoundOn(!soundOn)}
          >
            <Icon name={soundOn ? "speaker.wave.2" : "speaker.slash"} size={16} />
          </button>
          <span title={t("Language. Text you write goes into the language the app is using.")}>
            <LanguageMenuButton />
          </span>
          <button type="button" className="btn btn-glass btn-icon" title={t("Undo")} aria-label={t("Undo")} disabled={!document.canUndo} onClick={() => document.undo()}>
            <Icon name="arrow.uturn.backward" size={16} />
          </button>
          <button type="button" className="btn btn-glass btn-icon" title={t("Redo")} aria-label={t("Redo")} disabled={!document.canRedo} onClick={() => document.redo()}>
            <Icon name="arrow.uturn.forward" size={16} />
          </button>
        </div>
        <button
          ref={issuesButton}
          type="button"
          className={`btn btn-glass btn-large ${errorCount > 0 ? "btn-tint-health" : ""}`}
          onClick={() => setShowsIssues((s) => !s)}
        >
          {errorCount === 0 && warningCount === 0 ? (
            <>
              <Icon name="checkmark.seal" size={15} />
              {t("Ready to play")}
            </>
          ) : (
            <>
              <Icon name={errorCount > 0 ? "xmark.octagon" : "exclamationmark.triangle"} size={15} />
              {t("%lld errors, %lld warnings", errorCount, warningCount)}
            </>
          )}
        </button>
        {showsIssues && (
          <Popover anchor={issuesButton.current} onClose={() => setShowsIssues(false)} width={420} maxHeight={360}>
            <div style={{ padding: 8 }}>
              {document.issues.length === 0 ? (
                <div className="issue-row accent">
                  <Icon name="checkmark.seal" size={14} />
                  {t("No problems found. This script is ready to play.")}
                </div>
              ) : (
                <IssueList
                  issues={document.issues}
                  story={document.story}
                  language={document.language}
                  onSelect={(issue) => {
                    if (issue.nodeId) document.selection = { type: "node", id: issue.nodeId };
                    setShowsIssues(false);
                  }}
                />
              )}
            </div>
          </Popover>
        )}
        <button type="button" className="btn btn-glass btn-large" title={t("Save a copy of this script as a .rpstory file to share")} onClick={exportStory}>
          <Icon name="square.and.arrow.up" size={15} />
          {t("Export…")}
        </button>
        <button type="button" className="btn btn-prominent btn-large" title={t("Play-test this script. Your saved game isn’t affected.")} onClick={playtest}>
          <Icon name="play.fill" size={14} />
          {t("Play-test")}
        </button>
      </div>
      <div className="divider" />
      <div className="designer-body">
        <Sidebar document={document} tab={tab} onTab={setTab} />
        <div className="vdivider" />
        {tab === "locations" ? (
          <LocationCanvas document={document} />
        ) : (
          <div className="column" style={{ flex: 1, minWidth: 0 }}>
            <ChapterBar document={document} />
            <div className="divider" />
            <NodeCanvas document={document} />
          </div>
        )}
        <div className="vdivider" />
        <Inspector document={document} preview={preview} />
      </div>
      {error && <Alert title={error.title} message={error.message} onDismiss={() => setError(null)} />}
    </div>
  );
}

// MARK: Chapters

/// Tabs for the story's chapters above the canvas. Each chapter has its own node map.
function ChapterBar({ document }: { document: StoryDocument }) {
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);
  const story = document.story;
  const language = document.language;
  const tabRefs = useRef(new Map<string, HTMLElement>());

  const addChapter = () => {
    document.addChapter();
    const id = document.currentChapterId;
    // Open the new chapter's editor once its tab is on screen.
    requestAnimationFrame(() => {
      const anchor = tabRefs.current.get(id);
      if (anchor) setEditing({ id, anchor });
    });
  };

  return (
    <div className="chapter-bar">
      <div className="chapter-tabs">
        {story.chapters.map((chapter, index) => {
          const isCurrent = chapter.id === document.currentChapterId;
          const hasErrors = document.issues.some((i) => i.severity === "error" && i.nodeId && findNode(story, i.nodeId)?.chapterId === chapter.id);
          return (
            <button
              key={chapter.id}
              ref={(element) => {
                if (element) tabRefs.current.set(chapter.id, element);
                else tabRefs.current.delete(chapter.id);
              }}
              type="button"
              className={`chapter-tab ${isCurrent ? "current" : ""}`}
              onClick={() => document.setCurrentChapter(chapter.id)}
              onDoubleClick={(e) => setEditing({ id: chapter.id, anchor: e.currentTarget })}
              {...contextMenu(() => [
                {
                  label: t("Edit Chapter…"),
                  icon: "pencil",
                  action: () => {
                    const anchor = tabRefs.current.get(chapter.id);
                    if (anchor) setEditing({ id: chapter.id, anchor });
                  },
                },
                { label: t("Move Left"), icon: "arrow.left", disabled: index === 0, action: () => document.moveChapter(chapter.id, -1) },
                { label: t("Move Right"), icon: "arrow.right", disabled: index === story.chapters.length - 1, action: () => document.moveChapter(chapter.id, 1) },
                { separator: true },
                {
                  label: t("Delete Chapter"),
                  icon: "trash",
                  destructive: true,
                  disabled: story.chapters.length === 1,
                  action: () => setPendingDeletion(chapter.id),
                },
              ])}
            >
              <span className="number">{index + 1}</span>
              <span>{isBlank(chapter.title) ? t("Untitled chapter") : resolve(chapter.title, language)}</span>
              <span className="tertiary mono-digits" style={{ fontSize: 10 }}>
                {nodesIn(story, chapter.id).length}
              </span>
              {hasErrors && <Icon name="exclamationmark.triangle.fill" size={11} style={{ color: "var(--health)" }} />}
            </button>
          );
        })}
      </div>
      <button type="button" className="btn btn-glass" style={{ marginRight: 12 }} title={t("Add a chapter after this one, with its Chapter Start ready")} onClick={addChapter}>
        <Icon name="plus" size={14} />
        {t("New Chapter")}
      </button>
      {editing && (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)} width={360}>
          <ChapterEditor document={document} chapterId={editing.id} />
        </Popover>
      )}
      {pendingDeletion && (
        <Confirm
          title={t("Delete this chapter?")}
          message={t("All %lld nodes on its map will be removed. You can undo this.", nodesIn(story, pendingDeletion).length)}
          confirmTitle={t("Delete Chapter")}
          onConfirm={() => document.deleteChapter(pendingDeletion)}
          onDismiss={() => setPendingDeletion(null)}
        />
      )}
    </div>
  );
}

/// The title and notes for a chapter, edited in a popover from the chapter bar.
function ChapterEditor({ document, chapterId }: { document: StoryDocument; chapterId: string }) {
  useDocument(document);
  const chapter = document.story.chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;
  const language = document.language;
  const jumps = document.jumpsInto(chapterId).length;
  return (
    <div className="form">
      <FormSection>
        <LocalizedField title={t("Title")} text={chapter.title} language={language} onChange={(v) => document.updateChapter(chapterId, (c) => void (c.title = v))} />
        <LocalizedField
          title={t("Subtitle")}
          text={chapter.subtitle}
          language={language}
          prompt={t("Optional, e.g. “The Hollow Calls”")}
          onChange={(v) => document.updateChapter(chapterId, (c) => void (c.subtitle = v))}
        />
        <LocalizedField
          title={t("Summary")}
          text={chapter.summary}
          language={language}
          multiline
          prompt={t("What happens in this chapter, for your own reference.")}
          onChange={(v) => document.updateChapter(chapterId, (c) => void (c.summary = v))}
        />
        <FormRow label={t("Entered from")}>
          <span className="value">{entranceNode(document.story)?.chapterId === chapterId ? t("The story’s Entrance") : t("%lld Next Chapter nodes", jumps)}</span>
        </FormRow>
      </FormSection>
    </div>
  );
}

// MARK: Sidebar

/// The left column: the node palette and the story's character, item, monster, location, and event sheets.
function Sidebar({ document, tab, onTab }: { document: StoryDocument; tab: SidebarTab; onTab: (tab: SidebarTab) => void }) {
  return (
    <div className="designer-sidebar">
      <div style={{ padding: "12px 12px 0" }}>
        <Segmented
          value={tab}
          onChange={onTab}
          options={TABS.map((item) => ({ value: item.id, label: <Icon name={item.symbol} size={15} />, title: t(item.name) }))}
        />
      </div>
      <div className="section-label" style={{ padding: "10px 16px 0", color: "var(--text-secondary)" }}>
        {t(TABS.find((item) => item.id === tab)!.name)}
      </div>
      {tab === "nodes" && <NodePalette document={document} />}
      {tab === "characters" && <CharacterList document={document} />}
      {tab === "monsters" && <MonsterList document={document} />}
      {tab === "items" && <ItemList document={document} />}
      {tab === "locations" && <LocationList document={document} />}
      {tab === "events" && <EventList document={document} />}
    </div>
  );
}

/// The node types a creator can add. Click to add next to the selection, or drag onto the canvas.
function NodePalette({ document }: { document: StoryDocument }) {
  const types = NODE_TYPES.filter((type) => isPlaceable(type, document.currentChapterId, document.story));

  /// To the right of the selected node, or past the rightmost node when nothing is selected.
  const nextPosition = () => {
    const id = document.selectedNodeId;
    const node = id ? findNode(document.story, id) : undefined;
    if (node && node.chapterId === document.currentChapterId) return { x: node.position.x + NodeMetrics.width + 90, y: node.position.y };
    const rightmost = document.visibleNodes.reduce<(typeof document.visibleNodes)[number] | undefined>(
      (best, n) => (!best || n.position.x > best.position.x ? n : best),
      undefined,
    );
    return { x: (rightmost?.position.x ?? 0) + NodeMetrics.width + 90, y: rightmost?.position.y ?? 120 };
  };

  return (
    <div className="sidebar-scroll" style={{ gap: 10, padding: 14 }}>
      {types.map((type: NodeType) => (
        <button
          key={type}
          type="button"
          className="palette-item"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(NODE_TYPE_DRAG, type);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => document.addNode(type, nextPosition())}
        >
          <span className="type-icon" style={{ color: typeColor(type), background: withAlpha(typeColor(type), 0.15) }}>
            <Icon name={typeSymbol(type)} size={15} strokeWidth={2.2} />
          </span>
          <span className="column" style={{ gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{typeName(type)}</span>
            <span className="caption secondary">{typeSummary(type)}</span>
          </span>
        </button>
      ))}
      <span className="caption tertiary" style={{ padding: "6px 4px 0" }}>
        {t("Click to add next to the selected node, or drag onto the canvas.")}
      </span>
    </div>
  );
}

/// A scrolling list of sheet entries with an add button at the top.
function SheetList({ addTitle, onAdd, empty, children }: { addTitle: string; onAdd: () => void; empty: string; children: ReactNode }) {
  return (
    <div className="sidebar-scroll">
      <button type="button" className="btn btn-glass" style={{ width: "100%", marginBottom: 4 }} onClick={onAdd}>
        <Icon name="plus" size={14} />
        {addTitle}
      </button>
      {children}
      <span className="caption tertiary" style={{ padding: "6px 4px 0" }}>
        {empty}
      </span>
    </div>
  );
}

function SheetRow({ symbol, title, detail, isHero, isSelected, onSelect, onDuplicate, onDelete }: {
  symbol: string;
  title: string;
  detail: string;
  isHero?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      className={`sheet-row ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
      {...contextMenu(() => [
        { label: t("Duplicate"), icon: "plus.square.on.square", action: onDuplicate },
        { label: t("Delete"), icon: "trash", destructive: true, action: onDelete },
      ])}
    >
      <span className="sheet-icon">
        <Icon name={symbol} size={15} />
      </span>
      <span className="column" style={{ gap: 2, minWidth: 0, flex: 1 }}>
        <span className="row" style={{ gap: 4 }}>
          <span className="title">{title}</span>
          {isHero && <Icon name="star.fill" size={10} style={{ color: "var(--action-point)", flexShrink: 0 }} />}
        </span>
        <span className="detail">{detail}</span>
      </span>
    </button>
  );
}

function CharacterList({ document }: { document: StoryDocument }) {
  const language = document.language;
  const heroId = entrance(document.story)?.heroId;
  return (
    <SheetList addTitle={t("New Character")} onAdd={() => document.addCharacter()} empty={t("Characters you add here can be the hero or fought in battles.")}>
      {document.story.characters.map((character) => (
        <SheetRow
          key={character.id}
          symbol={character.symbol}
          title={isBlank(character.name) ? t("Unnamed") : resolve(character.name, language)}
          detail={
            character.id === heroId
              ? t("Hero · Level %lld", character.level)
              : t("%lld HP · used in %lld battles", hitPoints(character.characteristics), document.nodesUsing(character.id).length)
          }
          isHero={character.id === heroId}
          isSelected={document.selectedId("character") === character.id}
          onSelect={() => (document.selection = { type: "character", id: character.id })}
          onDuplicate={() => document.duplicateCharacter(character.id)}
          onDelete={() => document.deleteCharacter(character.id)}
        />
      ))}
    </SheetList>
  );
}

function MonsterList({ document }: { document: StoryDocument }) {
  const language = document.language;
  return (
    <SheetList
      addTitle={t("New Monster")}
      onAdd={() => document.addMonster()}
      empty={t("Monsters are enemies with just what a fight needs: a few characteristics, hit points, an attack, and a dodge. Battles can fight a monster or any character.")}
    >
      {document.story.monsters.map((monster) => (
        <SheetRow
          key={monster.id}
          symbol={monster.symbol}
          title={isBlank(monster.name) ? t("Unnamed") : resolve(monster.name, language)}
          detail={t("%lld HP · %lld%% · used in %lld battles", monster.hitPoints, monster.fighting, document.nodesUsing(monster.id).length)}
          isSelected={document.selectedId("monster") === monster.id}
          onSelect={() => (document.selection = { type: "monster", id: monster.id })}
          onDuplicate={() => document.duplicateMonster(monster.id)}
          onDelete={() => document.deleteMonster(monster.id)}
        />
      ))}
    </SheetList>
  );
}

function itemDetail(item: Item): string {
  return item.attack > 0 || item.defense > 0 ? t("%@ · +%lld attack · +%lld defense", categoryName(item.category), item.attack, item.defense) : categoryName(item.category);
}

function ItemList({ document }: { document: StoryDocument }) {
  const language = document.language;
  return (
    <SheetList addTitle={t("New Item")} onAdd={() => document.addItem()} empty={t("Items you add here can be carried by characters or handed out by choices.")}>
      {document.story.items.map((item) => (
        <SheetRow
          key={item.id}
          symbol={item.symbol}
          title={isBlank(item.name) ? t("Unnamed") : resolve(item.name, language)}
          detail={itemDetail(item)}
          isSelected={document.selectedId("item") === item.id}
          onSelect={() => (document.selection = { type: "item", id: item.id })}
          onDuplicate={() => document.duplicateItem(item.id)}
          onDelete={() => document.deleteItem(item.id)}
        />
      ))}
    </SheetList>
  );
}

function LocationList({ document }: { document: StoryDocument }) {
  const language = document.language;
  return (
    <SheetList
      addTitle={t("New Location")}
      onAdd={() => document.addLocation()}
      empty={t("Places you add here can be picked as the location of most nodes. Players see the location’s name and region above the scene.")}
    >
      {document.story.locations.map((location) => {
        const uses = document.nodesAt(location.id).length;
        return (
          <SheetRow
            key={location.id}
            symbol={location.symbol}
            title={isBlank(location.name) ? t("Unnamed") : resolve(location.name, language)}
            detail={isBlank(location.region) ? t("Used by %lld nodes", uses) : t("%@ · used by %lld nodes", resolve(location.region, language), uses)}
            isSelected={document.selectedId("location") === location.id}
            onSelect={() => (document.selection = { type: "location", id: location.id })}
            onDuplicate={() => document.duplicateLocation(location.id)}
            onDelete={() => document.deleteLocation(location.id)}
          />
        );
      })}
    </SheetList>
  );
}

function EventList({ document }: { document: StoryDocument }) {
  const language = document.language;
  return (
    <SheetList
      addTitle={t("New Event")}
      onAdd={() => document.addEvent()}
      empty={t("Events you add here are made to happen by Event nodes. Once an event has happened, other Event nodes can follow it.")}
    >
      {document.story.events.map((event) => (
        <SheetRow
          key={event.id}
          symbol={event.symbol}
          title={isBlank(event.name) ? t("Unnamed") : resolve(event.name, language)}
          detail={t("Used by %lld Event nodes", document.nodesInvolving(event.id).length)}
          isSelected={document.selectedId("event") === event.id}
          onSelect={() => (document.selection = { type: "event", id: event.id })}
          onDuplicate={() => document.duplicateEvent(event.id)}
          onDelete={() => document.deleteEvent(event.id)}
        />
      ))}
    </SheetList>
  );
}
