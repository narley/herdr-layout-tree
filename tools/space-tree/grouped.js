  toggleSpace(id, cx) {
    this.spaceFolded.has(id) ? this.spaceFolded.delete(id) : this.spaceFolded.add(id);
    localStorage.setItem("spaces.folded", JSON.stringify([...this.spaceFolded]));
    cx.notify();
  }

  // Raised lettering: text has no shadow of its own here, so darker copies sit behind it.
  poppedText(label, t) {
    const copy = (x, color) => div().absolute().top(x).left(x).whitespace_nowrap().text_color(color).child(label);
    return div().relative().flex_1().min_w(0).h(20).font_family("Helvetica Neue").font_weight(700).line_height("20px")
      .child(copy(2, t.canvas)).child(copy(1, t.dim))
      .child(div().absolute().top(0).left(0).whitespace_nowrap().text_color(t.foreground).child(label));
  }

  // Local or Remote. Folding one keeps a count of whatever is waiting on you inside.
  sectionHead(id, label, icon, folded, ids, onToggle, plus, t) {
    const S = this.sessions;
    const waiting = S.waiting(ids);
    const addresses = S.foldable(ids);
    return h_flex().id(`section-${id}`).h(32).mb(4).mt(id === "local" ? 2 : 10).flex_none().px(8).gap(7).items_center().rounded(7)
      .text_size(13).text_color(t.foreground).bg(t.raised).border_1().border_color("#ffffff1f").shadow_md().cursor_pointer().hover((s) => s.bg(t.input))
      .on_click((_e, cx) => onToggle(cx))
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).flex_none())
      .child(this.poppedText(label, t))
      .when(folded && waiting > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).child(`${waiting} waiting`)))
      .when(!folded && addresses.length > 0, (el) => el.child(S.minAllButton(id, addresses, t)))
      .when(Boolean(plus), (el) => el.child(plus))
      .when(id === "local" && Boolean(find(layout(), "agents")), (el) => el.child(this.listToggle(t)))
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none());
  }

  // Back to the two lists, in a layout that has them. herdr-tree doesn't, so it shows no button.
  listToggle(t) {
    return div().id("tree-toggle").size(20).flex_none().flex().items_center().justify_center().rounded(4).bg(t.selected).text_color(t.accent)
      .cursor_pointer().tooltip("Back to separate Spaces and Agents lists")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        for (const id of ["spaces", "agents"]) run("layout.show", { id });
        run("layout.hide", { id: "tree" });
        run("layout.resize", { id: "sidebar", px: 268 });
      })
      .child(svg("mods/workspace-chrome/layers.svg").size(13));
  }

  // A machine's rows: each space with its sessions nested below it.
  spaceRows(rows, machine, known, t) {
    const S = this.sessions;
    const nest = (children, tree) => v_flex().flex_none().ml(tree ? 38 : 16).pl(6).mt(4).mb(4).border_l(1).border_color(t.border).children(children);
    const out = rows.flatMap((r) => {
      const kids = this.spaceFolded.has(r.w.id) ? [] : S.rowsFor(r.w.id);
      return [this.row(r, t), ...(kids.length ? [nest(kids, r.tree)] : [])];
    });
    // Nothing goes missing: a session in a space not on the list still shows.
    const stray = S.elsewhere(known, machine).flatMap((id) => S.rowsFor(id));
    if (stray.length) {
      out.push(div().h(24).flex_none().px(8).flex().items_center().text_size(11).text_color(t.dim).child("Other sessions"));
      out.push(nest(stray, null));
    }
    return out;
  }

  newSpaceRow(m, t) {
    return h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
      .text_size(12).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("space.new", { machine: m ?? "" }))
      .child(svg("mods/workspace-chrome/plus.svg").size(12)).child(m ? "New space there" : "New space here");
  }

  plusButton(m, t) {
    return div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).text_size(13).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(`New space on ${m ?? "this computer"}`)
      .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+");
  }

  // Local, then Remote with one line per machine under it.
  grouped(t, collapsed) {
    const rows = this.ordered();
    if (collapsed) return rows.map((r) => this.compact(r, t));
    const S = this.sessions;
    const known = new Set(rows.map((r) => r.w.id));
    const remote = [...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...this.machines.map((m) => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = (m) => {
      const layout = machines().find((k) => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some((k) => k.name === m && k.state === "connected"))
        || spaces().some((s) => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = (m) => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).items_center().text_size(12).text_color(t.dim).child("Loading…");
    const idsOn = (m) => [...rows.filter((r) => (r.w.machine ?? null) === m).map((r) => r.w.id), ...S.elsewhere(known, m)];
    const body = (m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const drawn = this.spaceRows(mine, m, known, t);
      return drawn.length ? drawn : [loading(m) ? loadingRow(m) : this.newSpaceRow(m, t)];
    };

    const toggleLocal = (cx) => {
      this.folded.has(null) ? this.folded.delete(null) : this.folded.add(null);
      localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
      cx.notify();
    };
    const out = [
      this.sectionHead("local", "Local", "monitor", this.folded.has(null), idsOn(null), toggleLocal, this.plusButton(null, t), t),
      ...(this.folded.has(null) ? [] : body(null)),
    ];
    if (!remote.length) return out;

    const toggleRemote = (cx) => {
      this.remoteFolded = !this.remoteFolded;
      localStorage.setItem("sections.remoteFolded", JSON.stringify(this.remoteFolded));
      cx.notify();
    };
    out.push(this.sectionHead("remote", "Remote", "server", this.remoteFolded, remote.flatMap(idsOn), toggleRemote, null, t));
    if (this.remoteFolded) return out;

    for (const m of remote) {
      const repair = this.reconnecting[m];
      const machine = this.machines.find((k) => k.name === m) ?? repair?.machine;
      const connected = machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      out.push(h_flex().id(`machine-${m}`).h(26).flex_none().pl(8).pr(8).gap(7).items_center().rounded(7).text_size(13).text_color(t.dim)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(div().size(8).rounded(4).flex_none().bg(connected ? t.ansi2 : t.dim))
        .child(div().flex_1().truncate().font_family("Helvetica Neue").font_weight(400).text_color(t.foreground).child(m))
        .when(folded && S.waiting(idsOn(m)) > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`${S.waiting(idsOn(m))} waiting`)))
        .when(!connected && !rebuilt, (el) => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
        .when(rebuilt, (el) => el.child(h_flex().flex_none().gap(3).items_center()
          .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
          .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
            .hover((s) => s.text_color(t.foreground))
            .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
            .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
            .child(repair?.busy ? "Connecting…" : "Connect"))))
        .when(connected, (el) => el.child(this.plusButton(m, t)))
        .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      if (!folded && !rebuilt) out.push(...body(m));
    }
    return out;
  }

