// Plain terminals (a shell, or a program started from one; not an agent), per space, for the tree
// views. Shared by every layout's tree (copied in by tree-view/build.py and herdr-tree/build.py):
//   - count(w): how many a space has, shown on its >_ button;
//   - rowsFor(w, t): a folded "TERMINALS 3 · 1 busy" line under the space's cards that opens into
//     one row per terminal (folder, tab name or number, what it runs or how long it has been idle). Click a row to
//     go there; hover for Close. Terminals idle for IDLE_STALE are dimmed, and the line offers
//     "close idle" (click twice) for them.
// Busy or idle comes from Herdr (the program in front of the shell); the command line itself from
// the terminal's title, which shell/title.zsh (workflows repo) sets while a command runs.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { panes, run, shared, setShared } from "herdr";

const SINCE = "terminals.since";          // terminal -> { sig, at }: when it last went busy or idle
const OPEN = "terminals.open";            // localStorage: spaces whose list is open
export const IDLE_STALE = 3 * 3600 * 1000;

const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop() || "/";
export function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export class Terminals {
  init(_props, cx) {
    this.open = new Set(JSON.parse(localStorage.getItem(OPEN) ?? "[]"));
    this.hovered = null;
    this.arming = null;                   // space whose "close idle" waits for its second click
    this.bySpace = new Map();
    cx?.timer?.every(30000, (cx) => cx.notify());   // idle times move on
  }

  // Once per render, before count / rowsFor.
  prepare(sp) {
    this.open ??= new Set();
    const tabOf = new Map();
    for (const s of sp) (s.tabs ?? []).forEach((tb, i) => tabOf.set(tb.id, { s, i, tb }));
    const was = shared(SINCE) ?? {};
    const since = {};
    const now = Date.now();
    let dirty = false;
    this.bySpace = new Map();
    for (const p of panes()) {
      const at = tabOf.get(p.tab);
      if (!p.terminal || !at || p.program?.agent || p.status) continue;
      const busy = !p.program?.shell;
      const titled = p.title && p.title !== p.terminal && !p.terminal.endsWith(`/${p.title}`);
      const what = busy ? (titled ? p.title : p.program?.name || "running") : null;
      const sig = busy ? `busy:${what}` : "idle";
      const prev = was[p.terminal];
      since[p.terminal] = prev?.sig === sig ? prev : { sig, at: now };
      if (prev?.sig !== sig) dirty = true;
      const row = { pane: p.pane, terminal: p.terminal, space: at.s, tab: at.i + 1, tabName: at.tb.named ? at.tb.name : null, folder: base(p.cwd), branch: p.branch, busy, what, at: since[p.terminal].at, focused: p.focused };
      row.stale = !busy && now - row.at > IDLE_STALE && prev?.sig === sig;
      if (!this.bySpace.has(at.s.id)) this.bySpace.set(at.s.id, []);
      this.bySpace.get(at.s.id).push(row);
    }
    if (dirty || Object.keys(was).length !== Object.keys(since).length) setShared(SINCE, since);
  }

  list(w) { return this.bySpace.get(w.id) ?? []; }
  count(w) { return this.list(w).length; }

  toggle(w, cx) {
    this.open.has(w.id) ? this.open.delete(w.id) : this.open.add(w.id);
    localStorage.setItem(OPEN, JSON.stringify([...this.open]));
    cx.notify();
  }

  go(r) {
    run("space.select", { id: r.space.id });
    run("pane.focus", { pane: r.pane });
  }

  // The folded line, and the rows when it's open. [] when the space has none.
  rowsFor(w, t) {
    const rows = this.list(w);
    if (!rows.length) return [];
    const open = this.open.has(w.id);
    const busy = rows.filter((r) => r.busy).length;
    const stale = rows.filter((r) => r.stale);
    const armed = this.arming === w.id;
    const stop = (_e, cx) => cx.stop_propagation();
    const head = h_flex().id(`terms-${w.id}`).h(22).flex_none().px(6).gap(6).items_center().text_size(10.5).text_color(t.dim)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_mouse_up("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(w, cx); })
      .child(svg("mods/workspace-chrome/terminal.svg").size(11).flex_none())
      .child(div().flex_none().font_semibold().child(`TERMINALS ${rows.length}`))
      .when(busy > 0, (el) => el.child(div().flex_none().text_color(t.working ?? t.accent).child(`· ${busy} busy`)))
      .child(div().flex_1())
      .when(stale.length > 0, (el) => el.child(
        div().id(`terms-close-idle-${w.id}`).flex_none().px(4).rounded(3).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.blocked))
          .tooltip(armed ? `Click again to close ${stale.length} terminal${stale.length === 1 ? "" : "s"} idle for 3h or more` : "Close terminals idle for 3h or more")
          .on_mouse_down("left", stop).on_mouse_up("left", stop)
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (!armed) { this.arming = w.id; cx.notify(); return; }
            this.arming = null;
            for (const r of stale) run("pane.close", { pane: r.pane });
            cx.notify();
          })
          .child(armed ? `close ${stale.length} idle?` : `${stale.length} idle`)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none());
    return [head, ...(open ? rows.map((r) => this.row(r, t)) : [])];
  }

  row(r, t) {
    const hover = this.hovered === r.terminal;
    const stop = (_e, cx) => cx.stop_propagation();
    const age = ago(Date.now() - r.at);
    const label = r.busy ? r.what : "idle";
    return h_flex().id(`term-${r.terminal}`).h(22).flex_none().pl(8).pr(4).gap(6).items_center().text_size(11)
      .when(r.focused, (el) => el.bg(t.selected))
      .when(r.stale, (el) => el.opacity(0.55))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => { this.hovered = on ? r.terminal : this.hovered === r.terminal ? null : this.hovered; cx.notify(); })
      .on_mouse_down("left", stop).on_mouse_up("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.go(r); })
      .tooltip(`${r.folder}${r.branch ? ` (${r.branch})` : ""} · tab ${r.tab}${r.tabName ? ` "${r.tabName}"` : ""} · ${r.busy ? `running ${r.what}` : "idle"} for ${age}`)
      .child(div().size(6).rounded(3).flex_none().bg(r.busy ? (t.working ?? t.accent) : t.dim))
      // A named tab leads, highlighted, with the folder dimmed after it; otherwise the folder leads.
      .when(!!r.tabName, (el) => el
        .child(div().flex_shrink(0).max_w(96).truncate().text_color(t.foreground).child(r.tabName))
        .child(div().flex_shrink(0).max_w(80).truncate().text_size(10).text_color(t.dim).child(r.folder)))
      .when(!r.tabName, (el) => el
        .child(div().flex_shrink(0).max_w(96).truncate().text_color(t.foreground).child(r.folder))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(`tab ${r.tab}`)))
      .child(div().flex_1().min_w(0).truncate().text_color(r.busy ? (t.working ?? t.accent) : t.dim).child(label))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(age === "now" && !r.busy ? "" : age))
      .when(hover, (el) => el.child(
        div().id(`term-close-${r.terminal}`).size(16).flex_none().flex().items_center().justify_center().rounded(3)
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.blocked))
          .tooltip("Close this terminal")
          .on_mouse_down("left", stop).on_mouse_up("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); run("pane.close", { pane: r.pane }); cx.notify(); })
          .child(svg("mods/pane/close.svg").size(10))));
  }
}
