// 페어드 2-arm 비교의 통계 코어 (부작용 없는 순수 함수 — import해도 아무것도 실행/기록하지 않는다).
// report-stage.mjs가 import하고, eval/soak/test-mcnemar.mjs가 합성 데이터로 직접 검증한다.
//
// 사전등록(STAGE-HAIKU-LIFT.md §통계): 판정에는 EXACT McNemar(불일치쌍에 대한 양측 정확 이항검정, p=0.5)만 쓴다.
// 연속성보정(Yates) χ²는 참고용으로 병기하되 판정에 절대 쓰지 않는다 — N=30에서 기대 불일치쌍 n은 대략 5~12로
// 정규근사가 요구하는 b+c≥25에 한참 못 미치고, Yates 보정도 n<10 구간에서는 불안정하다. 정확검정은 모든 n에서
// 타당하며 보정이 필요 없다.

// sum_{k=0..x} C(n,k) p^k (1-p)^(n-k) — 로그공간 (eval/scripts/audit_numbers.mjs:15-24와 동일 구현, 신규 의존성 0)
export function binomCdf(x, n, p) {
  let s = 0;
  for (let k = 0; k <= x; k++) {
    let lg = 0;
    for (let i = 0; i < k; i++) lg += Math.log(n - i) - Math.log(i + 1);
    s += Math.exp(lg + k * Math.log(p) + (n - k) * Math.log1p(-p));
  }
  return s;
}

// Clopper–Pearson 경계. alpha = **한쪽 꼬리 질량** (양측 95% 구간을 원하면 0.025를 넘긴다).
export function cpUpper(x, n, alpha = 0.05) {
  if (n === 0) return null;
  if (x >= n) return 1;
  let lo = x / n, hi = 1;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (binomCdf(x, n, mid) > alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export function cpLower(x, n, alpha = 0.05) {
  if (n === 0 || x <= 0) return 0;
  let lo = 0, hi = x / n;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (binomCdf(x - 1, n, mid) > 1 - alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// b = A만 성공한 인스턴스 수, c = C(taskops)만 성공한 인스턴스 수. 일치쌍(둘 다 성공/둘 다 실패)은 정보량 0이라
// McNemar에 들어가지 않는다 — 이것이 페어드 설계에서 인스턴스 난이도 편차를 자동으로 상쇄하는 지점이다.
// H0: 불일치쌍이 C쪽일 확률 = 0.5, 즉 c ~ Binomial(n, 0.5)
// 양측 p = min(1, 2 · Σ_{k=0}^{min(b,c)} C(n,k) · 0.5^n),  n = 0 이면 p = 1 (효과 추정 불가)
export function mcnemar(b, c) {
  const n = b + c;
  const pExact = n === 0 ? 1 : Math.min(1, 2 * binomCdf(Math.min(b, c), n, 0.5));
  // Yates 연속성보정은 |b−c| ≥ 1 을 전제로 한다. max(0,·) 클램프가 없으면 |b−c| ≤ 1 구간에서 (|b−c|−1)² 이 다시
  // 양수가 되어 **완전대칭이 치우친 결과보다 큰 χ²** 로 찍힌다: b=c=5 → (0−1)²/10 = 0.100 인데 b=6,c=5 → (1−1)²/11 = 0.
  // 판정에는 절대 쓰이지 않지만(pairedVerdict는 pExact만 참조) REPORT.md에 병기되는 값이라 오독 소지를 제거한다.
  const chi2Yates = n === 0 ? NaN : Math.pow(Math.max(0, Math.abs(b - c) - 1), 2) / n;   // 참고 병기 전용
  return { b, c, n, pExact, chi2Yates };
}

// 효과크기: π = c/n 에 대한 Clopper–Pearson 95% 구간을 lift 스케일로 사상. lift = n(2π − 1)/|P| (n 조건부).
export function liftInterval(b, c, sizeP) {
  const n = b + c;
  if (!(n > 0) || !(sizeP > 0)) return null;
  return [(n * (2 * cpLower(c, n, 0.025) - 1)) / sizeP, (n * (2 * cpUpper(c, n, 0.025) - 1)) / sizeP];
}

// 사전등록 판정 규칙 — 이 순서대로 평가하며 사후 이동은 금지한다.
export const PAIRED_MIN_P = 20;            // |P| < 20 → 페어드 표본 부족
export const PAIRED_MIN_DISCORDANT = 6;    // n < 6 → 최소 p = 2·0.5^n ≥ 0.0625, α=0.05 기각이 수학적으로 불가능
export function pairedVerdict({ b, c, n, pExact }, sizeP) {
  if (sizeP < PAIRED_MIN_P) return `INSUFFICIENT (페어드 표본 부족 |P|=${sizeP} < ${PAIRED_MIN_P})`;
  if (pExact < 0.05 && c > b) return 'LIFT (taskops가 약한 모델의 resolve율을 끌어올린다)';
  if (pExact < 0.05 && b > c) return 'DROP (이 구성에서 taskops는 해가 된다)';
  if (n >= PAIRED_MIN_DISCORDANT) return 'NULL (이 표본에서 효과 미검출 — "효과 없음"과 구별해 보고할 것)';
  return `INSUFFICIENT (불일치쌍 n=${n} < ${PAIRED_MIN_DISCORDANT} — 검정력 0)`;
}
