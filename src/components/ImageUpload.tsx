"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACCEPTED_IMAGE_TYPES,
  cleanOcrText,
  isConfidentOcr,
  recognizeImage,
  validateImageFile,
  type OcrProgress,
} from "@/lib/ocr";

interface ImageUploadProps {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  /** Receives flattened OCR text; the parent sends it through /api/detect. */
  onRecognized: (text: string) => Promise<void> | void;
  /** Moves focus to the ordinary name/link input when OCR is unclear. */
  onManualEntry: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  "loading tesseract core": "Loading OCR engine",
  "initializing tesseract": "Preparing OCR",
  "loading language traineddata": "Loading language data",
  "recognizing text": "Recognizing product label",
  "trying label layouts": "Trying label layouts",
};

function progressLabel(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? (status || "Reading image");
}

export function ImageUpload({ disabled, onBusyChange, onRecognized, onManualEntry }: ImageUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editableOcr, setEditableOcr] = useState<string | null>(null);
  const [editedOcr, setEditedOcr] = useState("");
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

    const validation = validateImageFile(candidate);
    if (validation) {
      setFile(null);
      setPreviewUrl(null);
      setProgress(null);
      setError(validation);
      setEditableOcr(null);
      setEditedOcr("");
      return;
    }

    setError(null);
    setEditableOcr(null);
    setEditedOcr("");
    setFile(candidate);
    setPreviewUrl(URL.createObjectURL(candidate));
    setProgress({ status: "Preparing image", progress: 0 });
    setBusy(true);
    onBusyChange(true);

    try {
      const result = await recognizeImage(candidate, (update) => {
        if (mounted.current) setProgress(update);
      });
      const text = cleanOcrText(result.text);
      if (!text) {
        throw new Error(
          "No text was found in that image. Try a clearer photo or type the product name instead.",
        );
      }
      if (!mounted.current) return;
      setProgress({ status: "Recognizing product label", progress: 100 });

      if (isConfidentOcr(result.text, result.confidence)) {
        await onRecognized(text);
      } else {
        // Not a rejection: the exact OCR text stays visible and editable.
        setProgress(null);
        setEditableOcr(text);
        setEditedOcr(text);
      }
    } catch (caught) {
      if (!mounted.current) return;
      const message = caught instanceof Error ? caught.message : "That image could not be read.";
      setError(message);
      setProgress(null);
    } finally {
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  async function submitEditedOcr() {
    const value = editedOcr.trim();
    if (!value) {
      setError("Enter the product name or corrected OCR text.");
      return;
    }

    setError(null);
    setEditableOcr(null);
    setBusy(true);
    onBusyChange(true);
    try {
      await onRecognized(value);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : "That text could not be detected.");
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
    setProgress(null);
    setError(null);
    setEditableOcr(null);
    setEditedOcr("");
  }

  return (
    <section className="card mt-3 p-4 sm:p-5" aria-labelledby="image-upload-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="image-upload-heading" className="text-sm font-semibold text-neutral-900">
            Or upload a product photo
          </h2>
          <p id="image-hint" className="mt-1 text-xs text-neutral-600">
            OCR runs in your browser with Tesseract.js. The photo is not uploaded. If the text looks
            uncertain, you can edit it before searching.
          </p>
        </div>
        {file && !busy ? (
          <button type="button" className="text-xs font-semibold text-neutral-600 underline" onClick={clearImage}>
            Remove image
          </button>
        ) : null}
      </div>

      <label
        htmlFor="product-image"
        aria-describedby={
          error
            ? "image-error image-hint"
            : editableOcr !== null
              ? "image-ocr-notice image-hint"
              : "image-hint"
        }
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
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
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
            {busy ? "Reading image…" : "Choose an image or drop it here"}
          </span>
          <span className="block text-xs text-neutral-500">
            JPG, PNG, WebP, GIF, or BMP · max 8 MB · bright light, straight-on, text fills frame
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

      {progress && !error ? (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs text-neutral-700">
            <span>{progressLabel(progress.status)}</span>
            <span>{progress.progress}%</span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.progress}
            aria-label="Image reading progress"
          >
            <div
              className="h-full rounded-full bg-emerald-700 transition-[width] duration-200"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {editableOcr !== null && !error && !busy ? (
        <div
          id="image-ocr-notice"
          role="status"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3"
        >
          <p className="text-sm font-semibold text-amber-900">Check what OCR read</p>
          <p className="mt-1 text-xs text-amber-800">
            The text looks uncertain. Edit it below and continue, or type the product name in the
            search box.
          </p>
          <label htmlFor="ocr-edit" className="mt-2 block text-xs font-medium text-amber-900">
            Recognized text
          </label>
          <textarea
            id="ocr-edit"
            className="input mt-1 min-h-20 resize-y"
            value={editedOcr}
            onChange={(event) => setEditedOcr(event.target.value)}
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => void submitEditedOcr()}>
              Use this text
            </button>
            <button type="button" className="btn-secondary" onClick={onManualEntry}>
              Type product name instead
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p id="image-error" role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
