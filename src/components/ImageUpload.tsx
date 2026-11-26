"use client";

import { useEffect, useRef, useState } from "react";
import { prepareImageForUpload } from "@/lib/vision/client";
import { DetectImageResultSchema, type DetectImageResult } from "@/lib/types";

interface ImageUploadProps {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDetected: (result: DetectImageResult) => Promise<void> | void;
  /** Moves focus to the ordinary name input when Gemini is unavailable. */
  onManualEntry: () => void;
}

const PRIVACY_NOTICE =
  "Photos are sent to Google's free Gemini API; free-tier data may be used to improve Google products. Don't upload private photos.";

export function ImageUpload({ disabled, onBusyChange, onDetected, onManualEntry }: ImageUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const inactive = disabled || busy;

  async function handleFile(candidate: File | undefined) {
    if (!candidate || inactive) return;

    if (!candidate.type.startsWith("image/")) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }

    setError(null);
    setFile(candidate);
    setPreviewUrl(URL.createObjectURL(candidate));
    setBusy(true);
    onBusyChange(true);

    try {
      const blob = await prepareImageForUpload(candidate);
      const form = new FormData();
      form.append("image", blob, "product.jpg");

      const response = await fetch("/api/detect-image", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "The photo could not be identified. Type the product name instead.";
        throw new Error(message);
      }

      const parsed = DetectImageResultSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("The photo could not be identified. Type the product name instead.");
      }
      if (mounted.current) await onDetected(parsed.data);
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The photo could not be identified. Type the product name instead.",
      );
    } finally {
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  function clearImage() {
    if (busy) return;
    setFile(null);
    setPreviewUrl(null);
    setError(null);
  }

  return (
    <section className="card mt-3 p-4 sm:p-5" aria-labelledby="image-upload-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="image-upload-heading" className="text-sm font-semibold text-neutral-900">
            Or upload a product photo
          </h2>
          <div id="image-hint" className="mt-1 space-y-1">
            <p className="text-xs text-neutral-600">{PRIVACY_NOTICE}</p>
            <p className="text-xs text-neutral-500">
              Identifies shoes, clothing, electronics, household items, and beauty products when the
              brand or model text is readable.
            </p>
          </div>
        </div>
        {file && !busy ? (
          <button
            type="button"
            className="text-xs font-semibold text-neutral-600 underline"
            onClick={clearImage}
          >
            Remove image
          </button>
        ) : null}
      </div>

      <label
        htmlFor="product-image"
        aria-describedby={error ? "image-error image-hint" : "image-hint"}
        onDragOver={(event) => {
          event.preventDefault();
          if (!inactive) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (!inactive) void handleFile(event.dataTransfer.files[0]);
        }}
        className={`mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 transition focus-within:ring-2 focus-within:ring-emerald-700 focus-within:ring-offset-2 ${
          dragActive
            ? "border-emerald-700 bg-emerald-50"
            : "border-neutral-300 bg-neutral-50 hover:border-emerald-700"
        } ${inactive ? "opacity-70" : ""}`}
      >
        <input
          id="product-image"
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={inactive}
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-lg text-emerald-800 shadow-sm"
        >
          ▧
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-neutral-800">
            {busy ? "Identifying product…" : "Choose an image or drop it here"}
          </span>
          <span className="block text-xs text-neutral-500">
            JPG, PNG, or WebP · max 3 MB · bright light, straight-on, text fills frame
          </span>
        </span>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL has no fixed Next.js allowlist
          <img
            src={previewUrl}
            alt="Selected product photo"
            className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 bg-white object-contain"
          />
        ) : null}
      </label>

      {busy ? (
        <p className="mt-3 text-xs text-neutral-600" role="status" aria-live="polite">
          Resizing the photo and asking Gemini to identify the product…
        </p>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <p id="image-error" role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
          <button type="button" className="btn-secondary mt-2" onClick={onManualEntry}>
            Type product name instead
          </button>
        </div>
      ) : null}
    </section>
  );
}
