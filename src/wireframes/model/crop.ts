/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Rect2, Vec2 } from '@app/core';

// The appearance key that stores the crop rect, relative to the original image: "x,y,w,h" with values in [0, 1].
// An empty string means "not cropped".
export const IMAGE_CROP = 'IMAGE_CROP';

// The appearance key that stores the bounds of the image before the first crop, to support "Reset crop".
export const IMAGE_CROP_ORIGIN = 'IMAGE_CROP_ORIGIN';

// A crop rect relative to the original image. All values in [0, 1].
export interface CropRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

// Represents the full, un-cropped image.
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

// PRD FR-03: A crop is invalid when the intersection is smaller than these thresholds.
const MIN_CROP_PIXELS = 10;
const MIN_CROP_RATIO = 0.02;

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

// Parses a crop value from the appearance. Returns null when not cropped or invalid.
export function parseCrop(value: any): CropRect | null {
    if (value === null || value === undefined || value === '' || typeof value !== 'string') {
        return null;
    }

    const parts = value.split(',').map(part => parseFloat(part));

    if (parts.length !== 4 || parts.some(part => !isFinite(part))) {
        return null;
    }

    const [x, y, w, h] = parts;

    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) {
        return null;
    }

    return { x, y, w, h };
}

// Serializes a crop rect to the appearance string format.
export function cropToString(rel: CropRect): string {
    const round = (value: number) => Math.round(value * 1e6) / 1e6;

    return `${round(rel.x)},${round(rel.y)},${round(rel.w)},${round(rel.h)}`;
}

// Composes a second crop (relative to the currently displayed area) with the existing crop (relative to the original image).
export function composeCrop(oldRel: CropRect, subRel: CropRect): CropRect {
    return {
        x: oldRel.x + subRel.x * oldRel.w,
        y: oldRel.y + subRel.y * oldRel.h,
        w: subRel.w * oldRel.w,
        h: subRel.h * oldRel.h,
    };
}

// Converts a marquee rect (in canvas coordinates) to a crop rect relative to the item bounds.
// Clamping each edge to [0, 1] implements the PRD rule: crop area = marquee ∩ image bounds.
export function marqueeToRelative(marquee: Rect2, itemRect: Rect2): CropRect {
    const x = clamp01((marquee.x - itemRect.x) / itemRect.w);
    const y = clamp01((marquee.y - itemRect.y) / itemRect.h);
    const w = clamp01((marquee.right - itemRect.x) / itemRect.w) - x;
    const h = clamp01((marquee.bottom - itemRect.y) / itemRect.h) - y;

    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

// Converts a relative crop rect back to an absolute rect within the item bounds.
export function cropToRect(rel: CropRect, itemRect: Rect2): Rect2 {
    return new Rect2(
        itemRect.x + rel.x * itemRect.w,
        itemRect.y + rel.y * itemRect.h,
        rel.w * itemRect.w,
        rel.h * itemRect.h);
}

// Validates a crop against the PRD FR-03 thresholds: at least 10px and 2% of each dimension.
export function isValidCrop(rel: CropRect, itemSize: Vec2): boolean {
    return rel.w * itemSize.x >= MIN_CROP_PIXELS &&
        rel.h * itemSize.y >= MIN_CROP_PIXELS &&
        rel.w >= MIN_CROP_RATIO &&
        rel.h >= MIN_CROP_RATIO;
}
