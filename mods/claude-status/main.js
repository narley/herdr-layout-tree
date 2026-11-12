// claude-status: a clone of Herdr's `workspace-status` mod (0.1.13) with the Claude
// account rate limits at the right, as the herdr TUI tab bar shows them:
//   personal 5h 4% ↻02:00 · 7d 3% ↻Fri   (one profile)
//   work 5h 30% · 7d 8%  |  personal 7d 2%   (both reporting)
// Read from the newest `claude.stats` terminal label per profile (written by
// ~/.config/herdr/claude-desktop.sh on each machine); reports older than 12 h are
// ignored, a window whose reset has passed shows "—". Green, yellow from 50%, orange from 75%, red from 90%,
// and a notification the first time a window passes 75% and again at 90%.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, theme, settings, run, window, keys, shared, setShared, notify, playSound } from "herdr";

const STALE_S = 12 * 3600;
const ALERTS = "claude.limitAlerts";
const WINDOWS = [["five_hour", "5h"], ["seven_day", "7d"]];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");

// profile -> rate_limits of its newest report. The last known limits per profile are kept
// in shared "claude.limits", so they stay after a session ends or reports none (a session
// that exits before its first reply carries no limits); 12 hours old, they go.
// `rl_at`: when the limits were seen (claude-desktop.sh carries old ones forward with it).
const MEMO = "claude.limits";
function limits(nowS) {
  const memo = { ...(shared(MEMO) ?? {}) };
  let dirty = false;
  for (const t of terminals()) {
    const raw = t.labels?.["claude.stats"];
    if (!raw) continue;
    let s;
    try { s = JSON.parse(raw); } catch { continue; }
    const at = s.rl_at ?? s.at;
    if (!s.rl || !at) continue;
    const p = s.profile || "default";
    if (!memo[p] || memo[p].at < at) { memo[p] = { rl: s.rl, at }; dirty = true; }
  }
  for (const p of Object.keys(memo)) if (nowS - memo[p].at > STALE_S) { delete memo[p]; dirty = true; }
  if (dirty) setShared(MEMO, memo);
  return Object.entries(memo).sort(([a], [b]) => a.localeCompare(b)).map(([profile, m]) => ({ profile, rl: m.rl }));
}

// The reset: a time today for the 5h window, a weekday for the 7d one.
function reset(key, at) {
  const d = new Date(at * 1000);
  return key === "five_hour" ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : DAYS[d.getDay()];
}

export default class ClaudeStatus extends View {
  init(_props, cx) {
    // Passed resets and alerts depend on the clock as well as the labels.
    cx.timer.every(30000, (cx) => { this.alert(); cx.notify(); });
    this.alert();
  }

  // One notification per profile, window, reset and level (75, 90), remembered in shared state.
  alert() {
    const now = Date.now() / 1000;
    const sent = { ...(shared(ALERTS) ?? {}) };
    let dirty = false;
    for (const k of Object.keys(sent)) if (now - sent[k] > 8 * 86400) { delete sent[k]; dirty = true; }
    const many = limits(now).length > 1;
    for (const { profile, rl } of limits(now)) {
      for (const [key, short] of WINDOWS) {
        const w = rl[key];
        if (!w || w.resets_at <= now) continue;
        const pct = Math.round(w.used_percentage ?? 0);
        const level = pct >= 90 ? 90 : pct >= 75 ? 75 : 0;
        if (!level) continue;
        const id = `${profile}|${key}|${w.resets_at}|${level}`;
        if (sent[id]) continue;
        sent[id] = now;
        dirty = true;
        notify({
          title: `Claude ${many ? `${profile} ` : ""}${short} limit at ${pct}%`,
          body: `Resets ${reset(key, w.resets_at)}`,
          level: level >= 90 ? "error" : "warning",
          timeout: 10000,
        });
        playSound("blocked");
      }
    }
    if (dirty) setShared(ALERTS, sent);
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  limitsView(t) {
    const now = Date.now() / 1000;
    const list = limits(now);
    if (!list.length) return null;
    const dark = settings()?.dark !== false;
    const green = dark ? "#a6e3a1" : t.ansi2, yellow = dark ? "#f9e2af" : "#b58900", amber = dark ? "#fab387" : "#d9730d";
    const red = dark ? "#f38ba8" : t.ansi1;
    const span = (text, color = t.muted, bold = false) => div().flex_none().text_color(color).when(bold, (el) => el.font_semibold()).child(text);
    const parts = [];
    list.forEach(({ profile, rl }, i) => {
      if (i > 0) parts.push(span("  |  ", t.dim));
      if (profile !== "default") {
        // Which account these limits belong to, at a glance: a badge in the profile's own colour.
        const tone = { personal: t.ansi6, work: t.ansi5 }[profile] ?? t.foreground;
        parts.push(div().flex_none().px(5).rounded(3).bg(tone).text_color(t.chrome).text_size(10).font_semibold().child(profile.toUpperCase()));
        parts.push(span(" ", t.dim));
      }
      let first = true;
      for (const [key, short] of WINDOWS) {
        const w = rl[key];
        if (!w) continue;
        if (!first) parts.push(span(" · ", t.dim));
        first = false;
        if (w.resets_at <= now) { parts.push(span(`${short} —`)); continue; }
        const pct = Math.round(w.used_percentage ?? 0);
        const color = pct >= 90 ? red : pct >= 75 ? amber : pct >= 50 ? yellow : green;
        parts.push(span(`${short} `), span(`${pct}%`, color, pct >= 75), span(` ↻${reset(key, w.resets_at)}`, t.dim));
      }
    });
    return h_flex().id("claude-limits").flex_none().items_center().children(parts);
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const lim = this.limitsView(t);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(Boolean(lim), el => el.child(lim))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
