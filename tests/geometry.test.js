// SPDX-License-Identifier: GPL-2.0-or-later
// node --test tests/geometry.test.js

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    MIN_RUBBERBAND_DEVICE_PX,
    MIN_RUBBERBAND_LOGICAL_PX,
    SIZE_CLAMP_LOGICAL_PX,
    RESHAPEABLE_WINDOW_TYPE_NICKS,
    normalizeRect,
    minRubberbandSize,
    isAcceptableRubberband,
    parseMinSizeResult,
    clampGeometrySize,
    resolveApplyOrigin,
    buildApplyActionOrder,
    reshapeRejectionReason,
    isValidShortcutMask,
} from '../geometry.js';

describe('normalizeRect', () => {
    it('normalizes inverted drag with inclusive size (Shell SelectArea style)', () => {
        assert.deepEqual(
            normalizeRect(100, 200, 50, 80, {inclusive: true}),
            {x: 50, y: 80, width: 51, height: 121});
    });

    it('supports exclusive size when requested', () => {
        assert.deepEqual(
            normalizeRect(10, 10, 20, 30, {inclusive: false}),
            {x: 10, y: 10, width: 10, height: 20});
    });

    it('defaults to inclusive', () => {
        assert.deepEqual(
            normalizeRect(0, 0, 0, 0),
            {x: 0, y: 0, width: 1, height: 1});
    });
});

describe('rubberband thresholds', () => {
    it('exports named constants', () => {
        assert.equal(MIN_RUBBERBAND_DEVICE_PX, 32);
        assert.equal(MIN_RUBBERBAND_LOGICAL_PX, 48);
        assert.equal(SIZE_CLAMP_LOGICAL_PX, 25);
    });

    it('minRubberbandSize uses max of device floor and scaled logical', () => {
        assert.equal(minRubberbandSize(1), 48);
        assert.equal(minRubberbandSize(2), 96);
        assert.equal(minRubberbandSize(0.5), 32); // 24 rounded → device floor 32
    });

    it('isAcceptableRubberband rejects tiny rects', () => {
        assert.equal(isAcceptableRubberband(10, 10, 1), false);
        assert.equal(isAcceptableRubberband(48, 48, 1), true);
        assert.equal(isAcceptableRubberband(47, 48, 1), false);
        assert.equal(isAcceptableRubberband(96, 96, 2), true);
    });
});

describe('parseMinSizeResult', () => {
    it('parses GJS [ok, w, h] success', () => {
        assert.deepEqual(parseMinSizeResult([true, 120, 80]), {
            ok: true, minW: 120, minH: 80,
        });
    });

    it('parses 2-tuple [w, h] out-params only', () => {
        assert.deepEqual(parseMinSizeResult([120, 80]), {
            ok: true, minW: 120, minH: 80,
        });
        assert.deepEqual(parseMinSizeResult([0, 0]), {
            ok: true, minW: 1, minH: 1,
        });
        assert.deepEqual(parseMinSizeResult([-5, -10]), {
            ok: true, minW: 1, minH: 1,
        });
    });

    it('floors zero/negative mins from 3-tuple success', () => {
        assert.deepEqual(parseMinSizeResult([true, 0, 0]), {
            ok: true, minW: 1, minH: 1,
        });
        assert.deepEqual(parseMinSizeResult([true, -3, 50]), {
            ok: true, minW: 1, minH: 50,
        });
        assert.deepEqual(parseMinSizeResult([1, 200, -1]), {
            ok: true, minW: 200, minH: 1,
        });
    });

    it('returns defaults on failure', () => {
        assert.deepEqual(parseMinSizeResult([false, 0, 0]), {
            ok: false, minW: 1, minH: 1,
        });
        assert.deepEqual(parseMinSizeResult(null), {
            ok: false, minW: 1, minH: 1,
        });
        assert.deepEqual(parseMinSizeResult([]), {
            ok: false, minW: 1, minH: 1,
        });
    });
});

describe('clampGeometrySize', () => {
    it('clamps to client min and scaled floor', () => {
        assert.deepEqual(
            clampGeometrySize(10, 10, 100, 50, 1),
            {width: 100, height: 50});
        assert.deepEqual(
            clampGeometrySize(10, 10, 1, 1, 1),
            {width: 25, height: 25});
        assert.deepEqual(
            clampGeometrySize(400, 300, 1, 1, 1),
            {width: 400, height: 300});
    });
});

describe('resolveApplyOrigin', () => {
    it('keeps desired origin when move allowed', () => {
        assert.deepEqual(
            resolveApplyOrigin(true, 10, 20, 1, 2),
            {x: 10, y: 20, pinned: false});
    });

    it('pins to current frame when move disallowed', () => {
        assert.deepEqual(
            resolveApplyOrigin(false, 10, 20, 5, 6),
            {x: 5, y: 6, pinned: true});
    });
});

describe('buildApplyActionOrder', () => {
    it('orders unfullscreen → unmaximize → defer → move_resize', () => {
        assert.deepEqual(
            buildApplyActionOrder({fullscreen: true, maximized: true}),
            ['unmake_fullscreen', 'unmaximize', 'defer', 'move_resize_frame']);
    });

    it('skips defer when no state clear needed', () => {
        assert.deepEqual(
            buildApplyActionOrder({}),
            ['move_resize_frame']);
    });

    it('defers when only maximize flags set', () => {
        assert.deepEqual(
            buildApplyActionOrder({maximizeFlags: 1}),
            ['unmaximize', 'defer', 'move_resize_frame']);
    });
});

describe('reshapeRejectionReason', () => {
    it('rejects missing / OR / chrome types / non-resizable', () => {
        assert.equal(reshapeRejectionReason({missing: true}), 'No focused window');
        assert.equal(
            reshapeRejectionReason({overrideRedirect: true}),
            'Window cannot be reshaped');
        assert.equal(
            reshapeRejectionReason({windowTypeNick: 'desktop'}),
            'Window cannot be reshaped');
        assert.equal(
            reshapeRejectionReason({windowTypeNick: 'dock'}),
            'Window cannot be reshaped');
        assert.equal(
            reshapeRejectionReason({windowTypeNick: 'normal', allowsResize: false}),
            'Window cannot be resized');
    });

    it('allows normal/dialog/utility/modal_dialog', () => {
        for (const nick of RESHAPEABLE_WINDOW_TYPE_NICKS) {
            assert.equal(
                reshapeRejectionReason({windowTypeNick: nick, allowsResize: true}),
                null,
                nick);
        }
    });
});

describe('isValidShortcutMask', () => {
    it('rejects bare keys (mask 0)', () => {
        assert.equal(isValidShortcutMask(0), false);
    });

    it('accepts non-zero modifier masks', () => {
        assert.equal(isValidShortcutMask(1), true);
        assert.equal(isValidShortcutMask(64), true);
    });
});

/**
 * Fake-window call-order unit test for apply planning (issue 18).
 * Mirrors GeometryApplier side-effect order without Shell imports.
 */
describe('fake window apply action order', () => {
    it('records unfullscreen → unmaximize → move_resize for maximized fullscreen', () => {
        const calls = [];
        const window = {
            fullscreen: true,
            maximized: true,
            maximizeFlags: 3,
            allows_resize: () => true,
            allows_move: () => true,
            is_fullscreen: () => window.fullscreen,
            is_maximized: () => window.maximized,
            get_maximize_flags: () => window.maximizeFlags,
            unmake_fullscreen() {
                calls.push('unmake_fullscreen');
                window.fullscreen = false;
            },
            unmaximize() {
                calls.push('unmaximize');
                window.maximized = false;
                window.maximizeFlags = 0;
            },
            move_resize_frame(userOp, x, y, w, h) {
                calls.push(['move_resize_frame', userOp, x, y, w, h]);
            },
            get_min_size: () => [true, 40, 40],
            get_frame_rect: () => ({x: 0, y: 0, width: 800, height: 600}),
        };

        // Simulate GeometryApplier planning + immediate commit path order.
        const order = buildApplyActionOrder({
            fullscreen: window.is_fullscreen(),
            maximized: window.is_maximized(),
            maximizeFlags: window.get_maximize_flags(),
        });
        assert.deepEqual(order, [
            'unmake_fullscreen', 'unmaximize', 'defer', 'move_resize_frame',
        ]);

        for (const step of order) {
            if (step === 'unmake_fullscreen')
                window.unmake_fullscreen();
            else if (step === 'unmaximize')
                window.unmaximize();
            else if (step === 'defer')
                calls.push('defer');
            else if (step === 'move_resize_frame')
                window.move_resize_frame(true, 10, 20, 300, 200);
        }

        assert.deepEqual(calls, [
            'unmake_fullscreen',
            'unmaximize',
            'defer',
            ['move_resize_frame', true, 10, 20, 300, 200],
        ]);
    });
});
