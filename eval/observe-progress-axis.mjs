#!/usr/bin/env node
// progress 축 실 관측 (P1-P3 계측기의 첫 실전): repo 안의 모든 taskops work graph에 progressLedger를 일괄
// 적용해 (a) κ_reabsorb 분포를 시나리오 유형별로 보고 (b) progress ⟂ claimSafe 직교를 실증하며 (c) 3채널
// 지배 유형을 분류한다. 이론 문서 docs/theory/divergence-convergence-v0.md 의 반증가능 예측을 실 데이터로 친다.
//   usage: node eval/observe-progress-axis.mjs
import { readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProject } from '../cli/lib-taskops.js';
import { auditParsedWork } from '../cli/lib-audit.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function walk(dir, acc = []) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.git'].includes(e.name)) continue;
    if (e.name === 'task-groups') { acc.push(dir); continue; }
    walk(join(dir, e.name), acc);
  }
  return acc;
}

const works = walk(ROOT).sort();
const rows = [];
for (const w of works) {
  try {
    const audit = auditParsedWork(parseProject(w));
    const p = audit.progress;
    const dom = ['div', 'transport', 'elim']
      .map((k) => [k, k === 'div' ? p.aDiv : k === 'transport' ? p.aConvTransport : p.aConvElim])
      .sort((a, b) => b[1] - a[1])[0][0];
    rows.push({
      w: relative(ROOT, w), aDiv: p.aDiv, aT: p.aConvTransport, aE: p.aConvElim,
      kappa: p.kappaReabsorb, residual: p.residual, claimSafe: audit.claimSafe,
      dom, divN: p.channels.div.count, trN: p.channels.transport.count,
      unc: p.channels.elim.uncertifiedCount, undet: p.channels.elim.undeterminedCount,
    });
  } catch (e) { rows.push({ w: relative(ROOT, w), err: e.message.slice(0, 50) }); }
}

const ok = rows.filter((r) => !r.err);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`\n=== progress 축 실 관측: ${ok.length}/${rows.length} work (parse 성공) ===\n`);
console.log(pad('work', 52) + padL('A_div', 7) + padL('A_tr', 6) + padL('A_el', 6) + padL('κ', 8) + padL('resid', 8) + '  ' + pad('dom', 10) + 'claimSafe');
console.log('-'.repeat(104));
for (const r of rows) {
  if (r.err) { console.log(pad(r.w, 52) + '  ERR: ' + r.err); continue; }
  console.log(
    pad(r.w, 52) + padL(r.aDiv, 7) + padL(r.aT, 6) + padL(r.aE, 6) +
    padL(r.kappa ?? 'na', 8) + padL(r.residual, 8) + '  ' + pad(r.dom, 10) + r.claimSafe,
  );
}

// ── 분석 1: progress ⟂ claimSafe 직교 실증 (κ 높은데 claimSafe=false 있으면 직교의 증거) ──
console.log('\n=== 직교 실증: κ_reabsorb vs claimSafe ===');
const withK = ok.filter((r) => r.kappa !== null);
const hiK = withK.filter((r) => r.kappa >= 1);
const hiKunsafe = hiK.filter((r) => r.claimSafe === false);
console.log(`κ≥1 (수렴 우세) work: ${hiK.length}개 중 claimSafe=false: ${hiKunsafe.length}개`);
console.log(hiKunsafe.length > 0
  ? `  → 직교 확인: 잘 되접었어도(κ≥1) 정직성은 별개 — [${hiKunsafe.map((r) => r.w.split('/').pop()).join(', ')}]`
  : '  → 이 표본에선 κ≥1이 전부 claimSafe=true (직교 반례 없음 ≠ 상관 증명; n 작음)');

// ── 분석 2: residual 부호 = 발산 우세 vs 수렴 우세 ──
console.log('\n=== residual 부호 (발산 잔여 vs 초과 수렴) ===');
const pos = withK.filter((r) => r.residual > 0), neg = withK.filter((r) => r.residual < 0), zero = withK.filter((r) => r.residual === 0);
console.log(`발산 우세 (residual>0, 펼친 게 남음): ${pos.length}  |  수렴 우세 (<0): ${neg.length}  |  균형 (=0): ${zero.length}`);

// ── 분석 3: 3채널 지배 유형 ──
console.log('\n=== 3채널 지배 유형 ===');
for (const d of ['div', 'transport', 'elim']) {
  const g = ok.filter((r) => r.dom === d);
  console.log(`${pad(d + ' 지배', 14)}: ${g.length}개  [${g.map((r) => r.w.split('/').pop()).join(', ')}]`);
}

// ── 분석 4: κ 분포 요약 ──
const ks = withK.map((r) => r.kappa).sort((a, b) => a - b);
if (ks.length) {
  const q = (p) => ks[Math.min(ks.length - 1, Math.floor(p * ks.length))];
  console.log(`\n=== κ 분포 (n=${ks.length}) ===`);
  console.log(`min=${ks[0]} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} max=${ks[ks.length - 1]}`);
  console.log(`κ=null (aDiv=0, 순수 수렴/무발산): ${ok.length - withK.length}개`);
}
