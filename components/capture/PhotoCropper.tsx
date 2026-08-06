"use client";

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from "react";
import {
  applyDrag, exportCrop, fitRect, hitTestHandle, type DragHandle, type Rect,
} from "./imageCrop";

export type CropperHandle = {
  rotate: () => void;
  reset: () => void;
  /** JPEG data URL of the selected region only, or null if not ready. */
  exportCropped: (maxSize: number, quality: number) => string | null;
};

type Props = {
  src: string;
  disabled?: boolean;
};

/**
 * Rotate-and-crop over a photo.
 *
 * Pointer events rather than separate mouse and touch handlers: one code path
 * covers finger, mouse and stylus, and setPointerCapture keeps a drag alive
 * when the finger slides outside the frame — which on a phone it always does.
 */
export const PhotoCropper = forwardRef<CropperHandle, Props>(function PhotoCropper({ src, disabled }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [rotation, setRotation] = useState(0);
  const [displayed, setDisplayed] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [activeHandle, setActiveHandle] = useState<DragHandle | null>(null);
  const dragOrigin = useRef<{ x: number; y: number; rect: Rect } | null>(null);

  /** Recompute where the image sits, and start with the whole frame selected. */
  const layout = useCallback((keepCrop: boolean) => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image || !image.naturalWidth) return;

    const box = container.getBoundingClientRect();
    const turned = ((rotation % 360) + 360) % 360;
    const swapped = turned === 90 || turned === 270;
    const w = swapped ? image.naturalHeight : image.naturalWidth;
    const h = swapped ? image.naturalWidth : image.naturalHeight;

    const fitted = fitRect(w, h, box.width, box.height);
    setDisplayed(fitted);
    // A crop drawn for the previous orientation means nothing after a turn.
    if (!keepCrop) setCrop(fitted);
  }, [rotation]);

  useEffect(() => { layout(false); }, [layout]);

  useEffect(() => {
    const onResize = () => layout(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [layout]);

  useImperativeHandle(ref, () => ({
    rotate: () => setRotation((r) => (r + 90) % 360),
    reset: () => setCrop(displayed),
    exportCropped: (maxSize, quality) => {
      const image = imageRef.current;
      if (!image) return null;
      return exportCrop(image, { crop, displayed, rotation, maxSize, quality });
    },
  }), [crop, displayed, rotation]);

  const pointFromEvent = (e: React.PointerEvent) => {
    const box = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    const point = pointFromEvent(e);
    const handle = hitTestHandle(crop, point.x, point.y);
    if (!handle) return;

    // Capture keeps the drag alive when the finger leaves the frame. It can
    // throw for a pointer the element never owned; the drag still works without
    // it, so never let that abort the gesture.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    setActiveHandle(handle);
    dragOrigin.current = { x: point.x, y: point.y, rect: crop };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!activeHandle || !dragOrigin.current) return;
    e.preventDefault();
    const point = pointFromEvent(e);
    const { x, y, rect } = dragOrigin.current;
    setCrop(applyDrag(rect, activeHandle, point.x - x, point.y - y, displayed));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!activeHandle) return;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
    setActiveHandle(null);
    dragOrigin.current = null;
  };

  const turned = ((rotation % 360) + 360) % 360;
  const swapped = turned === 90 || turned === 270;

  return (
    <div
      ref={containerRef}
      className={`cropper${activeHandle ? " dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={src}
        alt="Снимок"
        className="cropper-img"
        draggable={false}
        onLoad={() => layout(false)}
        style={{
          left: displayed.x,
          top: displayed.y,
          width: swapped ? displayed.height : displayed.width,
          height: swapped ? displayed.width : displayed.height,
          // Turn about the centre of the box the image occupies on screen.
          transform: `rotate(${turned}deg)`,
          transformOrigin: "center",
          marginLeft: swapped ? (displayed.width - displayed.height) / 2 : 0,
          marginTop: swapped ? (displayed.height - displayed.width) / 2 : 0,
        }}
      />

      {/* Everything outside the selection is dimmed by four panels — simpler and
          sharper than one box-shadow, and it keeps the frame crisp on HiDPI. */}
      <div className="cropper-shade" style={{ left: 0, top: 0, width: "100%", height: crop.y }} />
      <div className="cropper-shade" style={{ left: 0, top: crop.y + crop.height, width: "100%", bottom: 0 }} />
      <div className="cropper-shade" style={{ left: 0, top: crop.y, width: crop.x, height: crop.height }} />
      <div className="cropper-shade" style={{ left: crop.x + crop.width, top: crop.y, right: 0, height: crop.height }} />

      <div
        className="cropper-frame"
        style={{ left: crop.x, top: crop.y, width: crop.width, height: crop.height }}
      >
        <span className="cropper-corner nw" /><span className="cropper-corner ne" />
        <span className="cropper-corner sw" /><span className="cropper-corner se" />
        <span className="cropper-third v" style={{ left: "33.33%" }} />
        <span className="cropper-third v" style={{ left: "66.66%" }} />
        <span className="cropper-third h" style={{ top: "33.33%" }} />
        <span className="cropper-third h" style={{ top: "66.66%" }} />
      </div>
    </div>
  );
});

const STYLES = `
  .cropper {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #000;
    /* The frame is dragged, so the browser must not pan or zoom the page. */
    touch-action: none;
    user-select: none;
    cursor: crosshair;
  }
  .cropper.dragging { cursor: grabbing; }
  .cropper-img { position: absolute; object-fit: fill; pointer-events: none; }
  .cropper-shade { position: absolute; background: rgba(0,0,0,0.58); pointer-events: none; }

  .cropper-frame {
    position: absolute;
    border: 1.5px solid rgba(255,255,255,0.95);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.35);
    pointer-events: none;
  }
  .cropper-corner {
    position: absolute;
    width: 22px;
    height: 22px;
    border: 3px solid var(--accent);
  }
  .cropper-corner.nw { left: -3px;  top: -3px;    border-right: 0; border-bottom: 0; }
  .cropper-corner.ne { right: -3px; top: -3px;    border-left: 0;  border-bottom: 0; }
  .cropper-corner.sw { left: -3px;  bottom: -3px; border-right: 0; border-top: 0; }
  .cropper-corner.se { right: -3px; bottom: -3px; border-left: 0;  border-top: 0; }

  .cropper-third { position: absolute; background: rgba(255,255,255,0.22); }
  .cropper-third.v { top: 0; bottom: 0; width: 1px; }
  .cropper-third.h { left: 0; right: 0; height: 1px; }
`;
