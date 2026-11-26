import type { SearchResult } from "@/lib/types";

export function DebugPanel({ result }: { result: SearchResult | null }) {
  const enabled =
    process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DEBUG === "1";
  if (!enabled || !result) return null;

  return (
    <details className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-3">
      <summary className="cursor-pointer text-xs font-semibold text-neutral-700">
        Debug panel (development only)
      </summary>
      <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <h3 className="font-semibold text-neutral-800">Budget</h3>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 text-[11px] leading-relaxed text-neutral-100">
            {JSON.stringify(result.budget, null, 2)}
          </pre>
        </div>
        <div>
          <h3 className="font-semibold text-neutral-800">Sources</h3>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 text-[11px] leading-relaxed text-neutral-100">
            {JSON.stringify(result.coverage.sources, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  );
}
