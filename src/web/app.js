const TYPE_COLORS = {
  decision: "#58a6ff", preference: "#bc8cff", context: "#3fb950",
  bug: "#f85149", pattern: "#d29922", architecture: "#39c5cf",
};
const RELATION_COLORS = { related: "#6e7681", supersedes: "#d29922", contradicts: "#f85149" };

const el = (id) => document.getElementById(id);
const filters = { relation: true, similarity: true, tag: true };
let pulses = new Map(); // id -> animation start ms

const Graph = ForceGraph()(el("graph"))
  .backgroundColor("#0b0e14")
  .nodeId("id")
  .nodeRelSize(4)
  .nodeLabel((n) => `<div style="max-width:240px;padding:2px 4px">${escapeHtml(n.label)}<br><span style="color:#8b949e">${n.type} · ${n.scope}</span></div>`)
  .linkColor((l) => l.kind === "relation" ? (RELATION_COLORS[l.relationType] || "#6e7681")
                 : l.kind === "similarity" ? "#30363d" : "#21262d")
  .linkLineDash((l) => l.kind === "similarity" ? [2, 3] : null)
  .linkDirectionalArrowLength((l) => l.kind === "relation" && l.relationType !== "related" ? 3 : 0)
  .linkVisibility((l) => filters[l.kind])
  .onNodeClick(showPanel)
  .nodeCanvasObject((node, ctx, scale) => {
    const r = (3 + node.importance * 6);
    const alpha = Math.max(0.25, node.strength);
    const p = pulses.get(node.id);
    if (p != null) {
      const t = (performance.now() - p) / 600;
      if (t < 1) {
        ctx.beginPath(); ctx.arc(node.x, node.y, r + (1 - t) * 14, 0, 2 * Math.PI);
        ctx.strokeStyle = `${TYPE_COLORS[node.type] || "#888888"}${Math.floor((1 - t) * 200).toString(16).padStart(2, "0")}`;
        ctx.lineWidth = 1.5 / scale; ctx.stroke();
      } else pulses.delete(node.id);
    }
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = TYPE_COLORS[node.type] || "#888888"; ctx.fill();
    if (node.scope === "shared") { ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = "#e3b341"; ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (node._hl) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = "#ffffff"; ctx.stroke(); }
  });

let lastIds = new Set();
let fitted = false;
async function load() {
  const data = await (await fetch("/api/graph")).json();
  el("empty").style.display = data.nodes.length ? "none" : "flex";
  const now = performance.now();
  for (const n of data.nodes) if (!lastIds.has(n.id)) pulses.set(n.id, now);
  lastIds = new Set(data.nodes.map((n) => n.id));
  Graph.graphData(data);
  // Center/fit once after the first non-empty layout settles.
  if (!fitted && data.nodes.length) {
    fitted = true;
    setTimeout(() => Graph.zoomToFit(500, 60), 700);
  }
}

function showPanel(node) {
  fetch(`/api/node/${node.id}`).then((r) => r.json()).then((m) => {
    const panel = el("panel");
    panel.style.display = "block";
    panel.innerHTML = `<h3>${node.type}</h3><div>${escapeHtml(m.content || node.label)}</div>
      <div class="meta">scope: ${node.scope} · importance: ${node.importance} · tags: ${(node.tags||[]).join(", ") || "—"}</div>
      <button id="forget">Forget</button>`;
    el("forget").onclick = async () => {
      await fetch("/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: node.id }) });
      panel.style.display = "none"; load();
    };
  }).catch(() => {});
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

el("search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  for (const n of Graph.graphData().nodes) n._hl = !!q && n.label.toLowerCase().includes(q);
  Graph.graphData(Graph.graphData()); // trigger repaint
});

for (const kind of ["relation", "similarity", "tag"]) {
  el(`t-${kind}`).addEventListener("change", (e) => { filters[kind] = e.target.checked; Graph.linkVisibility((l) => filters[l.kind]); });
}

el("legend").innerHTML = Object.entries(TYPE_COLORS)
  .map(([t, c]) => `<span><i class="dot" style="background:${c}"></i>${t}</span>`).join("");

const es = new EventSource("/api/events");
es.addEventListener("change", load);
es.addEventListener("ready", load);
load();
