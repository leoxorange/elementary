// Queries on the story graph, shared by the game, the validator, and the designer.

import type {
  Chapter,
  EntranceNode,
  LocationRoute,
  NodeKind,
  StoryCharacter,
  Item,
  StoryEvent,
  StoryLink,
  StoryLocation,
  StoryMonster,
  StoryNode,
  Story,
  StoryText,
  MusicTrack,
} from "./types";
import { Port } from "./types";

/// A short random ID for nodes, options, and sheet entries.
export function makeId(): string {
  return crypto.randomUUID().slice(0, 8).toLowerCase();
}

// MARK: Node kinds

/// Entrances and chapter starts are where play begins, so nothing can be wired into them.
export function hasInput(kind: NodeKind): boolean {
  return kind.type !== "entrance" && kind.type !== "chapterStart";
}

/// Whether the node can be placed at a location-sheet entry. Checks happen wherever the hero already is, and Next
/// Chapter nodes are never shown.
export function hasLocation(kind: NodeKind): boolean {
  return kind.type !== "check" && kind.type !== "chapterJump";
}

/// Whether a choice option does damage, and so could kill the hero.
export function canKill(kind: NodeKind): boolean {
  if (kind.type === "choice") return kind.options.some((o) => o.effect.hp < 0);
  if (kind.type === "event") return kind.hp < 0;
  return false;
}

/// The IDs of this node's output ports, in display order.
export function outputPorts(kind: NodeKind): string[] {
  switch (kind.type) {
    case "entrance":
    case "narration":
    case "chapterStart":
      return [Port.next];
    case "choice":
      return [...kind.options.map((o) => o.id), ...(canKill(kind) ? [Port.death] : [])];
    case "check":
      return [Port.success, Port.failure];
    case "battle":
      return [Port.victory, Port.defeat];
    case "event":
      return [...(kind.occurrence === "eventually" ? [Port.next] : [Port.happens, Port.otherwise]), ...(canKill(kind) ? [Port.death] : [])];
    case "end":
    case "chapterJump":
      return [];
  }
}

/// The node's headline, used on the canvas, in the journal, and as the scene title in play. Chapter starts are
/// titled by their chapter, and jumps by where they lead.
export function kindTitle(kind: NodeKind): StoryText {
  return kind.type === "chapterStart" || kind.type === "chapterJump" ? [] : kind.title;
}

// MARK: Lookups

export function entranceNode(story: Story): StoryNode | undefined {
  return story.nodes.find((n) => n.kind.type === "entrance");
}

export function entrance(story: Story): EntranceNode | undefined {
  const kind = entranceNode(story)?.kind;
  return kind?.type === "entrance" ? kind : undefined;
}

export function storyTitle(story: Story): StoryText {
  return entrance(story)?.title ?? [];
}

export function findNode(story: Story, id: string): StoryNode | undefined {
  return story.nodes.find((n) => n.id === id);
}

export function findChapter(story: Story, id: string): Chapter | undefined {
  return story.chapters.find((c) => c.id === id);
}

export function nodesIn(story: Story, chapterId: string): StoryNode[] {
  return story.nodes.filter((n) => n.chapterId === chapterId);
}

/// Where play enters a chapter when a Next Chapter node leads to it.
export function startNode(story: Story, chapterId: string): StoryNode | undefined {
  return story.nodes.find((n) => n.chapterId === chapterId && n.kind.type === "chapterStart");
}

export function findTrack(story: Story, id: string): MusicTrack | undefined {
  return story.tracks.find((t) => t.id === id);
}

export function findCharacter(story: Story, id: string): StoryCharacter | undefined {
  return story.characters.find((c) => c.id === id);
}

export function findItem(story: Story, id: string): Item | undefined {
  return story.items.find((i) => i.id === id);
}

export function findMonster(story: Story, id: string): StoryMonster | undefined {
  return story.monsters.find((m) => m.id === id);
}

export function findLocation(story: Story, id: string): StoryLocation | undefined {
  return story.locations.find((l) => l.id === id);
}

export function findEvent(story: Story, id: string): StoryEvent | undefined {
  return story.events.find((e) => e.id === id);
}

/// The protagonist chosen on the entrance node.
export function heroCharacter(story: Story): StoryCharacter | undefined {
  const heroId = entrance(story)?.heroId;
  return heroId ? findCharacter(story, heroId) : undefined;
}

/// The node wired to an output port, if any.
export function linkTarget(story: Story, nodeId: string, port: string): string | undefined {
  return story.links.find((l) => l.fromNode === nodeId && l.fromPort === port)?.toNode;
}

/// Links arriving at a node's input.
export function incomingLinks(story: Story, nodeId: string): StoryLink[] {
  return story.links.filter((l) => l.toNode === nodeId);
}

export function linkEquals(a: StoryLink, b: StoryLink): boolean {
  return a.fromNode === b.fromNode && a.fromPort === b.fromPort && a.toNode === b.toNode;
}

// MARK: Locations

/// A road with its ends in sorted order, so a road has one representation whichever end it was drawn from.
export function makeRoute(a: string, b: string): LocationRoute {
  return a < b ? { first: a, second: b } : { first: b, second: a };
}

export function routeEquals(a: LocationRoute, b: LocationRoute): boolean {
  return a.first === b.first && a.second === b.second;
}

export function routeConnects(route: LocationRoute, id: string): boolean {
  return route.first === id || route.second === id;
}

/// The location at the other end from `id`.
export function routeOther(route: LocationRoute, id: string): string {
  return route.first === id ? route.second : route.first;
}

/// Locations one road away from `locationId`.
export function neighbors(story: Story, locationId: string): Set<string> {
  return new Set(story.routes.filter((r) => routeConnects(r, locationId)).map((r) => routeOther(r, locationId)));
}

/// For every node, the locations the hero can be at when play arrives there: the location of the nearest node
/// before it, or the destination of the choice option taken, along every branch that leads in. Nodes without a
/// location of their own pass on where the hero already was. Nodes nothing leads into, like the entrance, have none.
export function arrivingLocations(story: Story): Map<string, Set<string>> {
  const nodesById = new Map<string, StoryNode>();
  for (const node of story.nodes) if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  const successors = new Map<string, { node: string; port: string }[]>();
  const addSuccessor = (from: string, node: string, port: string) => {
    const list = successors.get(from);
    if (list) list.push({ node, port });
    else successors.set(from, [{ node, port }]);
  };
  for (const link of story.links) addSuccessor(link.fromNode, link.toNode, link.fromPort);
  for (const node of story.nodes) {
    if (node.kind.type === "chapterJump") {
      const start = startNode(story, node.kind.targetChapterId);
      if (start) addSuccessor(node.id, start.id, "");
    }
  }
  const locationIds = new Set(story.locations.map((l) => l.id));

  // Propagate until nothing changes. Sets only grow and are bounded by the location sheet, so this ends.
  const arriving = new Map<string, Set<string>>();
  const queue = [...story.nodes];
  while (queue.length > 0) {
    const node = queue.pop()!;
    const here: Set<string> =
      hasLocation(node.kind) && locationIds.has(node.locationId) ? new Set([node.locationId]) : (arriving.get(node.id) ?? new Set());
    for (const { node: next, port } of successors.get(node.id) ?? []) {
      // A choice option that travels somewhere leaves from its destination instead.
      let leaving = here;
      if (node.kind.type === "choice") {
        const destination = node.kind.options.find((o) => o.id === port)?.effect.moveTo;
        if (destination && locationIds.has(destination)) leaving = new Set([destination]);
      }
      if (leaving.size === 0) continue;
      const before = arriving.get(next) ?? new Set<string>();
      const merged = new Set([...before, ...leaving]);
      if (merged.size !== before.size) {
        arriving.set(next, merged);
        const successor = nodesById.get(next);
        if (successor) queue.push(successor);
      }
    }
  }
  return arriving;
}
