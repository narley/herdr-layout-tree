#!/usr/bin/env python3
"""Adds the DETACHED state to a mod's attached-session cards. Safe to run again.
Usage: detached.py <kind> <main.js>   kind: matrix | themed | oompa | anchor | cards"""
import re
import sys

HELPERS = '''// An attached session's pane can lose Claude (a restart, a crash) and fall back to a shell, while
// its old labels stay. Such a card is DETACHED, and clicking it reattaches: it only types when the
// pane is at a shell prompt, so anything else running there just gets focus.
const detachedFrom = (t) => {
  const fg = t.foreground;
  return Boolean(fg) && !(fg.argv ?? []).join(" ").includes("claude") && !/^\\d+\\.\\d+\\.\\d+/.test(fg.name ?? "");
};
const atShell = (t) => /^-?(zsh|bash|fish|sh|dash)$/.test(String(t.foreground?.name ?? "").split("/").pop());
async function reattach(k) {
  run("pane.focus", { terminal: k.address });
  if (!k.shell || !/^[A-Za-z0-9_-]+$/.test(k.bg ?? "")) return;
  const profile = k.stats?.profile;
  const config = profile && profile !== "default" && /^[A-Za-z0-9_-]+$/.test(profile) ? `CLAUDE_CONFIG_DIR="$HOME/.claude-${profile}" ` : "";
  await hc(["keys", k.address, "ctrl+u"]);   // anything half-typed at the prompt
  const r = await hc(["send", k.address, `${config}claude attach ${k.bg}`]);
  if (r.code !== 0) notify({ title: "Couldn't reattach", body: (r.stderr || r.stdout || "").trim(), level: "error" });
}

'''


def sub(text, old, new, count=1):
    assert text.count(old) == count, old[:90]
    return text.replace(old, new)


def common(s, imports="hc, notify, "):
    s = sub(s, "import { agents, ", f"import {{ {imports}agents, ")
    s = sub(s, 'const status = s.state === "working" || s.state === "busy" ? "working" :',
            'const status = detachedFrom(t) ? "detached" : s.state === "working" || s.state === "busy" ? "working" :')
    s = sub(s, '{ address: t.address, app: "claude-code", status,', '{ address: t.address, app: "claude-code", status, shell: atShell(t),')
    m = re.search(r"^(// Attached background sessions[^\n]*\n(?:// [^\n]*\n)*)?function bgChildren\(", s, re.M)
    assert m, "bgChildren"
    return s[:m.start()] + HELPERS + s[m.start():]


def themed(s):
    s = common(s)
    s, n = re.subn(r"(function foldedTip\(a, s, name,[^)]*\) \{\n)", r'\1  if (a.status === "detached") return `${name}\\nDetached. Click to reattach.`;\n', s)
    assert n == 1, "foldedTip"
    s = sub(s, 'run(nested ? "pane.focus" : "agent.focus", { terminal: a.address })',
            'a.status === "detached" ? reattach(a) : run(nested ? "pane.focus" : "agent.focus", { terminal: a.address })')
    return s


def word_table(s):
    m = re.search(r"const STATE = \{\n", s)
    assert m, "STATE"
    return s[:m.end()] + '  detached: { word: "DETACHED", frames: null },\n' + s[m.end():]


def apply(kind, s):
    if "detachedFrom" in s:
        return s
    if kind == "themed":
        s = word_table(themed(s))
        return sub(s, "\n    if (s) {\n", '\n    if (a.status === "detached") {\n      rows.push(row("detached", [grow("Click to reattach", t.accent)]));\n    } else if (s) {\n')
    if kind == "oompa":
        s = themed(s)
        s = sub(s, 'const STATUS = { working: "Mixing",', 'const STATUS = { detached: "Detached", working: "Mixing",')
        return sub(s, "\n    if (s) {\n", '\n    if (a.status === "detached") {\n      body.child(line("detached", [flex("Click to reattach", t.accent)]));\n    } else if (s) {\n')
    if kind == "anchor":
        s = common(s, "hc, ")
        s = sub(s, '  idle: "Resting",\n};\nconst SHORT = { blocked: "Waiting",', '  idle: "Resting",\n  detached: "Detached, click to reattach",\n};\nconst SHORT = { detached: "Detached", blocked: "Waiting",')
        s = sub(s, "  if (!s) return lines.join(\"\\n\");\n", '  if (!s || a.status === "detached") return lines.join("\\n");\n')
        s = sub(s, '    run(a.child ? "pane.focus" : "agent.focus", { terminal: a.address });\n',
                '    if (a.status === "detached") return reattach(a);\n    run(a.child ? "pane.focus" : "agent.focus", { terminal: a.address });\n')
        return s
    if kind == "cards":
        s = common(s)
        s = sub(s, 'const GLYPH = { working: "▶",', 'const GLYPH = { detached: "○", working: "▶",')
        s = sub(s, '        .on_click(() => run("pane.focus", { terminal: k.address }))\n',
                '        .on_click(() => (k.status === "detached" ? reattach(k) : run("pane.focus", { terminal: k.address })))\n')
        s = sub(s, "        .when(!folded, (el) => el.child(this.details(t, P, k, s, now)))\n",
                '        .when(!folded, (el) => el.child(k.status === "detached"\n'
                '          ? v_flex().pl(25).pb(6).text_size(12).text_color(t.accent).child("Detached. Click to reattach")\n'
                "          : this.details(t, P, k, s, now)))\n")
        return s
    raise SystemExit(f"unknown kind {kind}")


if __name__ == "__main__":
    kind, path = sys.argv[1], sys.argv[2]
    text = open(path).read()
    open(path, "w").write(apply(kind, text))
    print("patched", kind, path)
