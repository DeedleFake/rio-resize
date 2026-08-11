// SPDX-License-Identifier: GPL-2.0-or-later

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    createFlashMessage,
    GeometryApplier,
    rejectionForWindow,
    ReshapeSession,
} from './reshape.js';

const KEYBINDING = 'reshape-window';

export default class RioResizeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._flash = createFlashMessage();
        this._applier = new GeometryApplier(msg => this._flash.show(msg));
        this._session = null;

        Main.wm.addKeybinding(
            KEYBINDING,
            this._settings,
            Meta.KeyBindingFlags.PER_WINDOW,
            Shell.ActionMode.NORMAL,
            this._onReshape.bind(this));
    }

    disable() {
        Main.wm.removeKeybinding(KEYBINDING);

        if (this._session) {
            this._session.destroy();
            this._session = null;
        }

        if (this._applier) {
            this._applier.destroy();
            this._applier = null;
        }

        if (this._flash) {
            this._flash.destroy();
            this._flash = null;
        }

        this._settings = null;
    }

    /**
     * @param {Meta.Display} _display
     * @param {Meta.Window} window
     * @param {Clutter.Event} _event
     * @param {Meta.KeyBinding} _binding
     */
    _onReshape(_display, window, _event, _binding) {
        if (this._session)
            return;

        const reason = rejectionForWindow(window);
        if (reason) {
            this._flash.show(reason);
            return;
        }

        const session = new ReshapeSession(
            window,
            this._applier,
            msg => this._flash.show(msg),
            () => {
                if (this._session === session)
                    this._session = null;
            });

        if (!session.begin()) {
            // begin() always destroy()s on failure (terminal).
            this._flash.show('Could not start reshape');
            return;
        }

        this._session = session;
    }
}
