// How the tree is arranged, and the dragging that changes it. The arrangement is one shared value,
// so every layout's tree agrees: { groups: {spaceId: "work"}, machines: [names], sessions: {scope: [addresses]} }.
// Herdr keeps spaces in its own order, so a space's group and position are written back with
// space.move (ordered() does that); machines and sessions have no such order and live only here.
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { shared, setShared, run, openOverlay } from "herdr";

const KEY = "tree.arrange";
const SETTLE_MS = 15000;
const stored = () => shared(KEY) ?? {};
const save = (change) => setShared(KEY, { ...stored(), ...change });

export const GROUPS = ["personal", "work"];
export const groupOf = (id) => (stored().groups?.[id] === "work" ? "work" : "personal");

// `key` moved next to `over`, the rest as they were.
export function placed(list, key, over, before) {
  const out = list.filter((k) => k !== key);
  const at = out.indexOf(over);
  out.splice(at < 0 ? out.length : before ? at : at + 1, 0, key);
  return out;
}

// Personal and Work fold separately on each machine.
const foldKey = (machine, group) => `${group}:${machine ?? "local"}`;
export const groupFolded = (machine, group) => (stored().folded ?? []).includes(foldKey(machine, group));
export function toggleGroup(machine, group) {
  const key = foldKey(machine, group);
  const folded = stored().folded ?? [];
  save({ folded: folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key] });
}

// Those with a saved place first, in it; new ones after, as they came.
export function inOrder(items, order, keyOf = (x) => x) {
  const at = new Map((order ?? []).map((k, n) => [k, n]));
  const rank = (x) => at.get(keyOf(x)) ?? Infinity;
  return items.map((x, n) => [x, n]).sort(([a, n], [b, m]) => (rank(a) === rank(b) ? n - m : rank(a) - rank(b))).map(([x]) => x);
}

export const machinesInOrder = (names) => inOrder(names, stored().machines);

// New sessions go last, and nothing moves on its own: the address is the order they were started.
export const byAddress = (x, y) => x.address.localeCompare(y.address, undefined, { numeric: true });

// A pinned session stays on top; the rest keep where they were dragged.
export function sessionsInOrder(scope, items) {
  const order = stored().sessions?.[String(scope)];
  return inOrder(items, order, (a) => a.address).map((a, n) => [a, n])
    .sort(([a, n], [b, m]) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || n - m).map(([a]) => a);
}

// The order just dropped, held until Herdr's own order catches up: a remote machine's can lag.
let settling = null;

// A new space joins the group of the space that was showing when it was made, if it's on the same
// machine. Herdr shows a new space at once; a machine coming back brings several, or doesn't show them,
// so only one unseen space that's now showing counts as new.
let seen = null;
let before = null;
function adoptNewSpace(rows) {
  const fresh = rows.filter((r) => !seen?.has(r.w.id));
  const made = seen && fresh.length === 1 && !fresh[0].tree && fresh[0].w.active ? fresh[0].w : null;
  if (made && before?.group === "work" && before.machine === (made.machine ?? null)) {
    save({ groups: { ...(stored().groups ?? {}), [made.id]: "work" } });
  }
  seen = new Set([...(seen ?? []), ...rows.map((r) => r.w.id)]);
  let head = null;
  for (const r of rows) {
    if (!r.tree) head = r;
    if (r.w.active && head) before = { group: groupOf(head.w.id), machine: head.w.machine ?? null };
  }
}

// Each machine's rows: Personal then Work, worktrees staying under their checkout.
export function arrangedRows(rows, core) {
  adoptNewSpace(rows);
  const blocks = [];
  for (const r of rows) {
    if (r.tree && blocks.length) blocks.at(-1).push(r);
    else blocks.push([r]);
  }
  if (settling && Date.now() - settling.at > SETTLE_MS) settling = null;
  const at = new Map((settling?.order ?? []).map((id, n) => [id, n]));
  const machineRank = new Map();
  for (const [r] of blocks) if (!machineRank.has(r.w.machine ?? null)) machineRank.set(r.w.machine ?? null, machineRank.size);
  const out = blocks.map((rs, n) => ({ rs, n, group: groupOf(rs[0].w.id), id: rs[0].w.id, m: machineRank.get(rs[0].w.machine ?? null) }))
    .sort((a, b) => a.m - b.m || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity) || a.n - b.n)
    .flatMap((b) => b.rs.map((r) => ({ ...r, group: b.group })));
  if (settling && core.every((id, n) => id === out[n]?.w.id)) settling = null;
  return out;
}

// Brings Herdr's own order in line, so numbers and next/previous space match. Retried, as a write
// to a remote machine can lose a sync conflict.
let written = null;
export function writeOrder(rows, sp) {
  const order = sp.map((w) => w.id);
  const target = rows.map((r) => r.w.id);
  if (order.length !== target.length) return;   // some are still loading
  if (order.every((id, n) => id === target[n])) { written = null; return; }
  const key = JSON.stringify([order, target]);
  if (written?.key === key && Date.now() - written.at < 5000) return;
  written = { key, at: Date.now() };
  for (let n = 0; n < target.length; n++) {
    const from = order.indexOf(target[n]);
    if (from === n) continue;
    run("space.move", { id: target[n], index: n + 1 });
    order.splice(n, 0, order.splice(from, 1)[0]);
  }
}

// A space dropped on another row takes that row's group, and on a heading goes first in that group.
export function dropSpace(key, over, before, rows) {
  const tops = rows.filter((r) => !r.tree);
  const ids = tops.map((r) => r.w.id);
  const me = tops.find((r) => r.w.id === key);
  if (!me) return;
  let group, order;
  if (over.startsWith("group:")) {
    group = over.split(":")[1];
    const first = tops.find((r) => r.w.id !== key && r.group === group && (r.w.machine ?? null) === (me.w.machine ?? null));
    order = first ? placed(ids, key, first.w.id, true) : ids;
  } else {
    const target = tops.find((r) => r.w.id === over);
    if (!target) return;
    group = target.group;
    order = placed(ids, key, over, before);
  }
  const groups = { ...(stored().groups ?? {}) };
  if (group === "work") groups[key] = "work";
  else delete groups[key];
  save({ groups });
  settling = { order, at: Date.now() };
}

export function dropMachine(names, key, over, before) {
  save({ machines: placed(names, key, over, before) });
}

// ---- dragging ----
// A drag lands on the last place its line showed, so letting go between two rows still works.
let drag = null;

export const cancelDrag = () => { drag = null; };

export function finishDrag() {
  const d = drag;
  drag = null;
  if (d && d.over !== null && d.over !== d.key) d.onDrop(d.over, d.before);
}

export const startDrag = (item) => () => {
  drag = { kind: item.kind, scope: item.scope, key: item.key, level: item.level ?? 0, onDrop: item.onDrop, over: null, before: false };
};

// A place something can land. It only follows the pointer for a drag of its own kind and scope;
// a drag from elsewhere that can't land here hides the line, so it's clear nothing would happen.
export function dropArea(item, t, el) {
  const { kind, scope, key, level = 0, heading = false } = item;
  const lit = drag && drag.kind === kind && drag.scope === scope && drag.over === key && drag.key !== key;
  const lifted = drag && drag.kind === kind && drag.key === key && drag.over !== null && drag.over !== key;
  return el
    .relative()
    .when(Boolean(lifted), (x) => x.opacity(0.5))
    .when(Boolean(lit), (x) => x.child(div().absolute().left(0).right(0).h(2).bg(t.accent).when(drag?.before, (l) => l.top(0)).when(!drag?.before, (l) => l.bottom(0))))
    .on_mouse_move((e, cx) => {
      // Attached sessions sit inside their parent's card, which answers a drag of its own level.
      if (!drag || drag.kind !== kind || level > drag.level) return;
      if (drag.scope !== scope) {
        if (drag.over !== null) { drag.over = null; cx.notify(); }
        return;
      }
      const before = !heading && e.local_position.y < e.bounds.height / 2;
      if (drag.over !== key || drag.before !== before) {
        drag.over = key;
        drag.before = before;
        cx.notify();
      }
      cx.stop_propagation();
    });
}

// Something that can be picked up, and dropped on its own kind. Its press stops here so the card
// around an attached session doesn't pick itself up too.
export function draggable(item, t, el) {
  const start = startDrag(item);
  return dropArea(item, t, v_flex().id(`drag-${item.kind}-${item.key}`).flex_none().min_w(0).child(el))
    .on_mouse_down("left", (e, cx) => { start(e, cx); cx.stop_propagation(); });
}

export function sessionItem(scope, keys, key, t, el, level = 0) {
  return draggable({
    kind: "session", scope: String(scope), key, level,
    onDrop: (over, before) => save({ sessions: { ...(stored().sessions ?? {}), [String(scope)]: placed(keys, key, over, before) } }),
  }, t, el);
}

// A space's row, which can be dropped on any row or group heading on its machine.
export function spaceItem(r, rows, t, el) {
  const key = r.w.id;
  return draggable({ kind: "space", scope: String(r.w.machine ?? null), key, onDrop: (over, before) => dropSpace(key, over, before, rows) }, t, el);
}

// ---- starting something in a space ----
// Herdr's own menu, as the tab bar's button opens: a terminal or any agent, in a new tab of this space.
// It acts on the shown space, so that comes first. A row's press switches space or starts a drag,
// so this button stops its own.
// n: the space's plain terminals (terminals.js), shown beside the icon when there are any.
export function newTabButton(w, t, n = 0) {
  const stop = (_e, cx) => { cancelDrag(); cx.stop_propagation(); };
  return div().id(`space-new-tab-${w.id}`).h(18).min_w(18).when(n > 0, (el) => el.px(3)).gap(3).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.dim)
    .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(n > 0 ? `${n} terminal${n === 1 ? "" : "s"} open here (listed under TERMINALS). Click for a new terminal or agent` : "New terminal or agent here")
    .on_mouse_down("left", stop).on_mouse_up("left", stop)
    .on_click((e, cx) => {
      stop(e, cx);
      run("space.select", { id: w.id });
      openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 });
    })
    .child(svg("mods/workspace-chrome/terminal.svg").size(12))
    .when(n > 0, (el) => el.child(div().text_size(10.5).font_semibold().child(String(n))));
}
