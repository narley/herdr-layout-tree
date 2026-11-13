// claude-usage: a Claude account's usage, like Claude Code's /usage, in a popup. The status bar
// opens it when you click an account's badge (PERSONAL, WORK) with props { profile }.
//   - the 5-hour session and the 7-day week: a bar, the % used, when it resets, and whether the
//     current pace runs out before the reset;
//   - the live Claude sessions on that account, on every machine: model and effort, and spend.
// The limits come from the `claude.stats` terminal labels (Claude Code's status line), via the
// status bar's shared "claude.limits"; per-model weekly limits aren't reported there.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { terminals, theme, settings, shared, props, closeOverlay, run } from "herdr";

const MEMO = "claude.limits";
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
  init(_props, cx) {
    cx.timer.every(30000, (cx) => cx.notify());
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
    const fresh = lim && now - lim.at <= STALE_S;
    const sessions = sessionsOf(profile);
    const spend = sessions.reduce((n, s) => n + (s.cost ?? 0), 0);
    const close = () => closeOverlay(props()?.overlay);

    const windowBlock = ([key, title, length, lenS]) => {
      const w = lim?.rl?.[key];
      const box = v_flex().w_full().flex_none().gap(5)
        .child(h_flex().w_full().items_center()
          .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(length)));
      if (!w || w.resets_at <= now) {
        return box.child(div().text_size(11.5).text_color(t.muted).child(w ? "Reset since the last reading: back to 0%." : "Not reported yet."));
      }
      const pct = Math.max(0, Math.min(100, Math.round(w.used_percentage ?? 0)));
      const start = w.resets_at - lenS;
      const gone = Math.max(0, Math.min(1, (now - start) / lenS));
      // At this rate, when it reaches 100% (only if that comes before the reset).
      const full = pct > 0 && now > start ? start + (now - start) * (100 / pct) : null;
      const runsOut = full && full < w.resets_at;
      const pace = runsOut ? `At this pace it runs out around ${when(full, now)}.`
        : pct > gone * 100 + 10 ? "Using it faster than the clock, but it lasts to the reset."
        : `${Math.round(gone * 100)}% of the window has passed.`;
      return box
        .child(h_flex().w_full().gap(8).items_center()
          .child(div().relative().w(BAR_W - 52).h(8).flex_none().rounded(4).bg(t.raised ?? t.border).overflow_hidden()
            .child(div().absolute().top(0).left(0).h_full().w(Math.max(pct > 0 ? 3 : 0, Math.round((BAR_W - 52) * pct / 100))).rounded(4).bg(colorOf(pct)))
            // where the clock is: past this mark, usage is ahead of time
            .child(div().absolute().top(0).h_full().w(1).left(Math.round((BAR_W - 52) * gone)).bg(t.foreground).opacity(0.45)))
          .child(div().flex_1().text_right().text_size(12).font_semibold().text_color(colorOf(pct)).child(`${pct}%`)))
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
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(!lim ? "" : now - lim.at < 60 ? "read just now" : `read ${span(now - lim.at)} ago`)))
      .when(!fresh, (el) => el.child(div().text_size(11.5).text_color(t.muted)
        .child(lim ? "The last reading is over 12 hours old. Send a message in a Claude session on this account to refresh it." : "No reading yet. It arrives with a Claude session's next reply on this account.")))
      .children(WINDOWS.map(windowBlock))
      .child(div().w_full().h(1).flex_none().bg(t.border))
      .child(h_flex().w_full().items_center()
        .child(div().flex_1().text_size(12.5).font_semibold().child(sessions.length ? `Sessions · ${sessions.length}` : "No live sessions"))
        .when(spend > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).tooltip("What these sessions have cost since each started").child(`$${spend.toFixed(2)} in total`))))
      .when(sessions.length > 0, (el) => el.child(v_flex().w_full().h(Math.min(sessions.length, ROWS_SHOWN) * ROW_H).flex_none()
        .child(v_flex().id("usage-sessions").w_full().flex_1().min_h(0).gap(1).overflow_y_scrollbar().children(sessions.map(row)))));
  }
}
