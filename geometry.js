// SPDX-License-Identifier: MIT
// Pure geometry / eligibility helpers (no GObject / Shell imports).
// Safe to import from node --test.

/** Absolute floor for accepting a rubber-band (device pixels). */
export const MIN_RUBBERBAND_DEVICE_PX = 32;

/** Scale-aware rubber-band accept threshold (logical px × scale). */
export const MIN_RUBBERBAND_LOGICAL_PX = 48;

/** Scale-aware size clamp floor when applying geometry (logical px × scale). */
export const SIZE_CLAMP_LOGICAL_PX = 25;

/**
 * Window type nicks (Meta.WindowType) accepted for reshape.
 * Matches whitelist: NORMAL / DIALOG / UTILITY (+ modal dialogs).
 */
export const RESHAPEABLE_WINDOW_TYPE_NICKS = Object.freeze([
    'normal',
    'dialog',
    'modal_dialog',
    'utility',
]);

/**
 * Normalize a drag from start→last into a top-left + size rect.
 * Inclusive (+1) matches GNOME Shell SelectArea getGeometry().
 *
 * @param {number} startX
 * @param {number} startY
 * @param {number} lastX
 * @param {number} lastY
 * @param {{inclusive?: boolean}} [opts]
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function normalizeRect(startX, startY, lastX, lastY, opts = {}) {
    const inclusive = opts.inclusive !== false;
    const x1 = Math.min(startX, lastX);
    const y1 = Math.min(startY, lastY);
    const x2 = Math.max(startX, lastX);
    const y2 = Math.max(startY, lastY);
    const pad = inclusive ? 1 : 0;
    return {
        x: x1,
        y: y1,
        width: Math.max(0, x2 - x1 + pad),
        height: Math.max(0, y2 - y1 + pad),
    };
}

/**
 * @param {number} scaleFactor
 * @returns {number}
 */
export function minRubberbandSize(scaleFactor) {
    const scale = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
    return Math.max(
        MIN_RUBBERBAND_DEVICE_PX,
        Math.round(MIN_RUBBERBAND_LOGICAL_PX * scale));
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} scaleFactor
 * @returns {boolean}
 */
export function isAcceptableRubberband(width, height, scaleFactor) {
    const min = minRubberbandSize(scaleFactor);
    return width >= min && height >= min;
}

/**
 * Parse GJS-style get_min_size() result ([ok, w, h]).
 *
 * @param {unknown} result
 * @returns {{ok: boolean, minW: number, minH: number}}
 */
export function parseMinSizeResult(result) {
    if (!Array.isArray(result) || result.length === 0)
        return {ok: false, minW: 1, minH: 1};

    // 2-tuple [w, h] (out-params only).
    if (result.length === 2 &&
        typeof result[0] === 'number' &&
        typeof result[1] === 'number') {
        return {
            ok: true,
            minW: Math.max(1, result[0]),
            minH: Math.max(1, result[1]),
        };
    }

    // 3-tuple [ok, w, h].
    if (result.length >= 3) {
        const [ok, mw, mh] = result;
        if (ok === true || ok === 1) {
            return {
                ok: true,
                minW: Math.max(1, Number(mw) || 0),
                minH: Math.max(1, Number(mh) || 0),
            };
        }
        return {ok: false, minW: 1, minH: 1};
    }

    return {ok: false, minW: 1, minH: 1};
}

/**
 * Clamp desired size against client min size and a scaled floor.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} minW
 * @param {number} minH
 * @param {number} scaleFactor
 * @returns {{width: number, height: number}}
 */
export function clampGeometrySize(width, height, minW, minH, scaleFactor) {
    const scale = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
    const floor = Math.round(SIZE_CLAMP_LOGICAL_PX * scale);
    const w = Math.max(Number(width) || 0, Math.max(Number(minW) || 1, floor));
    const h = Math.max(Number(height) || 0, Math.max(Number(minH) || 1, floor));
    return {width: w, height: h};
}

/**
 * Decide whether origin should be pinned (move disallowed).
 *
 * @param {boolean} allowsMove
 * @param {number} desiredX
 * @param {number} desiredY
 * @param {number} currentX
 * @param {number} currentY
 * @returns {{x: number, y: number, pinned: boolean}}
 */
export function resolveApplyOrigin(allowsMove, desiredX, desiredY, currentX, currentY) {
    if (allowsMove)
        return {x: desiredX, y: desiredY, pinned: false};
    return {x: currentX, y: currentY, pinned: true};
}

/**
 * Ordered side-effect steps for applying geometry after a drag.
 *
 * @param {{fullscreen?: boolean, maximized?: boolean, maximizeFlags?: number}} flags
 * @returns {string[]}
 */
export function buildApplyActionOrder(flags = {}) {
    const actions = [];
    if (flags.fullscreen)
        actions.push('unmake_fullscreen');
    if (flags.maximized || (flags.maximizeFlags ?? 0) !== 0)
        actions.push('unmaximize');
    // Defer only when state was cleared first.
    if (actions.length > 0)
        actions.push('defer');
    actions.push('move_resize_frame');
    return actions;
}

/**
 * Run planned apply steps. Shared by GeometryApplier and unit tests.
 *
 * @param {string[]} order
 * @param {{
 *   unmake_fullscreen?: () => void,
 *   unmaximize?: () => void,
 *   defer?: () => void,
 *   move_resize_frame: (deferred: boolean) => void,
 *   unknown?: (step: string) => void,
 * }} handlers
 * @returns {boolean} whether move_resize_frame was deferred
 */
export function runApplyActions(order, handlers) {
    let deferred = false;
    for (const step of order) {
        switch (step) {
        case 'unmake_fullscreen':
            handlers.unmake_fullscreen?.();
            break;
        case 'unmaximize':
            handlers.unmaximize?.();
            break;
        case 'defer':
            deferred = true;
            handlers.defer?.();
            break;
        case 'move_resize_frame':
            handlers.move_resize_frame(deferred);
            break;
        default:
            handlers.unknown?.(step);
            break;
        }
    }
    return deferred;
}

/**
 * Human-readable rejection for reshape entry (or null if allowed).
 *
 * @param {{
 *   missing?: boolean,
 *   overrideRedirect?: boolean,
 *   windowTypeNick?: string,
 *   allowsResize?: boolean,
 * }} info
 * @returns {string|null}
 */
export function reshapeRejectionReason(info = {}) {
    if (info.missing)
        return 'No focused window';
    if (info.overrideRedirect)
        return 'Window cannot be reshaped';
    const nick = info.windowTypeNick ?? 'normal';
    if (!RESHAPEABLE_WINDOW_TYPE_NICKS.includes(nick))
        return 'Window cannot be reshaped';
    if (info.allowsResize === false)
        return 'Window cannot be resized';
    return null;
}
