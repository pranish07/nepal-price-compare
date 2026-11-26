import type { SearchResult } from "@/lib/types";

const CACHE_LABEL: Record<SearchResult["budget"]["cacheStatus"], string> = {
  hit: "cached",
  miss: "fresh",
  stale: "stale cache",
  coalesced: "shared request",
};

export function CoverageLine({ result }: { result: SearchResult }) {
  const { coverage, budget } = result;
  return (
    <section
      aria-labelledby="coverage-heading"
      className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="coverage-heading" className="text-sm font-semibold text-neutral-900">
          Coverage
        </h2>
        <p className="text-xs text-neutral-500">
          Generated{" "}
          <time dateTime={result.generatedAt}>
            {new Date(result.generatedAt).toLocaleString("en-NP", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </p>
      </div>
      <p className="mt-1 text-sm text-neutral-700">
        Checked {coverage.checked} sources · {coverage.responded} responded · {coverage.failed} failed ·{" "}
        {coverage.listings} listing(s)
      </p>
      <p className="mt-1 text-xs text-neutral-600">
        Serper credits: {budget.creditsUsed}/{budget.creditsMax} · Fetches: {budget.fetchesUsed}/
        {budget.fetchesMax} · Cache: {CACHE_LABEL[budget.cacheStatus]}
      </p>
      {result.notes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-neutral-600">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
