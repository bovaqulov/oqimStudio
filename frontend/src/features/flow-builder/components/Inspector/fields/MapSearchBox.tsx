"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import { GEOCODE_MIN_QUERY, searchPlaces, type GeocodePlace } from "../../../lib/geocode";

/** Long enough that a typed word is finished, short enough not to feel laggy — and it keeps Nominatim's rate cap honest. */
const DEBOUNCE_MS = 450;

type Status = "idle" | "loading" | "empty" | "error";

/**
 * Search-by-name for the location picker: nobody knows their office's
 * latitude, but everybody knows its address. Picking a result hands the whole
 * place — coordinate *and* name — to the caller, which is what lets the block
 * fill in a venue rather than a bare pin.
 */
export function MapSearchBox({
  onSelect,
  placeholder = "Manzil yoki joy nomi",
}: {
  onSelect: (place: GeocodePlace) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodePlace[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** Set when a result is chosen, so echoing its name back into the box does not fire a fresh search. */
  const skipRef = useRef(false);

  /** Typing decides what the box *shows*; the effect below only runs the request. */
  function retype(text: string) {
    setQuery(text);
    if (text.trim().length < GEOCODE_MIN_QUERY) {
      setResults([]);
      setStatus("idle");
      setOpen(false);
    } else {
      setStatus("loading");
      setOpen(true);
    }
  }

  useEffect(() => {
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const text = query.trim();
    if (text.length < GEOCODE_MIN_QUERY) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(text, controller.signal)
        .then((places) => {
          setResults(places);
          setStatus(places.length ? "idle" : "empty");
          setHighlight(0);
          setOpen(true);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setResults([]);
          setStatus("error");
          setOpen(true);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function choose(place: GeocodePlace) {
    skipRef.current = true;
    setQuery(place.name);
    setOpen(false);
    setResults([]);
    onSelect(place);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && open) {
      // Stops here rather than closing the dialog the picker may be sitting in.
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (!open || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (current + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const place = results[highlight];
      if (place) choose(place);
    }
  }

  const message =
    status === "loading"
      ? "Qidirilmoqda…"
      : status === "empty"
        ? "Hech narsa topilmadi."
        : status === "error"
          ? "Qidiruv ishlamadi — koordinatani qo'lda kiriting."
          : null;

  return (
    <div className="relative">
      <Icon
        name="magnifying-glass"
        size={13}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-600"
      />
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onChange={(event) => retype(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        className="pl-7.5"
      />

      {open && (message || results.length > 0) && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-[186px] overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg"
        >
          {message && <div className="px-2.5 py-1.5 text-[11px] max-md:text-[13px] text-neutral-500">{message}</div>}
          {results.map((place, index) => (
            <button
              key={place.id}
              type="button"
              role="option"
              aria-selected={index === highlight}
              // Mouse down would blur the input first and close the list before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(place)}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                "flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors",
                index === highlight ? "bg-neutral-800" : "hover:bg-neutral-850",
              )}
            >
              <Icon name="map-pin" size={13} className="mt-0.5 flex-none text-neutral-600" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] max-md:text-[15px] text-neutral-100">{place.name}</span>
                {place.label && (
                  <span className="block truncate text-[10.5px] max-md:text-[12px] text-neutral-600">{place.label}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
