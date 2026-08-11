#!/usr/bin/env bash
# Validate gnome-rio extension packaging and pure logic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

echo "== node --check =="
for f in extension.js reshape.js geometry.js prefs.js; do
  node --check "$f" || fail "syntax $f"
  ok "syntax $f"
done

echo "== metadata.json =="
python3 - <<'PY' || exit 1
import json, sys
m = json.load(open("metadata.json"))
assert m["uuid"] == "gnome-rio@deedles.dev", m["uuid"]
assert "50" in m["shell-version"], m["shell-version"]
assert m["settings-schema"] == "org.gnome.shell.extensions.gnome-rio", m.get("settings-schema")
assert m["name"] == "Rio Resize", m["name"]
print("OK: metadata contract")
PY

echo "== schema compile + gsettings =="
SCHEMA_DIR="$ROOT/schemas"
SCHEMA_XML="$SCHEMA_DIR/org.gnome.shell.extensions.gnome-rio.gschema.xml"
test -f "$SCHEMA_XML" || fail "missing schema xml"
glib-compile-schemas "$SCHEMA_DIR" || fail "glib-compile-schemas"

# settings-schema id and key + Super+r default
grep -q 'id="org.gnome.shell.extensions.gnome-rio"' "$SCHEMA_XML" || fail "schema id"
grep -q 'name="reshape-window"' "$SCHEMA_XML" || fail "reshape-window key"
grep -q "<Super>r" "$SCHEMA_XML" || fail "default Super+r in schema xml"

DEFAULT="$(gsettings --schemadir "$SCHEMA_DIR" get org.gnome.shell.extensions.gnome-rio reshape-window)"
# Accept either ['<Super>r'] or ["<Super>r"] depending on gsettings quoting
echo "$DEFAULT" | grep -Eq "Super>r" || fail "gsettings default was: $DEFAULT"
ok "gsettings reshape-window default: $DEFAULT"

# settings-schema in metadata must match schema id
META_SCHEMA="$(python3 -c 'import json;print(json.load(open("metadata.json"))["settings-schema"])')"
grep -q "id=\"$META_SCHEMA\"" "$SCHEMA_XML" || fail "metadata settings-schema mismatch"
ok "metadata settings-schema matches schema id"

echo "== KEYBINDING / schema key lock =="
# JS KEYBINDING constant must match schema key reshape-window
grep -q "KEYBINDING = 'reshape-window'" extension.js || fail "extension.js KEYBINDING != 'reshape-window'"
grep -q "KEYBINDING = 'reshape-window'" prefs.js || fail "prefs.js KEYBINDING != 'reshape-window'"
ok "KEYBINDING = 'reshape-window' in extension.js and prefs.js"

echo "== unit tests =="
node --test tests/geometry.test.js

echo
echo "All validation checks passed."
