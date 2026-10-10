// The script open in the story designer, with selection, undo history, and autosave to the library.

import { produce, type Draft } from "immer";
import { useSyncExternalStore } from "react";
import { api, errorMessage } from "../api";
import {
  arrivingLocations,
  entranceNode,
  findChapter,
  findCharacter,
  findEvent,
  findItem,
  findLocation,
  findMonster,
  findNode,
  linkEquals,
  makeId,
  makeRoute,
  nodesIn,
  outputPorts,
  routeConnects,
  routeEquals,
  startNode,
} from "../model/story";
import { localizedText } from "../model/storyText";
import type {
  CanvasPoint,
  Chapter,
  Item,
  LocationRoute,
  MusicTrack,
  NodeType,
  Story,
  StoryCharacter,
  StoryEvent,
  StoryLink,
  StoryLocation,
  StoryMonster,
  StoryNode,
  StoryOccupation,
  StorySkill,
} from "../model/types";
import { builtInOccupations, builtInSkills, catalogOf, type SkillCatalog } from "../model/skills";
import { validate, type StoryIssue } from "../model/validator";
import { characterTemplate, isPlaceable, makeKind, monsterTemplate } from "./nodeTypes";

export type Selection =
  | { type: "node"; id: string }
  /// Several nodes at once, such as after Select All. A single node always uses `node`.
  | { type: "nodes"; ids: string[] }
  | { type: "link"; link: StoryLink }
  | { type: "character"; id: string }
  | { type: "item"; id: string }
  | { type: "monster"; id: string }
  | { type: "location"; id: string }
  | { type: "event"; id: string }
  | { type: "skill"; id: string }
  | { type: "occupation"; id: string }
  /// A road on the location map.
  | { type: "route"; route: LocationRoute }
  | null;

const UNDO_LIMIT = 200;
const SAVE_DELAY = 600;

export class StoryDocument {
  story: Story;
  private selectionValue: Selection = null;
  /// The chapter shown on the canvas. New nodes go here.
  currentChapterId: string;
  /// The language text fields edit. Other languages are kept untouched.
  language: string;
  /// Validation results for the current graph, refreshed after every edit.
  issues: StoryIssue[];
  /// Where the hero can be when play reaches each node, refreshed with `issues`.
  arriving: Map<string, Set<string>>;
  lastSaveError: string | null = null;

  private undoStack: Story[] = [];
  private redoStack: Story[] = [];
  private lastUndoPush = 0;
  private saveTimer: number | undefined;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(story: Story, language: string) {
    this.story = story;
    this.language = language;
    this.currentChapterId = entranceNode(story)?.chapterId ?? story.chapters[0]?.id ?? "";
    this.issues = validate(story);
    this.arriving = arrivingLocations(story);
  }

  /// A new script with a hero on the character sheet and an entrance wired straight to an end, ready to grow.
  static newStory(language: string): StoryDocument {
    const hero = characterTemplate(language);
    hero.name = localizedText("Hero", language);
    const chapter: Chapter = { id: makeId(), title: localizedText("Chapter One", language), subtitle: [], summary: [] };
    const story: Story = {
      id: crypto.randomUUID().toUpperCase(),
      author: "",
      chapters: [chapter],
      nodes: [],
      links: [],
      characters: [hero],
      items: [],
      monsters: [],
      locations: [],
      events: [],
      routes: [],
      tracks: [],
      skills: null,
      occupations: null,
    };
    const entrance: StoryNode = {
      id: makeId(),
      chapterId: chapter.id,
      position: { x: 80, y: 120 },
      music: { type: "keep" },
      locationId: "",
      kind: makeKind("entrance", language, story, chapter.id),
    };
    const end: StoryNode = {
      id: makeId(),
      chapterId: chapter.id,
      position: { x: 460, y: 140 },
      music: { type: "keep" },
      locationId: "",
      kind: makeKind("end", language, story, chapter.id),
    };
    story.nodes = [entrance, end];
    story.links = [{ fromNode: entrance.id, fromPort: "next", toNode: end.id }];
    const document = new StoryDocument(story, language);
    document.selection = { type: "node", id: entrance.id };
    document.saveNow();
    return document;
  }

  // MARK: Observing

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  /// Tells views something changed.
  notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  // MARK: Selection

  get selection(): Selection {
    return this.selectionValue;
  }

  set selection(selection: Selection) {
    this.selectionValue = selection;
    // Selecting a node elsewhere (from the problems list, say) brings its chapter onto the canvas.
    if (selection?.type === "node") {
      const chapterId = findNode(this.story, selection.id)?.chapterId;
      if (chapterId) this.currentChapterId = chapterId;
    }
    this.notify();
  }

  setCurrentChapter(id: string) {
    this.currentChapterId = id;
    this.notify();
  }

  setLanguage(language: string) {
    if (language === this.language) return;
    this.language = language;
    this.notify();
  }

  get selectedNodeId(): string | undefined {
    return this.selection?.type === "node" ? this.selection.id : undefined;
  }

  /// Every selected node, whether one or many.
  get selectedNodeIds(): Set<string> {
    const s = this.selection;
    if (s?.type === "node") return new Set([s.id]);
    if (s?.type === "nodes") return new Set(s.ids);
    return new Set();
  }

  selectedId(type: "character" | "item" | "monster" | "location" | "event" | "skill" | "occupation"): string | undefined {
    const s = this.selection;
    return s?.type === type ? s.id : undefined;
  }

  /// Selects every node on the current chapter's map.
  selectAllNodes() {
    this.selectNodes(this.visibleNodes.map((n) => n.id));
  }

  /// Adds a node to the selection, or removes it if it's already selected.
  toggleSelection(id: string) {
    const ids = this.selectedNodeIds;
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    this.selectNodes([...ids]);
  }

  private selectNodes(ids: string[]) {
    if (ids.length === 0) this.selection = null;
    else if (ids.length === 1) this.selection = { type: "node", id: ids[0] };
    else this.selection = { type: "nodes", ids };
  }

  /// The nodes on the current chapter's map.
  get visibleNodes(): StoryNode[] {
    return nodesIn(this.story, this.currentChapterId);
  }

  get currentChapter(): Chapter | undefined {
    return findChapter(this.story, this.currentChapterId);
  }

  issuesFor(nodeId: string): StoryIssue[] {
    return this.issues.filter((i) => i.nodeId === nodeId);
  }

  // MARK: Editing

  /// Applies an edit. Rapid edits (typing, dragging) are coalesced into a single undo step.
  private edit(change: (story: Draft<Story>) => void, coalescing = false) {
    const before = this.story;
    const after = produce(before, change);
    if (after === before) return;
    this.story = after;
    if (!coalescing || Date.now() - this.lastUndoPush > 1000) {
      this.undoStack.push(before);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastUndoPush = coalescing ? Date.now() : 0;
    this.didChange();
  }

  updateNode(id: string, change: (node: Draft<StoryNode>) => void) {
    this.edit((story) => {
      const node = story.nodes.find((n) => n.id === id);
      if (!node) return;
      change(node);
      // Removing a choice option removes its output, so drop any wire that left from it.
      const ports = new Set(outputPorts(node.kind as StoryNode["kind"]));
      story.links = story.links.filter((l) => l.fromNode !== id || ports.has(l.fromPort));
    }, true);
  }

  setAuthor(author: string) {
    this.edit((story) => {
      story.author = author;
    }, true);
  }

  addNode(type: NodeType, position: CanvasPoint): string | undefined {
    if (!isPlaceable(type, this.currentChapterId, this.story)) return undefined;
    const node: StoryNode = {
      id: makeId(),
      chapterId: this.currentChapterId,
      position,
      music: { type: "keep" },
      locationId: "",
      kind: makeKind(type, this.language, this.story, this.currentChapterId),
    };
    this.edit((story) => {
      story.nodes.push(node);
    });
    this.selection = { type: "node", id: node.id };
    return node.id;
  }

  duplicateNode(id: string) {
    const original = findNode(this.story, id);
    if (!original || original.kind.type === "entrance" || original.kind.type === "chapterStart") return;
    const copy: StoryNode = structuredClone(original);
    copy.id = makeId();
    copy.position = { x: copy.position.x + 40, y: copy.position.y + 40 };
    // Options double as port IDs, so the copy needs its own.
    if (copy.kind.type === "choice") for (const option of copy.kind.options) option.id = makeId();
    this.edit((story) => {
      story.nodes.push(copy);
    });
    this.selection = { type: "node", id: copy.id };
  }

  deleteNode(id: string) {
    this.deleteNodes([id]);
  }

  /// Deletes several nodes as one undo step.
  deleteNodes(ids: string[]) {
    const removed = new Set(ids);
    this.edit((story) => {
      story.nodes = story.nodes.filter((n) => !removed.has(n.id));
      story.links = story.links.filter((l) => !removed.has(l.fromNode) && !removed.has(l.toNode));
    });
    if ([...this.selectedNodeIds].some((id) => removed.has(id))) this.selection = null;
  }

  /// Starts a drag so the whole move becomes one undo step.
  beginMove() {
    this.undoStack.push(this.story);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /// Moves several nodes at once, as when dragging a selection. Call `beginMove` first.
  moveNodes(positions: Map<string, CanvasPoint>) {
    this.story = produce(this.story, (story) => {
      for (const node of story.nodes) {
        const position = positions.get(node.id);
        if (position) node.position = position;
      }
    });
    this.notify();
    this.scheduleSave();
  }

  /// Wires an output to a node's input, replacing whatever that output was wired to before.
  connect(fromNode: string, port: string, toNode: string) {
    // Chapters connect through Next Chapter nodes, so wires stay inside one chapter's map.
    const source = findNode(this.story, fromNode);
    const target = findNode(this.story, toNode);
    if (fromNode === toNode || !source || !target || target.kind.type === "entrance" || target.kind.type === "chapterStart") return;
    if (source.chapterId !== target.chapterId) return;
    this.edit((story) => {
      story.links = story.links.filter((l) => !(l.fromNode === fromNode && l.fromPort === port));
      story.links.push({ fromNode, fromPort: port, toNode });
    });
  }

  disconnect(link: StoryLink) {
    this.edit((story) => {
      story.links = story.links.filter((l) => !linkEquals(l, link));
    });
    if (this.selection?.type === "link" && linkEquals(this.selection.link, link)) this.selection = null;
  }

  /// Removes every wire into or out of a node, as one undo step.
  disconnectAll(nodeId: string) {
    this.edit((story) => {
      story.links = story.links.filter((l) => l.fromNode !== nodeId && l.toNode !== nodeId);
    });
  }

  deleteSelection() {
    const s = this.selection;
    switch (s?.type) {
      case "node":
        return this.deleteNode(s.id);
      case "nodes":
        return this.deleteNodes(s.ids);
      case "link":
        return this.disconnect(s.link);
      case "character":
        return this.deleteCharacter(s.id);
      case "item":
        return this.deleteItem(s.id);
      case "monster":
        return this.deleteMonster(s.id);
      case "location":
        return this.deleteLocation(s.id);
      case "event":
        return this.deleteEvent(s.id);
      case "skill":
        return this.deleteSkill(s.id);
      case "occupation":
        return this.deleteOccupation(s.id);
      case "route":
        return this.disconnectRoute(s.route);
    }
  }

  // MARK: Chapters

  /// Adds a chapter after the current one, with its Chapter Start ready, and shows it.
  addChapter() {
    const chapter: Chapter = { id: makeId(), title: localizedText("New chapter", this.language), subtitle: [], summary: [] };
    const start: StoryNode = {
      id: makeId(),
      chapterId: chapter.id,
      position: { x: 80, y: 120 },
      music: { type: "keep" },
      locationId: "",
      kind: { type: "chapterStart", body: [], quote: [] },
    };
    const current = this.currentChapterId;
    this.edit((story) => {
      const index = story.chapters.findIndex((c) => c.id === current);
      story.chapters.splice(index === -1 ? story.chapters.length : index + 1, 0, chapter);
      story.nodes.push(start);
    });
    this.currentChapterId = chapter.id;
    this.selection = { type: "node", id: start.id };
  }

  updateChapter(id: string, change: (chapter: Draft<Chapter>) => void) {
    this.edit((story) => {
      const chapter = story.chapters.find((c) => c.id === id);
      if (chapter) change(chapter);
    }, true);
  }

  moveChapter(id: string, offset: number) {
    this.edit((story) => {
      const index = story.chapters.findIndex((c) => c.id === id);
      const other = index + offset;
      if (index === -1 || other < 0 || other >= story.chapters.length) return;
      [story.chapters[index], story.chapters[other]] = [story.chapters[other], story.chapters[index]];
    });
  }

  /// Removes a chapter and everything on its map. The last chapter can't be removed.
  deleteChapter(id: string) {
    const index = this.story.chapters.findIndex((c) => c.id === id);
    if (this.story.chapters.length <= 1 || index === -1) return;
    const removed = new Set(nodesIn(this.story, id).map((n) => n.id));
    this.edit((story) => {
      story.chapters.splice(index, 1);
      story.nodes = story.nodes.filter((n) => !removed.has(n.id));
      story.links = story.links.filter((l) => !removed.has(l.fromNode) && !removed.has(l.toNode));
      // Jumps into the deleted chapter now lead nowhere, which validation points out.
      for (const node of story.nodes) {
        if (node.kind.type === "chapterJump" && node.kind.targetChapterId === id) node.kind.targetChapterId = "";
      }
    });
    if (this.currentChapterId === id) {
      this.currentChapterId = this.story.chapters[Math.min(index, this.story.chapters.length - 1)].id;
      this.notify();
    }
  }

  /// Moves a node to another chapter's map. Its wires are removed, since wires can't cross chapters.
  moveNodeToChapter(id: string, chapterId: string) {
    const node = findNode(this.story, id);
    if (!node || node.chapterId === chapterId || !findChapter(this.story, chapterId)) return;
    if (node.kind.type === "chapterStart" && startNode(this.story, chapterId)) return;
    this.edit((story) => {
      const draft = story.nodes.find((n) => n.id === id);
      if (draft) draft.chapterId = chapterId;
      story.links = story.links.filter((l) => l.fromNode !== id && l.toNode !== id);
    });
    if (this.selectedNodeId === id) this.selection = null;
  }

  /// Nodes in other chapters that lead into a chapter.
  jumpsInto(chapterId: string): StoryNode[] {
    return this.story.nodes.filter((n) => n.kind.type === "chapterJump" && n.kind.targetChapterId === chapterId);
  }

  // MARK: Character sheet

  addCharacter(): string {
    const character = characterTemplate(this.language);
    this.edit((story) => {
      story.characters.push(character);
    });
    this.selection = { type: "character", id: character.id };
    return character.id;
  }

  updateCharacter(id: string, change: (character: Draft<StoryCharacter>) => void) {
    this.edit((story) => {
      const character = story.characters.find((c) => c.id === id);
      if (character) change(character);
    }, true);
  }

  duplicateCharacter(id: string) {
    const original = findCharacter(this.story, id);
    if (!original) return;
    const copy = { ...structuredClone(original), id: makeId() };
    this.edit((story) => {
      story.characters.push(copy);
    });
    this.selection = { type: "character", id: copy.id };
  }

  /// Removes a character. Nodes that referred to it are left without one, which validation points out.
  deleteCharacter(id: string) {
    this.edit((story) => {
      story.characters = story.characters.filter((c) => c.id !== id);
      for (const node of story.nodes) {
        if (node.kind.type === "entrance" && node.kind.heroId === id) node.kind.heroId = "";
        if (node.kind.type === "battle" && node.kind.enemyId === id) node.kind.enemyId = "";
      }
    });
    if (this.selectedId("character") === id) this.selection = null;
  }

  /// Nodes that use a character or monster as the hero or an enemy.
  nodesUsing(id: string): StoryNode[] {
    return this.story.nodes.filter(
      (n) => (n.kind.type === "entrance" && n.kind.heroId === id) || (n.kind.type === "battle" && n.kind.enemyId === id),
    );
  }

  // MARK: Item sheet

  addItem(): string {
    const item: Item = {
      id: makeId(),
      name: localizedText("New item", this.language),
      detail: [],
      symbol: "diamond",
      category: "trinket",
      attack: 0,
      defense: 0,
      weight: 0,
      value: 0,
      skillId: "",
      damage: { count: 1, sides: 6, bonus: 0 },
      addsDamageBonus: true,
      impales: false,
    };
    this.edit((story) => {
      story.items.push(item);
    });
    this.selection = { type: "item", id: item.id };
    return item.id;
  }

  updateItem(id: string, change: (item: Draft<Item>) => void) {
    this.edit((story) => {
      const item = story.items.find((i) => i.id === id);
      if (item) change(item);
    }, true);
  }

  duplicateItem(id: string) {
    const original = findItem(this.story, id);
    if (!original) return;
    const copy = { ...structuredClone(original), id: makeId() };
    this.edit((story) => {
      story.items.push(copy);
    });
    this.selection = { type: "item", id: copy.id };
  }

  /// Removes an item from the sheet and from every inventory and choice that referred to it.
  deleteItem(id: string) {
    this.edit((story) => {
      story.items = story.items.filter((i) => i.id !== id);
      for (const character of story.characters) character.itemIds = character.itemIds.filter((i) => i !== id);
      for (const node of story.nodes) {
        if (node.kind.type !== "choice") continue;
        for (const option of node.kind.options) {
          option.effect.gainItems = option.effect.gainItems.filter((i) => i !== id);
          option.effect.loseItems = option.effect.loseItems.filter((i) => i !== id);
        }
      }
    });
    if (this.selectedId("item") === id) this.selection = null;
  }

  /// Characters who start with an item.
  charactersCarrying(itemId: string): StoryCharacter[] {
    return this.story.characters.filter((c) => c.itemIds.includes(itemId));
  }

  /// Choice nodes whose options give or take an item.
  nodesHandingOut(itemId: string): StoryNode[] {
    return this.story.nodes.filter(
      (n) => n.kind.type === "choice" && n.kind.options.some((o) => o.effect.gainItems.includes(itemId) || o.effect.loseItems.includes(itemId)),
    );
  }

  // MARK: Monster sheet

  addMonster(): string {
    const monster = monsterTemplate(this.language);
    this.edit((story) => {
      story.monsters.push(monster);
    });
    this.selection = { type: "monster", id: monster.id };
    return monster.id;
  }

  updateMonster(id: string, change: (monster: Draft<StoryMonster>) => void) {
    this.edit((story) => {
      const monster = story.monsters.find((m) => m.id === id);
      if (monster) change(monster);
    }, true);
  }

  duplicateMonster(id: string) {
    const original = findMonster(this.story, id);
    if (!original) return;
    const copy = { ...structuredClone(original), id: makeId() };
    this.edit((story) => {
      story.monsters.push(copy);
    });
    this.selection = { type: "monster", id: copy.id };
  }

  /// Removes a monster. Battles that fought it are left without an enemy, which validation points out.
  deleteMonster(id: string) {
    this.edit((story) => {
      story.monsters = story.monsters.filter((m) => m.id !== id);
      for (const node of story.nodes) {
        if (node.kind.type === "battle" && node.kind.enemyId === id) node.kind.enemyId = "";
      }
    });
    if (this.selectedId("monster") === id) this.selection = null;
  }

  // MARK: Location sheet

  addLocation(position?: CanvasPoint): string {
    // Without a spot, place it right of the rightmost location on the map.
    const rightmost = this.story.locations.reduce<StoryLocation | undefined>((best, l) => (!best || l.position.x > best.position.x ? l : best), undefined);
    const location: StoryLocation = {
      id: makeId(),
      name: localizedText("New location", this.language),
      region: [],
      detail: [],
      symbol: "mappin.and.ellipse",
      position: position ?? (rightmost ? { x: rightmost.position.x + 240, y: rightmost.position.y } : { x: 0, y: 0 }),
    };
    this.edit((story) => {
      story.locations.push(location);
    });
    this.selection = { type: "location", id: location.id };
    return location.id;
  }

  updateLocation(id: string, change: (location: Draft<StoryLocation>) => void) {
    this.edit((story) => {
      const location = story.locations.find((l) => l.id === id);
      if (location) change(location);
    }, true);
  }

  duplicateLocation(id: string) {
    const original = findLocation(this.story, id);
    if (!original) return;
    const copy = { ...structuredClone(original), id: makeId(), position: { x: original.position.x + 40, y: original.position.y + 40 } };
    this.edit((story) => {
      story.locations.push(copy);
    });
    this.selection = { type: "location", id: copy.id };
  }

  /// Removes a location. Nodes set there are left without one.
  deleteLocation(id: string) {
    this.edit((story) => {
      story.locations = story.locations.filter((l) => l.id !== id);
      story.routes = story.routes.filter((r) => !routeConnects(r, id));
      for (const node of story.nodes) {
        if (node.locationId === id) node.locationId = "";
        // Options that traveled there now stay put.
        if (node.kind.type === "choice") {
          for (const option of node.kind.options) if (option.effect.moveTo === id) option.effect.moveTo = null;
        }
      }
    });
    if (this.selectedId("location") === id) this.selection = null;
  }

  /// Moves a location on the map. Call `beginMove` first so the drag is one undo step.
  moveLocation(id: string, position: CanvasPoint) {
    this.story = produce(this.story, (story) => {
      const location = story.locations.find((l) => l.id === id);
      if (location) location.position = position;
    });
    this.notify();
    this.scheduleSave();
  }

  /// Adds a two-way road between two locations, if there isn't one already.
  connectLocations(a: string, b: string) {
    const route = makeRoute(a, b);
    if (a === b || !findLocation(this.story, a) || !findLocation(this.story, b) || this.story.routes.some((r) => routeEquals(r, route))) return;
    this.edit((story) => {
      story.routes.push(route);
    });
  }

  disconnectRoute(route: LocationRoute) {
    this.edit((story) => {
      story.routes = story.routes.filter((r) => !routeEquals(r, route));
    });
    if (this.selection?.type === "route" && routeEquals(this.selection.route, route)) this.selection = null;
  }

  /// Nodes set at a location, and choices with an option that travels there.
  nodesAt(locationId: string): StoryNode[] {
    return this.story.nodes.filter((n) => {
      if (n.kind.type !== "check" && n.kind.type !== "chapterJump" && n.locationId === locationId) return true;
      return n.kind.type === "choice" && n.kind.options.some((o) => o.effect.moveTo === locationId);
    });
  }

  // MARK: Event sheet

  addEvent(): string {
    const event: StoryEvent = { id: makeId(), name: localizedText("New event", this.language), detail: [], symbol: "sparkles" };
    this.edit((story) => {
      story.events.push(event);
    });
    this.selection = { type: "event", id: event.id };
    return event.id;
  }

  updateEvent(id: string, change: (event: Draft<StoryEvent>) => void) {
    this.edit((story) => {
      const event = story.events.find((e) => e.id === id);
      if (event) change(event);
    }, true);
  }

  duplicateEvent(id: string) {
    const original = findEvent(this.story, id);
    if (!original) return;
    const copy = { ...structuredClone(original), id: makeId() };
    this.edit((story) => {
      story.events.push(copy);
    });
    this.selection = { type: "event", id: copy.id };
  }

  /// Removes an event. Event nodes that made it happen or waited for it are left without one.
  deleteEvent(id: string) {
    this.edit((story) => {
      story.events = story.events.filter((e) => e.id !== id);
      for (const node of story.nodes) {
        if (node.kind.type !== "event") continue;
        if (node.kind.eventId === id) node.kind.eventId = "";
        if (node.kind.trigger.priorEventId === id) node.kind.trigger.priorEventId = "";
      }
    });
    if (this.selectedId("event") === id) this.selection = null;
  }

  /// Event nodes that make an event happen, or wait for it.
  nodesInvolving(eventId: string): StoryNode[] {
    return this.story.nodes.filter(
      (n) =>
        n.kind.type === "event" &&
        (n.kind.eventId === eventId ||
          (n.kind.occurrence === "perhaps" && n.kind.trigger.mode === "priorEvent" && n.kind.trigger.priorEventId === eventId)),
    );
  }

  // MARK: Skill sheet

  /// The story's skills and occupations: its own sheets, or the built-in ones.
  get catalog(): SkillCatalog {
    return catalogOf(this.story);
  }

  /// Stories start out on the built-in catalog. The first change to it copies the catalog into the story, so
  /// built-in skills can be edited and deleted like any other.
  private ownSkills(story: Draft<Story>): Draft<StorySkill>[] {
    story.skills ??= builtInSkills();
    return story.skills;
  }

  private ownOccupations(story: Draft<Story>): Draft<StoryOccupation>[] {
    story.occupations ??= builtInOccupations();
    return story.occupations;
  }

  /// Adds a skill: an ordinary one, or an ability that starts out as a simple attack spell to adjust.
  addSkill(kind: "skill" | "ability" = "skill"): string {
    const skill: StorySkill = {
      id: makeId(),
      name: localizedText(kind === "ability" ? "New ability" : "New skill", this.language),
      detail: [],
      symbol: kind === "ability" ? "flame.fill" : "sparkles",
      group: kind === "ability" ? "magic" : "other",
      base: { type: "fixed", value: kind === "ability" ? 0 : 10 },
      takesSpecialty: false,
      isUncommon: kind === "ability",
      atCreation: true,
      isWealth: false,
      combat:
        kind === "ability"
          ? {
              type: "ability",
              ability: {
                effect: "damage",
                amount: { count: 2, sides: 6, bonus: 0 },
                addsDamageBonus: false,
                piercesArmor: true,
                dodgeable: true,
                target: "enemy",
                cost: { mp: 4, hp: 0, stamina: 0, sanity: 0 },
              },
            }
          : { type: "none" },
    };
    this.edit((story) => {
      this.ownSkills(story).push(skill);
    });
    this.selection = { type: "skill", id: skill.id };
    return skill.id;
  }

  updateSkill(id: string, change: (skill: Draft<StorySkill>) => void) {
    this.edit((story) => {
      const skill = this.ownSkills(story).find((s) => s.id === id);
      if (skill) change(skill);
      // Only one skill can be the measure of wealth.
      if (skill?.isWealth) for (const other of story.skills!) if (other.id !== id) other.isWealth = false;
    }, true);
  }

  duplicateSkill(id: string) {
    const original = this.catalog.skill(id);
    if (!original) return;
    const copy: StorySkill = { ...structuredClone(original), id: makeId(), isWealth: false };
    this.edit((story) => {
      const skills = this.ownSkills(story);
      skills.splice(skills.findIndex((s) => s.id === id) + 1, 0, copy);
    });
    this.selection = { type: "skill", id: copy.id };
  }

  /// Removes a skill from the sheet, from every character's skills and every occupation, and from the weapons that
  /// used it. Checks that rolled it are left pointing at nothing, which validation points out.
  deleteSkill(id: string) {
    this.edit((story) => {
      const skills = this.ownSkills(story);
      skills.splice(0, skills.length, ...skills.filter((s) => s.id !== id));
      for (const character of story.characters) character.skills = character.skills.filter((s) => s.skillId !== id);
      for (const item of story.items) if (item.skillId === id) item.skillId = "";
      for (const occupation of this.ownOccupations(story)) {
        occupation.slots = occupation.slots
          .map((slot) => (slot.type === "oneOf" ? { ...slot, skillIds: slot.skillIds.filter((s) => s !== id) } : slot))
          .filter((slot) => !(slot.type === "skill" && slot.skillId === id) && !(slot.type === "oneOf" && slot.skillIds.length === 0));
      }
    });
    if (this.selectedId("skill") === id) this.selection = null;
  }

  moveSkill(id: string, offset: number) {
    this.edit((story) => {
      const skills = this.ownSkills(story);
      const from = skills.findIndex((s) => s.id === id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= skills.length) return;
      const [skill] = skills.splice(from, 1);
      skills.splice(to, 0, skill);
    });
  }

  /// Goes back to the built-in skills. Story-made skills disappear, and whatever used them is flagged by validation.
  restoreBuiltInSkills() {
    this.edit((story) => {
      story.skills = null;
    });
    if (this.selection?.type === "skill") this.selection = null;
  }

  /// Where a skill is used: checks that roll it, weapons that use it, characters who have it, and occupations that offer it.
  skillUsage(id: string): { checks: StoryNode[]; items: Item[]; characters: StoryCharacter[]; occupations: StoryOccupation[] } {
    return {
      checks: this.story.nodes.filter((n) => n.kind.type === "check" && n.kind.target.type === "skill" && n.kind.target.skillId === id),
      items: this.story.items.filter((i) => i.skillId === id),
      characters: this.story.characters.filter((c) => c.skills.some((s) => s.skillId === id)),
      occupations: this.catalog.occupations.filter((o) =>
        o.slots.some((slot) => (slot.type === "skill" && slot.skillId === id) || (slot.type === "oneOf" && slot.skillIds.includes(id))),
      ),
    };
  }

  // MARK: Occupation sheet

  addOccupation(): string {
    const occupation: StoryOccupation = {
      id: makeId(),
      name: localizedText("New occupation", this.language),
      detail: [],
      symbol: "briefcase",
      wealth: [9, 30],
      points: [{ characteristics: ["education"], multiplier: 4 }],
      slots: [{ type: "any", count: 4 }],
    };
    this.edit((story) => {
      this.ownOccupations(story).push(occupation);
    });
    this.selection = { type: "occupation", id: occupation.id };
    return occupation.id;
  }

  updateOccupation(id: string, change: (occupation: Draft<StoryOccupation>) => void) {
    this.edit((story) => {
      const occupation = this.ownOccupations(story).find((o) => o.id === id);
      if (occupation) change(occupation);
    }, true);
  }

  duplicateOccupation(id: string) {
    const original = this.catalog.occupation(id);
    if (!original) return;
    const copy: StoryOccupation = { ...structuredClone(original), id: makeId() };
    this.edit((story) => {
      const occupations = this.ownOccupations(story);
      occupations.splice(occupations.findIndex((o) => o.id === id) + 1, 0, copy);
    });
    this.selection = { type: "occupation", id: copy.id };
  }

  /// Removes an occupation. Characters who had it keep their skills but have no occupation.
  deleteOccupation(id: string) {
    this.edit((story) => {
      const occupations = this.ownOccupations(story);
      occupations.splice(0, occupations.length, ...occupations.filter((o) => o.id !== id));
      for (const character of story.characters) if (character.occupationId === id) character.occupationId = "";
    });
    if (this.selectedId("occupation") === id) this.selection = null;
  }

  restoreBuiltInOccupations() {
    this.edit((story) => {
      story.occupations = null;
    });
    if (this.selection?.type === "occupation") this.selection = null;
  }

  charactersWithOccupation(id: string): StoryCharacter[] {
    return this.story.characters.filter((c) => c.occupationId === id);
  }

  // MARK: Music

  addTrack(track: MusicTrack) {
    this.edit((story) => {
      story.tracks.push(track);
    });
  }

  /// Removes a track; nodes that played it fall back to keeping the current music.
  removeTrack(id: string) {
    this.edit((story) => {
      story.tracks = story.tracks.filter((t) => t.id !== id);
      for (const node of story.nodes) {
        if (node.music.type === "play" && node.music.trackId === id) node.music = { type: "keep" };
      }
    });
  }

  // MARK: Undo

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.story);
    this.story = previous;
    this.lastUndoPush = 0;
    this.didChange();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.story);
    this.story = next;
    this.lastUndoPush = 0;
    this.didChange();
  }

  // MARK: Saving

  private didChange() {
    const story = this.story;
    this.issues = validate(story);
    this.arriving = arrivingLocations(story);
    // Drop selections that no longer exist.
    const s = this.selectionValue;
    if (s?.type === "node" && !findNode(story, s.id)) this.selectionValue = null;
    if (s?.type === "nodes") {
      const ids = s.ids.filter((id) => findNode(story, id));
      this.selectionValue = ids.length === 0 ? null : ids.length === 1 ? { type: "node", id: ids[0] } : { type: "nodes", ids };
    }
    if (s?.type === "link" && !story.links.some((l) => linkEquals(l, s.link))) this.selectionValue = null;
    if (s?.type === "character" && !findCharacter(story, s.id)) this.selectionValue = null;
    if (s?.type === "item" && !findItem(story, s.id)) this.selectionValue = null;
    if (s?.type === "monster" && !findMonster(story, s.id)) this.selectionValue = null;
    if (s?.type === "location" && !findLocation(story, s.id)) this.selectionValue = null;
    if (s?.type === "event" && !findEvent(story, s.id)) this.selectionValue = null;
    if (s?.type === "route" && !story.routes.some((r) => routeEquals(r, s.route))) this.selectionValue = null;
    if (!findChapter(story, this.currentChapterId) && story.chapters[0]) this.currentChapterId = story.chapters[0].id;
    this.notify();
    this.scheduleSave();
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DELAY);
  }

  /// Writes the script to the library right away, e.g. when leaving the designer.
  saveNow(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    return api
      .saveToLibrary(this.story)
      .then(() => {
        if (this.lastSaveError !== null) {
          this.lastSaveError = null;
          this.notify();
        }
      })
      .catch((error) => {
        this.lastSaveError = errorMessage(error);
        this.notify();
      });
  }
}

/// Re-renders a component whenever the document changes.
export function useDocument(document: StoryDocument): StoryDocument {
  useSyncExternalStore(document.subscribe, document.getVersion);
  return document;
}
