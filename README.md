# pi zellij tab status

A small pi extension that renames the current Zellij tab with a status icon:

- ⏳ working
- 🔴 waiting
- ✅ done

## Usage

Load the extension directly:

```bash
pi -e ./index.ts
```

Install this repo as a pi package:

```bash
pi install .
```

Or, after publishing, install it from npm or git:

```bash
pi install npm:pi-zellij-tab-status
# or
pi install git:github.com/<you>/pi-zellij-tab-status
```

Or copy it into your normal pi extensions directory:

```bash
cp index.ts ~/.pi/agent/extensions/zellij-tab-status.ts
```

## Behavior

- `session_start` → `🔴 <label>`
- `agent_start` → `⏳ <label>`
- `agent_end` → `✅ <label>`
- after a short delay, `done` falls back to `🔴 <label>`
- `session_shutdown` removes the icon and restores just `<label>`

The label is chosen in this order:

1. `PI_ZELLIJ_TAB_LABEL`
2. pi session name
3. current directory name

## Optional environment variables

```bash
export PI_ZELLIJ_TAB_LABEL="review schema"
export PI_ZELLIJ_DONE_MS=3000
```

- `PI_ZELLIJ_TAB_LABEL` overrides the tab label text.
- `PI_ZELLIJ_DONE_MS` controls how long `done` stays visible before switching back to `waiting`.

## Manual refresh command

Inside pi you can run:

```text
/zellij-tab-status
/zellij-tab-status refresh
/zellij-tab-status working
/zellij-tab-status waiting
/zellij-tab-status done
/zellij-tab-status clear
```

## Zellij commands used

The extension uses the same Zellij flow as the shell snippets below.

```bash
# Detect the tab ID for the current pane
TAB_ID="$(
  zellij action list-panes --tab --json | node -e '
const fs = require("fs");
const paneId = Number(process.env.ZELLIJ_PANE_ID || -1);
const panes = JSON.parse(fs.readFileSync(0, "utf8"));
const pane = panes.find(p => p.id === paneId && !p.is_plugin);
if (pane) process.stdout.write(String(pane.tab_id));
'
)"
```

```bash
# Helper for reliable tab renaming
rename_zellij_tab() {
  local state="$1"
  local label="$2"
  local icon=""

  case "$state" in
    working)  icon="$(printf '\342\217\263')" ;;    # ⏳
    awaiting) icon="$(printf '\360\237\224\264')" ;; # 🔴
    done)     icon="$(printf '\342\234\205')" ;;    # ✅
    *) return 1 ;;
  esac

  if [ -n "$TAB_ID" ]; then
    zellij action rename-tab --tab-id "$TAB_ID" "$icon $label"
  fi
}
```

Usage:

```bash
rename_zellij_tab working "review schema"
rename_zellij_tab awaiting "debug build"
rename_zellij_tab done "review schema"
```
