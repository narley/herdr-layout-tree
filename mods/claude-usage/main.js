// claude-usage: a Claude account's usage, like Claude Code's /usage, in a popup. The status bar
// opens it when you click an account's badge (PERSONAL, WORK) with props { profile }.
//   - the 5-hour session and the 7-day week: a bar, the % used, when it resets, and whether the
//     current pace runs out before the reset;
//   - the live Claude sessions on that account, on every machine: model and effort, and spend.
// The limits come from `claude -p /usage` on this machine (run when the popup opens and every 2
// minutes while it's open; kept in shared "claude.usage"), which also gives each model's own weekly
// limit (Fable, ...). Until it answers, or if it can't, from the `claude.stats` terminal labels
// (Claude Code's status line, via the status bar's shared "claude.limits"): 5 hours and 7 days only.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { terminals, theme, settings, shared, setShared, props, closeOverlay, run, exec, home } from "herdr";

const MEMO = "claude.limits";
const USAGE = "claude.usage";            // { <profile>: { at, items: [{ model, pct, resets }] } } from /usage
const ASK_EVERY_MS = 2 * 60000;
const WEEK_S = 7 * 86400;
const STALE_S = 12 * 3600;
const BAR_W = 300;
const ROW_H = 23;
const ROWS_SHOWN = 8;                     // the sessions list scrolls past this many
const WINDOWS = [
  ["five_hour", "Current session", "5 hours", 5 * 3600],
  ["seven_day", "This week", "7 days", 7 * 86400],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");
const RANK = { blocked: 0, working: 1, done: 2, idle: 3 };

const EFFORT_CODE = { low: "L", medium: "M", high: "H", xhigh: "X", max: "XX" };
function modelCode(s) {
  const m = String(s?.model ?? "").replace(/^claude[- ]/i, "").trim();
  return m ? `${m[0].toUpperCase()}${EFFORT_CODE[String(s.effort ?? "").toLowerCase()] ?? ""}` : "";
}

// "20:50" today, "Fri 09:00" later in the week.
function when(atS, nowS) {
  const d = new Date(atS * 1000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(nowS * 1000).toDateString() === d.toDateString() ? `today ${hm}` : `${DAYS[d.getDay()]} ${hm}`;
}
function span(s) {
  s = Math.max(0, Math.round(s / 60));
  const d = Math.floor(s / 1440), h = Math.floor((s % 1440) / 60), m = s % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

// The newest limits for a profile: a live label if one is newer than the remembered ones.
function limitsOf(profile) {
  let best = shared(MEMO)?.[profile] ?? null;
  for (const t of terminals()) {
    const raw = t.labels?.["claude.stats"];
    if (!raw) continue;
    try {
      const s = JSON.parse(raw);
      const at = s.rl_at ?? s.at;
      if (s.rl && at && (s.profile || "default") === profile && (!best || best.at < at)) best = { rl: s.rl, at };
    } catch {}
  }
  return best;
}

// `claude -p /usage` lines, e.g. "Current week (Fable): 4% used · resets Nov 13 at 9pm (Europe/London)".
// model: null for the session, "all" for every model, else the model's name.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseReset(text, nowS) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text ?? "");
  if (!m) return null;
  const now = new Date(nowS * 1000);
  let h = Number(m[3]) % 12;
  if (m[5].toLowerCase() === "pm") h += 12;
  const d = new Date(now.getFullYear(), MONTHS.indexOf(m[1]), Number(m[2]), h, Number(m[4] ?? 0));
  if (d.getTime() / 1000 < nowS - 86400) d.setFullYear(d.getFullYear() + 1);
  return d.getTime() / 1000;
}
function parseUsage(out, nowS) {
  const items = [];
  for (const line of String(out).split("\n")) {
    const m = /^Current (session|week \(([^)]+)\)):\s*(\d+)% used(?:\s*·\s*resets (.+))?/.exec(line.trim());
    if (!m) continue;
    const model = m[1] === "session" ? null : /^all/i.test(m[2]) ? "all" : m[2];
    items.push({ model, pct: Number(m[3]), resets: parseReset(m[4], nowS) });
  }
  return items;
}

// Live Claude sessions on the account, busiest first.
function sessionsOf(profile) {
  const out = [];
  for (const t of terminals()) {
    const raw = t.labels?.["claude.stats"];
    if (!raw || t.state !== "live") continue;
    let s;
    try { s = JSON.parse(raw); } catch { continue; }
    if ((s.profile || "default") !== profile) continue;
    const st = s.state === "working" || s.state === "busy" ? "working" : /input|wait|block/.test(s.state ?? "") ? "blocked" : t.status ?? "idle";
    out.push({ address: t.address, name: s.name || s.repo || t.address, code: modelCode(s), machine: t.address.includes("/") ? t.address.split("/")[0] : "local", cost: s.cost, tokens: s.tokens, status: st });
  }
  return out.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.name.localeCompare(b.name));
}

export default class ClaudeUsage extends View {
  // A bar with the % at its right; `gone` (0..1) marks how much of the window has passed.
  bar(pct, gone, color, t) {
    const w = BAR_W - 52;
    return h_flex().w_full().gap(8).items_center()
      .child(div().relative().w(w).h(8).flex_none().rounded(4).bg(t.raised ?? t.border).overflow_hidden()
        .child(div().absolute().top(0).left(0).h_full().w(Math.max(pct > 0 ? 3 : 0, Math.round(w * pct / 100))).rounded(4).bg(color))
        // where the clock is: past this mark, usage is ahead of time
        .when(gone != null, (el) => el.child(div().absolute().top(0).h_full().w(1).left(Math.round(w * gone)).bg(t.foreground).opacity(0.45))))
      .child(div().flex_1().text_right().text_size(12).font_semibold().text_color(color).child(`${pct}%`));
  }

  init(_props, cx) {
    this.asking = false;
    this.failed = null;
    this.ask(cx);
    cx.timer.every(30000, (cx) => { if (Date.now() - (this.askedAt ?? 0) >= ASK_EVERY_MS) this.ask(cx); cx.notify(); });
  }

  // Claude Code's own /usage for this account, on this machine (no model is called).
  async ask(cx) {
    if (this.asking) return;
    const profile = props()?.profile ?? "default";
    this.asking = true;
    this.askedAt = Date.now();
    try {
      const env = profile === "default" ? [] : [`CLAUDE_CONFIG_DIR=${home()}/.claude-${profile}`];
      const r = await exec("env", [...env, "claude", "-p", "/usage"], { cwd: home(), timeout: 60000 });
      const items = parseUsage(r.stdout, Date.now() / 1000);
      if (items.length) {
        setShared(USAGE, { ...(shared(USAGE) ?? {}), [profile]: { at: Date.now() / 1000, items } });
        this.failed = null;
      } else this.failed = (r.stderr || r.stdout || "no answer").trim().split("\n")[0];
    } catch (e) {
      this.failed = String(e?.message ?? e);
    }
    this.asking = false;
    cx?.notify?.();
  }

  render() {
    const t = theme();
    const profile = props()?.profile ?? "default";
    const now = Date.now() / 1000;
    const dark = settings()?.dark !== false;
    const green = dark ? "#a6e3a1" : t.ansi2 ?? t.working, yellow = dark ? "#f9e2af" : "#b58900", amber = dark ? "#fab387" : "#d9730d";
    const red = dark ? "#f38ba8" : t.ansi1 ?? t.blocked;
    const colorOf = (pct) => (pct >= 90 ? red : pct >= 75 ? amber : pct >= 50 ? yellow : green);
    const tone = { personal: t.ansi6, work: t.ansi5 }[profile] ?? t.accent;
    const lim = limitsOf(profile);
    const asked = shared(USAGE)?.[profile] ?? null;
    // /usage when it has answered and is newer than the status line's reading
    const fromUsage = asked && (!lim || asked.at >= lim.at);
    const read = fromUsage ? asked : lim;
    const fresh = read && now - read.at <= STALE_S;
    const windows = fromUsage
      ? asked.items.map((u) => u.model === null ? { title: "Current session", length: "5 hours", lenS: 5 * 3600, pct: u.pct, resets: u.resets }
        : { title: u.model === "all" ? "This week" : `This week · ${u.model}`, length: u.model === "all" ? "all models" : `${u.model} only`, lenS: WEEK_S, pct: u.pct, resets: u.resets })
      : WINDOWS.map(([key, title, length, lenS]) => {
        const w = lim?.rl?.[key];
        return { title, length, lenS, pct: w?.used_percentage ?? null, resets: w?.resets_at ?? null, missing: !w };
      });
    const sessions = sessionsOf(profile);
    const spend = sessions.reduce((n, s) => n + (s.cost ?? 0), 0);
    const close = () => closeOverlay(props()?.overlay);

    const windowBlock = ({ title, length, lenS, pct: raw, resets, missing }) => {
      const box = v_flex().w_full().flex_none().gap(5)
        .child(h_flex().w_full().items_center()
          .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(length)));
      if (missing) return box.child(div().text_size(11.5).text_color(t.muted).child("Not reported yet."));
      if (resets && resets <= now) return box.child(div().text_size(11.5).text_color(t.muted).child("Reset since the last reading: back to 0%."));
      const pct = Math.max(0, Math.min(100, Math.round(raw ?? 0)));
      if (!resets) {
        return box.child(this.bar(pct, null, colorOf(pct), t))
          .child(div().text_size(11.5).text_color(t.muted).child(pct ? "Running." : "Not started: it starts with your next message."));
      }
      const w = { resets_at: resets };
      const start = w.resets_at - lenS;
      const gone = Math.max(0, Math.min(1, (now - start) / lenS));
      // At this rate, when it reaches 100% (only if that comes before the reset).
      const full = pct > 0 && now > start ? start + (now - start) * (100 / pct) : null;
      const runsOut = full && full < w.resets_at;
      const pace = runsOut ? `At this pace it runs out around ${when(full, now)}.`
        : pct > gone * 100 + 10 ? "Using it faster than the clock, but it lasts to the reset."
        : `${Math.round(gone * 100)}% of the window has passed.`;
      return box
        .child(this.bar(pct, gone, colorOf(pct), t))
        .child(div().text_size(11.5).text_color(t.muted).child(`Resets ${when(w.resets_at, now)} · in ${span(w.resets_at - now)}`))
        .child(div().text_size(11).text_color(runsOut ? amber : t.dim).child(pace));
    };

    const row = (s) => h_flex().id(`usage-${s.address}`).w_full().h(22).flex_none().gap(7).items_center().px(4).rounded(4)
      .cursor_pointer().hover((x) => x.bg(t.hover))
      .on_click(() => { run("pane.focus", { terminal: s.address }); close(); })
      .child(div().size(6).flex_none().rounded(3).bg(t[s.status] ?? t.idle ?? t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.foreground).child(s.name))
      .child(div().flex_none().text_size(10).font_semibold().text_color(t.muted).child(s.code))
      .child(div().flex_none().w(52).truncate().text_size(10.5).text_color(t.dim).child(s.machine))
      .child(div().flex_none().w(52).text_right().text_size(10.5).text_color(t.muted)
        .child(s.cost != null ? `$${s.cost.toFixed(2)}` : s.tokens != null ? `${Math.round(s.tokens / 1000)}k tok` : ""));

    return v_flex().id("claude-usage").size_full().p(16).gap(14).bg(t.popover ?? t.surface ?? t.background).text_color(t.foreground)
      .child(h_flex().w_full().gap(8).items_center()
        .child(div().flex_none().px(6).rounded(3).bg(tone).text_color(t.chrome).text_size(10.5).font_semibold().child(profile.toUpperCase()))
        .child(div().flex_1().text_size(13).font_semibold().child("Claude usage"))
        .child(div().id("usage-read").flex_none().text_size(10.5).text_color(t.dim)
          .tooltip(fromUsage ? "From Claude Code's /usage. Click to check again." : "From the status line. Click to ask /usage.")
          .cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click((_e, cx) => this.ask(cx))
          .child(this.asking ? "checking…" : !read ? "" : now - read.at < 60 ? "just now ↻" : `${span(now - read.at)} ago ↻`)))
      .when(!fresh && !this.asking, (el) => el.child(div().text_size(11.5).text_color(t.muted)
        .child(read ? "The last reading is over 12 hours old." : "No reading yet.")))
      .when(Boolean(this.failed) && !fromUsage && !this.asking, (el) => el.child(div().w_full().truncate().text_size(10.5).text_color(t.dim)
        .child(`/usage didn't answer (${this.failed}), so this is the status line's reading: 5 hours and 7 days only.`)))
      .children(windows.map(windowBlock))
      .child(div().w_full().h(1).flex_none().bg(t.border))
      .child(h_flex().w_full().items_center()
        .child(div().flex_1().text_size(12.5).font_semibold().child(sessions.length ? `Sessions · ${sessions.length}` : "No live sessions"))
        .when(spend > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).tooltip("What these sessions have cost since each started").child(`$${spend.toFixed(2)} in total`))))
      .when(sessions.length > 0, (el) => el.child(v_flex().w_full().h(Math.min(sessions.length, ROWS_SHOWN) * ROW_H).flex_none()
        .child(v_flex().id("usage-sessions").w_full().flex_1().min_h(0).gap(1).overflow_y_scrollbar().children(sessions.map(row)))));
  }
}
