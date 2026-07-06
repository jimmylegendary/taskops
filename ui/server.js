#!/usr/bin/env node
// TaskOps live web app (v1.0 live-UI) — a thin read/write layer over ANY file-as-truth TaskOps work dir.
// OPEN any work folder at runtime (this session's run, a daemon's, another AI agent's — all file-based): the UI
// projects its task graph, per-task run graph, and the human-delegation queue, live-watches it, and resolves a
// human delegation by writing DECISION/BASIS into the task .md (the same edit TaskOps trusts — cannot mint a
// completion; verify-grounding still gates verified_done). Dependency-free (node + lib-taskops).
//   usage: node ui/server.js [work-dir] [port]   (work-dir optional — open one from the UI)
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, watch, statSync, readdirSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProject, deriveExternalResolutionStatus, readBody, parseMarkdownFile } from '../cli/lib-taskops.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[3] || process.env.PORT || 4317);
// stay alive through transient fs races while a work is being written by concurrent workers
process.on('uncaughtException', (e) => { console.error('[uncaught]', e && e.code ? e.code : e); });
process.on('unhandledRejection', () => {});
let WORK = process.argv[2] || process.env.TASKOPS_WORK || null;
let watcher = null;

const DECISION_PLACEHOLDER = '<resolver: the concrete, downstream-consumable choice — a value, not prose>';
const BASIS_PLACEHOLDER = '<resolver: the grounds for this decision>';
const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 600);
const section = (body, heading) => {
  const lines = String(body || '').split(/\r?\n/); const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return ''; const out = [];
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) break; out.push(lines[i]); } return out.join('\n').trim();
};
const safeBody = (p) => { try { return p ? readBody(p) : ''; } catch { return ''; } };

// a dir is a TaskOps work iff it has an index.md whose entityType is 'work'
function isWork(dir) { try { return existsSync(join(dir, 'index.md')) && parseMarkdownFile(join(dir, 'index.md')).entityType === 'work'; } catch { return false; } }
function workTitle(dir) { try { const w = parseMarkdownFile(join(dir, 'index.md')); return w.title || w.id || dir; } catch { return dir; } }

// the task-level EoW ("End of Work") attesting a task's completion, with its reason (e.g. runner_verified)
function taskEow(parsed, taskId, tgvId) {
  for (const e of parsed.eowNodes.values()) {
    if (e.graphType === 'task' && e.attachedToType === 'task' && e.attachedToId === taskId && (!tgvId || !e.taskGroupVersionId || e.taskGroupVersionId === tgvId)) return e;
  }
  return null;
}
// the run graph for a single task: its run node(s), their review nodes, EoWs on those nodes, and the edges among them
function taskRunGraph(parsed, task) {
  const nodes = [], edges = [], seen = new Set();
  const pushNode = (n, extra) => { if (seen.has(n.id)) return; seen.add(n.id); nodes.push({ id: n.id, type: n.type, status: n.status, title: n.title || n.id, decision: (n.reviewReport && n.reviewReport.decision) || null, verified: !!(n.reviewReport && n.reviewReport.verified === true), ...extra }); };
  for (const rr of (task.runRefs || [])) {
    const run = parsed.runs.get(rr.runId); if (!run) continue;
    const mine = run.nodes.filter((n) => n.sourceTaskId === task.id || n.id === rr.runNodeId);
    const mineIds = new Set(mine.map((n) => n.id));
    const reviews = run.nodes.filter((n) => n.type === 'review' && mineIds.has(n.reviewsRunNodeId));
    for (const n of mine) pushNode(n, { role: rr.role || null });
    for (const n of reviews) { pushNode(n); edges.push({ from: n.reviewsRunNodeId, to: n.id, type: 'reviews' }); }
    for (const e of run.edges) if (seen.has(e.fromRunNodeId) && seen.has(e.toRunNodeId)) edges.push({ from: e.fromRunNodeId, to: e.toRunNodeId, type: e.edgeType });
    for (const eow of (run.eows || [])) if (seen.has(eow.attachedToId)) { pushNode({ id: eow.id, type: 'eow', status: eow.status, title: eow.reason }, { reason: eow.reason }); edges.push({ from: eow.attachedToId, to: eow.id, type: 'eow' }); }
  }
  return { nodes, edges };
}

// --- SSE + watch (rebinds when the open work changes) ---
const clients = new Set();
let lastPing = 0;
const broadcast = () => { const now = Date.now(); if (now - lastPing < 150) return; lastPing = now; for (const res of clients) res.write('event: update\ndata: {}\n\n'); };
function rewatch() {
  try { if (watcher) watcher.close(); } catch {} watcher = null;
  if (WORK && existsSync(WORK)) {
    try { watcher = watch(WORK, { recursive: true }, () => broadcast()); watcher.on('error', () => {}); } catch {}
  }
}
function setWork(path) {
  const abs = resolve(path || '');
  if (!abs || !existsSync(abs)) return { ok: false, error: 'folder not found: ' + path };
  if (!isWork(abs)) return { ok: false, error: 'not a TaskOps work folder (no work index.md): ' + abs };
  WORK = abs; rewatch(); broadcast(); return { ok: true, work: abs, title: workTitle(abs) };
}
if (WORK) { const r = setWork(WORK); if (!r.ok) { console.error(r.error); WORK = null; } }

// list TaskOps works under a root (one level deep + the root itself)
function listWorks(root) {
  const abs = resolve(root || '.'); const out = [];
  if (isWork(abs)) out.push({ path: abs, title: workTitle(abs) });
  try { for (const e of readdirSync(abs, { withFileTypes: true })) { if (e.isDirectory()) { const p = join(abs, e.name); if (isWork(p)) out.push({ path: p, title: workTitle(p) }); } } } catch {}
  return out;
}

// --- projections (over the currently-open WORK) ---
function projectGraph() {
  if (!WORK) return { tasks: [], edges: [], closure: null, errors: 0, noWork: true };
  const parsed = parseProject(WORK);
  const tasks = [...parsed.tasks.values()].map((t) => {
    const delegation = deriveExternalResolutionStatus({ resolverKind: t.resolverKind, body: safeBody(t.path) });
    return { id: t.id, title: t.title || t.id, status: t.status, runReadiness: t.runReadiness || null, resolverKind: t.resolverKind || null, taskGroupId: t.taskGroupId, order: Number(t.order) || 0, childTaskGroupId: t.childTaskGroupId || null, blockedBy: (Array.isArray(t.blockedBy) ? t.blockedBy : []).map((b) => (b && typeof b === 'object' ? (b.taskId || b.id || b.ref) : b)).filter(Boolean), delegation, hasRun: (t.runRefs || []).length > 0, awaitingHuman: t.resolverKind === 'human' && (delegation === 'waiting' || delegation === 'invalid'), eow: (taskEow(parsed, t.id, t.taskGroupVersionId) || {}).reason || null };
  });
  const byId = new Map(tasks.map((t) => [t.id, t])); const edges = [];
  for (const t of tasks) { if (t.childTaskGroupId) for (const c of tasks.filter((x) => x.taskGroupId === t.childTaskGroupId)) edges.push({ from: t.id, to: c.id, type: 'decompose' }); for (const b of t.blockedBy) if (byId.has(b)) edges.push({ from: b, to: t.id, type: 'blocks' }); }
  const rootTgId = (parsed.project && parsed.project.activeRootTaskGroupId) || null;
  return { tasks, edges, closure: parsed.closure ? { complete: !!parsed.closure.complete } : null, errors: (parsed.errors || []).length, work: WORK, workTitle: workTitle(WORK), language: (parsed.project && parsed.project.language) || null, rootTaskGroupId: rootTgId };
}
function projectQueue() {
  if (!WORK) return [];
  // surface every assigned human gate; `ready` = blockers cleared (answerable now) vs upcoming (still blocked)
  return [...parseProject(WORK).tasks.values()].filter((t) => t.resolverKind === 'human' && !['done', 'cancelled'].includes(t.status)).map((t) => {
    const body = safeBody(t.path); const st = deriveExternalResolutionStatus({ resolverKind: 'human', body });
    if (st !== 'waiting' && st !== 'invalid') return null;
    return { id: t.id, title: t.title || t.id, status: st, ready: t.status !== 'blocked', question: section(body, '## QUESTION'), options: section(body, '## OPTIONS'), escalationBasis: section(body, '## ESCALATION_BASIS') };
  }).filter(Boolean);
}
function projectTask(id) {
  if (!WORK) return null;
  const parsed = parseProject(WORK);
  const t = [...parsed.tasks.values()].find((x) => x.id === id); if (!t) return null;
  const body = safeBody(t.path);
  const runNodes = (t.runRefs || []).map((rr) => { const p = join(WORK, 'runs', rr.runId, 'nodes', `${rr.runNodeId}.md`); if (!existsSync(p)) return null; let n; try { n = parseMarkdownFile(p); } catch { return null; } const rp = join(WORK, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`); let review = null; if (existsSync(rp)) { try { review = parseMarkdownFile(rp).reviewReport || null; } catch {} } return { runId: rr.runId, id: rr.runNodeId, type: n.type || 'run', status: n.status, role: rr.role || null, decision: review ? review.decision : null, verified: review ? review.verified === true : null }; }).filter(Boolean);
  const eow = taskEow(parsed, t.id, t.taskGroupVersionId);
  return { id: t.id, title: t.title || t.id, objective: t.objective || '', status: t.status, resolverKind: t.resolverKind || null, runReadiness: t.runReadiness || null, acceptanceMode: (t.acceptance && t.acceptance.mode) || 'informational', delegation: deriveExternalResolutionStatus({ resolverKind: t.resolverKind, body }), question: section(body, '## QUESTION'), decision: section(body, '## DECISION'), runNodes, runGraph: taskRunGraph(parsed, t), eow: eow ? { reason: eow.reason, status: eow.status, declaredBy: eow.declaredBy || null } : null };
}
function resolveDelegation(id, decision, basis) {
  if (!WORK) return { ok: false, error: 'no work open' };
  const t = [...parseProject(WORK).tasks.values()].find((x) => x.id === id);
  if (!t) return { ok: false, error: 'task not found' };
  if (t.resolverKind !== 'human') return { ok: false, error: 'not a human delegation' };
  if (!String(decision || '').trim()) return { ok: false, error: 'a DECISION is required' };
  let raw; try { raw = readFileSync(t.path, 'utf8'); } catch { return { ok: false, error: 'cannot read task' }; }
  if (!raw.includes(DECISION_PLACEHOLDER)) return { ok: false, error: 'no open decision block (already resolved?)' };
  raw = raw.replace(DECISION_PLACEHOLDER, oneLine(decision)).replace(BASIS_PLACEHOLDER, oneLine(basis) || 'resolved via UI');
  writeFileSync(t.path, raw); return { ok: true };
}

// --- HTTP ---
const json = (res, obj, code = 200) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const readBodyReq = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => res(b)); });

createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`); const p = u.pathname;
  try {
    if (p === '/api/state') return json(res, { work: WORK, title: WORK ? workTitle(WORK) : null, open: !!WORK });
    if (p === '/api/graph') return json(res, projectGraph());
    if (p === '/api/queue') return json(res, projectQueue());
    if (p === '/api/works') return json(res, listWorks(u.searchParams.get('root') || process.cwd()));
    if (p.startsWith('/api/task/')) { const d = projectTask(decodeURIComponent(p.slice('/api/task/'.length))); return d ? json(res, d) : json(res, { error: 'not found' }, 404); }
    if (p === '/api/open' && req.method === 'POST') { const o = JSON.parse((await readBodyReq(req)) || '{}'); const r = setWork(o.path); return json(res, r, r.ok ? 200 : 400); }
    if (p.startsWith('/api/resolve/') && req.method === 'POST') { const o = JSON.parse((await readBodyReq(req)) || '{}'); const r = resolveDelegation(decodeURIComponent(p.slice('/api/resolve/'.length)), o.decision, o.basis); broadcast(); return json(res, r, r.ok ? 200 : 400); }
    if (p === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write('event: update\ndata: {}\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    const file = p === '/' ? 'index.html' : p.replace(/^\/+/, ''); const fp = join(HERE, 'public', file);
    if (existsSync(fp) && statSync(fp).isFile()) { res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' }); return res.end(readFileSync(fp)); }
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, { error: String((e && e.message) || e) }, 500); }
}).listen(PORT, () => console.log(`TaskOps live UI on http://localhost:${PORT}  (open a work folder from the UI${WORK ? '; started on ' + WORK : ''})`));
