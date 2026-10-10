"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, RotateCcw, Check, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast";
import { MAX_SIGNATURE_DATA_BYTES, MAX_SIGNATURE_LABEL } from "@/lib/signatureLimits";

/**
 * Hand-rolled signature canvas.
 *
 * WHY NOT A LIBRARY
 * -----------------
 * The obvious candidate (react-signature-canvas) last shipped in 2021 and has
 * open React 18/19 StrictMode issues. This codebase already hand-rolls its
 * shared primitives — Select, Modal, toast, Button variants — so a ~130-line
 * canvas matches the house style and carries no upgrade-surface risk on React
 * 19. lib/celebration.ts:92-141 is the existing precedent for raw Canvas 2D.
 *
 * HOW UNDO WORKS
 * --------------
 * Strokes are kept as arrays of points and replayed onto the canvas rather than
 * using a bitmap snapshot per stroke. Replaying costs a few microseconds for
 * the handful of strokes a signature has, and it avoids the memory blow-up of
 * one full-canvas ImageData per stroke — which matters on a phone, where this
 * modal is most likely to be used.
 *
 * SIZE DISCIPLINE
 * ---------------
 * The export is TRIMMED to the ink's bounding box and DOWNSCALED to a bounded
 * width before `toDataURL`. Without this, a signature drawn in the top-left
 * corner of a large canvas still exports a full-size PNG — hundreds of bytes
 * per pixel of empty space — and would blow the 64 KB server cap while looking
 * tiny on the report card.
 */

export interface SignatureCaptureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing signature to show as the starting preview (URL or data URI). */
  currentSignature?: string | null;
  /** Human label for whose signature this is, e.g. "Principal". */
  signerLabel: string;
  /** Persist the drawn PNG. Receives a base64 PNG data URI. */
  onSave: (dataUri: string) => Promise<void> | void;
  /** Remove any existing signature. Omitted => no "Remove" affordance. */
  onRemove?: () => Promise<void> | void;
}

type Point = { x: number; y: number };

/** Bounded export width. A signature is ~3:1, so ~600x200 is ample for print. */
const MAX_EXPORT_WIDTH = 600;
/** Ink colour — near-black, matching the printed report-card signature line. */
const INK = "#0f172a";

export default function SignatureCaptureModal({
  open,
  onOpenChange,
  currentSignature,
  signerLabel,
  onSave,
  onRemove,
}: SignatureCaptureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  /** Completed strokes. The in-progress stroke lives in `current` only. */
  const strokesRef = useRef<Point[][]>([]);
  const currentRef = useRef<Point[] | null>(null);
  const drawingRef = useRef(false);

  const [strokeCount, setStrokeCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // CSS-pixel size of the drawing surface (the canvas backing store is scaled
  // by devicePixelRatio so strokes are not blurry on retina screens).
  const [size, setSize] = useState({ w: 0, h: 0 });

  const repaint = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { w, h } = size;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const drawStroke = (pts: Point[]) => {
      if (pts.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) {
        // A single tap should still leave a dot.
        ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      }
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    };

    for (const s of strokesRef.current) drawStroke(s);
    const live = currentRef.current;
    if (live && live.length > 0) drawStroke(live);
  }, [size]);

  // Size the backing store to the element's box, honouring devicePixelRatio.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.25;
      ctx.strokeStyle = INK;
      ctxRef.current = ctx;
      setSize({ w, h });
    };

    measure();
    // Re-measure on resize so the surface stays crisp when the modal reflows
    // (orientation change on a phone).
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useEffect(() => {
    repaint();
  }, [repaint, strokeCount]);

  // Reset state each time the modal opens so a previous session's strokes do
  // not reappear.
  useEffect(() => {
    if (open) {
      strokesRef.current = [];
      currentRef.current = null;
      setStrokeCount(0);
    }
  }, [open]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Ignore secondary buttons (right-click / stylus barrel).
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    // Capture so a stroke that leaves the canvas still tracks.
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    currentRef.current = [pointFrom(e)];
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentRef.current) return;
    e.preventDefault();
    currentRef.current.push(pointFrom(e));
    repaint();
  };

  const handleUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const live = currentRef.current;
    if (live && live.length > 0) {
      strokesRef.current.push(live);
      setStrokeCount(strokesRef.current.length);
    }
    currentRef.current = null;
    repaint();
  };

  const handleUndo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    repaint();
  };

  const handleClear = () => {
    strokesRef.current = [];
    currentRef.current = null;
    setStrokeCount(0);
    repaint();
  };

  /**
   * Trim to the ink bounding box and downscale to a bounded width.
   * Returns a PNG data URI, or null when there is nothing drawn.
   */
  const exportSignature = (): string | null => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return null;

    const { w, h } = size;
    if (!w || !h) return null;

    const all: Point[] = [];
    for (const s of strokesRef.current) all.push(...s);
    if (all.length === 0) return null;

    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)) - 4);
    const minY = Math.max(0, Math.floor(Math.min(...ys)) - 4);
    const maxX = Math.min(w, Math.ceil(Math.max(...xs)) + 4);
    const maxY = Math.min(h, Math.ceil(Math.max(...ys)) + 4);
    const cropW = Math.max(1, maxX - minX);
    const cropH = Math.max(1, maxY - minY);

    const scale = Math.min(1, MAX_EXPORT_WIDTH / cropW);
    const outW = Math.max(1, Math.round(cropW * scale));
    const outH = Math.max(1, Math.round(cropH * scale));

    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const octx = out.getContext("2d");
    if (!octx) return null;
    // Transparent background: the report card is white, and a transparent PNG
    // prints cleanly (and stays small — no alpha-less white slab).
    octx.lineCap = "round";
    octx.lineJoin = "round";
    octx.lineWidth = Math.max(1.5, 2.25 * scale);
    octx.strokeStyle = INK;

    for (const s of strokesRef.current) {
      if (s.length === 0) continue;
      octx.beginPath();
      octx.moveTo((s[0].x - minX) * scale, (s[0].y - minY) * scale);
      if (s.length === 1) {
        octx.lineTo((s[0].x - minX) * scale + 0.01, (s[0].y - minY) * scale);
      }
      for (let i = 1; i < s.length; i += 1) {
        octx.lineTo((s[i].x - minX) * scale, (s[i].y - minY) * scale);
      }
      octx.stroke();
    }

    const dataUri = out.toDataURL("image/png");

    // Guard the server cap locally so the user gets an immediate, actionable
    // message instead of a 422 after a slow round-trip.
    if (dataUri.length > MAX_SIGNATURE_DATA_BYTES) {
      toast.error("Signature is too detailed", {
        description: `Please keep it under ${MAX_SIGNATURE_LABEL}. Try drawing with fewer, longer strokes.`,
      });
      return null;
    }
    return dataUri;
  };

  const handleSave = async () => {
    const dataUri = exportSignature();
    if (!dataUri) {
      toast.error("Nothing to save", { description: "Draw your signature first." });
      return;
    }
    setSaving(true);
    try {
      await onSave(dataUri);
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not save signature", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onRemove?.();
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not remove signature", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setRemoving(false);
    }
  };

  const hasInk = strokeCount > 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${signerLabel}'s signature`}
      description="Draw your signature below. It will be printed on every report card."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-purple-300/50">
          Used only to sign report cards. It is stored securely and is not shared.
        </p>

        {/* The canvas is the primary control, so it is a real focusable element
            with an accessible name — drawing is otherwise invisible to a
            screen reader. */}
        <div className="rounded-xl border border-purple-500/20 bg-white p-2">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Signature drawing area for the ${signerLabel}. Draw with a mouse, finger, or stylus.`}
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
            onPointerCancel={handleUp}
            onPointerLeave={handleUp}
            className="block h-40 w-full cursor-crosshair touch-none rounded-lg"
            style={{ backgroundImage: "transparent" }}
          />
          {/* Signature rule — mirrors the printed card so what is drawn here
              sits where it will appear. */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-slate-300" />
            <span className="text-[10px] uppercase tracking-wide text-slate-400">
              {signerLabel}
            </span>
            <div className="h-px flex-1 bg-slate-300" />
          </div>
        </div>

        {/* Announces stroke count for screen-reader users, who cannot see the
            drawing happen. */}
        <p aria-live="polite" className="sr-only">
          {strokeCount === 0
            ? "No strokes drawn yet."
            : `${strokeCount} stroke${strokeCount === 1 ? "" : "s"} drawn.`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleUndo}
            disabled={!hasInk}
            title={hasInk ? "Remove the last stroke" : "Nothing to undo"}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClear}
            disabled={!hasInk}
            title={hasInk ? "Clear the canvas" : "Nothing to clear"}
          >
            <Eraser className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </Button>
          <Button className="ml-auto" size="sm" onClick={() => void handleSave()} disabled={!hasInk || saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save signature
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-purple-500/15 pt-3">
          {/* "Skip" rather than Cancel-only: a pad that can only be dismissed
              as a failure feels broken to a first-time user. */}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Skip for now
          </Button>
          {onRemove && currentSignature && (
            <Button variant="ghost" size="sm" onClick={() => void handleRemove()} disabled={saving || removing}>
              {removing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Remove existing signature
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}