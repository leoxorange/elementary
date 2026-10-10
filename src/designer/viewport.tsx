// Pan and zoom for the designer's canvases. A mouse wheel zooms around the pointer; a trackpad's two-finger
// scroll pans (hold ⌘ to zoom instead), and pinching zooms.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { t } from "../i18n";
import { Icon } from "../icons";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const ZOOM_RANGE: [number, number] = [0.3, 2];

function clampZoom(zoom: number) {
  return Math.min(Math.max(zoom, ZOOM_RANGE[0]), ZOOM_RANGE[1]);
}

export function rectContains(rect: Rect, point: Point, inset = 0): boolean {
  return point.x >= rect.x - inset && point.x <= rect.x + rect.width + inset && point.y >= rect.y - inset && point.y <= rect.y + rect.height + inset;
}

export function useViewport(container: RefObject<HTMLDivElement | null>) {
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const current = useRef(viewport);
  current.current = viewport;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [container]);

  /// Zooms while keeping the canvas point under `anchor` (in view coordinates) fixed on screen.
  const setZoom = useCallback((zoom: number, anchor: Point) => {
    setViewport((from) => {
      const clamped = clampZoom(zoom);
      const scale = clamped / from.zoom;
      return { x: anchor.x - (anchor.x - from.x) * scale, y: anchor.y - (anchor.y - from.y) * scale, zoom: clamped };
    });
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const legacy = event as WheelEvent & { wheelDeltaY?: number; webkitDirectionInvertedFromDevice?: boolean };
      const isTrackpad = legacy.wheelDeltaY ? legacy.wheelDeltaY === -3 * event.deltaY : event.deltaMode === 0;
      if (event.ctrlKey) {
        // A pinch arrives as a wheel event with Control held.
        setZoom(current.current.zoom * Math.exp(-event.deltaY / 100), anchor);
      } else if (isTrackpad && !event.metaKey) {
        setViewport((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
      } else if (isTrackpad) {
        setZoom(current.current.zoom * Math.exp(-event.deltaY / 100), anchor);
      } else {
        // Undo the natural-scrolling flip so rolling the wheel forward always zooms in.
        const deviceDelta = legacy.webkitDirectionInvertedFromDevice ? -event.deltaY : event.deltaY;
        if (deviceDelta !== 0) setZoom(current.current.zoom * (deviceDelta < 0 ? 1.1 : 1 / 1.1), anchor);
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [container, setZoom]);

  const toWorld = useCallback((point: Point): Point => {
    const v = current.current;
    return { x: (point.x - v.x) / v.zoom, y: (point.y - v.y) / v.zoom };
  }, []);

  const toScreen = useCallback((point: Point): Point => {
    const v = current.current;
    return { x: point.x * v.zoom + v.x, y: point.y * v.zoom + v.y };
  }, []);

  /// A point from a pointer event, in view coordinates.
  const localPoint = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = container.current?.getBoundingClientRect();
      return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    },
    [container],
  );

  const zoomBy = useCallback(
    (factor: number) => setZoom(current.current.zoom * factor, { x: size.width / 2, y: size.height / 2 }),
    [setZoom, size],
  );

  /// Frames every rect in the view.
  const fit = useCallback(
    (frames: Rect[], margin: number) => {
      const element = container.current;
      if (frames.length === 0 || !element || element.clientWidth === 0) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const minX = Math.min(...frames.map((f) => f.x)) - margin;
      const minY = Math.min(...frames.map((f) => f.y)) - margin;
      const maxX = Math.max(...frames.map((f) => f.x + f.width)) + margin;
      const maxY = Math.max(...frames.map((f) => f.y + f.height)) + margin;
      const zoom = clampZoom(Math.min(width / (maxX - minX), height / (maxY - minY), 1.2));
      setViewport({ zoom, x: (width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (height - (maxY - minY) * zoom) / 2 - minY * zoom });
    },
    [container],
  );

  /// Drags the view along with the pointer.
  const startPan = useCallback((start: Point) => {
    const origin = current.current;
    return (point: Point) => setViewport({ ...origin, x: origin.x + point.x - start.x, y: origin.y + point.y - start.y });
  }, []);

  return { viewport, size, setZoom, toWorld, toScreen, localPoint, zoomBy, fit, startPan };
}

/// A dotted grid that moves and scales with the view.
export function gridStyle(viewport: Viewport): CSSProperties {
  const spacing = 24 * viewport.zoom;
  if (spacing <= 6) return {};
  const dot = Math.max(1.2, 1.5 * viewport.zoom) / 2;
  return {
    backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.09) ${dot}px, transparent ${dot + 0.6}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${viewport.x - spacing / 2}px ${viewport.y - spacing / 2}px`,
  };
}

/// Tracks a pointer drag on the window until release. `onMove` gets each position in client coordinates.
export function trackPointer(event: React.PointerEvent, onMove: (event: PointerEvent) => void, onEnd: (event: PointerEvent) => void) {
  const move = (e: PointerEvent) => onMove(e);
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onEnd(e);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  event.preventDefault();
}

export function ZoomControls({ zoom, onZoomOut, onZoomIn, onFit }: { zoom: number; onZoomOut: () => void; onZoomIn: () => void; onFit: () => void }) {
  return (
    <div className="canvas-overlay zoom-controls">
      <button type="button" className="btn btn-glass btn-icon" title={t("Zoom Out")} aria-label={t("Zoom Out")} onClick={onZoomOut}>
        <Icon name="minus" size={15} />
      </button>
      <span className="zoom-value">{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn btn-glass btn-icon" title={t("Zoom In")} aria-label={t("Zoom In")} onClick={onZoomIn}>
        <Icon name="plus" size={15} />
      </button>
      <button type="button" className="btn btn-glass btn-icon" title={t("Fit")} aria-label={t("Fit")} onClick={onFit}>
        <Icon name="arrow.up.left.and.down.right.magnifyingglass" size={15} />
      </button>
    </div>
  );
}

/// Distance from `point` to the segment `a`–`b`.
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
