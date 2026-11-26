"use client";

import { formatNPR } from "@/lib/price";
import { formatSize } from "@/lib/size";
import type { DetectResult } from "@/lib/types";

export const CITY_OPTIONS = [
  "Kathmandu",
  "Lalitpur",
  "Bhaktapur",
  "Pokhara",
  "Dharan",
  "Biratnagar",
  "Chitwan",
  "Butwal",
  "Nepalgunj",
  "Dhangadhi",
  "Other",
] as const;

interface ProductConfirmProps {
  detected: DetectResult;
  name: string;
  brand: string;
  sizeValue: string;
  sizeUnit: "g" | "ml";
  city: string;
  warnings: string[];
  busy: boolean;
  onNameChange: (value: string) => void;
  onBrandChange: (value: string) => void;
  onSizeValueChange: (value: string) => void;
  onSizeUnitChange: (value: "g" | "ml") => void;
  onCityChange: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
}

export function ProductConfirm({
  detected,
  name,
  brand,
  sizeValue,
  sizeUnit,
  city,
  warnings,
  busy,
  onNameChange,
  onBrandChange,
  onSizeValueChange,
  onSizeUnitChange,
  onCityChange,
  onSearch,
  onReset,
}: ProductConfirmProps) {
  const preview = detected.preview;
  const sizeNumber = Number.parseFloat(sizeValue);
  const sizeInvalid = sizeValue.trim() !== "" && (!Number.isFinite(sizeNumber) || sizeNumber <= 0);

  return (
    <section aria-labelledby="confirm-heading" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Step 2 · Confirm the product
          </p>
          <h2 id="confirm-heading" className="mt-1 text-xl font-semibold tracking-tight">
            Is this the exact product?
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Edit anything that looks wrong. Matching the exact name and size is what makes the
            comparison honest.
          </p>
        </div>
        {detected.sourceUrl ? (
          <a
            href={detected.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="link text-sm"
          >
            Source page
          </a>
        ) : null}
      </div>

      {preview ? (
        <div className="mt-4 flex gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          {preview.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote seller images have no fixed Next.js allowlist
            <img
              src={preview.image}
              alt=""
              className="h-20 w-20 rounded-lg border border-neutral-200 bg-white object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-500">
              no image
            </div>
          )}
          <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-neutral-500">Detected price</dt>
              <dd className="font-semibold">
                {preview.price ? formatNPR(preview.price.amount) : "not listed"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Stock</dt>
              <dd className="font-medium">
                {preview.inStock === true ? "In stock" : preview.inStock === false ? "Out of stock" : "not listed"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Size</dt>
              <dd className="font-medium">{formatSize(preview.size)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Fetched</dt>
              <dd className="font-medium">
                {new Date(preview.fetchedAt).toLocaleString("en-NP", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="product-name" className="block text-sm font-medium text-neutral-800">
            Product name
          </label>
          <input
            id="product-name"
            className="input mt-1.5"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            autoComplete="off"
            required
          />
        </div>

        <div>
          <label htmlFor="product-brand" className="block text-sm font-medium text-neutral-800">
            Brand <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <input
            id="product-brand"
            className="input mt-1.5"
            value={brand}
            onChange={(event) => onBrandChange(event.target.value)}
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="product-city" className="block text-sm font-medium text-neutral-800">
            Your city <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <select
            id="product-city"
            className="input mt-1.5"
            value={city}
            onChange={(event) => onCityChange(event.target.value)}
          >
            <option value="">No city selected</option>
            {CITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <fieldset>
            <legend className="block text-sm font-medium text-neutral-800">Size</legend>
            <div className="mt-1.5 flex gap-2">
              <div className="flex-1">
                <label htmlFor="size-value" className="sr-only">
                  Size value
                </label>
                <input
                  id="size-value"
                  className="input"
                  inputMode="decimal"
                  placeholder="e.g. 20"
                  value={sizeValue}
                  onChange={(event) => onSizeValueChange(event.target.value)}
                  aria-invalid={sizeInvalid}
                  aria-describedby={sizeInvalid ? "size-error" : "size-hint"}
                />
              </div>
              <div>
                <label htmlFor="size-unit" className="sr-only">
                  Size unit
                </label>
                <select
                  id="size-unit"
                  className="input w-24"
                  value={sizeUnit}
                  onChange={(event) => onSizeUnitChange(event.target.value === "ml" ? "ml" : "g")}
                >
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                </select>
              </div>
            </div>
            <p id="size-hint" className="mt-1.5 text-xs text-neutral-500">
              Used for price per gram or millilitre. Leave blank if the seller does not list a size.
            </p>
            {sizeInvalid ? (
              <p id="size-error" className="mt-1 text-xs font-medium text-red-700">
                Enter a positive number, or clear the size.
              </p>
            ) : null}
          </fieldset>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3" role="status">
          <p className="text-sm font-semibold text-amber-900">Before searching</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          className="btn-primary"
          onClick={onSearch}
          disabled={busy || !name.trim() || sizeInvalid}
        >
          {busy ? "Searching…" : "Search Nepali sellers"}
        </button>
        <button type="button" className="btn-secondary" onClick={onReset} disabled={busy}>
          Start over
        </button>
      </div>
    </section>
  );
}
