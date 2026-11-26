import type { SourceReport } from "@/lib/types";

const STATUS_STYLE: Record<
  SourceReport["status"],
  { label: string; className: string; dot: string }
> = {
  ok: { label: "OK", className: "bg-emerald-100 text-emerald-900", dot: "bg-emerald-600" },
  error: { label: "Error", className: "bg-red-100 text-red-900", dot: "bg-red-600" },
  timeout: { label: "Timed out", className: "bg-amber-100 text-amber-900", dot: "bg-amber-600" },
  skipped: { label: "Skipped", className: "bg-neutral-200 text-neutral-700", dot: "bg-neutral-500" },
  circuit_open: {
    label: "Temporarily skipped",
    className: "bg-amber-100 text-amber-900",
    dot: "bg-amber-600",
  },
};

interface SourceStatusProps {
  sources: SourceReport[];
  searching: boolean;
}

export function SourceStatus({ sources, searching }: SourceStatusProps) {
  if (!searching && sources.length === 0) return null;

  return (
    <section aria-labelledby="sources-heading" className="card mt-4 p-4" aria-live="polite">
      <h2 id="sources-heading" className="text-sm font-semibold text-neutral-900">
        Sources
      </h2>
      {sources.length === 0 ? (
        <ul className="mt-3 space-y-2" aria-label="Sources still loading">
          {[0, 1, 2].map((index) => (
            <li key={index} className="flex items-center gap-3">
              <span className="skeleton h-2.5 w-2.5 rounded-full" aria-hidden="true" />
              <span className="skeleton h-4 w-40" aria-hidden="true" />
              <span className="skeleton ml-auto h-4 w-16" aria-hidden="true" />
            </li>
          ))}
          <li className="text-xs text-neutral-500">Contacting stores…</li>
        </ul>
      ) : (
        <ul className="mt-3 space-y-2">
          {sources.map((source) => {
            const style = STATUS_STYLE[source.status];
            return (
              <li key={`${source.kind}:${source.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
                <span className="font-medium text-neutral-900">{source.label}</span>
                <span className="text-xs text-neutral-500">
                  {source.kind === "adapter" ? "store adapter" : "discovery"}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.className}`}>
                  {style.label}
                </span>
                <span className="text-xs text-neutral-500">
                  {source.listingCount} listing(s) · {Math.round(source.durationMs)} ms
                </span>
                {source.message ? (
                  <span className="w-full text-xs text-neutral-600 sm:w-auto">{source.message}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
