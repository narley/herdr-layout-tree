# Herdr Tree: a Herdr Desktop layout

One sidebar list, Local and Remote, with each Claude Code session nested under its space, in Herdr's plain look.

Everything this layout adds to Herdr is in this repo, so it installs on its own. The only other mods it uses ship
with Herdr Desktop. Built against Herdr Desktop 0.1.14.

## Install

```sh
./install.sh
herdr-app do layout.switch --name herdr-tree
```

The script copies `layouts/`, `themes/` and `mods/` into `~/.config/herdr-app` (or `$HERDR_APP_HOME`), and `scripts/`
into `~/.config/herdr`. It saves any files it replaces to `backups/` in the Herdr home first. Mods reload by themselves.

## Claude Code stats

Cards get their numbers from a terminal label written by `scripts/claude-desktop.sh`. On each machine that runs
Claude Code, add this to the status line script, where `$input` holds the JSON Claude passes it:

```sh
{ printf '%s' "$input" | ~/.config/herdr/claude-desktop.sh & } 2>/dev/null
```

It needs `jq`, and does nothing outside a Herdr terminal. Without it, sessions still appear, just without stats.

## Rebuilding

`mods/space-tree` is generated. After changing a file in `tools/space-tree`, run:

```sh
python3 tools/space-tree/build.py tools/space-tree mods/space-tree
```

## Arranging the tree

Drag machines, spaces and sessions to put them in the order you want. Each machine splits into Personal and Work: click a
heading to fold it, and drop a space on a row or heading to move it into that group. Spaces start in Personal. The arrangement
is saved in Herdr's shared settings as `tree.arrange`, so every layout's tree shows the same one.

## What's here

| Path | What it is |
|---|---|
| `layouts/` | The layout, and its picture for the settings screen, if it has one |
| `mods/` | Its sidebar and other mods, including the Close / Delete worktree dialog (`session-actions`) |
| `scripts/` | The stats script |
| `tools/` | Scripts that generate parts of it (not needed to install) |

See `NOTICE.md` for what this derives from.
