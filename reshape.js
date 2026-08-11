// SPDX-License-Identifier: MIT

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    buildApplyActionOrder,
    clampGeometrySize,
    isAcceptableRubberband,
    normalizeRect,
    parseMinSizeResult,
    resolveApplyOrigin,
    reshapeRejectionReason,
} from './geometry.js';

/** Flash message duration in ms. */
const MESSAGE_FADE_TIME = 2000;

/**
 * Map Meta.WindowType enum value to geometry.js nick strings.
 *
 * @param {Meta.WindowType} type
 * @returns {string}
 */
export function windowTypeNick(type) {
    const map = {
        [Meta.WindowType.NORMAL]: 'normal',
        [Meta.WindowType.DIALOG]: 'dialog',
        [Meta.WindowType.MODAL_DIALOG]: 'modal_dialog',
        [Meta.WindowType.UTILITY]: 'utility',
        [Meta.WindowType.DESKTOP]: 'desktop',
        [Meta.WindowType.DOCK]: 'dock',
        [Meta.WindowType.TOOLBAR]: 'toolbar',
        [Meta.WindowType.MENU]: 'menu',
        [Meta.WindowType.SPLASHSCREEN]: 'splashscreen',
        [Meta.WindowType.DROPDOWN_MENU]: 'dropdown_menu',
        [Meta.WindowType.POPUP_MENU]: 'popup_menu',
        [Meta.WindowType.TOOLTIP]: 'tooltip',
        [Meta.WindowType.NOTIFICATION]: 'notification',
        [Meta.WindowType.COMBO]: 'combo',
        [Meta.WindowType.DND]: 'dnd',
        [Meta.WindowType.OVERRIDE_OTHER]: 'override_other',
    };
    return map[type] ?? 'unknown';
}

/**
 * @param {Meta.Window|null|undefined} window
 * @returns {boolean}
 */
export function isWindowAlive(window) {
    if (!window)
        return false;
    try {
        return window.get_monitor() >= 0;
    } catch (_e) {
        return false;
    }
}

/**
 * Eligibility message for a Meta.Window, or null if reshape is allowed.
 *
 * @param {Meta.Window|null|undefined} window
 * @returns {string|null}
 */
export function rejectionForWindow(window) {
    if (!window)
        return reshapeRejectionReason({missing: true});

    let overrideRedirect = false;
    try {
        overrideRedirect = window.is_override_redirect();
    } catch (_e) {
        overrideRedirect = true;
    }

    return reshapeRejectionReason({
        overrideRedirect,
        windowTypeNick: windowTypeNick(window.get_window_type()),
        allowsResize: window.allows_resize(),
    });
}

/**
 * Applies geometry with unmaximize/fullscreen handling and deferred commit.
 *
 * Pending work stores the full target geometry. cancel()/destroy() and a new
 * apply() flush any pending commit synchronously so unmaximize is never left
 * without a following move_resize_frame.
 */
export class GeometryApplier {
    /**
     * @param {(message: string) => void} flashMessage
     */
    constructor(flashMessage) {
        this._flashMessage = flashMessage;
        this._idleId = 0;
        /** @type {{window: Meta.Window, x: number, y: number, width: number, height: number}|null} */
        this._pending = null;
    }

    /**
     * @param {Meta.Window} window
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     */
    apply(window, x, y, width, height) {
        // Flush any prior deferred apply (after its unmaximize already ran)
        // before starting a new one — never drop a pending move_resize.
        this.flushPending();

        try {
            if (!isWindowAlive(window)) {
                this._flashMessage?.('Window closed');
                return;
            }
            if (!window.allows_resize()) {
                this._flashMessage?.('Window cannot be resized');
                return;
            }

            // Shared planner with unit tests — production order cannot drift.
            const order = buildApplyActionOrder({
                fullscreen: window.is_fullscreen(),
                maximized: window.is_maximized(),
                maximizeFlags: window.get_maximize_flags(),
            });

            let deferred = false;
            for (const step of order) {
                switch (step) {
                case 'unmake_fullscreen':
                    window.unmake_fullscreen();
                    break;
                case 'unmaximize':
                    window.unmaximize();
                    break;
                case 'defer':
                    // Unmaximize/fullscreen are async; commit on idle so the
                    // compositor does not re-apply the old maximized frame.
                    deferred = true;
                    break;
                case 'move_resize_frame':
                    if (deferred) {
                        this._pending = {window, x, y, width, height};
                        this._idleId = GLib.idle_add(
                            GLib.PRIORITY_DEFAULT_IDLE,
                            () => {
                                this._idleId = 0;
                                this._flushPendingNow();
                                return GLib.SOURCE_REMOVE;
                            });
                    } else {
                        this._commitMoveResize(window, x, y, width, height);
                    }
                    break;
                default:
                    console.error(`[rio-resize] unknown apply step: ${step}`);
                    break;
                }
            }
        } catch (e) {
            console.error('[rio-resize] apply failed:', e);
            this._flashMessage?.('Could not reshape window');
        }
    }

    /**
     * Remove the idle source (if any) and synchronously commit any pending
     * geometry. Used when starting a new apply, on cancel, and on destroy.
     */
    flushPending() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        this._flushPendingNow();
    }

    /**
     * Alias kept for call sites that mean "tear down deferred work".
     * Always flushes so unmaximize is not left without move_resize.
     */
    cancel() {
        this.flushPending();
    }

    destroy() {
        this.flushPending();
        this._flashMessage = null;
    }

    _flushPendingNow() {
        const pending = this._pending;
        this._pending = null;
        if (!pending)
            return;
        try {
            this._commitMoveResize(
                pending.window,
                pending.x,
                pending.y,
                pending.width,
                pending.height);
        } catch (e) {
            console.error('[rio-resize] move_resize failed:', e);
            this._flashMessage?.('Could not reshape window');
        }
    }

    /**
     * @param {Meta.Window} window
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     */
    _commitMoveResize(window, x, y, width, height) {
        if (!isWindowAlive(window)) {
            this._flashMessage?.('Window closed');
            return;
        }
        if (!window.allows_resize()) {
            this._flashMessage?.('Window cannot be resized');
            return;
        }

        // If move is disallowed, pin origin to the current frame top-left.
        let applyX = x;
        let applyY = y;
        try {
            if (!window.allows_move()) {
                const frame = window.get_frame_rect();
                const origin = resolveApplyOrigin(
                    false, x, y, frame.x, frame.y);
                applyX = origin.x;
                applyY = origin.y;
            }
        } catch (_e) {
            // keep desired origin
        }

        let minW = 1;
        let minH = 1;
        try {
            const parsed = parseMinSizeResult(window.get_min_size());
            minW = parsed.minW;
            minH = parsed.minH;
        } catch (_e) {
            // keep defaults
        }

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const {width: finalW, height: finalH} =
            clampGeometrySize(width, height, minW, minH, scale);

        window.move_resize_frame(true, applyX, applyY, finalW, finalH);
    }
}

/**
 * Runs one rio-style rubber-band reshape session for a single window.
 * Outline-then-commit: geometry is applied only on button release.
 *
 * v1 input: pointer (mouse) only — touch is not supported (see README).
 */
export class ReshapeSession {
    /**
     * @param {Meta.Window} window
     * @param {GeometryApplier} applier
     * @param {(message: string) => void} flashMessage
     * @param {() => void} [onEnded]
     */
    constructor(window, applier, flashMessage, onEnded = null) {
        this._window = window;
        this._applier = applier;
        this._flashMessage = flashMessage;
        this._onEnded = onEnded;

        this._overlay = null;
        this._rubberband = null;
        this._grab = null;
        this._signalId = 0;
        this._unmanagedId = 0;
        this._dragging = false;
        this._startX = 0;
        this._startY = 0;
        this._lastX = 0;
        this._lastY = 0;
        this._destroyed = false;
    }

    /**
     * Begin the session. Returns false if setup failed (always cleaned up).
     *
     * @returns {boolean}
     */
    begin() {
        if (this._destroyed)
            return false;

        if (!isWindowAlive(this._window)) {
            this.destroy();
            return false;
        }

        try {
            this._overlay = new St.Widget({
                name: 'rio-resize-reshape-overlay',
                reactive: true,
                can_focus: true,
                visible: true,
                x: 0,
                y: 0,
            });
            this._overlay.set_size(global.stage.width, global.stage.height);
            this._overlay.add_constraint(new Clutter.BindConstraint({
                source: global.stage,
                coordinate: Clutter.BindCoordinate.ALL,
            }));

            this._rubberband = new St.Widget({
                style_class: 'rio-resize-rubberband',
                visible: false,
                x: -10,
                y: -10,
                width: 0,
                height: 0,
            });
            this._overlay.add_child(this._rubberband);
            Main.uiGroup.add_child(this._overlay);

            // Shell 50: pushModal returns a grab object (always truthy on
            // success paths). Treat exceptions / post-grab setup failure as
            // the real error cases; still pop/cleanup via destroy().
            this._grab = Main.pushModal(this._overlay);

            try {
                try {
                    this._overlay.set_cursor_type(Clutter.CursorType.CROSSHAIR);
                } catch (_e) {
                    // optional
                }

                this._overlay.grab_key_focus();
                this._signalId = this._overlay.connect(
                    'captured-event',
                    this._onCapturedEvent.bind(this));

                this._unmanagedId = this._window.connect(
                    'unmanaged',
                    () => this.cancel());
            } catch (e) {
                console.error('[rio-resize] reshape begin setup failed:', e);
                this.destroy();
                return false;
            }

            return true;
        } catch (e) {
            console.error('[rio-resize] reshape begin failed:', e);
            this.destroy();
            return false;
        }
    }

    cancel() {
        this.destroy();
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        if (this._unmanagedId && this._window) {
            try {
                this._window.disconnect(this._unmanagedId);
            } catch (_e) {
                // window may already be gone
            }
            this._unmanagedId = 0;
        }

        if (this._signalId && this._overlay) {
            try {
                this._overlay.disconnect(this._signalId);
            } catch (_e) {
                // ignore
            }
            this._signalId = 0;
        }

        try {
            this._overlay?.set_cursor_type(Clutter.CursorType.DEFAULT);
        } catch (_e) {
            // ignore
        }

        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (_e) {
                // grab already released
            }
            this._grab = null;
        }

        this._cleanupActors();
        this._window = null;

        const onEnded = this._onEnded;
        this._onEnded = null;
        try {
            onEnded?.();
        } catch (_e) {
            // ignore listener errors
        }
    }

    _cleanupActors() {
        this._rubberband = null;
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
    }

    /**
     * @param {Clutter.Actor} _actor
     * @param {Clutter.Event} event
     */
    _onCapturedEvent(_actor, event) {
        const type = event.type();

        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                this.cancel();
            return Clutter.EVENT_STOP;
        }

        const [x, y] = global.get_pointer();

        if (type === Clutter.EventType.BUTTON_PRESS) {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
                this.cancel();
                return Clutter.EVENT_STOP;
            }

            this._dragging = true;
            this._startX = Math.floor(x);
            this._startY = Math.floor(y);
            this._lastX = this._startX;
            this._lastY = this._startY;
            this._drawRubberband();
            return Clutter.EVENT_STOP;
        }

        if (!this._dragging)
            return Clutter.EVENT_STOP;

        if (type === Clutter.EventType.MOTION) {
            this._lastX = Math.floor(x);
            this._lastY = Math.floor(y);
            this._drawRubberband();
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_RELEASE) {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_STOP;

            this._lastX = Math.floor(x);
            this._lastY = Math.floor(y);
            this._dragging = false;

            const geom = normalizeRect(
                this._startX, this._startY, this._lastX, this._lastY,
                {inclusive: true});
            const window = this._window;
            const applier = this._applier;

            this.destroy();

            if (!isWindowAlive(window)) {
                this._flashMessage?.('Window closed');
                return Clutter.EVENT_STOP;
            }

            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            if (!isAcceptableRubberband(geom.width, geom.height, scale)) {
                // Tiny rectangle: cancel with no geometry change.
                return Clutter.EVENT_STOP;
            }

            try {
                applier.apply(window, geom.x, geom.y, geom.width, geom.height);
            } catch (e) {
                console.error('[rio-resize] apply threw:', e);
                this._flashMessage?.('Could not reshape window');
            }
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    _drawRubberband() {
        if (!this._rubberband)
            return;
        const geom = normalizeRect(
            this._startX, this._startY, this._lastX, this._lastY,
            {inclusive: true});
        this._rubberband.set_position(geom.x, geom.y);
        this._rubberband.set_size(
            Math.max(geom.width, 1),
            Math.max(geom.height, 1));
        this._rubberband.visible = true;
    }
}

/**
 * Create flash OSD controller with explicit teardown for extension disable.
 *
 * @returns {{show: (message: string) => void, destroy: () => void}}
 */
export function createFlashMessage() {
    let text = null;
    let destroyed = false;

    function destroy() {
        destroyed = true;
        if (text) {
            text.remove_all_transitions();
            text.destroy();
            text = null;
        }
    }

    function show(message) {
        if (destroyed)
            return;

        if (!text) {
            text = new St.Label({
                style_class: 'rio-resize-message',
                text: message,
            });
            Main.uiGroup.add_child(text);
        } else {
            text.remove_all_transitions();
            text.text = message;
        }

        text.opacity = 255;

        // Prefer monitor under pointer; fall back to primary.
        const [px, py] = global.get_pointer();
        const monitor =
            Main.layoutManager.monitors.find(m =>
                px >= m.x && px < m.x + m.width &&
                py >= m.y && py < m.y + m.height) ??
            Main.layoutManager.primaryMonitor ??
            Main.layoutManager.monitors[0];

        if (!monitor) {
            // Do not leak the actor if we cannot place it.
            if (text) {
                text.remove_all_transitions();
                text.destroy();
                text = null;
            }
            return;
        }

        // Force a preferred-size query so width/height are non-zero before centering.
        const [, natW] = text.get_preferred_width(-1);
        const [, natH] = text.get_preferred_height(natW);
        const w = Math.max(text.width, natW, 1);
        const h = Math.max(text.height, natH, 1);

        text.set_position(
            monitor.x + Math.floor(monitor.width / 2 - w / 2),
            monitor.y + Math.floor(monitor.height / 2 - h / 2));

        text.ease({
            opacity: 0,
            duration: MESSAGE_FADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (text) {
                    text.destroy();
                    text = null;
                }
            },
        });
    }

    return {show, destroy};
}
