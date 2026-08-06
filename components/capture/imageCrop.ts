// Geometry and canvas export for the photo cropper.
//
// Kept out of the component so the fiddly parts — clamping a crop rect while a
// corner is dragged, mapping screen coordinates onto the source image, applying
// rotation on export — can be reasoned about (and tested) without a DOM.

export type Rect = { x: number; y: number; width: number; height: number };

/** Which part of the crop frame a pointer grabbed. */
export type DragHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | "move";

/** Crop cannot shrink below this, in displayed pixels — smaller is unusable on a phone. */
export const MIN_CROP_PX = 48;

/** How close to an edge a pointer counts as grabbing it, in displayed pixels. */
export const HANDLE_HIT_PX = 28;

/**
 * Which handle a press at (px, py) grabs, or null when it missed the frame.
 *
 * Corners win over edges: near a corner both tests pass, and dragging a corner
 * is what the user meant.
 */
export function hitTestHandle(rect: Rect, px: number, py: number): DragHandle | null {
  const nearLeft = Math.abs(px - rect.x) <= HANDLE_HIT_PX;
  const nearRight = Math.abs(px - (rect.x + rect.width)) <= HANDLE_HIT_PX;
  const nearTop = Math.abs(py - rect.y) <= HANDLE_HIT_PX;
  const nearBottom = Math.abs(py - (rect.y + rect.height)) <= HANDLE_HIT_PX;

  const withinX = px >= rect.x - HANDLE_HIT_PX && px <= rect.x + rect.width + HANDLE_HIT_PX;
  const withinY = py >= rect.y - HANDLE_HIT_PX && py <= rect.y + rect.height + HANDLE_HIT_PX;

  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearTop && withinX) return "n";
  if (nearBottom && withinX) return "s";
  if (nearLeft && withinY) return "w";
  if (nearRight && withinY) return "e";

  const inside = px > rect.x && px < rect.x + rect.width && py > rect.y && py < rect.y + rect.height;
  return inside ? "move" : null;
}

/**
 * Apply a drag to the crop rect and keep it legal: inside `bounds`, never
 * smaller than MIN_CROP_PX, and never inverted when a handle is dragged past
 * the opposite edge.
 */
export function applyDrag(rect: Rect, handle: DragHandle, dx: number, dy: number, bounds: Rect): Rect {
  if (handle === "move") {
    return {
      ...rect,
      x: clamp(rect.x + dx, bounds.x, bounds.x + bounds.width - rect.width),
      y: clamp(rect.y + dy, bounds.y, bounds.y + bounds.height - rect.height),
    };
  }

  let { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes("w")) {
    const nextX = clamp(x + dx, bounds.x, right - MIN_CROP_PX);
    width = right - nextX;
    x = nextX;
  }
  if (handle.includes("e")) {
    width = clamp(width + dx, MIN_CROP_PX, bounds.x + bounds.width - x);
  }
  if (handle.includes("n")) {
    const nextY = clamp(y + dy, bounds.y, bottom - MIN_CROP_PX);
    height = bottom - nextY;
    y = nextY;
  }
  if (handle.includes("s")) {
    height = clamp(height + dy, MIN_CROP_PX, bounds.y + bounds.height - y);
  }

  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The largest rect of the image's aspect ratio that fits inside the container. */
export function fitRect(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): Rect {
  if (imageWidth <= 0 || imageHeight <= 0) return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

export type ExportOptions = {
  /** Crop rect in displayed coordinates. */
  crop: Rect;
  /** Where the image is drawn inside the container, same coordinate space as `crop`. */
  displayed: Rect;
  /** Clockwise, degrees, a multiple of 90. */
  rotation: number;
  /** Longest side of the exported image; phone photos are far larger than the model needs. */
  maxSize: number;
  quality: number;
};

/**
 * Render the selected region — and only it — to a JPEG data URL.
 *
 * Rotation is applied here rather than to the source: the crop rect the user
 * drew is in the *rotated* view, so the canvas is set up in that view and the
 * image is drawn into it turned.
 */
export function exportCrop(
  image: HTMLImageElement,
  { crop, displayed, rotation, maxSize, quality }: ExportOptions,
): string | null {
  // The displayed image is the rotated one, so its natural size swaps on odd
  // quarter turns.
  const turned = ((rotation % 360) + 360) % 360;
  const swapped = turned === 90 || turned === 270;
  const naturalW = swapped ? image.naturalHeight : image.naturalWidth;
  const naturalH = swapped ? image.naturalWidth : image.naturalHeight;
  if (!naturalW || !naturalH || displayed.width <= 0 || displayed.height <= 0) return null;

  const scale = naturalW / displayed.width;
  const sx = (crop.x - displayed.x) * scale;
  const sy = (crop.y - displayed.y) * scale;
  const sw = crop.width * scale;
  const sh = crop.height * scale;

  const outScale = Math.min(1, maxSize / Math.max(sw, sh));
  const outW = Math.max(1, Math.round(sw * outScale));
  const outH = Math.max(1, Math.round(sh * outScale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Work in the rotated frame: translate to the output centre, turn, then draw
  // the source region around its own centre.
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((turned * Math.PI) / 180);

  const drawW = swapped ? outH : outW;
  const drawH = swapped ? outW : outH;

  // Where the crop sits in the *unrotated* source.
  const src = unrotateRect({ x: sx, y: sy, width: sw, height: sh }, turned, naturalW, naturalH);

  ctx.drawImage(image, src.x, src.y, src.width, src.height, -drawW / 2, -drawH / 2, drawW, drawH);

  return canvas.toDataURL("image/jpeg", quality);
}

/** Map a rect expressed in the rotated view back onto the original image. */
function unrotateRect(rect: Rect, turned: number, rotatedW: number, rotatedH: number): Rect {
  switch (turned) {
    case 90:
      return { x: rect.y, y: rotatedW - rect.x - rect.width, width: rect.height, height: rect.width };
    case 180:
      return { x: rotatedW - rect.x - rect.width, y: rotatedH - rect.y - rect.height, width: rect.width, height: rect.height };
    case 270:
      return { x: rotatedH - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width };
    default:
      return rect;
  }
}
