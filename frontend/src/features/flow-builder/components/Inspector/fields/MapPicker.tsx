"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { showToast } from "@/components/ui/toast-store";
import { cn } from "@/lib/utils/cn";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  TILE_SIZE,
  clampZoom,
  project,
  samePoint,
  tileUrl,
  unproject,
  type MapPoint,
} from "../../../lib/map";

/**
 * OpenStreetMap ships light tiles; the editor is dark. Inverting the hue wheel
 * back after the invert keeps water blue and parks green instead of producing
 * the orange-and-purple negative.
 */
const DARK_TILES = "invert(1) hue-rotate(180deg) brightness(0.86) contrast(0.92) saturate(0.72)";

/** How far one arrow key nudges the map, in pixels. */
const KEY_PAN = 48;

/** Trackpads fire dozens of small wheel events per gesture — zoom once per this much scroll. */
const WHEEL_STEP = 60;

/** Street level: what "my location" is worth showing at, unless the map is already closer in. */
const LOCATE_ZOOM = 16;

interface Tile {
  key: string;
  left: number;
  top: number;
  url: string;
}

/**
 * Drag-and-zoom map whose *center* is the picked point: the pin never moves,
 * the world moves under it. One coordinate rather than two interaction models
 * (click-to-drop plus drag-to-pan) is what makes this usable at the 260px the
 * docked Inspector gives it — and it works the same under a finger.
 */
export function MapPicker({
  point,
  onChange,
  onLocate,
  height,
  actions,
  className,
}: {
  /** The picked coordinate, or `null` while the fields are still empty. */
  point: MapPoint | null;
  onChange: (point: MapPoint) => void;
  /**
   * Fired *in addition to* `onChange` when the point came from the browser's
   * own geolocation — the one case where the caller knows a name for the spot
   * is worth looking up, which panning by hand does not warrant.
   */
  onLocate?: (point: MapPoint) => void;
  height: number;
  /** Extra controls for the top-right corner, next to the zoom buttons. */
  actions?: ReactNode;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState<MapPoint>(point ?? DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [width, setWidth] = useState(0);
  const [locating, setLocating] = useState(false);
  /** Live pixel offset while a drag is in flight — folded into `center` on release. */
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  /** The live center for the pointer handlers, which run outside the render that produced it. */
  const centerRef = useRef(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  // Follow the coordinate inputs when they are edited by hand. A point the map
  // itself just published already *is* the center, so this stays a no-op then.
  useEffect(() => {
    if (point && !samePoint(point, centerRef.current)) setCenter(point);
  }, [point]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    setWidth(frame.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Wheel is bound by hand because React's own listener is passive: without
  // preventDefault the Inspector behind the map scrolls away under the cursor.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let accumulated = 0;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      accumulated += event.deltaY;
      if (Math.abs(accumulated) < WHEEL_STEP) return;
      const direction = accumulated < 0 ? 1 : -1;
      accumulated = 0;
      setZoom((current) => clampZoom(current + direction));
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  /** Move the center by a pixel delta at the current zoom and publish it. */
  function panBy(dx: number, dy: number) {
    const base = project(centerRef.current, zoom);
    const next = unproject(base.x + dx, base.y + dy, zoom);
    setCenter(next);
    onChange(next);
  }

  /**
   * Jump to where the browser says the user is. Only offered as a button:
   * asking for the location permission the moment a block is opened would be
   * a prompt nobody asked for, on a field most flows fill in from an address.
   * Needs a secure context — https, or localhost in development.
   */
  function locate() {
    if (!navigator.geolocation) {
      showToast("Brauzer joylashuvni aniqlashni qo'llab-quvvatlamaydi.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const next = { lat: position.coords.latitude, lon: position.coords.longitude };
        setCenter(next);
        setZoom((current) => Math.max(current, LOCATE_ZOOM));
        onChange(next);
        onLocate?.(next);
      },
      (error) => {
        setLocating(false);
        showToast(
          error.code === error.PERMISSION_DENIED
            ? "Joylashuvga ruxsat berilmadi."
            : "Joylashuvni aniqlab bo'lmadi.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // Pointer capture retargets the pointerup, and with it the click the
    // overlay buttons are waiting for — so a press that starts on a control is
    // never a drag.
    if (event.target instanceof Element && event.target.closest("[data-map-control]")) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({ x: event.clientX - drag.startX, y: event.clientY - drag.startY });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setOffset({ x: 0, y: 0 });
    // Dragging the world right moves the viewpoint left, hence the negation.
    if (dx || dy) panBy(-dx, -dy);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_PAN, 0],
      ArrowRight: [KEY_PAN, 0],
      ArrowUp: [0, -KEY_PAN],
      ArrowDown: [0, KEY_PAN],
    };
    const step = pan[event.key];
    if (step) {
      event.preventDefault();
      panBy(step[0], step[1]);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((current) => clampZoom(current + 1));
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setZoom((current) => clampZoom(current - 1));
    }
  }

  const tiles: Tile[] = [];
  if (width > 0) {
    const centerPx = project(center, zoom);
    const originX = centerPx.x - width / 2 - offset.x;
    const originY = centerPx.y - height / 2 - offset.y;
    const count = 2 ** zoom;
    const lastY = Math.min(count - 1, Math.floor((originY + height - 1) / TILE_SIZE));
    for (let x = Math.floor(originX / TILE_SIZE); x <= Math.floor((originX + width - 1) / TILE_SIZE); x += 1) {
      for (let y = Math.max(0, Math.floor(originY / TILE_SIZE)); y <= lastY; y += 1) {
        tiles.push({
          key: `${zoom}/${x}/${y}`,
          left: x * TILE_SIZE - originX,
          top: y * TILE_SIZE - originY,
          // Longitude wraps, so a tile column left of the world edge is the one from its right edge.
          url: tileUrl(((x % count) + count) % count, y, zoom),
        });
      }
    }
  }

  return (
    <div
      ref={frameRef}
      role="application"
      aria-label="Xarita — surib joyni tanlang"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "relative touch-none overflow-hidden rounded-md border border-neutral-800 bg-neutral-850 select-none",
        "cursor-grab outline-none focus-visible:border-accent-500 active:cursor-grabbing",
        className,
      )}
      style={{ height }}
    >
      <div className="absolute inset-0" style={{ filter: DARK_TILES }}>
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="absolute bg-neutral-800 bg-cover"
            style={{
              left: tile.left,
              top: tile.top,
              width: TILE_SIZE,
              height: TILE_SIZE,
              backgroundImage: `url("${tile.url}")`,
            }}
          />
        ))}
      </div>

      {/* The pin's tip sits exactly on the center pixel — that pixel is the coordinate. */}
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full text-accent-400",
          // Half-lit until a coordinate exists, so a fresh block does not look like it already points somewhere.
          !point && "opacity-50",
        )}
      >
        <Icon name="map-pin" size={28} weight="fill" />
      </div>
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80" />

      <div data-map-control className="absolute top-1.5 right-1.5 flex flex-col gap-1">
        <IconButton
          icon={locating ? "arrow-clockwise" : "crosshair"}
          label="Hozirgi joylashuvim"
          size={26}
          disabled={locating}
          className={cn(
            "bg-neutral-950/70 text-neutral-200 hover:bg-neutral-900",
            locating && "[&>svg]:animate-spin",
          )}
          onClick={locate}
        />
        <IconButton
          icon="plus"
          label="Kattalashtirish"
          size={26}
          className="bg-neutral-950/70 text-neutral-200 hover:bg-neutral-900"
          onClick={() => setZoom((current) => clampZoom(current + 1))}
        />
        <IconButton
          icon="minus"
          label="Kichiklashtirish"
          size={26}
          className="bg-neutral-950/70 text-neutral-200 hover:bg-neutral-900"
          onClick={() => setZoom((current) => clampZoom(current - 1))}
        />
        {actions}
      </div>

      {/* OpenStreetMap's tile policy asks for visible attribution wherever its tiles are shown. */}
      <a
        data-map-control
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute right-0 bottom-0 bg-neutral-950/70 px-1.5 py-0.5 text-[9px] max-md:text-[12px] text-neutral-400 hover:text-neutral-200"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
