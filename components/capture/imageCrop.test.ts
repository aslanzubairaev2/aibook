// Run with: npm run test:crop
//
// Crop geometry is where a cropper goes wrong in ways that only show up on a
// real phone: a frame that inverts when you drag a corner past the opposite
// edge, or one that escapes the image. These pin the rules down.

import test from "node:test";
import assert from "node:assert/strict";
import { applyDrag, fitRect, hitTestHandle, MIN_CROP_PX, type Rect } from "./imageCrop.ts";

const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
const crop: Rect = { x: 100, y: 100, width: 200, height: 100 };

test("corners win over edges when both are in range", () => {
  assert.equal(hitTestHandle(crop, 100, 100), "nw");
  assert.equal(hitTestHandle(crop, 300, 200), "se");
});

test("edges and interior are distinguished", () => {
  assert.equal(hitTestHandle(crop, 200, 100), "n");
  assert.equal(hitTestHandle(crop, 100, 150), "w");
  assert.equal(hitTestHandle(crop, 200, 150), "move");
});

test("a press well outside the frame grabs nothing", () => {
  assert.equal(hitTestHandle(crop, 10, 10), null);
});

test("moving keeps the whole frame inside the image", () => {
  const far = applyDrag(crop, "move", 1000, 1000, bounds);
  assert.equal(far.x + far.width, bounds.width);
  assert.equal(far.y + far.height, bounds.height);
  assert.equal(far.width, crop.width, "moving must not resize");

  const negative = applyDrag(crop, "move", -1000, -1000, bounds);
  assert.deepEqual({ x: negative.x, y: negative.y }, { x: 0, y: 0 });
});

test("dragging a corner past the opposite edge clamps instead of inverting", () => {
  // The classic cropper bug: width goes negative and the frame turns inside out.
  const collapsed = applyDrag(crop, "nw", 1000, 1000, bounds);
  assert.equal(collapsed.width, MIN_CROP_PX);
  assert.equal(collapsed.height, MIN_CROP_PX);
  assert.ok(collapsed.x + collapsed.width <= crop.x + crop.width);

  const collapsedSe = applyDrag(crop, "se", -1000, -1000, bounds);
  assert.equal(collapsedSe.width, MIN_CROP_PX);
  assert.equal(collapsedSe.height, MIN_CROP_PX);
});

test("resizing stops at the image edge", () => {
  const wide = applyDrag(crop, "e", 1000, 0, bounds);
  assert.equal(wide.x + wide.width, bounds.width);

  const tall = applyDrag(crop, "n", -1000, -1000, bounds);
  assert.equal(tall.y, 0);
  assert.equal(tall.y + tall.height, crop.y + crop.height, "the anchored edge must not move");
});

test("fitRect centres the image and preserves its aspect ratio", () => {
  // A 2:1 image in a square box: full width, centred vertically.
  const fitted = fitRect(1000, 500, 400, 400);
  assert.deepEqual(fitted, { x: 0, y: 100, width: 400, height: 200 });

  const portrait = fitRect(500, 1000, 400, 400);
  assert.deepEqual(portrait, { x: 100, y: 0, width: 200, height: 400 });
});
