  // Everything one render needs, read once: each host read copies the whole list into JS.
  prepare(sp) {
    const t = theme();
    const all = terminals();
    this.all = all;
    this.bg = bgChildren(all);
    const flatKids = [...this.bg.values()].flat();
    this.nestedAt = new Set(flatKids.map((k) => k.address));
    const list = agents().filter((a) => !this.nestedAt.has(a.address));
    this.listed = new Map([...list, ...flatKids].map((a) => [a.address, a.status]));
    const paneList = panes();
    this.focusedTerm = paneList.find((p) => p.focused)?.terminal ?? null;
    this.stats = claudeStats(all, list);
    this.P = palette(t);
    this.shown = focused()?.agent;
    this.now = Date.now();
    this.track(list, this.now);
    this.hold(list);

    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const sorted = [...list].sort((x, y) => Number(y.pinned) - Number(x.pinned)
      || urgency.get(y.address) - urgency.get(x.address) || this.since(y) - this.since(x) || y.seq - x.seq);

    // Which space each session sits under: by its tab, which says so on any machine.
    const spaceOfTab = new Map(sp.flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, s.id])));
    const entry = (id) => {
      if (!this.bySpace.has(id)) this.bySpace.set(id, { parents: [], orphans: [] });
      return this.bySpace.get(id);
    };
    this.bySpace = new Map();
    for (const a of sorted) entry(spaceOfTab.get(a.tab) ?? a.space ?? null).parents.push(a);
    // An attached session whose parent has gone still has a pane, so it stays in its space.
    const parents = new Set(list.map((a) => a.address));
    const tabOf = new Map(paneList.filter((p) => p.terminal).map((p) => [p.terminal, p.tab]));
    for (const [parent, kids] of this.bg) {
      if (parents.has(parent)) continue;
      for (const k of kids) entry(spaceOfTab.get(tabOf.get(k.address)) ?? null).orphans.push(k);
    }
    this.urgency = urgency;
    // agent.next walks the sessions in the order they're drawn.
    setAgentOrder([...sp.map((s) => s.id), null].flatMap((id) => this.bySpace.get(id)?.parents ?? []).map((a) => a.address));

    // A row reads its session's name, else a tab someone named or the agent's own title,
    // never an automatic tab number unless two rows would otherwise read the same.
    const leads = leadPanes(paneList);
    const tabLabels = new Map(sp.flatMap((s) => s.tabs).map((tab) => [tab.id, title(tab, leads.get(tab.id))]));
    this.labels = new Map(list.map((a) => [a.address, tabLabels.get(a.tab) ?? (a.title || a.program?.name || "")]));
    this.detail = new Map(list.map((a) => [a.address, /^\d+$/.test(this.labels.get(a.address)) ? null : this.labels.get(a.address)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${this.detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (this.detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) this.detail.set(a.address, this.labels.get(a.address));
    }
  }

  // The sessions in one space, top-level ones and those attached to them.
  members(id) {
    const e = this.bySpace.get(id);
    if (!e) return [];
    return [...e.parents, ...e.parents.flatMap((a) => this.bg.get(a.address) ?? []), ...e.orphans];
  }

  count(id) {
    return this.members(id).length;
  }

  // The most urgent state in a space, for its folded row and section headers.
  topStatus(id) {
    const e = this.bySpace.get(id);
    if (!e) return null;
    let top = 0;
    for (const a of e.parents) top = Math.max(top, this.urgency.get(a.address) ?? 0);
    for (const k of this.members(id)) top = Math.max(top, RANK[k.status] ?? 0);
    return { 4: "blocked", 3: "done", 2: "working", 1: "idle" }[top] ?? null;
  }

  // Sessions that are waiting on you, however deep they're nested.
  waiting(ids) {
    return ids.flatMap((id) => this.members(id)).filter((a) => a.status === "blocked" || a.status === "done").length;
  }

  // The sessions a section's minimise-all button acts on: those with stats to fold.
  foldable(ids) {
    return ids.flatMap((id) => this.members(id)).filter((a) => a.stats || this.stats.has(a.address)).map((a) => a.address);
  }

  // Spaces with sessions that the tree isn't drawing, on this machine (null: this computer).
  elsewhere(known, machine) {
    const mine = (a) => (a.address.includes("/") ? a.address.split("/")[0] : null) === machine;
    return [...this.bySpace.keys()].filter((id) => !known.has(id) && this.members(id).some(mine));
  }

  rowsFor(id) {
    const e = this.bySpace.get(id);
    if (!e) return [];
    const t = theme();
    return [
      ...e.parents.flatMap((a) => this.withKids(a, t)),
      ...e.orphans.map((k, n) => this.nestedCard(t, this.P, k, this.now, n === e.orphans.length - 1)),
    ];
  }

  // Folds or unfolds only these sessions, leaving other sections as they are.
  minAllButton(id, addresses, t) {
    const folded = new Set(shared(COLLAPSED) ?? []);
    const allFolded = addresses.every((address) => folded.has(address));
    return div().id(`card-min-all-${id}`).size(16).flex_none().flex().items_center().justify_center().rounded(4).border(1).border_color(t.dim)
      .text_size(12).font_semibold().text_color(t.muted).cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
      .tooltip(allFolded ? "Expand all sessions here" : "Minimise all sessions here")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        for (const address of addresses) allFolded ? folded.delete(address) : folded.add(address);
        setShared(COLLAPSED, [...folded]);
      })
      .child(allFolded ? "+" : "–");
  }

  withKids(a, t) {
    const nest = this.bg.get(a.address) ?? [];
    const subs = this.tree(this.all, a.address).filter((s) => !this.nestedAt.has(s.t.address));
    // the fold chevron counts both
    const r = this.row(a, t, [...subs, ...nest.map((k) => ({ t: k }))]);
    const open = !this.folded.has(a.address);
    const tail = open ? subs.map((s) => this.subRow(t, s, this.shown, false)) : [];
    if (!nest.length) return [r, ...tail];
    const alarm = a.status === "blocked" || nest.some((k) => k.status === "blocked");
    // the group stays highlighted while the parent or any of its sessions is selected
    const active = a.focused || this.focusedTerm === a.address || nest.some((k) => k.address === this.focusedTerm);
    return [v_flex()
      .id(`group-${a.address}`)
      .flex_none()
      .my(2)
      .rounded(9)
      .border(1)
      .border_color(alarm ? t.blocked : active ? t.accent : t.border)
      .when(active, (el) => el.bg(t.selected))
      .child(r.border(1).border_color(this.focusedTerm === a.address ? t.foreground : "#00000000"))
      .children(tail)
      .when(open, (el) => el.children(nest.map((k, n) => this.nestedCard(t, this.P, k, this.now, n === nest.length - 1))))];
  }

  // The fold chevron; folded, the count too, colored by the most urgent one.
  fold(a, subs, t) {
    const sts = subs.map((s) => kidStatus(s.t, this.listed));
    const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    const open = !this.folded.has(a.address);
    return div()
      .id(`fold-${a.address}`)
      .h(18)
      .px(3)
      .gap(3)
      .flex()
      .items_center()
      .rounded(4)
      .text_size(11)
      .text_color(open ? t.dim : (t[top] ?? t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.folded.add(a.address) : this.folded.delete(a.address);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!open, (el) => el.child(String(subs.length)));
  }

  row(a, t, subs = []) {
    const now = this.now;
    const P = this.P;
    const pic = icon(a.program, 16, t.foreground);
    const more = this.detail.get(a.address);
    const label = this.labels.get(a.address);
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
    const when = this.since(a);
    const idle = a.status === "idle" && !a.focused;
    const isPinned = a.pinned;
    const pin = div()
      .id(`pin-${a.address}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(isPinned ? "Unpin" : "Pin to the top of this space")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("terminal.pin", { terminal: a.address, pinned: !isPinned });
        // The row moves away from under the pointer, and no hover-out comes.
        this.hovered = null;
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
    // Under its space the space goes without saying; an automatic tab number says nothing.
    const name = more ?? (/^\d+$/.test(label) ? a.program?.name || label : label);
    const stats = this.stats.get(a.address);
    if (stats) {
      // A Claude card: glyph · session name (from /rename, else the row's usual name), then its stats.
      const folded = (shared(COLLAPSED) ?? []).includes(a.address);
      return v_flex()
        .id(`ag-${a.address}`)
        .relative()
        .px(8)
        .flex_none()
        .rounded(8)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(h_flex().h(30).flex_none().items_center().gap(9)
          .child(this.glyph(t, P, a))
          .child(h_flex().id(`card-info-${a.address}`).flex_1().min_w(0).gap(5).items_center()
            .when(folded, (el) => el.tooltip(this.foldTip(a, stats, stats.name || name || "claude", machine, now)))
            .child(div().min_w(0).truncate().font_semibold().text_color(idle ? t.muted : t.foreground).child(stats.name || name || "claude")))
          .when(subs.length > 0, (el) => el.child(this.fold(a, subs, t)))
          .when(this.hovered === a.address, (el) => el.child(pin).child(this.foldButton(t, a, folded))))
        .when(!folded, (el) => el.child(this.details(t, P, a, stats, now)))
        .when(this.hovered === a.address && !folded, (el) => el.child(actionButtons(a, stats, this.bg.get(a.address) ?? [], t).absolute().right(6).bottom(6)));
    }
    return h_flex()
      .id(`ag-${a.address}`)
      .px(8)
      .h(30)
      .flex_none()
      .rounded(8)
      .items_center()
      .gap(9)
      .when(a.focused, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(pic), (el) => el.child(div().id(`agent-fold-${a.address}`)
        .when(subs.length > 0, (e) => e.on_click((_e, cx) => {
          cx.stop_propagation();
          this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
          cx.notify();
        })).child(pic)))
      .child(div().flex_1().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(name))
      .when(subs.length > 0, (el) => el.child(this.fold(a, subs, t)))
      .when(this.hovered === a.address, (el) => el.child(pin))
      .when(this.hovered === a.address, (el) => el.child(actionButtons(a, null, [], t)))
      .when(this.hovered !== a.address && Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
      .child(this.status(t, a, false));
  }
}
