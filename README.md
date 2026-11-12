# Herdr Tree: a Herdr Desktop layout

One sidebar list, Local and Remote, with each Claude Code session nested under its space, in Herdr's plain look.

Everything this layout adds to Herdr is in this repo, so it installs on its own. The only other mods it uses ship
with Herdr Desktop. Built against Herdr Desktop 0.1.14.

## Install

```sh
./install.sh
herdr-app do layout.switch --name herdr-tree
```

The script copies `layouts/`, `themes/`, `mods/` and `programs.json` into `~/.config/herdr-app` (or `$HERDR_APP_HOME`), and `scripts/`
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

## Terminals in the tree

Plain terminals (a shell, or a program started from one, not an agent) are counted on each space's
`>_` button, and listed under the space's cards as a folded `TERMINALS 3 · 1 busy` line. Open it for
one row per terminal: its folder, its tab, what it's running (or `idle`), and for how long. Click a row
to go there; hover it for Close. Terminals idle for 3 hours or more are dimmed, and the line offers
`N idle` (click twice) to close them all.

Busy or idle comes from Herdr. The command itself comes from the terminal's title, so it shows when
the shell sets the title to the running command, for example in zsh:

```zsh
title_run()  { print -n -- "\e]2;${${1//[[:cntrl:]]/ }[1,80]}\a"; }
title_idle() { print -n -- "\e]2;\a"; }
autoload -Uz add-zsh-hook
add-zsh-hook preexec title_run
add-zsh-hook precmd title_idle
```

Without it a busy terminal shows the program's name (`node`, `ssh`) instead.

## Arranging the tree

Drag machines, spaces and sessions to put them in the order you want. Each machine splits into Personal and Work: click a
heading to fold it, and drop a space on a row or heading to move it into that group. Spaces start in Personal. The arrangement
is saved in Herdr's shared settings as `tree.arrange`, so every layout's tree shows the same one.

A new space joins the group of the space showing when it's made, if that's on the same machine. The `>_` button on a space
opens Herdr's new-tab menu for that space: a terminal or any installed agent.

## Claude in the new-tab menu

`programs.json` adds **Claude (personal)** and **Claude (work)** to Herdr's new-tab menu (the `+` in the tab bar, and `>_` on a space in the tree). They run the
shell aliases `ccp` and `ccw` from `~/.zshrc` on the machine the space is on, which start Claude Code with
`~/.claude-personal` or `~/.claude-work` as its config; on a machine without them they start nothing. The install
script adds the two entries to any `programs.json` already in the Herdr home, keeping its others.

## Background sessions beside their session

When a Claude session in a Herdr pane starts background sessions (`claude --bg`), `scripts/claude-bg-panes.py` shows
each one beside it: the session keeps the left, and its background sessions stack evenly in a column on the right, each
running `claude attach <id>`. In the tree, their cards nest under the session. It's a Claude Code hook, so add it to the `hooks` in each Claude config's
`settings.json` on every machine that runs sessions:

```json
"PostToolUse": [
  { "matcher": "Bash", "hooks": [{ "type": "command", "command": "python3 -I ~/.config/herdr/claude-bg-panes.py", "timeout": 30 }] }
]
```

It only acts on background sessions Claude starts itself; `claude --bg` typed in a plain shell opens nothing. Problems go
to `~/.cache/herdr-claude/bg-panes.log`.

## What's here

| Path | What it is |
|---|---|
| `layouts/` | The layout, and its picture for the settings screen, if it has one |
| `mods/` | Its sidebar and other mods, including the Close / Delete worktree dialog (`session-actions`) |
| `scripts/` | The stats script and the background-session hook |
| `programs.json` | The two Claude entries for the new-tab menu |
| `tools/` | Scripts that generate parts of it (not needed to install) |

See `NOTICE.md` for what this derives from.
