#!/usr/bin/env python3
"""Assembles the space-tree mod from Herdr's spaces mod and the claude-cards mod."""
import re, sys
from pathlib import Path
here = Path(sys.argv[1]); out = Path(sys.argv[2])

def arranged(text):
    """A row's own drag code gives way to arrange.js, and anything that stops a mouse event ends a drag."""
    text, n = re.subn(r"      \.on_mouse_move\(\(_e, cx\) => \{\n.*?\n      \}\)\n", "", text, count=1, flags=re.S)
    assert n == 1, "row drag"
    return arranged_stops(text)
def arranged_stops(text):
    return text.replace("cx.stop_propagation()", "(cancelDrag(), cx.stop_propagation())")
ORDER_AT = "    // Simulate the batch so later indexes include earlier moves."
ORDER_NEW = "    out.splice(0, out.length, ...arrangedRows(out, sp.map((w) => w.id)));\n"
FINISH_OLD = '.on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })'
FINISH_NEW = '.on_mouse_up("left", (_e, cx) => { this.pressed = null; finishDrag(); cx.notify(); })\n        .on_hover((on, cx) => { if (!on) { cancelDrag(); cx.notify(); } })'
MAIN_IMPORT = 'import { GROUPS, groupFolded, toggleGroup, machinesInOrder, arrangedRows, finishDrag, cancelDrag, startDrag, dropArea, dropMachine, spaceItem } from "./arrange.js";\n'
cards = (here / "claude-cards.js").read_text().split("\n")
lines = lambda a, b: "\n".join(cards[a - 1:b]) + "\n"
def expect(line, text):
    assert cards[line - 1].startswith(text), (line, cards[line - 1])
for line, text in [(18, "const TUI"), (27, "const SUB_FRESH_S"), (31, "function claudeStats"), (42, "}"), (45, "const tipTokens"), (71, "}"),
                   (74, "const actionInfo"), (85, "}"), (89, "function bgChildren"), (104, "}"), (106, "const age"), (111, "const cacheLeft"),
                   (134, "const clean"), (136, "function leadPanes"), (145, "}"), (147, "function title"), (153, "const RANK"), (156, "const kidStatus"), (159, "};"),
                   (168, "function duration"), (174, "}"), (177, "function icon"), (180, "}"),
                   (194, "  // Stamps"), (209, "  }"), (231, "  since(a)"), (247, "  }"), (275, "  peek(addr)"), (478, "  }")]:
    expect(line, text)
head = '''// Sessions for the space tree: the same cards, stats, folding and hover buttons as claude-cards,
// grouped by space instead of by priority. Built from claude-cards by build.py.
// Stats come from the terminal label `claude.stats`, written by ~/.config/herdr/claude-desktop.sh.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, run, theme, settings, shared, setShared, setAgentOrder, openOverlay } from "herdr";
import { byAddress, cancelDrag, sessionItem, sessionsInOrder } from "./arrange.js";

'''
s = head + lines(18, 27) + "\n" + lines(29, 42) + "\n" + lines(44, 71) + "\n" + lines(73, 85) + "\n" + lines(87, 104) + "\n" + lines(106, 111) + "\n"
s += lines(134, 134) + "\n" + lines(136, 145) + "\n" + lines(147, 153) + lines(154, 159) + "\n" + lines(168, 174) + "\n" + lines(176, 180) + "\n"
s += '''export class Sessions {
  constructor() {
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.bySpace = new Map();
  }

'''
s += lines(194, 209) + "\n" + lines(231, 247) + "\n" + lines(275, 478) + "\n"
s += (here / "sessions_tail.js").read_text()
def sub(text, old, new):
    assert text.count(old) == 1, old[:70]
    return text.replace(old, new)
s = sub(s, "mods/claude-cards/bin.svg", "mods/space-tree/bin.svg")
s = sub(s, """    folded.has(address) ? folded.delete(address) : folded.add(address);
    setShared(COLLAPSED, [...folded]);
""", """    folded.has(address) ? folded.delete(address) : folded.add(address);
    // a parent takes its attached sessions with it; each can still be opened on its own
    for (const k of this.bg?.get(address) ?? []) { if (folded.has(address)) folded.add(k.address); else folded.delete(k.address); }
    setShared(COLLAPSED, [...folded]);
""")
# Under Local or Remote, a nested card needn't name its machine.
s = sub(s, "\n          .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine))))\n        .when(!folded, (el) => el.child(this.details(t, P, k, s, now)))", ")\n        .when(!folded, (el) => el.child(this.details(t, P, k, s, now)))")
s = sub(s, '    const machine = k.address.includes("/") ? k.address.split("/")[0] : null;\n    const selected', "    const selected")
sys.path.insert(0, str(here))
from detached import apply as add_detached
s = add_detached("cards", s)
(out / "sessions.js").write_text(arranged_stops(s))

m = (here / "spaces.js").read_text()
m = sub(m, '''// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.
''', '''// space-tree: one sidebar list, Local and Remote, with each session nested under its space.
// Built by build.py from Herdr's `spaces` mod (avatars, worktrees under their checkout, git,
// click to switch, right-click menu, drag to reorder, machines) and sessions.js (the cards
// from claude-cards). The chevron on a space folds its sessions; folded, it shows how many
// there are and the most urgent state. The buttons on a section and on a space minimise just their own cards.
''')
m = sub(m, 'import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";\n',
 'import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";\nimport { Sessions } from "./sessions.js";\n' + MAIN_IMPORT)
m = sub(m, '''const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
''', '''const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Back from the rail to the width it had.
function unfoldSidebar() {
  setShared("sidebar.collapsed", false);
  run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 304 });
}
''')
m = sub(m, '''    this.git = {}; // where()''', '''    this.sessions = new Sessions();
    this.spaceFolded = new Set(JSON.parse(localStorage.getItem("spaces.folded") ?? "[]"));
    this.remoteFolded = JSON.parse(localStorage.getItem("sections.remoteFolded") ?? "false");
    cx.timer.every(30000, (cx) => cx.notify()); // ages and cache countdowns on the cards
    this.git = {}; // where()''')
m = sub(m, ".child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))", ".child(div().flex_shrink(0).max_w(150).truncate().font_family(\"Helvetica Neue\").font_weight(400).text_color(t.muted).child(w.name))")
a = m.index("  // The rows, under a header per machine once one isn't this computer.\n")
b = m.index("  // Only what's unusual, after the name:")
m = m[:a] + (here / "grouped.js").read_text() + m[b:]
m = sub(m, '''          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }
''', '''          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1())
          .when(!this.spaceFolded.has(w.id) && this.sessions.foldable([w.id]).length > 0, (el) => el.child(this.spaceMinAll(w, t)))
          .when(this.sessions.count(w.id) > 0, (el) => el.child(this.spaceFold(w, t))),
      );
  }

  // Minimises or expands every card in this space. Row presses switch space, so it stops its own.
  spaceMinAll(w, t) {
    const stop = (_e, cx) => cx.stop_propagation();
    return div().id(`space-min-all-${w.id}`).flex_none().on_mouse_down("left", stop).on_mouse_up("left", stop)
      .child(this.sessions.minAllButton(w.id, this.sessions.foldable([w.id]), t));
  }

  // Folds a space's sessions. Row presses switch space, so this one stops its own.
  spaceFold(w, t) {
    const S = this.sessions;
    const folded = this.spaceFolded.has(w.id);
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex().id(`space-fold-${w.id}`).h(20).flex_none().px(3).gap(4).items_center().rounded(4).text_size(11).text_color(t.dim)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(folded ? "Show this space's sessions" : "Hide this space's sessions")
      .on_mouse_down("left", stop).on_mouse_up("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggleSpace(w.id, cx); })
      .when(folded, (el) => el.child(S.status(t, { status: S.topStatus(w.id) }, true)).child(String(S.count(w.id))))
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none());
  }
''')
a = m.index("    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)\n")
m = m[:a] + '''    this.sessions.prepare(sp);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(v_flex().id("space-tree").flex_1().min_h(0).px(collapsed ? 0 : 8).pt(collapsed ? 6 : 0).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)))
      // On the macOS rail the traffic lights cover the header's own button.
      .when(collapsed, (el) => el.child(h_flex().h(28).flex_none().items_center().justify_center()
        .child(div().id("collapse").text_size(13).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(unfoldSidebar).child("»"))));
  }
}
'''
m = sub(m, ORDER_AT, ORDER_NEW + ORDER_AT)
m = sub(m, FINISH_OLD, FINISH_NEW)
m = arranged(m)
(out / "main.js").write_text(m)
(out / "arrange.js").write_text((here / "arrange.js").read_text())
(out / "mod.json").write_text('{ "place": "none", "title": "Spaces and sessions" }\n')
print("built", out)
