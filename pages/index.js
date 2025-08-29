// app/page.jsx
"use client";

import { useRef, useState, useMemo } from "react";

export default function Home() {
  // ----- Refs for DOM nodes we need to access imperatively -----
  const fileRef = useRef(null);      // <input type="file"> element
  const canvasRef = useRef(null);    // hidden canvas used to sample pixels
  const pasteArtRef = useRef(null);  // canvas used to render pasted 9-bit text

  // ----- UI/processing state -----
  const [bits, setBits] = useState([]);                 // flat array of "#########" 9-bit binary strings (one per pixel)
  const [dims, setDims] = useState({ w: 0, h: 0 });     // output width/height in pixels
  const [copied, setCopied] = useState(false);          // "Copy all" feedback
  const [pastedText, setPastedText] = useState("");     // raw text the user pastes for rendering back to pixels
  const [previewUrl, setPreviewUrl] = useState("");     // data URL preview of the processed image

  // Convert 8-bit per channel RGB (0–255) -> packed 9-bit 3-3-3 binary string.
  // We quantize each channel to 3 bits (0–7), pack them into 9 bits (RRR GGG BBB), and return "#########" text.
  const rgbTo9Bit = (r, g, b) => {
    // Quantize 0–255 to 0–7 by scaling, then rounding to nearest
    const r3 = Math.round((r / 255) * 7);
    const g3 = Math.round((g / 255) * 7);
    const b3 = Math.round((b / 255) * 7);
    // Pack 3x3-bit channels into a single 9-bit int: R at bits 8..6, G at 5..3, B at 2..0
    const packed = (r3 << 6) | (g3 << 3) | b3;
    // Return as 9-character binary string, zero-padded on the left
    return packed.toString(2).padStart(9, "0");
  };

  // Convert a 9-bit "#########" string back to 8-bit RGB.
  // This reverses the packing and expands 3 bits (0–7) back to 0–255 by scaling.
  const bin9ToRgb = (bin) => {
    // Parse binary string to integer
    const val = parseInt(bin, 2);
    // Extract channels (mirror of packing above)
    const r3 = (val >> 6) & 0b111; // top 3 bits
    const g3 = (val >> 3) & 0b111; // middle 3 bits
    const b3 = val & 0b111;        // bottom 3 bits
    
    // Expand quantized values from 0–7 back to 0–255 (simple linear scaling)
    const r = Math.round((r3 / 7) * 255);
    const g = Math.round((g3 / 7) * 255);
    const b = Math.round((b3 / 7) * 255);
    
    return [r, g, b];
  };

  // Handle an uploaded image file:
  // - Load it into an <img>
  // - Draw it onto a hidden canvas scaled to a target size
  // - Read pixels, alpha-compose onto white, quantize to 3-3-3, and store as 9-bit strings
  // - Snapshot a preview data URL for the UI
  const handleFile = async (file) => {
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      // Get original size (not strictly used beyond drawImage source dims)
      const originalW = img.naturalWidth;
      const originalH = img.naturalHeight;
      
      // Fixed target output size (square). Adjust as you like.
      const targetSize = 40;
      let w = targetSize;
      let h = targetSize;

      // Prepare hidden canvas
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); // hint for frequent pixel reads
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      
      // Draw original image scaled to the target canvas
      // drawImage(sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
      ctx.drawImage(img, 0, 0, originalW, originalH, 0, 0, w, h);

      // Read back pixels (RGBA for the whole canvas)
      const { data } = ctx.getImageData(0, 0, w, h);
      // Pre-allocate output array of length w*h
      const out = new Array(w * h);

      // Loop pixels row-major; i points to RGBA in the flat Uint8ClampedArray
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let r = data[i],
            g = data[i + 1],
            b = data[i + 2],
            a = data[i + 3];

          // If there’s transparency, composite over white background:
          // out = src * alpha + white * (1 - alpha)
          if (a < 255) {
            const alpha = a / 255;
            r = Math.round(r * alpha + 255 * (1 - alpha));
            g = Math.round(g * alpha + 255 * (1 - alpha));
            b = Math.round(b * alpha + 255 * (1 - alpha));
          }

          // Convert to a 9-bit string and store in flat array
          out[y * w + x] = rgbTo9Bit(r, g, b);
        }
      }

      // Commit state for UI
      setBits(out);
      setDims({ w, h });
      setCopied(false);
      // Save a data URL preview (so we can display it as an <img>)
      setPreviewUrl(canvas.toDataURL());
    };
    
    // Basic load error feedback
    img.onerror = () => alert("Could not load that image. Try a different file.");
    // Create a temporary object URL so <img> can load the uploaded file
    img.src = URL.createObjectURL(file);
  };

  // Memoized string view of the 9-bit array:
  // - Joins each row’s binary codes with spaces
  // - Joins rows with newlines
  const textArt = useMemo(() => {
    if (!dims.w || !dims.h || bits.length === 0) return "";
    const lines = [];
    for (let y = 0; y < dims.h; y++) {
      const row = bits.slice(y * dims.w, (y + 1) * dims.w).join(" "); // "######### ######### ..."
      lines.push(row);
    }
    return lines.join("\n"); // each line = one image row
  }, [bits, dims]);

  // Copy the entire 9-bit text to clipboard and flash "Copied!"
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(textArt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Ignore clipboard errors (permissions, etc.)
    }
  };

  // Parse pasted 9-bit text and render it as pixels on the visible "paste" canvas.
  // - Splits by lines (rows), then spaces (columns)
  // - Validates tokens as 9-bit binary; invalid/missing -> white
  // - Converts tokens back to RGB and writes an ImageData for display
  const renderFromPaste = () => {
    if (!pastedText.trim()) return;
    
    // rows: string[][] where each inner array is tokens for that row
    const rows = pastedText
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((r) => r.trim().split(/\s+/).filter(Boolean));

    if (rows.length === 0) return;
    
    const height = rows.length;
    const width = rows[0]?.length || 0;
    
    if (width === 0) return;

    // Prepare output canvas sized to the text grid
    const canvas = pasteArtRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    
    // Allocate image buffer for width*height pixels
    const imgData = ctx.createImageData(width, height);

    // Fill pixels from tokens
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const code = rows[y]?.[x];
        let r, g, b;
        
        // If token looks like exactly 9 binary digits, decode; else white
        if (code && /^[01]{9}$/.test(code)) {
          [r, g, b] = bin9ToRgb(code);
        } else {
          r = g = b = 255;
        }

        // Write RGBA into the flat buffer (opaque)
        const i = (y * width + x) * 4;
        imgData.data[i] = r;
        imgData.data[i + 1] = g;
        imgData.data[i + 2] = b;
        imgData.data[i + 3] = 255;
      }
    }

    // Paint to the canvas
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
            {/* Image upload + stats */}
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <label className="block">
                <span className="text-sm font-medium">Select image</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="mt-2 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  onChange={(e) => handleFile(e.target.files?.[0])} // kick off processing
                />
              </label>

              <div className="mt-4 text-sm flex gap-6">
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

            {/* Processed image preview (uses hidden canvas data URL) */}
            {previewUrl ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-medium mb-2">Preview (scaled to fit)</h3>
                <img
                  src={previewUrl}
                  alt="Processed preview"
                  className="rounded border border-gray-200 max-w-full"
                  style={{ 
                    width: 'auto', 
                    height: 'auto',
                    maxWidth: '500px',
                    maxHeight: '500px',
                    imageRendering: 'pixelated'
                  }}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
                Upload an image to see preview.
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
                onChange={(e) => setPastedText(e.target.value)} // keep textarea controlled
              />

              <button
                onClick={renderFromPaste}                 // parse + draw onto pasteArtRef canvas
                disabled={!pastedText.trim()}             // guard against empty input
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Render Pixel Art
              </button>

              <div className="mt-4">
                <canvas
                  ref={pasteArtRef}
                  className="border border-gray-300 rounded max-w-full"
                  style={{ 
                    width: 'auto', 
                    height: 'auto',
                    maxWidth: '400px',
                    maxHeight: '400px',
                    imageRendering: 'pixelated' // same 'pixel look' as preview
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
                  onClick={copyAll}                        // write textArt to clipboard
                  disabled={!textArt}
                  className="text-sm px-3 py-1.5 rounded border border-gray-300 disabled:opacity-50 hover:bg-gray-50 disabled:cursor-not-allowed"
                >
                  {copied ? "Copied!" : "Copy all"}
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-2">
                Each row = image row; each 9-bit code = one pixel in 3-3-3 RGB format.
              </p>

              {/* Read-only view of the generated text (one row per line) */}
              <textarea
                className="w-full min-h-[320px] flex-1 font-mono text-xs rounded border border-gray-300 p-2 resize-none"
                readOnly
                value={textArt}
                placeholder="Binary output will appear here after uploading an image..."
              />

              {/* Small stats footer */}
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
