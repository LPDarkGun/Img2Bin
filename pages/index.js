// app/page.jsx
"use client";

import { useRef, useState, useMemo, useEffect } from "react";

export default function Home() {
  // ----- Refs for DOM nodes we need to access imperatively -----
  const fileRef = useRef(null);      // <input type="file"> element
  const canvasRef = useRef(null);    // hidden canvas used to sample pixels
  const pasteArtRef = useRef(null);  // canvas used to render pasted 9-bit text
  const pasteZoneRef = useRef(null); // optional focusable area for paste

  // ----- UI/processing state -----
  const [bits, setBits] = useState([]);                 // flat array of "#########" 9-bit binary strings (one per pixel)
  const [dims, setDims] = useState({ w: 0, h: 0 });     // output width/height in pixels
  const [copied, setCopied] = useState(false);          // "Copy all" feedback
  const [pastedText, setPastedText] = useState("");     // raw text the user pastes for rendering back to pixels
  const [previewUrl, setPreviewUrl] = useState("");     // data URL preview of the processed image
  const [targetNumber, setTargetNumber] = useState(20); // target width/height in pixels

  // Convert 8-bit per channel RGB (0–255) -> packed 9-bit 3-3-3 binary string.
  const rgbTo9Bit = (r, g, b) => {
    const r3 = Math.round((r / 255) * 7);
    const g3 = Math.round((g / 255) * 7);
    const b3 = Math.round((b / 255) * 7);
    const packed = (r3 << 6) | (g3 << 3) | b3;
    return packed.toString(2).padStart(9, "0");
  };

  // Convert a 9-bit "#########" string back to 8-bit RGB.
  const bin9ToRgb = (bin) => {
    const val = parseInt(bin, 2);
    const r3 = (val >> 6) & 0b111;
    const g3 = (val >> 3) & 0b111;
    const b3 = val & 0b111;
    const r = Math.round((r3 / 7) * 255);
    const g = Math.round((g3 / 7) * 255);
    const b = Math.round((b3 / 7) * 255);
    return [r, g, b];
  };

  // Handle an uploaded/pasted image file
  const handleFile = async (file) => {
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      const originalW = img.naturalWidth;
      const originalH = img.naturalHeight;

      const targetSize = targetNumber;
      let w = targetSize;
      let h = targetSize;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);

      ctx.drawImage(img, 0, 0, originalW, originalH, 0, 0, w, h);

      const { data } = ctx.getImageData(0, 0, w, h);
      const out = new Array(w * h);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let r = data[i],
            g = data[i + 1],
            b = data[i + 2],
            a = data[i + 3];

          if (a < 255) {
            const alpha = a / 255;
            r = Math.round(r * alpha + 255 * (1 - alpha));
            g = Math.round(g * alpha + 255 * (1 - alpha));
            b = Math.round(b * alpha + 255 * (1 - alpha));
          }

          out[y * w + x] = rgbTo9Bit(r, g, b);
        }
      }

      setBits(out);
      setDims({ w, h });
      setCopied(false);
      setPreviewUrl(canvas.toDataURL());
    };

    img.onerror = () => alert("Could not load that image. Try a different file.");
    img.src = URL.createObjectURL(file);
  };

  // Helper: extract first image file from a DataTransfer / Clipboard
  const extractImageFile = (itemsOrFiles) => {
    // items (ClipboardEvent) may be DataTransferItemList; fallback to FileList
    const list = itemsOrFiles;
    if (!list) return null;

    // Prefer items if present (so we can filter by type)
    if ("0" in list && list[0]?.kind !== undefined) {
      for (const it of list) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) return f;
        }
      }
    } else {
      // Looks like a FileList
      for (const f of list) {
        if (f && f.type?.startsWith?.("image/")) return f;
      }
    }
    return null;
  };

  // PASTE support (paste anywhere on the page)
  useEffect(() => {
    const onPaste = (e) => {
      const file = extractImageFile(e.clipboardData?.items || e.clipboardData?.files);
      if (file) {
        e.preventDefault();
        handleFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Optional: make the paste zone focus by default for better UX
  useEffect(() => {
    pasteZoneRef.current?.focus();
  }, []);

  // Reprocess if the user changes the target size and a file is already chosen
  useEffect(() => {
    if (fileRef.current?.files?.[0]) {
      handleFile(fileRef.current.files[0]);
    }
  }, [targetNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoized string view of the 9-bit array
  const textArt = useMemo(() => {
    if (!dims.w || !dims.h || bits.length === 0) return "";
    const lines = [];
    for (let y = 0; y < dims.h; y++) {
      const row = bits.slice(y * dims.w, (y + 1) * dims.w).join(" ");
      lines.push(row);
    }
    return lines.join("\n");
  }, [bits, dims]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(textArt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  // Parse pasted 9-bit text -> render back to pixels
  const renderFromPaste = () => {
    if (!pastedText.trim()) return;
    const rows = pastedText
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((r) => r.trim().split(/\s+/).filter(Boolean));

    if (rows.length === 0) return;
    const height = rows.length;
    const width = rows[0]?.length || 0;
    if (width === 0) return;

    const canvas = pasteArtRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;

    const imgData = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const code = rows[y]?.[x];
        let r, g, b;
        if (code && /^[01]{9}$/.test(code)) {
          [r, g, b] = bin9ToRgb(code);
        } else {
          r = g = b = 255;
        }
        const i = (y * width + x) * 4;
        imgData.data[i] = r;
        imgData.data[i + 1] = g;
        imgData.data[i + 2] = b;
        imgData.data[i + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  };

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-semibold mb-4">
          9-bit RGB Binary Table Converter
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column: uploader, preview, paste->render */}
          <section className="lg:col-span-8 space-y-4">
            {/* Image upload + paste hint */}
            <div
              ref={pasteZoneRef}
              tabIndex={0}
              onPaste={(e) => {
                // Works even if window listener is removed
                const file = extractImageFile(e.clipboardData?.items || e.clipboardData?.files);
                if (file) {
                  e.preventDefault();
                  handleFile(file);
                }
              }}
              className="rounded-lg border border-dashed border-gray-300 bg-white p-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Select or paste image</div>
                  <p className="text-xs text-gray-500 mt-1">
                    Click <em>Select image</em>, or paste with <kbd>Ctrl</kbd>+<kbd>V</kbd> (⌘+V on Mac).
                  </p>
                </div>

                <label className="block">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="mt-2 block rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                </label>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium mb-1">
                  Target Size (pixels)
                </label>
                <input
                  type="range"
                  min={20}
                  max={150}
                  value={targetNumber}
                  onChange={(e) => setTargetNumber(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-gray-600 mt-1">
                  {targetNumber} × {targetNumber} pixels
                </div>
              </div>

              <div className="mt-3 text-sm flex gap-6">
                <p>
                  <strong>Output Dimensions:</strong>{" "}
                  {dims.w && dims.h ? `${dims.w}×${dims.h}` : "—"}
                </p>
                <p>
                  <strong>Total pixels:</strong>{" "}
                  {bits.length ? bits.length.toLocaleString() : "—"}
                </p>
              </div>
            </div>

            {/* Processed image preview */}
            {previewUrl ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-medium mb-2">Preview (scaled to fit)</h3>
                <img
                  src={previewUrl}
                  alt="Processed preview"
                  className="rounded border border-gray-200 max-w-full"
                  style={{
                    width: "auto",
                    height: "auto",
                    maxWidth: "500px",
                    maxHeight: "500px",
                    imageRendering: "pixelated",
                  }}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
                Upload or paste an image to see preview.
              </div>
            )}

            {/* Hidden canvas used only for pixel reads + preview capture */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Paste 9-bit text -> render back to pixels */}
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-lg font-semibold mb-2">
                Paste 9-bit Table → Render Pixel Art
              </h2>

              <textarea
                className="w-full min-h=[160px] font-mono text-xs rounded border border-gray-300 p-2 mb-3"
                placeholder="Paste your 9-bit codes here (space-separated, one row per line)..."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
              />

              <button
                onClick={renderFromPaste}
                disabled={!pastedText.trim()}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Render Pixel Art
              </button>

              <div className="mt-4">
                <canvas
                  ref={pasteArtRef}
                  className="border border-gray-300 rounded max-w-full"
                  style={{
                    width: "auto",
                    height: "auto",
                    maxWidth: "400px",
                    maxHeight: "400px",
                    imageRendering: "pixelated",
                  }}
                />
              </div>
            </div>
          </section>

          {/* Right column: the generated 9-bit text table with copy/export-ish details */}
          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-6 rounded-lg border border-gray-200 bg-white p-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Binary Code</h2>
                <button
                  onClick={copyAll}
                  disabled={!textArt}
                  className="text-sm px-3 py-1.5 rounded border border-gray-300 disabled:opacity-50 hover:bg-gray-50 disabled:cursor-not-allowed"
                >
                  {copied ? "Copied!" : "Copy all"}
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-2">
                Each row = image row; each 9-bit code = one pixel in 3-3-3 RGB format.
              </p>

              <textarea
                className="w-full min-h-[320px] flex-1 font-mono text-xs rounded border border-gray-300 p-2 resize-none"
                readOnly
                value={textArt}
                placeholder="Binary output will appear here after uploading or pasting an image..."
              />

              <div className="mt-3 text-xs text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>Rows:</span>
                  <span>{dims.h || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Columns:</span>
                  <span>{dims.w || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total codes:</span>
                  <span>{bits.length ? bits.length.toLocaleString() : 0}</span>
                </div>
                <div className="text-xs text-gray-400 pt-2">
                  Format: 3 bits red + 3 bits green + 3 bits blue = 9 bits per pixel
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
