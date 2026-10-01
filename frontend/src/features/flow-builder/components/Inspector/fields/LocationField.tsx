"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import type { LocationConfig } from "@/features/flows";
import { reverseGeocode, type GeocodePlace } from "../../../lib/geocode";
import { DEFAULT_CENTER, formatCoordinate, toPoint, type MapPoint } from "../../../lib/map";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { MapPicker } from "./MapPicker";
import { MapSearchBox } from "./MapSearchBox";
import { RevealPanel } from "./RevealPanel";

const EMPTY: LocationConfig = { latitude: "", longitude: "" };

/** Coordinates go to `sendLocation`; filling in a name/address promotes the block to `sendVenue`. */
export function LocationField({
  value,
  onChange,
}: {
  value?: LocationConfig;
  onChange: (value: LocationConfig) => void;
}) {
  const location = value ?? EMPTY;
  /**
   * The big map used to be a dialog. Opened from the expanded block editor it
   * put a modal on top of a modal — two Escape keys deep, with the block it was
   * editing hidden behind it — so it grew downwards inside the panel instead.
   * Nothing about picking a place needs the page taken away.
   */
  const [expanded, setExpanded] = useState(false);
  /**
   * The big map edits a copy: panning around to *look* at somewhere should not
   * overwrite the block's coordinate until "Tanlash". The small map has no such
   * step, so it writes straight through.
   */
  const [draft, setDraft] = useState<MapPoint>(DEFAULT_CENTER);
  /** The named place behind `draft`, when it came from search or geolocation rather than a pan. */
  const [draftPlace, setDraftPlace] = useState<GeocodePlace | null>(null);

  const point = useMemo(
    () => toPoint(location.latitude, location.longitude),
    [location.latitude, location.longitude],
  );

  function commit(patch: Partial<LocationConfig>) {
    onChange({ ...location, ...patch });
  }

  function commitPoint(next: MapPoint) {
    commit({ latitude: formatCoordinate(next.lat), longitude: formatCoordinate(next.lon) });
  }

  /**
   * A place carries a name and an address as well as a pin. Those two fields
   * are what turn the block into a venue, so they get filled — but never over
   * something already written by hand.
   */
  function commitPlace(place: GeocodePlace) {
    onChange({
      ...location,
      latitude: formatCoordinate(place.point.lat),
      longitude: formatCoordinate(place.point.lon),
      title: location.title?.trim() ? location.title : place.name,
      address: location.address?.trim() ? location.address : place.label,
    });
  }

  /**
   * Name the spot the browser just located. The coordinate is already
   * committed by the picker, so it is restated from `located` rather than read
   * back out of the (by now stale) closure.
   */
  function nameLocatedPoint(located: MapPoint) {
    reverseGeocode(located)
      .then((place) => {
        if (place) commitPlace({ ...place, point: located });
      })
      // A pin without a name is a perfectly good result — nothing to report.
      .catch(() => {});
  }

  function expand() {
    setDraft(point ?? DEFAULT_CENTER);
    setDraftPlace(null);
    setExpanded(true);
  }

  function applyDraft() {
    onChange({
      ...location,
      latitude: formatCoordinate(draft.lat),
      longitude: formatCoordinate(draft.lon),
      title: location.title?.trim() || !draftPlace ? location.title : draftPlace.name,
      address: location.address?.trim() || !draftPlace ? location.address : draftPlace.label,
    });
    setExpanded(false);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <FieldLabel>Xaritadan tanlash</FieldLabel>
          <span className="flex-1" />
          <span className="text-[10.5px] max-md:text-[12px] text-neutral-500">
            {point ? `${formatCoordinate(point.lat)}, ${formatCoordinate(point.lon)}` : "tanlanmagan"}
          </span>
        </div>

        {expanded ? (
          <RevealPanel>
            <div className="flex items-baseline gap-2">
              <FieldLabel className="flex-none text-neutral-400">Kattaroq xarita</FieldLabel>
              <span className="min-w-0 flex-1 truncate text-[10.5px] max-md:text-[12px] text-neutral-600">
                {draftPlace?.label || `${formatCoordinate(draft.lat)}, ${formatCoordinate(draft.lon)}`}
              </span>
            </div>
            <MapSearchBox
              onSelect={(place) => {
                setDraft(place.point);
                setDraftPlace(place);
              }}
            />
            <MapPicker
              point={draft}
              onChange={(next) => {
                setDraft(next);
                // Panned away from the named place — the name no longer describes the pin.
                setDraftPlace(null);
              }}
              onLocate={(located) => {
                reverseGeocode(located)
                  .then((place) => setDraftPlace(place))
                  .catch(() => {});
              }}
              height={320}
            />
            <FieldHint>Sichqoncha g&apos;ildiragi yoki +/− tugmalari masshtabni o&apos;zgartiradi.</FieldHint>
            <div className="flex items-center gap-2">
              <span className="flex-1" />
              <Button variant="ghost" onClick={() => setExpanded(false)}>
                Bekor qilish
              </Button>
              <Button variant="primary" onClick={applyDraft}>
                Tanlash
              </Button>
            </div>
          </RevealPanel>
        ) : (
          <>
            <MapSearchBox onSelect={commitPlace} />
            <MapPicker
              point={point}
              onChange={commitPoint}
              onLocate={nameLocatedPoint}
              height={168}
              actions={
                <IconButton
                  icon="corners-out"
                  label="Kattaroq xaritada ochish"
                  size={26}
                  className="bg-neutral-950/70 text-neutral-200 hover:bg-neutral-900"
                  onClick={expand}
                />
              }
            />
            <FieldHint>
              Joyni qidiring, xaritani suring yoki <span className="text-neutral-300">nishon</span> tugmasi bilan
              hozirgi joylashuvni oling — koordinata quyidagi maydonlarga yoziladi.
            </FieldHint>
          </>
        )}
      </div>

      <div className="flex gap-1.5">
        <label className="flex flex-1 flex-col gap-1">
          <FieldLabel>Kenglik</FieldLabel>
          <Input
            value={location.latitude}
            onChange={(event) => commit({ latitude: event.target.value })}
            placeholder="41.311081"
            inputMode="decimal"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <FieldLabel>Uzunlik</FieldLabel>
          <Input
            value={location.longitude}
            onChange={(event) => commit({ longitude: event.target.value })}
            placeholder="69.240562"
            inputMode="decimal"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <FieldLabel>Joy nomi (ixtiyoriy)</FieldLabel>
        <Input
          value={location.title ?? ""}
          onChange={(event) => commit({ title: event.target.value })}
          placeholder="Ofis"
        />
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>Manzil (ixtiyoriy)</FieldLabel>
        <Input
          value={location.address ?? ""}
          onChange={(event) => commit({ address: event.target.value })}
          placeholder="Toshkent, Amir Temur ko'chasi 1"
        />
      </label>
      <FieldHint>
        Joy nomi va manzil to&apos;ldirilsa, blok <span className="text-neutral-300">sendVenue</span> orqali yuboriladi.
      </FieldHint>
    </div>
  );
}
