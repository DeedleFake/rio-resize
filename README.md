# GNOME Rio

Plan 9 **rio**-style window reshape for GNOME Shell: draw a rubber-band rectangle and commit a new geometry for the focused window.

This extension only implements **reshape** (rio’s Resize), not the full rio menu (Move / Hide / Delete / New).

## Requirements

- GNOME Shell **50** (tested against 50.x)

## Install

From the repository root:

```bash
# Optional: run packaging / unit checks first
./scripts/validate.sh

# Install into the user extensions directory
mkdir -p ~/.local/share/gnome-shell/extensions
cp -a . ~/.local/share/gnome-shell/extensions/gnome-rio@deedles.dev

# Compile the GSettings schema (required for the shortcut)
glib-compile-schemas ~/.local/share/gnome-shell/extensions/gnome-rio@deedles.dev/schemas
```

Or symlink for development:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -sfn "$(pwd)" ~/.local/share/gnome-shell/extensions/gnome-rio@deedles.dev
glib-compile-schemas schemas
```

Then enable:

```bash
# On Wayland, log out/in or use a nested session to load new extensions.
gnome-extensions enable gnome-rio@deedles.dev
```

On X11 you can often reload Shell with `Alt+F2`, `r`, Enter. On Wayland, restart the session.

Check status:

```bash
gnome-extensions info gnome-rio@deedles.dev
gnome-extensions show gnome-rio@deedles.dev
```

## Usage

1. Focus a resizable window (normal / dialog / utility).
2. Press **Super+R** (default).
3. Drag a rectangle with the **primary mouse button** (crosshair cursor).
4. Release to apply the new size/position.
5. **Escape** cancels with no change. Very small rectangles are ignored.

Non-resizable or invalid windows show a brief on-screen message.

### Input limitation (v1)

Reshape drag is **mouse/pointer only**. Touch and tablet stroke gestures are not supported in v1 (documenting rather than half-implementing). Use a mouse or trackpad pointer.

## Preferences

Open extension preferences to rebind the shortcut (modifier required; bare keys rejected):

```bash
gnome-extensions prefs gnome-rio@deedles.dev
```

Or via **Settings → Extensions → GNOME Rio → Settings**.

You can also change the binding with `gsettings` after install:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/gnome-rio@deedles.dev/schemas \
  set org.gnome.shell.extensions.gnome-rio reshape-window "['<Super>r']"
```

## Behavior notes

- Target is the **focused** window only (no gunsight pick mode in v1).
- Rubber-band is outline-then-commit (not live resize while dragging).
- Rubber-band geometry is **inclusive** (matches Shell SelectArea: `width = max-min+1`).
- Maximized / fullscreen state is cleared first; `move_resize_frame` is **deferred** on an idle so the compositor does not re-apply the old frame.
- If the window disallows move, only size is applied (origin pinned to the current frame).
- Geometry is clamped to the window’s minimum size when available.
- Multi-monitor: coordinates are global stage coords; the overlay covers the full stage.
- Pending deferred apply and OSD actors are cancelled/destroyed on extension disable.

## Validation / tests

```bash
./scripts/validate.sh
# or just unit tests:
node --test tests/geometry.test.js
```

`scripts/validate.sh` checks:

- `node --check` on extension modules
- `metadata.json` uuid / shell-version / settings-schema
- `glib-compile-schemas` + `reshape-window` default Super+r
- pure geometry unit tests

## Layout

| File | Role |
|------|------|
| `metadata.json` | Extension metadata (Shell 50) |
| `extension.js` | Keybinding + lifecycle |
| `reshape.js` | Rubber-band session + deferred apply + OSD |
| `geometry.js` | Pure helpers (rect, clamp, eligibility) |
| `stylesheet.css` | Rubber-band + OSD styles |
| `prefs.js` | Shortcut rebinding UI |
| `schemas/` | GSettings schema for the shortcut |
| `tests/geometry.test.js` | `node --test` unit tests |
| `scripts/validate.sh` | Packaging + test harness |

## License

GPL-2.0-or-later (same family as GNOME Shell extensions).
