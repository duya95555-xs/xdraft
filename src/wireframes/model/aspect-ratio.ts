/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Vec2 } from '@app/core';

// The appearance key that stores the locked aspect ratio (width / height).
// An empty string means "not locked".
// NOTE: Must not be 'ASPECT_RATIO', which is already used by the Image shape
// for its "Preserve aspect ratio" render toggle.
export const ASPECT_RATIO = 'LOCKED_ASPECT_RATIO';

// The minimum size of each dimension.
const MIN_SIZE = 2;

// Parses an appearance value into a valid aspect ratio. Returns null when not locked or invalid.
export function parseAspectRatio(value: any): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const ratio = parseFloat(value);

    if (!isFinite(ratio) || ratio <= 0) {
        return null;
    }

    return ratio;
}

// Calculates the aspect ratio (width / height) from a size, to be remembered when locking.
export function lockAspectRatio(size: Vec2): number {
    const height = size.y > 0 ? size.y : MIN_SIZE;
    const ratio = size.x / height;

    // Guard against degenerate ratios.
    return Math.min(1000, Math.max(0.001, Math.round(ratio * 1e6) / 1e6));
}

// Applies an aspect ratio to a size, driven by one axis ('x' or 'y') or by the axis
// with the bigger relative deviation from the ratio ('auto').
export function applyAspectRatio(size: Vec2, ratio: number, driven: 'x' | 'y' | 'auto'): Vec2 {
    if (!isFinite(ratio) || ratio <= 0) {
        return size;
    }

    const x = Math.max(MIN_SIZE, Math.round(size.x));
    const y = Math.max(MIN_SIZE, Math.round(size.y));

    let axis = driven;

    if (axis === 'auto') {
        // Drive by the axis that deviates more from the target ratio.
        const devX = Math.abs(x / ratio - y);
        const devY = Math.abs(y * ratio - x);

        axis = devX <= devY ? 'x' : 'y';
    }

    if (axis === 'x') {
        return new Vec2(x, Math.max(MIN_SIZE, Math.round(x / ratio)));
    } else {
        return new Vec2(Math.max(MIN_SIZE, Math.round(y * ratio)), y);
    }
}

// Formats a ratio as a simple fraction like '16:9' when possible, otherwise as a decimal.
export function formatRatio(ratio: number): string {
    if (!isFinite(ratio) || ratio <= 0) {
        return '';
    }

    const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));

    for (let b = 1; b <= 100; b++) {
        const exact = ratio * b;
        const a = Math.round(exact);

        if (a > 0 && Math.abs(exact - a) / exact < 0.005) {
            const d = gcd(a, b);

            return `${a / d}:${b / d}`;
        }
    }

    return `ratio ${ratio.toFixed(2)}`;
}
