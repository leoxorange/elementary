// The location map, shown in place of the node canvas while the Locations tab is open. Places are joined by two-way
// roads; node location pickers suggest places one road away from where the hero arrives from.

import { useEffect, useRef, useState } from "react";
import { contextMenu, EmptyState, isCommand, isTyping, useKeyboard, type MenuEntry } from "../components/ui";
import { t } from "../i18n";
import { Icon } from "../icons";
import { findLocation, neighbors, routeConnects, routeEquals, routeOther } from "../model/story";
import { isBlank, resolve } from "../model/storyText";
import type { LocationRoute, StoryLocation } from "../model/types";
import { useDocument, type StoryDocument } from "./document";
import { distanceToSegment, gridStyle, rectContains, trackPointer, useViewport, ZoomControls, type Point, type Rect } from "./viewport";

/// Fixed sizes for places on the map, so roads and drop targets can be computed instead of measured.
const LocationMetrics = { width: 200, height: 60 };

function locationFrame(location: StoryLocation): Rect {
  return { x: location.position.x, y: location.position.y, width: LocationMetrics.width, height: LocationMetrics.height };
}

function center(location: StoryLocation): Point {
  return { x: location.position.x + LocationMetrics.width / 2, y: location.position.y + LocationMetrics.height / 2 };
}

interface PendingRoad {
  from: string;
  /// The pointer, in view coordinates.
  location: Point;
}

export function LocationCanvas({ document }: { document: StoryDocument }) {
  useDocument(document);
  const container = useRef<HTMLDivElement>(null);
  const { viewport, toWorld, toScreen, localPoint, zoomBy, fit, startPan } = useViewport(container);
  const [pendingRoad, setPendingRoad] = useState<PendingRoad | null>(null);
  const story = document.story;
  const language = document.language;
  const locations = story.locations;

  const fitToContent = () => fit(document.story.locations.map(locationFrame), 80);
  const isEmpty = locations.length === 0;
  useEffect(() => {
    const frame = requestAnimationFrame(fitToContent);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmpty]);

  const roadPoints = (route: LocationRoute): [Point, Point] | undefined => {
    const a = findLocation(story, route.first);
    const b = findLocation(story, route.second);
    return a && b ? [toScreen(center(a)), toScreen(center(b))] : undefined;
  };

  const routeNear = (point: Point) =>
    story.routes.find((route) => {
      const points = roadPoints(route);
      return points ? distanceToSegment(point, ...points) <= 6 : false;
    });

  /// The place a dragged road would connect to if released now.
  const hoveredTarget = (road: PendingRoad) => {
    const point = toWorld(road.location);
    return [...locations].reverse().find((l) => l.id !== road.from && rectContains(locationFrame(l), point, 12));
  };
  const dropTarget = pendingRoad ? hoveredTarget(pendingRoad) : undefined;

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
          const route = routeNear(start);
          document.selection = route ? { type: "route", route } : null;
        }
      },
    );
  };

  const onCardPointerDown = (location: StoryLocation, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    container.current?.focus();
    const start = localPoint(event);
    let origin: Point | null = null;
    trackPointer(
      event,
      (e) => {
        const point = localPoint(e);
        if (!origin) {
          if (Math.hypot(point.x - start.x, point.y - start.y) < 3) return;
          origin = location.position;
          document.selection = { type: "location", id: location.id };
          document.beginMove();
        }
        // Snap to the grid, as on the node canvas.
        const zoom = viewport.zoom;
        document.moveLocation(location.id, {
          x: Math.round((origin.x + (point.x - start.x) / zoom) / 12) * 12,
          y: Math.round((origin.y + (point.y - start.y) / zoom) / 12) * 12,
        });
      },
      () => {
        if (!origin) document.selection = { type: "location", id: location.id };
      },
    );
  };

  const onHandlePointerDown = (location: StoryLocation, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    let road: PendingRoad = { from: location.id, location: localPoint(event) };
    setPendingRoad(road);
    trackPointer(
      event,
      (e) => {
        road = { ...road, location: localPoint(e) };
        setPendingRoad(road);
      },
      () => {
        setPendingRoad(null);
        const target = hoveredTarget(road);
        if (target) document.connectLocations(road.from, target.id);
      },
    );
  };

  useKeyboard((event) => {
    if (isTyping(event)) return;
    const command = isCommand(event);
    if ((event.key === "Delete" || event.key === "Backspace") && !command && document.selection) {
      document.deleteSelection();
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

  const cardMenu = (location: StoryLocation): MenuEntry[] => {
    const roads = story.routes.filter((r) => routeConnects(r, location.id));
    const entries: MenuEntry[] = [];
    if (roads.length > 0) {
      entries.push({ header: t("Remove Road To") });
      for (const route of roads) {
        const other = findLocation(story, routeOther(route, location.id));
        if (other) entries.push({ label: resolve(other.name, language), action: () => document.disconnectRoute(route) });
      }
      entries.push({ separator: true });
    }
    entries.push(
      { label: t("Duplicate"), icon: "plus.square.on.square", action: () => document.duplicateLocation(location.id) },
      { separator: true },
      { label: t("Delete"), icon: "trash", destructive: true, action: () => document.deleteLocation(location.id) },
    );
    return entries;
  };

  let pendingPath: [Point, Point] | null = null;
  if (pendingRoad) {
    const from = findLocation(story, pendingRoad.from);
    if (from) pendingPath = [toScreen(center(from)), dropTarget ? toScreen(center(dropTarget)) : pendingRoad.location];
  }

  return (
    <div ref={container} className="canvas" tabIndex={0} style={gridStyle(viewport)} onPointerDown={onBackgroundPointerDown}>
      <svg className="canvas-wires">
        {story.routes.map((route) => {
          const points = roadPoints(route);
          if (!points) return null;
          const isSelected = document.selection?.type === "route" && routeEquals(document.selection.route, route);
          const [a, b] = points;
          return (
            <g key={`${route.first}:${route.second}`}>
              {isSelected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.9)" strokeWidth={7} strokeLinecap="round" />}
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeOpacity={isSelected ? 1 : 0.7} strokeWidth={3.5} strokeLinecap="round" />
            </g>
          );
        })}
        {pendingPath && (
          <line
            x1={pendingPath[0].x}
            y1={pendingPath[0].y}
            x2={pendingPath[1].x}
            y2={pendingPath[1].y}
            stroke="var(--accent)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="7 5"
          />
        )}
      </svg>

      <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        {locations.map((location) => {
          const isSelected = document.selectedId("location") === location.id;
          const isTarget = dropTarget?.id === location.id;
          const uses = document.nodesAt(location.id).length;
          const border = isTarget ? "#fff" : isSelected ? "var(--accent)" : "rgba(255,255,255,0.1)";
          return (
            <div
              key={location.id}
              className="location-card"
              style={{
                left: location.position.x,
                top: location.position.y,
                borderColor: border,
                boxShadow: isSelected || isTarget ? `0 0 0 1px ${border}, 0 4px 14px rgba(0,0,0,0.35)` : undefined,
              }}
              onPointerDown={(e) => onCardPointerDown(location, e)}
              {...contextMenu(() => cardMenu(location))}
            >
              <span className="loc-icon">
                <Icon name={location.symbol} size={16} strokeWidth={2.2} />
              </span>
              <span className="column" style={{ gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {isBlank(location.name) ? t("Unnamed") : resolve(location.name, language)}
                </span>
                <span className="caption secondary" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {isBlank(location.region)
                    ? t("%lld nodes · %lld roads", uses, neighbors(story, location.id).size)
                    : t("%@ · %lld nodes", resolve(location.region, language), uses)}
                </span>
              </span>
              <span
                className="handle"
                style={{ cursor: "crosshair" }}
                title={t("Drag to another place to build a road")}
                onPointerDown={(e) => onHandlePointerDown(location, e)}
              />
            </div>
          );
        })}
      </div>

      <div className="canvas-overlay glass canvas-hint">{t("Drag from a place’s handle to another place to build a road. Roads go both ways.")}</div>
      <ZoomControls zoom={viewport.zoom} onZoomOut={() => zoomBy(1 / 1.25)} onZoomIn={() => zoomBy(1.25)} onFit={fitToContent} />
      {isEmpty && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto" }} onPointerDown={(e) => e.stopPropagation()}>
            <EmptyState
              symbol="map"
              title={t("No Locations Yet")}
              actions={
                <button type="button" className="btn btn-glass" style={{ marginTop: 8 }} onClick={() => document.addLocation()}>
                  <Icon name="plus" size={14} />
                  {t("New Location")}
                </button>
              }
            >
              {t("Add places, then connect them with roads. When you pick a node’s location, places one road away from where the hero is are suggested first.")}
            </EmptyState>
          </div>
        </div>
      )}
    </div>
  );
}
