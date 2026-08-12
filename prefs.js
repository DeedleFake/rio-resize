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
            title: _('General'),
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Keyboard shortcut'),
            description: _('Activate rio-style rubber-band reshape for the focused window'),
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: _('Reshape window'),
            subtitle: _('Default: Super+R. Click the button, then press a new shortcut (modifier required). Backspace clears.'),
        });
        group.add(row);

        const {button, dispose} = createShortcutButton(settings, KEYBINDING);
        row.add_suffix(button);
        row.activatable_widget = button;

        window.connect('close-request', () => {
            dispose();
            return false;
        });

        window.set_default_size(520, 280);
    }
}

/**
 * Simple accelerator capture button.
 *
 * @param {Gio.Settings} settings
 * @param {string} key
 * @returns {{button: Gtk.Button, dispose: () => void}}
 */
function createShortcutButton(settings, key) {
    const button = new Gtk.Button({
        has_frame: true,
        valign: Gtk.Align.CENTER,
    });

    const setLabelFromSettings = () => {
        const value = settings.get_strv(key)[0];
        if (!value)
            button.set_label(_('Disabled'));
        else
            button.set_label(value);
    };

    setLabelFromSettings();
    let settingsChangedId = settings.connect(`changed::${key}`, setLabelFromSettings);
    let disposed = false;

    let editing = false;
    let controller = null;
    let controllerId = 0;

    const stopEditing = () => {
        editing = false;
        if (controller) {
            if (controllerId)
                controller.disconnect(controllerId);
            button.remove_controller(controller);
            controller = null;
            controllerId = 0;
        }
        setLabelFromSettings();
    };

    button.connect('clicked', () => {
        if (editing) {
            stopEditing();
            return;
        }

        editing = true;
        button.set_label(_('Enter shortcut…'));

        controller = new Gtk.EventControllerKey();
        button.add_controller(controller);

        controllerId = controller.connect('key-pressed', (_ec, keyval, keycode, mask) => {
            mask &= Gtk.accelerator_get_default_mod_mask();

            // Super, Ctrl, and the other modifiers arrive as their own
            // key-press. Wait for the non-modifier key (Super then R).
            if (isModifierKeyval(keyval))
                return Gdk.EVENT_STOP;

            if (mask === 0) {
                switch (keyval) {
                case Gdk.KEY_Escape:
                    stopEditing();
                    return Gdk.EVENT_STOP;
                case Gdk.KEY_BackSpace:
                    settings.set_strv(key, []);
                    stopEditing();
                    return Gdk.EVENT_STOP;
                default:
                    button.set_label(_('Need a modifier…'));
                    return Gdk.EVENT_STOP;
                }
            }

            if (!Gtk.accelerator_valid(keyval, mask)) {
                button.set_label(_('Need a modifier…'));
                return Gdk.EVENT_STOP;
            }

            const name = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
            if (name)
                settings.set_strv(key, [name]);
            stopEditing();
            return Gdk.EVENT_STOP;
        });
    });

    const dispose = () => {
        if (disposed)
            return;
        disposed = true;
        stopEditing();
        if (settingsChangedId) {
            settings.disconnect(settingsChangedId);
            settingsChangedId = 0;
        }
    };

    return {button, dispose};
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
