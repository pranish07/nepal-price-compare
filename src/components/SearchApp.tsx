"use client";

import { useMemo, useRef, useState } from "react";
import { CoverageLine } from "@/components/CoverageLine";
import { DebugPanel } from "@/components/DebugPanel";
import { ListingTable } from "@/components/ListingTable";
import { CITY_OPTIONS, ProductConfirm } from "@/components/ProductConfirm";
import { SourceStatus } from "@/components/SourceStatus";
import { TopPicks } from "@/components/TopPicks";
import { formatSize } from "@/lib/size";
import type { SortKey, SortState } from "@/lib/sort";
import type {
  DetectResult,
  Listing,
  PipelineEvent,
  ProductQuery,
  SearchResult,
  SourceReport,
} from "@/lib/types";

type Phase = "idle" | "detecting" | "confirm" | "searching" | "done" | "error";

function parseFrame(frame: string): PipelineEvent | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as PipelineEvent;
  } catch {
    return null;
  }
}

function upsertListing(previous: Listing[], listing: Listing): Listing[] {
  const index = previous.findIndex((item) => item.id === listing.id);
  if (index === -1) return [...previous, listing];
  const next = [...previous];
  next[index] = listing;
  return next;
}

export function SearchApp() {
  const [input, setInput] = useState("");
  const [city, setCity] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [detected, setDetected] = useState<DetectResult | null>(null);
  const [editName, setEditName] = useState("");
  const [editBrand, setEditBrand] = useState("");
  const [editSizeValue, setEditSizeValue] = useState("");
  const [editSizeUnit, setEditSizeUnit] = useState<"g" | "ml">("g");
  const [editCity, setEditCity] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [sources, setSources] = useState<SourceReport[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "rank", dir: "desc" });
  const [otherUrl, setOtherUrl] = useState("");
  const [otherBusy, setOtherBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase === "detecting" || phase === "searching" || otherBusy;

  const confirmWarnings = useMemo(() => {
    if (!detected) return [];
    const warnings = [...detected.warnings];
    if (!editSizeValue.trim()) {
      const message = "No size is set. Add it for an exact-size comparison and price per unit.";
      if (!warnings.some((warning) => warning.toLowerCase().includes("size"))) {
        warnings.push(message);
      }
    }
    return warnings;
  }, [detected, editSizeValue]);

  function applyDetected(data: DetectResult) {
    setDetected(data);
    setEditName(data.query.name);
    setEditBrand(data.query.brand ?? "");
    setEditSizeValue(data.query.size ? String(data.query.size.value) : "");
    setEditSizeUnit(data.query.size?.unit ?? "g");
    setEditCity(data.query.city ?? city);
    setPhase("confirm");
    setError(null);
    setStatusMessage("");
    setResult(null);
    setListings([]);
    setSources([]);
    requestAnimationFrame(() => {
      confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function runDetect(value: string, isMain: boolean) {
    const trimmed = value.trim();
    if (!trimmed) return;

    setError(null);
    if (isMain) {
      setPhase("detecting");
      setDetected(null);
      setResult(null);
      setListings([]);
      setSources([]);
      setStatusMessage("Reading the product page…");
    } else {
      setOtherBusy(true);
    }

    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed }),
      });
      const data = (await response.json().catch(() => null)) as
        | (DetectResult & { error?: string })
        | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "That product could not be read.");
      }
      if (!data) throw new Error("That product could not be read.");
      setInput(trimmed);
      applyDetected(data);
      if (!isMain) setOtherUrl("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "That product could not be read.";
      setError(message);
      if (isMain) setPhase("error");
    } finally {
      if (!isMain) setOtherBusy(false);
    }
  }

  function handleMainSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runDetect(input, true);
  }

  function handleOtherSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runDetect(otherUrl, false);
  }

  async function handleSearch() {
    const name = editName.trim();
    if (!name) {
      setError("Enter a product name before searching.");
      return;
    }
    const sizeNumber = Number.parseFloat(editSizeValue);
    if (editSizeValue.trim() !== "" && (!Number.isFinite(sizeNumber) || sizeNumber <= 0)) {
      setError("Enter a positive size, or clear the size field.");
      return;
    }

    const query: ProductQuery = {
      name,
      ...(editBrand.trim() ? { brand: editBrand.trim() } : {}),
      ...(editSizeValue.trim() !== ""
        ? { size: { value: sizeNumber, unit: editSizeUnit } }
        : {}),
      ...(editCity ? { city: editCity } : {}),
    };

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("searching");
    setError(null);
    setResult(null);
    setListings([]);
    setSources([]);
    setStatusMessage("Starting search…");

    let sawDone = false;
    let sawError = false;

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "The search could not be started.");
      }
      if (!response.body) {
        throw new Error("This browser does not support streaming responses.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (event: PipelineEvent) => {
        switch (event.type) {
          case "status":
            setStatusMessage(event.message);
            break;
          case "source":
            setSources((previous) => {
              const next = previous.filter(
                (source) => !(source.id === event.source.id && source.kind === event.source.kind),
              );
              return [...next, event.source];
            });
            break;
          case "listing":
            setListings((previous) => upsertListing(previous, event.listing));
            break;
          case "done":
            sawDone = true;
            setResult(event.result);
            setListings(event.result.listings);
            setSources(event.result.coverage.sources);
            setStatusMessage("");
            setPhase("done");
            break;
          case "error":
            sawError = true;
            setError(event.message);
            setStatusMessage("");
            setPhase("error");
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = parseFrame(frame);
          if (event) handleEvent(event);
          boundary = buffer.indexOf("\n\n");
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const event = parseFrame(buffer);
        if (event) handleEvent(event);
      }

      if (!sawDone && !sawError) {
        setError("The search ended before results arrived. Please try again.");
        setPhase("error");
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        setPhase("confirm");
        setStatusMessage("Search cancelled.");
        return;
      }
      const message = caught instanceof Error ? caught.message : "The search failed.";
      setError(message);
      setPhase("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleReset() {
    abortRef.current?.abort();
    setInput("");
    setCity("");
    setPhase("idle");
    setDetected(null);
    setEditName("");
    setEditBrand("");
    setEditSizeValue("");
    setEditSizeUnit("g");
    setEditCity("");
    setListings([]);
    setSources([]);
    setResult(null);
    setError(null);
    setStatusMessage("");
    setOtherUrl("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSort(key: SortKey) {
    setSort((previous) => {
      if (previous.key === key) {
        return { key, dir: previous.dir === "asc" ? "desc" : "asc" };
      }
      const ascending = key === "price" || key === "perUnit" || key === "seller";
      return { key, dir: ascending ? "asc" : "desc" };
    });
  }

  const cheapestId = result?.badges.find((badge) => badge.kind === "cheapest")?.listingId;
  const showConfirm = detected !== null && (phase === "confirm" || phase === "searching");
  const showResults = phase === "done" && result !== null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white"
            >
              NP
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight text-neutral-950">Nepal Price Compare</p>
              <p className="text-[11px] text-neutral-500">Skincare · Nepal · NPR</p>
            </div>
          </div>
          <a href="#how" className="text-sm font-medium text-neutral-700 hover:text-emerald-900">
            How it works
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:pt-12">
        <section aria-labelledby="hero-heading">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
            Skincare price comparison
          </p>
          <h1
            id="hero-heading"
            className="mt-2 max-w-3xl text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl"
          >
            Know the price before you buy.
          </h1>
          <p className="mt-3 max-w-2xl text-base text-neutral-700">
            Paste a product link or type a product name. We compare the exact product across Nepali
            sellers, with NPR prices, stock, delivery, and price per gram or millilitre.
          </p>

          <form onSubmit={handleMainSubmit} className="card mt-6 p-4 sm:p-5">
            <label htmlFor="product-input" className="block text-sm font-medium text-neutral-800">
              Product link or product name
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                ref={inputRef}
                id="product-input"
                className="input flex-1"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="https://bonjournp.com/product/… or Dr. Althea Melaclear Cream 20g"
                autoComplete="off"
                enterKeyHint="search"
                required
              />
              <button type="submit" className="btn-primary sm:w-auto" disabled={busy}>
                {phase === "detecting" ? "Reading…" : "Find product"}
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <label htmlFor="city" className="block text-sm font-medium text-neutral-800">
                  Your city <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <select
                  id="city"
                  className="input mt-1.5"
                  value={city}
                  onChange={(event) => {
                    setCity(event.target.value);
                    setEditCity(event.target.value);
                  }}
                >
                  <option value="">No city selected</option>
                  {CITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-neutral-500 sm:max-w-[220px] sm:pb-2">
                City only affects delivery ranking. Prices are not location-specific.
              </p>
            </div>
          </form>

          <p className="mt-3 text-xs text-neutral-500">
            We read public product pages and identify ourselves to each store. Results are a partial
            survey, not a complete market comparison. V1 covers skincare only.
          </p>
        </section>

        {error ? (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            <p className="font-semibold">That did not work</p>
            <p className="mt-1">{error}</p>
            {phase === "error" ? (
              <button
                type="button"
                className="btn-secondary mt-3"
                onClick={() => {
                  setError(null);
                  setPhase(detected ? "confirm" : "idle");
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === "detecting" ? <DetectSkeleton /> : null}

        {showConfirm && detected ? (
          <div ref={confirmRef} className="mt-6 scroll-mt-6">
            <ProductConfirm
              detected={detected}
              name={editName}
              brand={editBrand}
              sizeValue={editSizeValue}
              sizeUnit={editSizeUnit}
              city={editCity}
              warnings={confirmWarnings}
              busy={phase === "searching"}
              onNameChange={setEditName}
              onBrandChange={setEditBrand}
              onSizeValueChange={setEditSizeValue}
              onSizeUnitChange={setEditSizeUnit}
              onCityChange={setEditCity}
              onSearch={() => void handleSearch()}
              onReset={handleReset}
            />
            {phase === "searching" ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700" role="status">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent"
                />
                <span>{statusMessage || "Searching stores…"}</span>
                <button type="button" className="ml-auto text-xs font-semibold text-neutral-600 underline" onClick={handleCancel}>
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {showResults && result ? (
          <ResultSummary
            result={result}
            city={editCity}
            onCityChange={setEditCity}
            onUpdate={() => void handleSearch()}
            onEdit={() => setPhase("confirm")}
          />
        ) : null}

        <SourceStatus sources={sources} searching={phase === "searching"} />

        {phase === "searching" && listings.length > 0 ? (
          <>
            <p className="mt-6 text-sm text-neutral-700" role="status">
              {listings.length} listing(s) have arrived. Ranking and badges appear when all sources
              finish.
            </p>
            <ListingTable
              listings={listings}
              sort={sort}
              onSort={handleSort}
              title="Live results"
              description="Streaming as stores respond. Verify every price on the seller site."
            />
          </>
        ) : null}

        {showResults && result ? (
          <>
            <TopPicks badges={result.badges} listings={result.listings} city={result.query.city} />
            <CoverageLine result={result} />
            {result.listings.length > 0 ? (
              <ListingTable
                listings={result.listings}
                sort={sort}
                onSort={handleSort}
                highlightId={cheapestId}
              />
            ) : (
              <EmptyState />
            )}
            <DebugPanel result={result} />
          </>
        ) : null}

        <section className="card mt-8 p-4 sm:p-5" aria-labelledby="other-link-heading">
          <h2 id="other-link-heading" className="text-sm font-semibold text-neutral-900">
            Paste another store&apos;s link
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            Already looking at a product on another Nepali store? Read it here, then confirm the
            product before comparing. This does not spend Serper credits.
          </p>
          <form onSubmit={handleOtherSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="other-url" className="sr-only">
              Another store product URL
            </label>
            <input
              id="other-url"
              className="input flex-1"
              value={otherUrl}
              onChange={(event) => setOtherUrl(event.target.value)}
              placeholder="https://store.com/product/…"
              autoComplete="off"
              inputMode="url"
              required
            />
            <button type="submit" className="btn-secondary" disabled={otherBusy}>
              {otherBusy ? "Reading…" : "Read link"}
            </button>
          </form>
        </section>

        <section id="how" className="mt-10 scroll-mt-6" aria-labelledby="how-heading">
          <h2 id="how-heading" className="text-xl font-semibold tracking-tight">
            How it works
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">1 · Detect</p>
              <p className="mt-1 text-sm text-neutral-700">
                We read the product page&apos;s structured data, then show the detected name, brand,
                and size for you to edit.
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">2 · Compare</p>
              <p className="mt-1 text-sm text-neutral-700">
                Store adapters and a budgeted Serper discovery check run in parallel. Each source
                streams in as it responds.
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">3 · Verify</p>
              <p className="mt-1 text-sm text-neutral-700">
                Every price links to its seller and shows a fetch time. Missing data stays “not
                listed”. Always confirm on the seller site.
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            No accounts, no price history, no medical claims. We do not scrape behind logins, and we
            do not present the result set as complete.
          </p>
        </section>
      </div>

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Nepal Price Compare · skincare v1 · NPR only</p>
          <p>Not affiliated with any seller. Prices change; verify on the seller page.</p>
        </div>
      </footer>
    </div>
  );
}

function DetectSkeleton() {
  return (
    <div className="card mt-6 p-5" aria-hidden="true">
      <div className="skeleton h-4 w-40" />
      <div className="mt-3 flex gap-4">
        <div className="skeleton h-20 w-20" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="skeleton h-10 w-full" />
        <div className="skeleton h-10 w-full" />
      </div>
    </div>
  );
}

function ResultSummary({
  result,
  city,
  onCityChange,
  onUpdate,
  onEdit,
}: {
  result: SearchResult;
  city: string;
  onCityChange: (value: string) => void;
  onUpdate: () => void;
  onEdit: () => void;
}) {
  return (
    <section className="card mt-6 p-4 sm:p-5" aria-labelledby="result-summary-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Comparing</p>
          <h2 id="result-summary-heading" className="mt-1 text-lg font-semibold tracking-tight">
            {result.query.brand ? `${result.query.brand} ` : ""}
            {result.query.name}
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            {result.query.size ? formatSize(result.query.size) : "size not set"} ·{" "}
            {result.query.city ? result.query.city : "no city selected"} · {result.listings.length}{" "}
            listing(s)
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="result-city" className="block text-xs font-medium text-neutral-700">
              City
            </label>
            <select
              id="result-city"
              className="input mt-1 min-h-10 w-40 py-2 text-sm"
              value={city}
              onChange={(event) => onCityChange(event.target.value)}
            >
              <option value="">No city</option>
              {CITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-secondary" onClick={onUpdate}>
            Update ranking
          </button>
          <button type="button" className="btn-secondary" onClick={onEdit}>
            Edit search
          </button>
        </div>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="card mt-8 p-5" aria-labelledby="empty-heading">
      <h2 id="empty-heading" className="text-lg font-semibold tracking-tight">
        No exact matches found
      </h2>
      <p className="mt-1 text-sm text-neutral-700">
        We do not pad results with similar products. Try one of these:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">
        <li>Check the size. A 50 ml listing is not the same as a 20 g listing.</li>
        <li>Paste the product page from a store you already trust.</li>
        <li>Remove the brand or shorten the product name if the store writes it differently.</li>
      </ul>
    </section>
  );
}
