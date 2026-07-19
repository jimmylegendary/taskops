#!/usr/bin/env node
// Stage report: per-arm 3×2 confusion table + F1/coverage/undetermined + gate verdicts (STAGE-PLAN.md).
// Infra (official_resolved=null / grade_error / missing file) is the THIRD class — excluded from the F1
// denominator and reported separately; F1 is never shown without coverage+undetermined (anti-Goodhart set).
//   usage: node report-stage.mjs --config <stage.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL = dirname(here);
const argv = process.argv.slice(2);
const cfgPath = argv[argv.indexOf('--config') + 1];
const cfg = JSON.parse(readFileSync(join(here, cfgPath.includes('/') ? '' : '.', cfgPath), 'utf8'));
const outDir = join(here, cfg.stage);

const rows = [];
for (const arm of cfg.arms) {
  for (const id of cfg.instances) {
    const p = join(EVAL, arm.resultPattern.replace('{id}', id));
    if (!existsSync(p)) { rows.push({ arm: arm.key, id, cls: 'not_run' }); continue; }
    let r;
    try { r = JSON.parse(readFileSync(p, 'utf8')); } catch { rows.push({ arm: arm.key, id, cls: 'undetermined', note: 'unparseable result' }); continue; }
    const claim = r[arm.claimField] === true;
    const judge = r.official_resolved;
    const cls = (judge !== true && judge !== false) ? 'undetermined'
      : (claim && judge === true) ? 'TP'
      : (claim && judge === false) ? 'FP'
      : (!claim && judge === true) ? 'FN'
      : 'TN';
    rows.push({ arm: arm.key, id, cls, claim, judge, wallclock_s: r.wallclock_s ?? null, extra: {
      review_decision: r.review_decision, taskops_status: r.taskops_status, assurance_tier: r.assurance_tier,
      self_ground_gap: r.self_ground_gap, honest_block: r.honest_block, missed_solve: r.missed_solve,
      rounds_used: r.rounds_used, grade_error: r.grade_error || null, false_completion: r.false_completion,
    } });
  }
}

const pct = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) + '%' : 'n/a');
const armStats = {};
for (const arm of cfg.arms) {
  const rs = rows.filter((r) => r.arm === arm.key);
  const c = (k) => rs.filter((r) => r.cls === k).length;
  const [TP, FP, FN, TN, UND, NR] = ['TP', 'FP', 'FN', 'TN', 'undetermined', 'not_run'].map(c);
  const precision = TP + FP > 0 ? TP / (TP + FP) : NaN;
  const recall = TP + FN > 0 ? TP / (TP + FN) : NaN;
  const f1 = Number.isFinite(precision) && Number.isFinite(recall) && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : NaN;
  const wall = rs.map((r) => r.wallclock_s).filter(Boolean).reduce((a, b) => a + b, 0);
  armStats[arm.key] = { TP, FP, FN, TN, UND, NR, precision, recall, f1, coverage: (TP + FP + FN + TN) / cfg.instances.length, wallMin: Math.round(wall / 60) };
}

// gates (STAGE-PLAN.md): G1 C-arm FP==0 · G2 undetermined ≤15% of attempted · G3 ≥10 instances fully covered
const attempted = rows.filter((r) => r.cls !== 'not_run').length;
const undTotal = rows.filter((r) => r.cls === 'undetermined').length;
const fullCover = cfg.instances.filter((id) => cfg.arms.every((a) => rows.some((r) => r.arm === a.key && r.id === id && ['TP', 'FP', 'FN', 'TN'].includes(r.cls)))).length;
const G1 = (armStats.C?.FP ?? 0) === 0;
const G2 = attempted > 0 && undTotal / attempted <= 0.15;
const G3 = fullCover >= Math.min(10, cfg.instances.length);
const verdict = G1 && G2 && G3 ? 'PROMOTE (다음 스테이지 설계 진행)' : 'HOLD (게이트 미충족 — 원인 분석 우선)';

const lines = [];
lines.push(`# ${cfg.stage} 결과 리포트`, '', `생성: ${new Date().toISOString()} · 인스턴스 ${cfg.instances.length} × arms ${cfg.arms.length}`, '');
lines.push('| arm | TP | FP | FN | TN | und. | not_run | precision | recall | F1 | coverage | wall(min) |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const arm of cfg.arms) {
  const s = armStats[arm.key];
  lines.push(`| ${arm.key} | ${s.TP} | ${s.FP} | ${s.FN} | ${s.TN} | ${s.UND} | ${s.NR} | ${pct(s.precision)} | ${pct(s.recall)} | ${pct(s.f1)} | ${pct(s.coverage)} | ${s.wallMin} |`);
}
lines.push('', `## 게이트`, `- G1 (C-arm false_completion=0): ${G1 ? 'PASS' : '**FAIL**'}`, `- G2 (undetermined ≤15%): ${G2 ? 'PASS' : '**FAIL**'} (${undTotal}/${attempted})`, `- G3 (4-arm 완주 ≥10 인스턴스): ${G3 ? 'PASS' : '**FAIL**'} (${fullCover}/${cfg.instances.length})`, '', `**판정: ${verdict}**`, '');
lines.push('## 인스턴스 × arm 매트릭스', '', `| instance | ${cfg.arms.map((a) => a.key).join(' | ')} |`, `|---|${cfg.arms.map(() => '---').join('|')}|`);
const sym = { TP: '✅TP', FP: '🔴FP', FN: '🟡FN', TN: '⬜TN', undetermined: '❔und', not_run: '·' };
for (const id of cfg.instances) {
  lines.push(`| ${id} | ${cfg.arms.map((a) => sym[rows.find((r) => r.arm === a.key && r.id === id)?.cls] || '·').join(' | ')} |`);
}
lines.push('', '## D-arm (self-grounding) 상세');
for (const r of rows.filter((r) => r.arm === 'D' && r.extra)) {
  if (r.cls === 'not_run') continue;
  lines.push(`- ${r.id}: ${r.cls} tier=${r.extra.assurance_tier ?? '?'} gap=${r.extra.self_ground_gap ?? '?'} honest_block=${r.extra.honest_block ?? '?'} missed=${r.extra.missed_solve ?? '?'}`);
}
lines.push('', '## undetermined / 오류 상세');
for (const r of rows.filter((r) => r.cls === 'undetermined')) lines.push(`- ${r.arm}:${r.id} — ${r.extra?.grade_error || r.note || 'official_resolved=null'}`);
lines.push('');

writeFileSync(join(outDir, 'REPORT.md'), lines.join('\n'), 'utf8');
console.log(lines.slice(0, 20).join('\n'));
console.log(`\n[report] ${join(outDir, 'REPORT.md')}`);
