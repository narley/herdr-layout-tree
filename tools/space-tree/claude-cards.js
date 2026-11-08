// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
//
// claude-cards: a clone of Herdr's `agents` mod (0.1.13) that draws each Claude Code
// session as a card with the same stats as the herdr TUI sidebar: state glyph and
// session name, age · rc, repo, branch/worktree, model effort · spend, context ·
// prompt-cache timer, running subagents. The stats come from the terminal label
// `claude.stats`, written by ~/.config/herdr/claude-desktop.sh from Claude's status
// line on each machine. Click a card's glyph to fold its stats (kept in shared
// "claude.cards.collapsed"). Agents without the label draw as in `agents`.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, settings, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";

// ── Claude stats ─────────────────────────────────────────────────────────────
// The herdr TUI palette (dark); light themes use the theme's own colors.
const TUI = { working: "#72fd9d", idle: "#4df5ff", done: "#d898ff", blocked: "#ff6f8e", unknown: "#ffe15c",
  spend: "#86b383", rc: "#b86f86", amber: "#fab387", red: "#f38ba8", sub: "#a6adc8" };
const palette = (t) => settings()?.dark === false
  ? { working: t.working, idle: t.idle, done: t.done, blocked: t.blocked, unknown: t.unknown ?? t.ansi3,
      spend: t.ansi2, rc: t.ansi5, amber: t.ansi3, red: t.ansi1, sub: t.muted }
  : TUI;
// Player controls, as in the TUI: play, paused (waiting for you), stopped (not seen yet), needs you.
const GLYPH = { working: "▶", idle: "▮▮", done: "■", blocked: "◆" };
const COLLAPSED = "claude.cards.collapsed";
const SUB_FRESH_S = 90;   // a subagent count older than this (no watcher left) is dropped

// address -> parsed claude.stats, for live Claude sessions only: the label stays on the
// terminal after Claude exits, so the terminal must still be a claude-code agent running claude.
function claudeStats(all, list) {
  const claude = new Set(list.filter((a) => a.app === "claude-code").map((a) => a.address));
  const out = new Map();
  for (const t of all) {
    const raw = t.labels?.["claude.stats"];
    if (!raw || !claude.has(t.address) || t.state !== "live") continue;
    const fg = t.foreground;
    if (fg && !(fg.argv ?? []).join(" ").includes("claude") && !/^\d+\.\d+\.\d+/.test(fg.name ?? "")) continue;
    try { out.set(t.address, JSON.parse(raw)); } catch { /* half-written: skip this render */ }
  }
  return out;
}

// What the context, usage limit and prompt cache readings mean, with the numbers behind them.
const tipTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
const tipPad = (n) => String(n).padStart(2, "0");
const tipClock = (at) => { const d = new Date(at * 1000); return `${tipPad(d.getHours())}:${tipPad(d.getMinutes())}`; };
const tipDay = (at) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(at * 1000).getDay()]} ${tipClock(at)}`;
const tipUntil = (d) => (d >= 3600 ? `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m` : `${Math.max(1, Math.floor(d / 60))}m`);
function contextTip(label, s) {
  const pct = s.ctx?.pct ?? 0;
  const size = s.ctx?.size ?? 200000;
  const estimated = s.parent ? "\nThe window size is an estimate for background sessions." : "";
  return `${label}: context left in this session.\n${pct}% used, about ${tipTokens((size * pct) / 100)} of ${tipTokens(size)} tokens.\nWhen it runs low, Claude compacts the conversation.${estimated}`;
}
function limitTip(label, s, now) {
  const who = s.profile && s.profile !== "default" ? ` (${s.profile} account)` : "";
  const five = s.rl?.five_hour;
  const week = s.rl?.seven_day;
  const current = five && five.resets_at > now
    ? `${Math.round(five.used_percentage ?? 0)}% used, resets at ${tipClock(five.resets_at)} (in ${tipUntil(five.resets_at - now)}).`
    : "No current reading: Claude reports it with its next reply.";
  const weekly = week && week.resets_at > now ? `\n7-day limit: ${Math.round(week.used_percentage ?? 0)}% used, resets ${tipDay(week.resets_at)}.` : "";
  return `${label}: your 5-hour usage limit left${who}.\n${current}${weekly}`;
}
function cacheTip(label, s, now) {
  const warm = s.cache?.warm === true && s.cache.exp > now;
  return warm
    ? `${label}: this session's prompt cache.\nWarm for ${tipUntil(s.cache.exp - now)} more, until ${tipClock(s.cache.exp)}.\nA reply before then reuses it, which costs less.`
    : `${label}: this session's prompt cache.\nIt has expired.\nThe next reply rebuilds it, which costs more.`;
}

// Close and Delete worktree, shown on hover. session-actions asks before doing anything.
const actionInfo = (a, s) => ({ address: a.address, name: s?.name || a.address, bg: a.bg ?? null, sid: s?.sid ?? null, profile: s?.profile ?? null, dir: s?.dir ?? null });
function actionButtons(a, s, kids, t) {
  const chip = (id, label, tip, action) => div().id(`${id}-${a.address}`).size(18).flex().items_center().justify_center().rounded(4).border(1).border_color(t.dim).bg(t.popover)
    .cursor_pointer().hover((x) => x.bg(t.hover)).tooltip(tip)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      openOverlay({ mod: "session-actions", kind: "dialog", modal: true, width: 480, height: 300, props: { action, session: actionInfo(a, s), kids: kids.map((k) => actionInfo(k, k.stats)) } });
    })
    .child(label);
  return h_flex().gap(4).child(chip("act-close", svg("mods/pane/close.svg").size(12).text_color(t.accent), "Close this session", "close"))
    .when(s?.loc === "wt" && Boolean(s?.dir), (el) => el.child(chip("act-wt", svg("mods/claude-cards/bin.svg").size(12).text_color(t.accent), "Close this session and delete its worktree", "worktree")));
}

// Attached background sessions (`claude --bg` in a child terminal labelled claude.bg), by
// their parent's address, as agent-shaped rows. Their stats label names the parent.
function bgChildren(all) {
  const out = new Map();
  for (const t of all) {
    const raw = t.labels?.["claude.stats"];
    if (!raw || !t.labels?.["claude.bg"] || t.state !== "live") continue;
    let s;
    try { s = JSON.parse(raw); } catch { continue; }
    if (!s.parent) continue;
    const machine = t.address.includes("/") ? `${t.address.split("/")[0]}/` : "";
    const key = `${machine}${s.parent}`;
    const status = s.state === "working" || s.state === "busy" ? "working" : /input|wait|block/.test(s.state ?? "") ? "blocked" : "idle";
    out.set(key, [...(out.get(key) ?? []), { address: t.address, app: "claude-code", status, focused: false, bg: t.labels["claude.bg"], tab_name: s.name ?? t.address, stats: s }]);
  }
  for (const kids of out.values()) kids.sort((x, y) => String(x.stats.name ?? x.address).localeCompare(String(y.stats.name ?? y.address)));
  return out;
}

const age = (s) => {
  const m = Math.max(0, Math.floor(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
};
const fmtK = (k) => (k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k}k`);
const cacheLeft = (d) => (d >= 3600 ? `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m left` : d >= 60 ? `${Math.floor(d / 60)}m left` : "<1m left");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  // The state glyph; clicking it folds or unfolds the card's stats.
  glyph(t, P, a) {
    const g = GLYPH[a.status] ?? "?";
    const color = P[a.status] ?? P.unknown;
    return div()
      .id(`cg-${a.address}`)
      .w(16)
      .flex_none()
      .text_center()
      .text_size(g === "▮▮" ? 10 : 12)
      .font_semibold()
      .text_color(color)
      .cursor_pointer()
      .tooltip("Fold or unfold the stats")
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggleFold(a.address); })
      .child(g);
  }

  toggleFold(address) {
    const folded = new Set(shared(COLLAPSED) ?? []);
    folded.has(address) ? folded.delete(address) : folded.add(address);
    setShared(COLLAPSED, [...folded]);
  }

  // Minimise or expand a card; shown while the pointer is over it.
  foldButton(t, a, folded) {
    return div().id(`card-min-${a.address}`).size(16).flex_none().flex().items_center().justify_center().rounded(4).border(1).border_color(t.dim)
      .text_size(12).font_semibold().text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.accent))
      .tooltip(folded ? "Expand this session" : "Minimise this session")
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggleFold(a.address); })
      .child(folded ? "+" : "\u2013");
  }

  // What a minimised card's stat lines would say, for its tooltip.
  foldTip(a, s, name, machine, nowMs) {
    const now = nowMs / 1000;
    const lines = [machine ? `${name} @${machine}` : name];
    const top = [s.start && age(now - s.start), a.status, s.rc && "rc"].filter(Boolean);
    lines.push(top.join(" · "));
    if (s.repo) lines.push(s.repo);
    if (s.branch) lines.push(`${s.loc === "wt" ? "wt" : "br"}: ${s.branch}`);
    const spend = s.tokens != null && s.cost == null
      ? (s.tokens >= 1000 ? `${Math.floor(s.tokens / 1000)}k tok` : `${s.tokens} tok`)
      : `$${(s.cost ?? 0).toFixed(2)}`;
    lines.push(`${s.model ?? "Claude"}${s.effort ? ` ${s.effort}` : ""} · ${spend}`);
    const pct = s.ctx?.pct ?? 0;
    const size = s.ctx?.size ?? 200000;
    const cache = s.cache?.warm === true && s.cache.exp > now ? cacheLeft(s.cache.exp - now) : s.cache?.warm != null ? "0m left" : null;
    lines.push(`${fmtK(Math.floor((size * pct) / 100 / 1000))}/${fmtK(Math.floor(size / 1000))} (${pct}%)${cache ? ` · ${cache}` : ""}`);
    const fresh = s.subs && now - (s.subs.at ?? 0) <= SUB_FRESH_S;
    const total = (fresh ? s.subs.n ?? 0 : 0) + (a.status === "working" ? 1 : 0);
    if (total > 0) lines.push(`${total} running`);
    if (fresh) for (const n of s.subs.helpers ?? s.subs.names ?? []) lines.push(`  ${n}`);
    return lines.join("\n");
  }

  // The stat lines under a Claude card's header. Rows with no value disappear;
  // colour carries every warning, as in the TUI.
  details(t, P, a, s, nowMs) {
    const now = nowMs / 1000;
    const plain = t.muted;
    const span = (text, color, bold = false) => div().flex_none().text_color(color).when(bold, (el) => el.font_semibold()).child(text);
    const sep = () => span(" · ", t.dim);
    const line = (key, ...parts) => h_flex().id(`cl-${key}-${a.address}`).min_w(0).h(17).items_center().overflow_hidden().whitespace_nowrap().children(parts.filter(Boolean));
    const text = (key, value, color = plain) => line(key, div().min_w(0).truncate().text_color(color).child(value));
    const rows = [];

    // age · rc
    if (s.start) rows.push(line("age", span(age(now - s.start), t.dim), s.rc && sep(), s.rc && span("rc", P.rc)));
    if (s.repo) rows.push(text("repo", s.repo));
    if (s.branch) rows.push(text("br", `${s.loc === "wt" ? "wt" : "br"}: ${s.branch}`));

    // model effort · spend
    const spend = s.tokens != null && s.cost == null
      ? (s.tokens >= 1000 ? `${Math.floor(s.tokens / 1000)}k tok` : `${s.tokens} tok`)
      : `$${(s.cost ?? 0).toFixed(2)}`;
    rows.push(line("model", div().min_w(0).truncate().text_color(plain).child(`${s.model ?? "Claude"}${s.effort ? ` ${s.effort}` : ""}`), sep(), span(spend, P.spend)));

    // context · cache: amber from 75%, red from 90%; the cache red in its last minute and at 0m
    const pct = s.ctx?.pct ?? 0;
    const size = s.ctx?.size ?? 200000;
    const ctxColor = pct >= 90 ? P.red : pct >= 75 ? P.amber : plain;
    const ctx = span(`${fmtK(Math.floor((size * pct) / 100 / 1000))}/${fmtK(Math.floor(size / 1000))} (${pct}%)`, ctxColor, pct >= 75).id(`cl-ctxtip-${a.address}`).tooltip(contextTip("CONTEXT", s));
    let cache = null;
    if (s.cache?.warm === true && s.cache.exp > now) {
      const left = s.cache.exp - now;
      cache = span(cacheLeft(left), left < 60 ? P.red : plain);
    } else if (s.cache?.warm != null) {
      cache = span("0m left", P.red);
    }
    if (cache) cache = cache.id(`cl-cachetip-${a.address}`).tooltip(cacheTip("CACHE", s, now));
    rows.push(line("ctx", ctx, cache && sep(), cache));

    // running: subagents plus 1 for the main session while it works; hidden at 0
    const fresh = s.subs && now - (s.subs.at ?? 0) <= SUB_FRESH_S;
    const subs = fresh ? s.subs.n ?? 0 : 0;
    const total = subs + (a.status === "working" ? 1 : 0);
    if (total > 0) {
      rows.push(text("run", `${total} running`));
      // helpers only: attached sessions get their own nested cards
      const names = fresh ? s.subs.helpers ?? s.subs.names ?? [] : [];
      const more = (fresh ? s.subs.hn ?? subs : 0) - names.length;
      names.forEach((n, i) => {
        const last = i === names.length - 1 && more <= 0;
        rows.push(text(`sub${i}`, `${last ? "└" : "├"} ${n}`, P.sub));
      });
      if (more > 0) rows.push(text("more", `└ +${more} more`, P.sub));
    }
    return v_flex().pl(25).pb(6).gap(0).text_size(12).children(rows);
  }

  // An attached background session inside its parent's group: the same stats as a card.
  nestedCard(t, P, k, now, last) {
    const s = k.stats;
    const folded = (shared(COLLAPSED) ?? []).includes(k.address);
    const machine = k.address.includes("/") ? k.address.split("/")[0] : null;
    const selected = this.focusedTerm === k.address;
    return h_flex()
      .id(`kid-${k.address}`)
      .w_full()
      .min_w(0)
      .flex_none()
      .items_start()
      .border_t(1)
      .border_color(t.border)
      .child(div().flex_none().w(14).pt(7).text_center().text_size(11).text_color(t.dim).child(last ? "└" : "├"))
      .child(v_flex()
        .id(`ag-${k.address}`)
        .relative()
        .flex_1()
        .min_w(0)
        .px(8)
        .rounded(8)
        .border(1)
        // a lighter border marks the selected session
        .border_color(selected ? t.foreground : "#00000000")
        .cursor_pointer()
        .hover((el) => el.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = k.address;
          else if (this.hovered === k.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { terminal: k.address }))
        .child(h_flex().h(30).flex_none().items_center().gap(9)
          .child(this.glyph(t, P, k))
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(k.status === "idle" && !selected ? t.muted : t.foreground).child(s.name || "claude"))
          .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine))))
        .when(!folded, (el) => el.child(this.details(t, P, k, s, now)))
        .when(this.hovered === k.address, (el) => el.child(actionButtons(k, s, [], t).absolute().right(6).bottom(6))));
  }

  // In the header: unfolds when every Claude card's stats are folded, otherwise folds them all.
  minAllButton(addresses, t) {
    const folded = new Set(shared(COLLAPSED) ?? []);
    const allFolded = addresses.every((address) => folded.has(address));
    return div().id("card-min-all").size(16).flex_none().flex().items_center().justify_center().rounded(4).border(1).border_color(t.dim)
      .text_size(12).font_semibold().text_color(t.muted).cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
      .tooltip(allFolded ? "Expand all sessions" : "Minimise all sessions")
      .on_click((_e, cx) => { cx.stop_propagation(); setShared(COLLAPSED, allFolded ? [] : addresses); })
      .child(allFolded ? "+" : "\u2013");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const all = terminals();
    const bg = bgChildren(all);
    const flatKids = [...bg.values()].flat();
    const nestedAt = new Set(flatKids.map((k) => k.address));
    let list = agents().filter((a) => !nestedAt.has(a.address));
    // Nested sessions report through their stats label: their urgency reaches the parent.
    this.listed = new Map([...list, ...flatKids].map((a) => [a.address, a.status]));
    const paneList = panes();
    this.focusedTerm = paneList.find((p) => p.focused)?.terminal ?? null;
    this.stats = claudeStats(all, list);
    const foldable = [...this.stats.keys(), ...flatKids.map((k) => k.address)];
    const P = palette(t);
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const nest = collapsed ? [] : bg.get(a.address) ?? [];
      const allSubs = collapsed ? [] : this.tree(all, a.address);
      const subs = allSubs.filter((s) => !nestedAt.has(s.t.address));
      // the fold chevron counts both
      const r = row(a, i, [...subs, ...nest.map((k) => ({ t: k }))]);
      const open = !this.folded.has(a.address);
      const tail = open ? subs.map((s) => this.subRow(t, s, shown, byPriority)) : [];
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
        .when(open, (el) => el.children(nest.map((k, n) => this.nestedCard(t, P, k, now, n === nest.length - 1))))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
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
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(paneList);
    const tabLabels = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, title(tab, leads.get(tab.id))]));
    const labels = new Map(list.map(a => [a.address, tabLabels.get(a.tab) ?? (a.title || a.program?.name || "")]));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
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
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
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
            .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine)))
            .when(subs.length > 0, (el) => el.child(fold(a, subs)))
            .when(this.hovered === a.address, (el) => el.child(pin).child(this.foldButton(t, a, folded))))
          .when(!folded, (el) => el.child(this.details(t, P, a, stats, now)))
          .when(this.hovered === a.address && !folded, (el) => el.child(actionButtons(a, stats, bg.get(a.address) ?? [], t).absolute().right(6).bottom(6)));
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
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered === a.address, el => el.child(actionButtons(a, null, [], t)))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(h_flex().gap(8).items_center()
              .when(foldable.length > 0, (el) => el.child(this.minAllButton(foldable, t)))
              .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "claude-cards", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
              ),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
