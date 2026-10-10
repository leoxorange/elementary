// The pannable, zoomable graph editor. Drag a node's header to move it, drag from an output socket onto another
// node to wire them, and drag a wire off an input socket to reroute or remove it, as in Blender's node editor.

import { useEffect, useRef, useState } from "react";
import { contextMenu, isCommand, isTyping, useKeyboard, type MenuEntry } from "../components/ui";
import { opponent, type Enemy } from "../game/battle";
import { t } from "../i18n";
import { Icon } from "../icons";
import { checkTargetName, comparisonSymbol, difficultyName, timeWindowSummary } from "../model/names";
import { ABBREVIATIONS, damageLabel } from "../model/rules";
import {
  findChapter,
  findCharacter,
  findEvent,
  findLocation,
  findNode,
  findTrack,
  hasInput,
  hasLocation,
  incomingLinks,
  kindTitle,
  linkEquals,
  outputPorts,
} from "../model/story";
import { isBlank, resolve } from "../model/storyText";
import type { Chapter, EventNode, NodeKind, NodeType, StoryLink, StoryNode } from "../model/types";
import { useDocument, type StoryDocument } from "./document";
import { portColor, portLabel, typeColor, typeName, typeSymbol, withAlpha } from "./nodeTypes";
import { distanceToSegment, gridStyle, rectContains, trackPointer, useViewport, ZoomControls, type Point, type Rect } from "./viewport";

/// Fixed node geometry. Cards are laid out with these exact sizes so socket positions can be computed instead of
/// measured, which keeps wires, cards, and drag targets in sync at any zoom.
export const NodeMetrics = {
  width: 248,
  header: 38,
  row: 26,
  summary: 46,
  padding: 6,
  socket: 12,
};

export function nodeHeight(kind: NodeKind): number {
  const m = NodeMetrics;
  return m.header + m.padding + outputPorts(kind).length * m.row + (hasInput(kind) ? m.row : 0) + m.summary + m.padding;
}

export function nodeFrame(node: StoryNode): Rect {
  return { x: node.position.x, y: node.position.y, width: NodeMetrics.width, height: nodeHeight(node.kind) };
}

/// Output sockets sit on the right edge, one per row, in port order.
function outputPoint(node: StoryNode, port: string): Point | undefined {
  const index = outputPorts(node.kind).indexOf(port);
  if (index === -1) return undefined;
  const m = NodeMetrics;
  return { x: node.position.x + m.width, y: node.position.y + m.header + m.padding + m.row * (index + 0.5) };
}

/// The input socket sits on the left edge, on the row below the outputs.
function inputPoint(node: StoryNode): Point {
  const m = NodeMetrics;
  return { x: node.position.x, y: node.position.y + m.header + m.padding + m.row * (outputPorts(node.kind).length + 0.5) };
}

/// A horizontal S-curve, like Blender's noodles.
function wirePath(start: Point, end: Point): string {
  const bend = Math.max(50, Math.abs(end.x - start.x) * 0.5);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

/// Points along a wire, for hit-testing clicks.
function wireSamples(start: Point, end: Point): Point[] {
  const bend = Math.max(50, Math.abs(end.x - start.x) * 0.5);
  const c1 = { x: start.x + bend, y: start.y };
  const c2 = { x: end.x - bend, y: end.y };
  const points: Point[] = [];
  for (let i = 0; i <= 32; i++) {
    const s = i / 32;
    const u = 1 - s;
    points.push({
      x: u * u * u * start.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s * s * s * end.x,
      y: u * u * u * start.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s * s * s * end.y,
    });
  }
  return points;
}

/// The MIME type palette items carry when dragged onto the canvas.
export const NODE_TYPE_DRAG = "application/x-elementary-node-type";

interface PendingWire {
  fromNode: string;
  fromPort: string;
  /// The pointer, in view coordinates.
  location: Point;
}

export function NodeCanvas({ document }: { document: StoryDocument }) {
  useDocument(document);
  const container = useRef<HTMLDivElement>(null);
  const { viewport, toWorld, toScreen, localPoint, zoomBy, fit, startPan } = useViewport(container);
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  const story = document.story;
  const language = document.language;

  const visibleNodes = document.visibleNodes;
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  // Wires never cross chapters, but a damaged file could have one.
  const visibleLinks = story.links.filter((l) => visibleIds.has(l.fromNode) && visibleIds.has(l.toNode));
  const selected = document.selectedNodeIds;
  // Draw the selected nodes last so they sit on top of any they overlap.
  const orderedNodes = [...visibleNodes.filter((n) => !selected.has(n.id)), ...visibleNodes.filter((n) => selected.has(n.id))];

  const fitToContent = () => fit(document.visibleNodes.map(nodeFrame), 60);

  // Frame the chapter when it's shown.
  useEffect(() => {
    const frame = requestAnimationFrame(fitToContent);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.currentChapterId]);

  /// The node a dragged wire would connect to if released now.
  const hoveredTarget = (wire: PendingWire): StoryNode | undefined => {
    const point = toWorld(wire.location);
    return [...orderedNodes].reverse().find((n) => n.id !== wire.fromNode && hasInput(n.kind) && rectContains(nodeFrame(n), point, 12));
  };
  const dropTarget = pendingWire ? hoveredTarget(pendingWire) : undefined;

  const linkPoints = (link: StoryLink): [Point, Point] | undefined => {
    const from = findNode(story, link.fromNode);
    const to = findNode(story, link.toNode);
    const start = from && outputPoint(from, link.fromPort);
    if (!from || !to || !start) return undefined;
    return [toScreen(start), toScreen(inputPoint(to))];
  };

  /// The wire under a click, if any, so wires can be selected and deleted.
  const linkNear = (point: Point): StoryLink | undefined =>
    visibleLinks.find((link) => {
      const points = linkPoints(link);
      if (!points) return false;
      const samples = wireSamples(...points);
      return samples.some((p, i) => i > 0 && distanceToSegment(point, samples[i - 1], p) <= 6);
    });

  // MARK: Gestures

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    container.current?.focus();
    const start = localPoint(event);
    const pan = startPan(start);
    let moved = false;
    trackPointer(
      event,
      (e) => {
        const point = localPoint(e);
        if (!moved && Math.hypot(point.x - start.x, point.y - start.y) < 2) return;
        moved = true;
        pan(point);
      },
      () => {
        if (!moved) {
          const link = linkNear(start);
          document.selection = link ? { type: "link", link } : null;
        }
      },
    );
  };

  const onNodePointerDown = (node: StoryNode, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    container.current?.focus();
    const start = localPoint(event);
    const toggles = event.shiftKey || isCommand(event);
    let origins: Map<string, Point> | null = null;
    trackPointer(
      event,
      (e) => {
        const point = localPoint(e);
        if (!origins) {
          if (Math.hypot(point.x - start.x, point.y - start.y) < 3) return;
          // Dragging a selected node moves the whole selection; dragging another selects just it.
          if (!document.selectedNodeIds.has(node.id)) document.selection = { type: "node", id: node.id };
          const ids = document.selectedNodeIds;
          origins = new Map(document.visibleNodes.filter((n) => ids.has(n.id)).map((n) => [n.id, n.position]));
          document.beginMove();
        }
        const origin = origins.get(node.id);
        if (!origin) return;
        // Snap the dragged node to the grid, and move the rest of the selection by the same amount.
        const zoom = viewport.zoom;
        const x = Math.round((origin.x + (point.x - start.x) / zoom) / 12) * 12;
        const y = Math.round((origin.y + (point.y - start.y) / zoom) / 12) * 12;
        const dx = x - origin.x;
        const dy = y - origin.y;
        document.moveNodes(new Map([...origins].map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }])));
      },
      () => {
        if (origins) return;
        // ⇧- or ⌘-click adds to or removes from the selection, as in Finder.
        if (toggles) document.toggleSelection(node.id);
        else document.selection = { type: "node", id: node.id };
      },
    );
  };

  const finishWire = (wire: PendingWire | null) => {
    setPendingWire(null);
    if (!wire) return;
    const target = hoveredTarget(wire);
    if (target) document.connect(wire.fromNode, wire.fromPort, target.id);
  };

  const onOutputPointerDown = (node: StoryNode, port: string, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    let wire: PendingWire = { fromNode: node.id, fromPort: port, location: localPoint(event) };
    setPendingWire(wire);
    trackPointer(
      event,
      (e) => {
        wire = { ...wire, location: localPoint(e) };
        setPendingWire(wire);
      },
      () => finishWire(wire),
    );
  };

  /// Dragging from a connected input picks up its most recent wire, so it can be dropped elsewhere or let go.
  const onInputPointerDown = (node: StoryNode, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const start = localPoint(event);
    let wire: PendingWire | null = null;
    trackPointer(
      event,
      (e) => {
        const point = localPoint(e);
        if (!wire) {
          if (Math.hypot(point.x - start.x, point.y - start.y) < 2) return;
          const link = incomingLinks(document.story, node.id).at(-1);
          if (!link) return;
          document.disconnect(link);
          wire = { fromNode: link.fromNode, fromPort: link.fromPort, location: point };
        } else {
          wire = { ...wire, location: point };
        }
        setPendingWire(wire);
      },
      () => finishWire(wire),
    );
  };

  // MARK: Keyboard

  useKeyboard((event) => {
    if (isTyping(event)) return;
    const command = isCommand(event);
    if ((event.key === "Delete" || event.key === "Backspace") && !command && document.selection) {
      document.deleteSelection();
      return true;
    }
    if (command && event.key.toLowerCase() === "a") {
      document.selectAllNodes();
      return true;
    }
    if (event.key === "Escape" && document.selection) {
      document.selection = null;
      return true;
    }
    if (command && (event.key === "-" || event.key === "_")) {
      zoomBy(1 / 1.25);
      return true;
    }
    if (command && (event.key === "=" || event.key === "+")) {
      zoomBy(1.25);
      return true;
    }
    if (command && event.key === "0") {
      fitToContent();
      return true;
    }
  });

  // MARK: Drop from the palette

  const onDrop = (event: React.DragEvent) => {
    const type = event.dataTransfer.getData(NODE_TYPE_DRAG) as NodeType;
    if (!type) return;
    event.preventDefault();
    const point = toWorld(localPoint(event));
    document.addNode(type, { x: point.x - NodeMetrics.width / 2, y: point.y - NodeMetrics.header / 2 });
  };

  // MARK: Drawing

  const chapterNumber = (id: string) => story.chapters.findIndex((c) => c.id === id) + 1;
  const chapterName = (chapter: Chapter, number: number) => (isBlank(chapter.title) ? t("Chapter %lld", number) : resolve(chapter.title, language));

  /// Chapter starts show their chapter's title, and jumps show where they lead.
  const headline = (node: StoryNode): string | undefined => {
    if (node.kind.type === "chapterStart") {
      const chapter = findChapter(story, node.chapterId);
      return chapter ? chapterName(chapter, chapterNumber(chapter.id)) : undefined;
    }
    if (node.kind.type === "chapterJump") {
      const target = findChapter(story, node.kind.targetChapterId);
      return target ? "→ " + chapterName(target, chapterNumber(target.id)) : t("No chapter chosen");
    }
    return undefined;
  };

  const nodeMenu = (node: StoryNode): MenuEntry[] => {
    const entries: MenuEntry[] = [];
    if (node.kind.type !== "entrance") {
      entries.push({ label: t("Duplicate"), icon: "plus.square.on.square", action: () => document.duplicateNode(node.id) });
    }
    entries.push({ label: t("Disconnect All"), icon: "scissors", action: () => document.disconnectAll(node.id) });
    if (story.chapters.length > 1) {
      entries.push({ separator: true }, { header: t("Move to Chapter") });
      story.chapters.forEach((chapter, index) =>
        entries.push({
          label: chapterName(chapter, index + 1),
          disabled: chapter.id === node.chapterId,
          action: () => document.moveNodeToChapter(node.id, chapter.id),
        }),
      );
    }
    entries.push({ separator: true }, { label: t("Delete"), icon: "trash", destructive: true, action: () => document.deleteNode(node.id) });
    return entries;
  };

  let pendingPath: { d: string; color: string } | null = null;
  if (pendingWire) {
    const from = findNode(story, pendingWire.fromNode);
    const start = from && outputPoint(from, pendingWire.fromPort);
    if (from && start) {
      const end = dropTarget ? toScreen(inputPoint(dropTarget)) : pendingWire.location;
      pendingPath = { d: wirePath(toScreen(start), end), color: portColor(from.kind, pendingWire.fromPort) };
    }
  }

  return (
    <div
      ref={container}
      className="canvas"
      tabIndex={0}
      style={gridStyle(viewport)}
      onPointerDown={onBackgroundPointerDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(NODE_TYPE_DRAG)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={onDrop}
    >
      <svg className="canvas-wires">
        {visibleLinks.map((link) => {
          const points = linkPoints(link);
          if (!points) return null;
          const isSelected = document.selection?.type === "link" && linkEquals(document.selection.link, link);
          const from = findNode(story, link.fromNode)!;
          const d = wirePath(...points);
          return (
            <g key={`${link.fromNode}:${link.fromPort}`}>
              {isSelected && <path d={d} stroke="rgba(255,255,255,0.9)" strokeWidth={5} fill="none" />}
              <path d={d} stroke={portColor(from.kind, link.fromPort)} strokeOpacity={isSelected ? 1 : 0.8} strokeWidth={2.5} fill="none" />
            </g>
          );
        })}
        {pendingPath && <path d={pendingPath.d} stroke={pendingPath.color} strokeWidth={2.5} strokeDasharray="6 4" fill="none" />}
      </svg>

      <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        {orderedNodes.map((node) => {
          const issues = document.issuesFor(node.id);
          return (
            <NodeCard
              key={node.id}
              node={node}
              language={language}
              isSelected={selected.has(node.id)}
              isDropTarget={dropTarget?.id === node.id}
              hasErrors={issues.some((i) => i.severity === "error")}
              hasWarnings={issues.some((i) => i.severity === "warning")}
              incomingCount={incomingLinks(story, node.id).length}
              summary={nodeSummary(node, document)}
              headline={headline(node)}
              locationName={hasLocation(node.kind) ? findLocation(story, node.locationId)?.name : undefined}
              trackName={node.music.type === "play" ? findTrack(story, node.music.trackId)?.name : undefined}
              onPointerDown={(e) => onNodePointerDown(node, e)}
              onOutputPointerDown={(port, e) => onOutputPointerDown(node, port, e)}
              onInputPointerDown={(e) => onInputPointerDown(node, e)}
              menu={() => nodeMenu(node)}
            />
          );
        })}
      </div>

      <ZoomControls zoom={viewport.zoom} onZoomOut={() => zoomBy(1 / 1.25)} onZoomIn={() => zoomBy(1.25)} onFit={fitToContent} />
    </div>
  );
}

// MARK: Node card

/// How a node looks on the canvas. Every row uses `NodeMetrics` sizes so sockets land where the canvas expects.
function NodeCard(props: {
  node: StoryNode;
  language: string;
  isSelected: boolean;
  isDropTarget: boolean;
  hasErrors: boolean;
  hasWarnings: boolean;
  incomingCount: number;
  summary: string;
  headline?: string;
  locationName?: { language: string; value: string }[];
  trackName?: string;
  onPointerDown: (event: React.PointerEvent) => void;
  onOutputPointerDown: (port: string, event: React.PointerEvent) => void;
  onInputPointerDown: (event: React.PointerEvent) => void;
  menu: () => MenuEntry[];
}) {
  const { node, language, isSelected, isDropTarget, hasErrors, hasWarnings } = props;
  const type = node.kind.type;
  const color = typeColor(type);
  const borderColor = isDropTarget ? "#fff" : isSelected ? color : hasErrors ? "rgba(240, 122, 128, 0.8)" : "rgba(255,255,255,0.1)";
  const title = props.headline ?? (isBlank(kindTitle(node.kind)) ? typeName(type) : resolve(kindTitle(node.kind), language));

  return (
    <div
      className={`node-card ${isSelected ? "selected" : ""}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        height: nodeHeight(node.kind),
        borderColor,
        boxShadow: isSelected || isDropTarget ? `0 0 0 1px ${borderColor}, 0 4px 14px rgba(0,0,0,0.35)` : undefined,
      }}
      onPointerDown={props.onPointerDown}
      {...contextMenu(props.menu)}
    >
      <div className="node-header" style={{ background: withAlpha(color, 0.32) }}>
        <Icon name={typeSymbol(type)} size={15} strokeWidth={2.2} />
        <div className="column" style={{ minWidth: 0, flex: 1 }}>
          <span className="type-name">{typeName(type)}</span>
          <span className="headline">{title}</span>
        </div>
        {props.locationName && (
          <span title={resolve(props.locationName, language)} style={{ display: "inline-flex" }}>
            <Icon name="mappin.and.ellipse" size={13} />
          </span>
        )}
        {props.trackName !== undefined && (
          <span title={props.trackName} style={{ display: "inline-flex" }}>
            <Icon name="music.note" size={13} />
          </span>
        )}
        {hasErrors ? (
          <Icon name="exclamationmark.triangle.fill" size={14} style={{ color: "var(--health)" }} />
        ) : (
          hasWarnings && <Icon name="exclamationmark.triangle" size={14} style={{ color: "var(--action-point)" }} />
        )}
      </div>
      <div style={{ height: NodeMetrics.padding }} />
      {outputPorts(node.kind).map((port) => (
        <div key={port} className="node-port-row output">
          <span className="label">{portLabel(node.kind, port, language)}</span>
          <span className="socket output" style={{ background: portColor(node.kind, port) }} />
          <span
            className="socket-hit"
            style={{ right: -13, top: 0 }}
            title={t("Drag to another node to connect")}
            onPointerDown={(e) => props.onOutputPointerDown(port, e)}
          />
        </div>
      ))}
      {hasInput(node.kind) && (
        <div className="node-port-row input">
          <span className="socket input" />
          <span>{props.incomingCount > 1 ? t("In · %lld wires", props.incomingCount) : t("In")}</span>
          <span
            className="socket-hit"
            style={{ left: -13, top: 0 }}
            title={t("Drag a wire off this input to reroute or remove it")}
            onPointerDown={props.onInputPointerDown}
          />
        </div>
      )}
      <div className="node-summary">{props.summary}</div>
    </div>
  );
}

function eventSummary(event: EventNode, document: StoryDocument): string {
  const story = document.story;
  const language = document.language;
  const eventName = findEvent(story, event.eventId);
  const name = eventName ? resolve(eventName.name, language) : t("No event chosen");
  if (event.occurrence !== "perhaps") return t("%@ · always happens", name);
  const trigger = event.trigger;
  switch (trigger.mode) {
    case "chance":
      return t("%@ · %lld%% chance", name, trigger.chance);
    case "characteristics":
      return trigger.conditions.length === 0 ? t("%@ · no conditions", name) : t("%@ · if %@", name, conditionsSummary(event));
    case "priorEvent": {
      const prior = findEvent(story, trigger.priorEventId);
      return t("%@ · after “%@”", name, prior ? resolve(prior.name, language) : "?");
    }
    case "time":
      return t("%@ · %@", name, timeWindowSummary(trigger));
  }
}

/// A compact description of an event's conditions, e.g. “STR > 60 and DEX < 20”.
export function conditionsSummary(event: EventNode): string {
  const separator = event.trigger.requiresAll ? t(" and ") : t(" or ");
  return event.trigger.conditions.map((c) => `${ABBREVIATIONS[c.characteristic]} ${comparisonSymbol(c.comparison)} ${c.value}`).join(separator);
}

function nodeSummary(node: StoryNode, document: StoryDocument): string {
  const story = document.story;
  const language = document.language;
  const kind = node.kind;
  switch (kind.type) {
    case "entrance": {
      const hero = findCharacter(story, kind.heroId);
      return hero ? t("Hero: %@ · Level %lld", resolve(hero.name, language), hero.level) : t("No hero chosen");
    }
    case "narration":
    case "choice":
    case "end":
    case "chapterStart":
      return resolve(kind.body, language);
    case "check":
      return t("%@ · %@ roll", checkTargetName(kind.target), difficultyName(kind.difficulty));
    case "battle": {
      const enemy: Enemy | undefined = opponent(story, kind.enemyId);
      return enemy
        ? t("%@ · %lld HP · %lld%% · %@", resolve(enemy.name, language), enemy.hp, enemy.attack.skill, damageLabel(enemy.attack.damage))
        : t("No enemy chosen");
    }
    case "chapterJump":
      return t("Continues at that chapter’s start.");
    case "event":
      return eventSummary(kind, document);
  }
}
