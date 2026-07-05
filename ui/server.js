#!/usr/bin/env node
// TaskOps live web app (v1.0 live-UI) — a thin read/write layer over a file-as-truth TaskOps work dir.
// Projects the task graph, per-task run graph, and the human-delegation queue; pushes live updates over SSE; and
// resolves a human delegation by writing DECISION/BASIS into the task .md (the same edit TaskOps already trusts —
// it cannot mint a completion; verify-grounding still gates verified_done). Dependency-free (node + lib-taskops).
//   usage: node ui/server.js <work-dir> [port]
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, watch, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProject, deriveExternalResolutionStatus, readBody, parseMarkdownFile } from '../cli/lib-taskops.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.argv[2] || process.env.TASKOPS_WORK;
const PORT = Number(process.argv[3] || process.env.PORT || 4317);
if (!WORK || !existsSync(WORK)) { console.error('usage: node ui/server.js <work-dir> [port]'); process.exit(2); }

const DECISION_PLACEHOLDER = '<resolver: the concrete, downstream-consumable choice — a value, not prose>';
const BASIS_PLACEHOLDER = '<resolver: the grounds for this decision>';
const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 600);

function section(body, heading) {
  const lines = String(body || '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) break; out.push(lines[i]); }
  return out.join('\n').trim();
}
const safeBody = (p) => { try { return p ? readBody(p) : ''; } catch { return ''; } };

function projectGraph() {
  const parsed = parseProject(WORK);
  const tasks = [...parsed.tasks.values()].map((t) => {
    const delegation = deriveExternalResolutionStatus({ resolverKind: t.resolverKind, body: safeBody(t.path) });
    return {
      id: t.id, title: t.title || t.id, status: t.status, runReadiness: t.runReadiness || null,
      resolverKind: t.resolverKind || null, taskGroupId: t.taskGroupId, order: Number(t.order) || 0,
      childTaskGroupId: t.childTaskGroupId || null,
      blockedBy: (Array.isArray(t.blockedBy) ? t.blockedBy : []).map((b) => (b && typeof b === 'object' ? (b.taskId || b.id || b.ref) : b)).filter(Boolean),
      delegation, hasRun: (t.runRefs || []).length > 0,
      awaitingHuman: t.resolverKind === 'human' && (delegation === 'waiting' || delegation === 'invalid'),
    };
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const edges = [];
  for (const t of tasks) {
    if (t.childTaskGroupId) for (const c of tasks.filter((x) => x.taskGroupId === t.childTaskGroupId)) edges.push({ from: t.id, to: c.id, type: 'decompose' });
    for (const b of t.blockedBy) if (byId.has(b)) edges.push({ from: b, to: t.id, type: 'blocks' });
  }
  return { tasks, edges, closure: parsed.closure ? { complete: !!parsed.closure.complete } : null, errors: (parsed.errors || []).length };
}

function projectQueue() {
  const parsed = parseProject(WORK);
  return [...parsed.tasks.values()].filter((t) => t.resolverKind === 'human' && !['done', 'cancelled'].includes(t.status)).map((t) => {
    const body = safeBody(t.path);
    const st = deriveExternalResolutionStatus({ resolverKind: 'human', body });
    if (st !== 'waiting' && st !== 'invalid') return null;
    return { id: t.id, title: t.title || t.id, status: st, question: section(body, '## QUESTION'), options: section(body, '## OPTIONS'), escalationBasis: section(body, '## ESCALATION_BASIS') };
  }).filter(Boolean);
}

function projectTask(id) {
  const parsed = parseProject(WORK);
  const t = [...parsed.tasks.values()].find((x) => x.id === id);
  if (!t) return null;
  const body = safeBody(t.path);
  const runNodes = (t.runRefs || []).map((rr) => {
    const p = join(WORK, 'runs', rr.runId, 'nodes', `${rr.runNodeId}.md`);
    if (!existsSync(p)) return null;
    let n; try { n = parseMarkdownFile(p); } catch { return null; }
    const rp = join(WORK, 'runs', rr.runId, 'nodes', `review-${rr.runNodeId}.md`);
    let review = null; if (existsSync(rp)) { try { review = parseMarkdownFile(rp).reviewReport || null; } catch {} }
    return { runId: rr.runId, id: rr.runNodeId, type: n.type || 'run', status: n.status, role: rr.role || null, decision: review ? review.decision : null, verified: review ? review.verified === true : null };
  }).filter(Boolean);
  return {
    id: t.id, title: t.title || t.id, objective: t.objective || '', status: t.status, resolverKind: t.resolverKind || null,
    runReadiness: t.runReadiness || null, acceptanceMode: (t.acceptance && t.acceptance.mode) || 'informational',
    delegation: deriveExternalResolutionStatus({ resolverKind: t.resolverKind, body }),
    question: section(body, '## QUESTION'), decision: section(body, '## DECISION'), runNodes,
  };
}

function resolveDelegation(id, decision, basis) {
  const parsed = parseProject(WORK);
  const t = [...parsed.tasks.values()].find((x) => x.id === id);
  if (!t) return { ok: false, error: 'task not found' };
  if (t.resolverKind !== 'human') return { ok: false, error: 'not a human delegation' };
  if (!String(decision || '').trim()) return { ok: false, error: 'a DECISION is required' };
  let raw; try { raw = readFileSync(t.path, 'utf8'); } catch { return { ok: false, error: 'cannot read task' }; }
  if (!raw.includes(DECISION_PLACEHOLDER)) return { ok: false, error: 'no open decision block (already resolved?)' };
  raw = raw.replace(DECISION_PLACEHOLDER, oneLine(decision)).replace(BASIS_PLACEHOLDER, oneLine(basis) || 'resolved via UI');
  writeFileSync(t.path, raw);
  return { ok: true };
}

// --- SSE live push on work-dir changes ---
const clients = new Set();
let lastPing = 0;
function broadcast() { const now = Date.now(); if (now - lastPing < 150) return; lastPing = now; for (const res of clients) res.write('event: update\ndata: {}\n\n'); }
try { watch(WORK, { recursive: true }, () => broadcast()); } catch { /* recursive watch may be unsupported; falls back to no live push */ }

// --- HTTP ---
const json = (res, obj, code = 200) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  try {
    if (p === '/api/graph') return json(res, projectGraph());
    if (p === '/api/queue') return json(res, projectQueue());
    if (p.startsWith('/api/task/')) { const d = projectTask(decodeURIComponent(p.slice('/api/task/'.length))); return d ? json(res, d) : json(res, { error: 'not found' }, 404); }
    if (p.startsWith('/api/resolve/') && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => { let o = {}; try { o = JSON.parse(body || '{}'); } catch {} const r = resolveDelegation(decodeURIComponent(p.slice('/api/resolve/'.length)), o.decision, o.basis); broadcast(); json(res, r, r.ok ? 200 : 400); });
      return;
    }
    if (p === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write('event: update\ndata: {}\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    // static
    const file = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const fp = join(HERE, 'public', file);
    if (existsSync(fp) && statSync(fp).isFile()) { res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' }); return res.end(readFileSync(fp)); }
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, { error: String((e && e.message) || e) }, 500); }
}).listen(PORT, () => console.log(`TaskOps live UI on http://localhost:${PORT}  (work: ${WORK})`));
