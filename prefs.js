// SPDX-License-Identifier: MIT

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const KEYBINDING = 'reshape-window';

export default class RioResizePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: _('Keyboard'),
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Reshape'),
            description: _('Draw a rectangle to resize the focused window.'),
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: _('Shortcut'),
        });
        group.add(row);

        const {button, resetButton, dispose} = createShortcutButton(settings, KEYBINDING);
        row.add_suffix(button);
        row.add_suffix(resetButton);
        row.activatable_widget = button;

        window.connect('close-request', () => {
            dispose();
            return false;
        });

        window.set_default_size(480, 240);
    }
}

/**
 * Simple accelerator capture button.
 *
 * @param {Gio.Settings} settings
 * @param {string} key
 * @returns {{button: Gtk.Button, resetButton: Gtk.Button, dispose: () => void}}
 */
function createShortcutButton(settings, key) {
    const button = new Gtk.Button({
        has_frame: true,
        valign: Gtk.Align.CENTER,
    });

    const resetButton = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: _('Reset to default'),
        has_frame: false,
    });

    let editing = false;
    let savedBinding = null;
    let controller = null;
    let controllerId = 0;
    let controllerTarget = null;
    let disposed = false;

    const updateFromSettings = () => {
        if (editing)
            return;
        const value = settings.get_strv(key)[0];
        if (!value)
            button.set_label(_('Disabled'));
        else
            button.set_label(value);
        resetButton.sensitive = settings.get_user_value(key) !== null;
    };

    const writeBinding = strv => {
        const def = settings.get_default_value(key).deep_unpack();
        if (strv.length === def.length && strv.every((v, i) => v === def[i]))
            settings.reset(key);
        else
            settings.set_strv(key, strv);
    };

    const detachController = () => {
        if (!controller)
            return;
        if (controllerId)
            controller.disconnect(controllerId);
        controllerTarget?.remove_controller(controller);
        controller = null;
        controllerId = 0;
        controllerTarget = null;
    };

    // Leave the Shell binding empty while capturing, otherwise Mutter
    // eats Super+R (and any other already-bound combo) before GTK sees it.
    const finishEditing = (mode, strv) => {
        const restore = savedBinding;
        savedBinding = null;
        editing = false;
        detachController();
        if (mode === 'restore' && restore)
            writeBinding(restore);
        else if (mode === 'clear')
            writeBinding([]);
        else if (mode === 'apply')
            writeBinding(strv);
        updateFromSettings();
    };

    updateFromSettings();
    let settingsChangedId = settings.connect(`changed::${key}`, updateFromSettings);

    resetButton.connect('clicked', () => {
        savedBinding = null;
        finishEditing('keep');
        settings.reset(key);
    });

    button.connect('clicked', () => {
        if (editing) {
            finishEditing('restore');
            return;
        }

        savedBinding = settings.get_strv(key).slice();
        editing = true;
        button.set_label(_('Press a shortcut…'));
        settings.set_strv(key, []);

        controllerTarget = button.get_root() ?? button;
        controller = new Gtk.EventControllerKey();
        controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        controllerTarget.add_controller(controller);

        controllerId = controller.connect('key-pressed', (_ec, keyval, keycode, mask) => {
            mask &= Gtk.accelerator_get_default_mod_mask();

            // Super, Ctrl, and the other modifiers arrive as their own
            // key-press. Wait for the non-modifier key (Super then R).
            if (isModifierKeyval(keyval))
                return Gdk.EVENT_STOP;

            if (mask === 0) {
                switch (keyval) {
                case Gdk.KEY_Escape:
                    finishEditing('restore');
                    return Gdk.EVENT_STOP;
                case Gdk.KEY_BackSpace:
                    finishEditing('clear');
                    return Gdk.EVENT_STOP;
                default:
                    button.set_label(_('Add a modifier'));
                    return Gdk.EVENT_STOP;
                }
            }

            if (!Gtk.accelerator_valid(keyval, mask)) {
                button.set_label(_('Add a modifier'));
                return Gdk.EVENT_STOP;
            }

            const name = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
            if (name)
                finishEditing('apply', [name]);
            else
                finishEditing('restore');
            return Gdk.EVENT_STOP;
        });
    });

    const dispose = () => {
        if (disposed)
            return;
        disposed = true;
        finishEditing('restore');
        if (settingsChangedId) {
            settings.disconnect(settingsChangedId);
            settingsChangedId = 0;
        }
    };

    return {button, resetButton, dispose};
}

/**
 * @param {number} keyval
 * @returns {boolean}
 */
function isModifierKeyval(keyval) {
    switch (keyval) {
    case Gdk.KEY_Shift_L:
    case Gdk.KEY_Shift_R:
    case Gdk.KEY_Control_L:
    case Gdk.KEY_Control_R:
    case Gdk.KEY_Alt_L:
    case Gdk.KEY_Alt_R:
    case Gdk.KEY_Meta_L:
    case Gdk.KEY_Meta_R:
    case Gdk.KEY_Super_L:
    case Gdk.KEY_Super_R:
    case Gdk.KEY_Hyper_L:
    case Gdk.KEY_Hyper_R:
    case Gdk.KEY_ISO_Level3_Shift:
    case Gdk.KEY_ISO_Level5_Shift:
    case Gdk.KEY_Caps_Lock:
    case Gdk.KEY_Shift_Lock:
    case Gdk.KEY_Num_Lock:
    case Gdk.KEY_Scroll_Lock:
        return true;
    default:
        return false;
    }
}
