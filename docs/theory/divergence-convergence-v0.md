# 발산/수렴으로 재는 work-progress: 깊은 이해 문서

> 대상 아이디어: **work 전체에 대한 발산(divergence)/수렴(convergence) 점수를 측정·업데이트한다** — 초기 objective를 "압축된 context"로 보고, step마다 각 task node를 발산/수렴으로 분류·채점하며, 유한한 시간·자원 안에서 "발산된 것을 수렴시킨 정도"를 progress로 정의한다. (Jimmy, taskops의 work-progress 측정 × melete의 발산/수렴 사고)
>
> **한 줄 요지.** 발산/수렴은 "스스로 자라는 측도공간 위 자유에너지 `F = E_q[U] − T·H[q]`의 gradient flow"로 실재하고 그 접공간은 **transport(수렴) ⊕ reaction(발산)** 으로 갈리지만 — 이 둘은 gradient flow에서 단일 장 `δF/δμ`에 **노예화(slaved)** 되므로 "독립 축"이 아니라 "한 흐름의 두 국면"이고, 거기서 나오는 progress 스칼라는 objective가 옳은 국소에서만 규범적이며 taskops 관측만으로는 식별되지 않는다.

---

## 0. 정직한 총평 (먼저 결론부터)

이 문서는 아이디어를 7개 렌즈로 조명하고 하나의 통합 형식으로 묶은 뒤, 4축 적대 검증에 통과시킨 결과다. 결론을 먼저 못박는다.

**살아남은 것 (수학으로 뒷받침됨, 실제 문헌 확인):**
1. 발산/수렴의 공통 척추는 자유에너지 범함수 `F = E_q[U] − T·H[q] = T·D_KL(q‖π) + const`이며, 이것은 은유가 아니라 검증된 대상이다 (JKO 1998; VFE = −log evidence 상한, 등호는 q=posterior).
2. 발산과 수렴은 **연산의 종류가 다르다** — 수렴은 고정 공간 안의 질량 이동(Wasserstein transport), 발산은 공간 자체의 성장(Fisher-Rao reaction). Wasserstein–Fisher–Rao(Hellinger–Kantorovich) 기하가 이 분해를 정리 수준으로 준다 (Liero–Mielke–Savaré 2018).
3. objective는 **두 번** 들어간다: 수렴이 향하는 potential(`π ∝ e^{−U/T}`)이자 발산을 유한하게 가두는 confinement(`Z_T = ∫e^{−U/T} < ∞ ⟺ U가 coercive`). "무한 why"는 `U ≡ const`일 때의 `Z=∞`·평형 부재로 정확히 재정식화된다.
4. "유한 자원 안의 최선"은 절대 최적이 아니라 **예산이 강제하는 F의 바닥에 접함**(`F[q_τ] − F*_B ≈ 0`)으로 형식화된다 — 7 렌즈 전부 공유하는 구조.

**무너지거나 크게 약해진 것 (정직하게):**
1. **[orthogonality — blocker]** "발산·수렴을 독립 축으로 관리한다"는 헤드라인은 gradient flow에서 **거짓**이다. `v = −∇(δF/δμ)`와 `α = −(δF/δμ − mean)`는 둘 다 **같은 장 `δF/δμ`의 함수**다. 메트릭이 직교(`‖·‖²_WFR = ∫|v|² + κ⁻²∫α²`)라는 것은 "무한소 비용이 직교합"일 뿐 "두 축을 독립 제어할 수 있다"가 아니다. 최선(=steepest descent)을 따르는 한 발산과 수렴은 완전 상관이며, 독립으로 움직이려면 최적 경로를 이탈해야 한다.
2. **[normative — weak]** "수렴 = 최선"은 `U = U*`(주어진 objective가 참 objective)를 몰래 가정한다. `U ≠ U*`면 `D_KL(q‖π)` 감소는 **틀린 곳으로의 수렴 = 능동적 해악**(Goodhart)이고, 모델엔 이 gap을 재는 항이 없다. 비볼록·기만적(deceptive) U에서 greedy F-하강은 조기 국소최소를 "최선"으로 보상하고 탈출에 필요한 탐색을 벌한다 (Lehman–Stanley 2011; Kirkpatrick 1983). "발산을 수렴시킨 게 최선"은 이 regime에서 직접 반증된다.
3. **[measurability — weak]** 대표 지표 `F`, `D_KL(q‖π)`, WFR 분해, `κ_reabsorb`, 절대 progress(NCD)는 자유상수(`κ, T`, ground metric)와 오라클(`U`)을 고정하기 전엔 **식별되지 않는다**. `π, U, q_t, κ, T, g*` 전부 온라인 미관측. 견고히 관측 가능한 것은 조야한 rate proxy뿐이다.
4. **[forced-analogy — sound_with_caveats]** 척추(thermo↔OT↔FEP↔WFR)는 진짜 동형이지만, "4 렌즈가 **독립** 도달"이라는 견고성 주장은 과장이다 — 넷은 log-partition `logZ_T`의 변분/Legendre 특성화 하나를 4번 재서술한 **동어반복**이다. Lyapunov 렌즈는 모델 자체와 모순되는 category error(아래 §4.4), tree-search는 loose analogy.

**가장 깊은 미해결 (melete의 심장):** 모든 렌즈의 깔끔한 결과가 **target 고정**을 가정한다. 그러나 이 아이디어의 핵심("압축 context가 펼쳐지며 objective 자체가 드러난다")은 **발산이 U를 재정의한다**는 뜻으로 그 가정을 정면 위반한다. WFR조차 U를 고정하므로 `(q, U)` 결합 flow가 필요하고, 7 렌즈 어디에도 clean 형식이 없다.

---

## 1. 아이디어 재구성 — 내가 이렇게 이해했다

아이디어를 형식 대상으로 옮기면 다음 6개 명제로 분해된다.

**(A1) objective = 압축된 context.** 목표는 짧은 명세 `s`(프로그램/description)이고, work는 그것의 **해압축(decompression)** 궤적이다. 산출물 `g*`를 `s`에서 생성하는 데 아직 공급해야 할 정보량이 조건부 Kolmogorov 복잡도 `K(g* | s)`. "압축"은 은유가 아니라 "가장 짧은 기술"이라는 문자적 의미다.

**(A2) step = 발산/수렴 분류.** 시각 `t`의 작업상태를 어떤 대상 `D_t`(직렬화 description / 측도 / posterior / 탐색 프론티어 — 렌즈마다 다르게 realize)로 보고, 각 task node를 **발산**(새 미해결을 여는 unfolding)인지 **수렴**(목표를 만족하는 최소 기술로의 재압축)인지 분류하며 강도를 채점한다.

**(A3) 회계 방식은 미결정.** 점수를 (i) 하나의 global 수렴 점수에 `+/−` 가감하거나, (ii) 발산·수렴을 독립으로 관리한다 — 아이디어는 이 둘 중 무엇이 옳은지 열어둔다. **이 미결정의 해소가 이 문서의 중심 기술적 과제다.**

**(A4) 동시성 가정.** 압축된 context가 발산되어 펼쳐지면서, 동시에 수렴 가능한 item은 수렴한다. (펼침과 접힘이 배타적 시점이 아니라 병존.)

**(A5) 무한 발산 직관.** 어떤 task든 무한 시간에서는 무한히 발산 가능하다. "why"를 묻는 것은 무한 발산 가능하다 — 모든 개념을 결국 건드리고, 모든 것은 연결되어 있으므로.

**(A6) 유한-자원 최선 명제.** 유한한 시간·자원 하에서 progress를 발산/수렴 점수로 평가할 수 있고, **유한 시간 안에 발산된 것을 수렴시킨 것**이 "최선을 다한 것"이다.

이 재구성은 taskops의 관측량과 melete의 사고 모드에 이미 맞물려 있다:
- taskops: `understandingLevel`(known/partial/unknown), `unknowns[]`, `needs_decomposition→childTaskGroupId`(재귀 분해 tree), `needs_exploration`, `runReadiness`, `surpriseHistory`, `requiredCheck`/`assuranceTier`(verified vs self_verified), run graph의 `informs`/`closes_with` 엣지, `taskGroup` versioning.
- melete: 발산(divergent) 사고 = 펼침, 수렴(convergent) 사고 = 접힘. 결정적으로 melete는 **발산이 목표 자체를 발견**한다고 본다 — 이 지점이 뒤에서 모든 고정-target 렌즈와 충돌한다.

---

## 2. 거인의 어깨 지도 — 7 렌즈가 말하는 것과, 어디서 공통 구조로 수렴하는가

7개 렌즈 각각이 아이디어의 어느 부분을 정확히 조명하는지, 그리고 어디서 하나로 모이는지.

### 2.1 렌즈 요약표

| 렌즈 | objective(A1) | 발산 | 수렴 | 무한 발산(A5) | 유한 최선(A6) | 핵심 문헌 (검증) |
|---|---|---|---|---|---|---|
| **1. info-compression (MDL/Kolmogorov/rate-distortion)** | 최단 프로그램 `s` | 기술길이 `L(M_t)` 팽창(two-part 첫 항) | 잔여 `L(g*\|M_t)` 축소(둘째 항) | distortion 부재 시 무한 unfolding | budget-optimal `K^B(g*\|s)` | Rissanen 1978†; Cilibrasi–Vitányi 2005✓; Bennett+ 1998†; Tishby+ 1999✓ |
| **2. dynamical-Lyapunov (contraction)** | 목표 attractor `A*` | 양의 FTLE 방향 `Σ max(Λ_i,0)` | 음의 FTLE / contraction rate `β` | asymptotic `λ_1>0`, attractor 부재 | FTLE(horizon T)·edge of chaos | Lohmiller–Slotine 1998†; Oseledets 1968†; Langton 1990†; **Mitchell–Hraber–Crutchfield 1993✓(반례)** |
| **3. optimal-transport (JKO/Wasserstein flow)** | Gibbs 측도 `μ* ∝ e^{−U/ε}` | 엔트로피 증가 `ΔS>0` | potential 하강 `ΔU<0`, `W₂↓` | potential 제거 시 정상측도 부재 | Benamou–Brenier action `≤ B` | **JKO 1998✓**; Otto 2001†; McCann 1997†; **Liero–Mielke–Savaré 2018✓** |
| **4. Bayesian posterior contraction** | 진실 `θ₀`, estimand `ψ` | model expansion `Θ↪Θ×𝒰` (extra-Bayesian) | posterior 집중, `H(ψ\|D)↓` | metric entropy 발산 → 수축률 부재 | T-step BOED 최적정책 | **Ghosal–Ghosh–van der Vaart 2000✓**; Lindley 1956†; Itti–Baldi 2009†; Schwartz 1965‡ |
| **5. tree search (MCTS/UCT/A\*/Levin)** | 루트 `r`, goal test | branching / frontier 확장 | pruning + value backup | 무한 branching factor `b*→∞` | anytime BestEffort(B) | Kocsis–Szepesvári 2006†; Auer+ 2002†; Hart–Nilsson–Raphael 1968†; Allis+ 1994‡ |
| **6. free-energy / active inference** | 선호분포 `p(o\|C)` | complexity `D_KL[q(s)‖p(s)]`↑ (epistemic value) | accuracy↑ = surprise↓ (pragmatic) | epistemic value 무한성 | bounded rationality `β` | Friston 2010✓; Friston+ 2015†; **Ortega–Braun 2013†**; Da Costa+ 2020† |
| **7. thermo / self-organization (MaxEnt/dissipative/computation)** | 저-엔트로피 목표 `π` + 제약 | 엔트로피 생성 `dS⁺>0` | 국소 엔트로피 감소(산일구조) | 제약 없는 극한 = heat death | 기약 잔차 `Σ_min(B)` | Still+ 2012†; Prigogine–Nicolis 1977†; **Jaynes 1957†**; Landauer 1961† |

> ✓ = 이번 세션 WebSearch 독립 확인 · † = 파이프라인 선행 검증(marked verified) · ‡ = **unverified** (원문 확인 못 함 — Schwartz 1965, Allis+ 1994, Grünwald 2007, Pesin 1977, Li–Vitányi book, Parr–Pezzulo–Friston 2022 textbook은 인용 시 unverified로 취급)

### 2.2 렌즈들이 공통 구조로 수렴하는 5개 지점

7개가 서로 다른 어휘를 쓰지만 다섯 곳에서 같은 구조로 모인다.

**(C1) 자유에너지 범함수 `F = E_q[U] − T·H[q] = T·D_KL(q‖π) + const`.**
MDL(`L(M)+L(g*|M)`), OT(`U−εS`), FEP(`complexity−accuracy`), thermo(`U−TS`) 네 렌즈가 동일 범함수에 도달한다. 이것은 검증된 표준 대응이다: Kraft 부등식으로 codelength `= −log p`, 변분 자유에너지 `=` 음의 로그증거(surprise)의 상한이고 `q =` 참 posterior에서 등호(§0 검증). — **단, 아래 §4.5에서 이 "수렴"이 견고성의 증거가 아니라 동어반복임을 정직히 밝힌다.**

**(C2) objective = confinement / distortion / constraint (well-posedness 공급).**
rate-distortion/IB(Tishby+ 1999 — "distortion을 먼저 정하지 못하는 문제를 관련변수로 해결")·MaxEnt 제약(Jaynes 1957)·OT confining potential·attractor 부재 시 progress 붕괴(Lyapunov)·metric entropy 발산 시 수축률 소멸(Ghosal–vdV). 다섯이 독립적으로 "objective 없으면 F 무하계, 발산 무한"을 진술한다. `Z_T < ∞ ⟺ 유한 발산`. **"무한 why" = `U ≡ const`.**

**(C3) 발산과 수렴은 범주가 다른 연산: 공간-변경 vs 공간-내-flow.**
Bayesian(extra-Bayesian model expansion vs within-model inference)·MDL(`L(M)` vs `L(g*|M)`)·OT(Fisher-Rao reaction vs Wasserstein transport)·tree(expand vs backup)·Lyapunov(bifurcation vs contraction) — 다섯 렌즈가 독립적으로 "두 연산은 대칭 역함수가 아니다"에 도달한다. 결정적 근거: Lindley EIG `= I(ψ;D) ≥ 0` 이므로 정상 Bayes는 기대 엔트로피를 늘릴 수 없다 — **발산은 반드시 extra-Bayesian(모델확장) 이벤트**다. WFR가 이를 `transport ⊕ reaction` 직교분해로 정식화한다. **(이 항목은 §4에서 부분적으로 재확인되고 부분적으로 정정된다.)**

**(C4) 유한자원 최선 = 예산 강제 F 바닥에 접함.**
resource-bounded `K^t`/Levin(MDL)·FTLE-horizon(Lyapunov)·Benamou–Brenier action `≤ B`(OT)·T-step BOED 최적정책(Bayesian)·anytime(tree)·bounded rationality `β`(FEP)·기약 잔차 `Σ_min(B)`(thermo). 일곱 전부 동일 구조 — **절대 최적이 아니라 예산-상대 최적.**

**(C5) surprise = per-step KL = 주입정보 = 엔트로피생성, 그리고 그 포화 = 정지규칙.**
Bayesian surprise `KL(π_t‖π_{t−1})`(Itti–Baldi)·surprisal `−log p(o)`(FEP)·주입 비트(MDL)·dissipation(thermo)이 동일 관측량. saturation(`dS/dt→0`) = fixpoint = NESS = predictive-information 포화(Bialek–Nemenman–Tishby 2001) = MDL 정지 = novelty-bounded retry 종료. **단일 정지 판정.**

이 5개 수렴은 진짜다. 문제는 이것들로부터 아이디어의 **회계 설계(A3)**·**규범(A6)**·**측정**이 곧바로 따라 나오지 않는다는 것 — 그게 §3~§4다.

---

## 3. 통합 수학 모델 — 발산/수렴의 정량 정의, 축 판정, global 점수

### 3.1 통합 형식: 스스로 자라는 측도공간 위 자유에너지 gradient flow

**상태·목표.** work 상태 = **성장 가능한** configuration/hypothesis 공간 `Ω_t` 위 측도 `q_t ∈ M₊(Ω_t)`(정규화 불필요, mass = "살아있는 possibility 총량"). objective = 압축 context는 potential `U: Ω → ℝ`을 정의하고, 목표 = Gibbs 측도 `π ∝ exp(−U/T)`.

**수렴 범함수 (단일 스칼라).**
```
F_T[q] = E_q[U] − T·H[q] = T·D_KL(q‖π) + const,   Z_T = ∫ exp(−U/T) dx.
```
Progress = `D_KL(q_t‖π)` 감소. 자원온도 `T` = explore/exploit 계수 = bounded rationality의 `1/β` = rate-distortion Lagrange 승수. **(주의: 이 `T` 동일시는 rate-distortion↔thermo에서만 genuine이고 MCTS `c`·soft-Q `α`까지 묶는 건 forced — §4.5.)**

**동역학·발산/수렴 분해 (척추).** `F`의 gradient flow를 **Wasserstein–Fisher–Rao(Hellinger–Kantorovich)** 기하 위에서 잡는다. 접공간이 reaction 항을 가진 연속방정식으로 분해된다 (이번 세션 PDE 구조 확인):
```
∂_t q + div(q v) = q α,     ‖∂_t q‖²_WFR = ∫|v|² dq + (1/κ²)∫ α² dq.
```
- **transport `v`** = `π`로의 질량 이동 → **수렴-해결**(posterior contraction / backup / `−∇U` 하강).
- **reaction `α`** = 국소 질량 생성/소멸(**부호 있음**): `α>0` = **발산**(새 unknown·childTaskGroup·model expansion), `α<0` = **수렴-소거**(dead-end pruning/abandon).

**결정적 사실 (이번 세션 확인).** gradient flow에서
```
v = −∇(δF/δμ),     α = −(δF/δμ − ∫ δF/δμ dμ)      [spherical HK]
```
즉 `v`와 `α`는 **하나의 스칼라장 `δF/δμ`의 함수**다. 이 사실이 §3.3의 축 판정과 §4.1의 orthogonality demolition을 동시에 지배한다.

### 3.2 발산/수렴의 정량 정의 (rate로 정의, 상태합산 아님)

**발산 강도.** step의 발산 = reaction 양성분의 Fisher-Rao 성분:
```
A_div = ∫₀^τ (κ⁻² ∫ max(α,0)² dq) dt.
```
taskops proxy: `Σ_tree log(branching)` + 신규 unknowns 엔트로피 + `understandingLevel` 재개방.

**수렴 강도 (둘로 갈림 — 이게 핵심).**
```
A_conv^transport = ∫₀^τ (transport 하강률) dt   [Wasserstein length, ≥ 0, "solved"]
A_conv^elim      = ∫₀^τ (κ⁻² ∫ max(−α,0)² dq) dt  [Fisher-Rao 음성분, "abandoned/pruned"]
```
transport 수렴은 오라클 인증으로 게이팅(`verified closure × assuranceTier`); reaction-소거 수렴은 `pruned/blocked` 소거. 이 분해가 "solved vs abandoned 수렴 부호혼동"을 자동 해소한다.

**왜 rate 적분인가 — 상태합산은 틀린다.** per-node `±` 상태 점수의 running sum은 종속 task 간 공유정보를 이중계상한다: 비트/엔트로피는 subadditive(`K(x,y) ≤ K(x)+K(y)`, mutual info만큼 할인), `F`는 path-integral 형태가 아니면 비가법, `σ`는 규약상수 의존. **해법: 상태를 합하지 말고 rate를 궤적 위에서 적분하라 — path action은 정의상 가법이다.** 이것이 Jimmy의 "`±` 누적" 직관을 살리면서 subadditivity를 고치는 유일한 올바른 스칼라화다. (원안의 "엔트로피 델타 누적"은 그대로면 틀림.)

### 3.3 축 독립성 판정 — **독립 아님, 슬레이빙된 두 국면**

아이디어(A3)의 두 옵션을 판정한다. 결론: **1축(±) 도 아니고 자유 2축도 아니다. "구분되지만 gradient flow에서 노예화된 두 국면"이다.**

**근거1 (범주 차이 ⇒ 순진한 1축 배제).** 수렴(transport, 고정 공간 내 flow)과 발산(reaction, 공간 성장)은 연산 종류가 다르다(C3). 범주가 다른 두 연산은 "한 연산의 부호반전=양끝"일 수 없다. WFR 접공간이 transport-장과 reaction-장의 direct sum(`‖·‖²=∫|v|²+κ⁻²∫α²`)이라는 사실이 비-공선성의 정확한 진술.

**근거2 (그러나 슬레이빙 ⇒ 자유 2축도 아님).** `v`와 `α`가 둘 다 `δF/δμ`의 함수이므로(§3.1), **최선(steepest descent)을 따르는 한 발산과 수렴은 완전 상관**이다. 메트릭 직교(block-diagonal)는 "무한소 kinetic energy가 직교합"일 뿐 "두 성분을 독립 제어"가 아니다 — 이 구별이 §4.1의 핵심.

**근거3 (부호축의 복권).** reaction `α ∈ ℝ`은 **부호 있는 단일 스칼라**다. `α>0`(발산=열기) vs `α<0`(수렴=소거)은 **문자 그대로 한 축의 두 부호**. 즉 **reaction 채널 안에서는 Jimmy의 원래 `±` 한 축 그림이 오히려 옳다.** 진짜로 갈리는 것은 (부호축 reaction) vs (항상 `≥0`인 transport) 둘뿐이다.

**정직한 최종 구조 (자유 3축 아님, 슬레이빙된 2-타입):**

| | transport 채널 | reaction 채널 |
|---|---|---|
| 기하 | Wasserstein (`∫\|v\|²`) | Fisher-Rao (`κ⁻²∫α²`) |
| 부호 | 항상 `≥ 0` | **부호 있음** (`α>0` 발산 / `α<0` 소거) |
| 의미 | 수렴-해결 (목표로 mass 이동) | 발산(열기) 또는 수렴-소거(닫기) |
| taskops | verified closure × tier | childTaskGroup 생성 / prune·abandon |
| 독립성 | gradient flow에서 `δF/δμ`에 **슬레이빙** | 동상(同上) |

`κ_reabsorb = (A_conv^transport + A_conv^elim)/A_div ∈ [0,1]`는 "펼친 것 중 되접은 비율"이자 Jimmy가 찾던 지표지만 — **§4.2·§4.3에서 이것이 lossy이자 non-identified임을 본다.**

### 3.4 global 점수 방식 판정

**판정: 다중 원장(attribution)이 primary·correct. 단일 `−F` 스칼라는 합법이되 lossy한 투영으로, 오직 고정-target·고정-`Ω` regime에서만 충분하다.**

`F = E_q[U] − T·H[q]`는 실재하고 `−F`(또는 `1 − F-gap 비`)는 valid progress 스칼라 — 그러나 이는 `(transport, reaction⁺, reaction⁻)` 다채널 상태를 `∇F` 방향으로 사영한 값이고, **사영은 재구성 불가**다. 스칼라가 무너지는 정확한 조건: (a) 공간 성장/이동 target ⇒ `U` 재정의 ⇒ `F` 리셋 ⇒ 누적 `±` 무의미; (b) 동시 팽창·수축(saddle) ⇒ net이 부호 은폐; (c) dark-room 퇴화 ⇒ 발산 안 열어 자명 수렴으로 오채점; (d) 가법성 파탄(§3.2). — 요약: **독립 관리하되 rate를 적분(상태 합산 금지); 단일 점수는 고정-target 국소에서만 신뢰.**

### 3.5 후보 정리 (정직)

이것은 하나의 primary 모델 + 두 경계다:
- **A (degenerate, 스칼라):** `Ω` 고정 · `κ→0`(질량생성 없음) · target 고정 ⇒ balanced Wasserstein flow ⇒ 단일 단조 스칼라. Jimmy의 "`±` global 점수"는 **정확히 이 regime에서만** 옳다.
- **B (full, primary):** 성장 `Ω` · WFR ⇒ transport/reaction 2-타입 · 원장 분리. A를 부분극한으로 포함.
- **C (미해결 경쟁후보):** `U` 자체가 발산으로 재정의됨(melete). WFR도 `U`를 고정하므로 `(q,U)` 결합 flow가 필요 — **7 렌즈 어디에도 clean 형식 없음.** 열린 frontier(§7).

---

## 4. 적대 검증이 살아남긴 것과 무너뜨린 것

4축(forced-analogy / orthogonality / measurability / normative-counterexamples)으로 통합 모델을 공격했다. 판정: forced-analogy = **sound_with_caveats**, 나머지 셋 = **weak**. 억지는 억지로, 살아남은 건 강하게.

### 4.1 orthogonality — **blocker: "독립 축"은 gradient flow에서 거짓**

이것이 가장 날카롭고 가장 중요한 정직이다. 이번 세션에 WFR gradient flow PDE를 원문으로 확인했다:
```
∂_t μ = div(μ ∇ δF/δμ) − μ (δF/δμ − ∫ δF/δμ dμ).
```
`velocity v = −∇(δF/δμ)`, `reaction α = −(δF/δμ − mean)` — **둘 다 하나의 `δF/δμ`가 결정한다.** `F`의 steepest descent를 따르는 한 `(v, α)`는 독립 자유도가 아니라 `δF/δμ`가 낳는 접벡터의 두 좌표다.

**유비로 정확히.** `ℝ²`에서 메트릭이 직교(`ds² = dx² + dy²`)여도, `−∇f`를 따르도록 구속되면 궤도 위 `dx`와 `dy`는 둘 다 `∇f`가 결정한다 — `x, y`를 독립으로 못 움직인다. **직교 메트릭 ≠ 독립 동역학.** 통합 모델은 tangent 부분공간의 메트릭-직교를 "독립 progress 축"과 동일시하는 category error를 범했다.

**살아남는 정정.** 두 채널은 **구분(distinguishable)**된다 — 임의 접벡터(에이전트의 suboptimal 이동 포함)를 transport + reaction으로 **분해(attribution)**하는 것은 well-posed. 따라서 "발산·수렴을 **따로 장부한다**"는 Jimmy의 직관은 **attribution/bookkeeping으로는 옳다.** 무너지는 것은 "**두 자유 차원으로 독립 제어**"라는 강한 판본이다. 그리고 두 채널을 실제로 독립으로 움직이려면 gradient flow를 이탈 = **차선책 행동** = "최선을 다함(A6)"의 정의를 스스로 위반한다. **헤드라인 "독립 2~3축"은 "구분되나 동역학적으로 결합(슬레이빙)된 두 국면"으로 정정되어야 한다.**

부수 정정: reaction `α`가 signed 스칼라이므로 그 축에서는 `div = −conv`가 정확히 성립 — "발산은 수렴의 음수 아닌가?"라는 공격을 모델의 자체 형식이 스스로 입증한다. "≥3 독립축"은 부호축 1개를 2개로 부풀린 것.

### 4.2 measurability — **weak: 대표 지표는 관측만으로 식별 불가**

- **`F = T·D_KL(q_t‖π)` 자체가 관측 불가.** `π ∝ e^{−U/T}`는 목표 potential `U`를 요구하는데 taskops가 가진 건 `completionCriteria`(짧은 텍스트)뿐, `U`라는 함수가 아니다. 두 run이 동일 `understandingLevel`·`|unknowns|`·`completionCriteria` 거리를 가져도 실제 `D_KL(q‖π)`가 임의로 다를 수 있다 → **북극성 지표가 observationally unidentified.**
- **WFR 분해는 순환적.** `A_div/A_conv`는 `q_t` 위 벡터장 `v, α`를 요구하는데, run graph는 이산 이벤트만 준다. "childTaskGroup = α>0", "verified closure = transport"는 측정이 아니라 **명명 규약(labeling)**이다. `q_t`의 구성법(run graph → `Ω` 위 측도)이 정의된 바 없어 `v, α` 추정 불가.
- **`κ_reabsorb`는 무차원 well-defined 수가 아니다.** `A_conv`(Wasserstein length)와 `A_div`(Fisher-Rao length)의 상대 단위가 자유상수 `κ, T`와 ground metric에 의존하고, 어느 것도 관측으로 고정되지 않는다. `κ`를 2배 잡으면 동일 run의 `κ_reabsorb`가 임의로 바뀐다.
- **`1 − NCD(D_t, g*)`는 온라인 측정 불가.** NCD는 두 객체를 모두 요구하는데(singly + pairwise concat, 이번 세션 확인) `g*`(완성된 산출물)는 run 도중 존재하지 않는다 — `g*`가 있으면 이미 끝난 것. 살릴 수 있는 건 `NCD(D_t, D_{t−1})`(step 자기거리)뿐이고 이건 **surprise 대리**이지 절대진행이 아니다.
- **`understandingLevel`(1/½/0) 노드 합산은 모델 자신의 가법성 교정과 모순.** 서수 라벨의 임의 기수화 + 종속 task 간 상태합산 = 모델이 §3.2에서 스스로 금지한 것.

**견고히 관측 가능한 것 (공정 평가).** 그래프 위상(branching/width/depth), 원자 카운트(`|unknowns|`, verify 이벤트, prune/abandon 수), step 자기거리 `NCD(D_t, D_{t−1})`. 이들은 `A_div·A_conv·surprise`의 **조야한 rate proxy**는 되지만 `F, D_KL(q‖π), κ_reabsorb, 절대진행`은 규약·오라클 고정 전엔 식별하지 못한다. **측정 가능성은 대체로 aspirational — 관측량은 "발산·수렴이 일어난다"는 정성 신호와 그 크기의 crude proxy까지만 지지한다.**

### 4.3 normative-counterexamples — **weak: "수렴 = 최선"은 U가 옳을 때만**

- **Goodhart(blocker).** progress = `D_KL(q_t‖π)↓`인데 `U`는 에이전트가 준 압축 context이지 ground truth `U*`가 아니다. `U ≠ U*`면 참 후회 `ρ = E_{q_τ}[U*] − min E[U*]`는 `q→π`로 갈수록 **커진다**(악화). 모델엔 `d(π, U_true)`를 재는 항이 하나도 없다. 확인: Goodhart's law(측정이 목표가 되면 좋은 측정이길 그친다), regressional/extremal Goodhart. 구체 반례: 코딩 task의 `U`='테스트 통과'가 `U*`='올바른 프로그램'과 갈리면 `U`로의 수렴은 test-overfit을 만든다. **규범 주장은 `U ≈ U*` regime 밖에서 UNDEFINED이며, 그 regime이 참인지 잴 관측량이 없다.**
- **비볼록 U에서 조기수렴 보상(blocker).** JKO/Wasserstein flow는 `U`가 볼록(또는 displacement-convex/log-Sobolev)일 때만 전역최소로 간다. 일반 work의 `U`는 비볼록 → 국소최소에 갇힌다. **Novelty search(Lehman–Stanley 2011, 이번 세션 확인): objective 함수 자체가 탐색을 dead end로 능동적 오도(deception)한다.** 기준 `F[q_τ] − F*_B ≈ 0` 하에서: greedy 조기수렴자는 국소 바닥에 빠르게 도달 → "최선"으로 채점; 현명한 탐색자는 국소최소 탈출에 필요한 uphill move(simulated annealing, Kirkpatrick 1983)로 horizon에서 `F`가 오히려 높아 → "덜 최선"으로 채점. **메트릭이 품질을 반전.** 게다가 `κ_reabsorb→1`("펼친 것 다 되접기")은 deceptive 문제에서 정확히 틀린 목표 — 옳은 행동은 예산 내 발산을 열어두는 것. **두 제안 스칼라(`F-gap`, `κ_reabsorb`) 모두 generic case에서 오순위. "발산을 수렴시킨 게 최선(A6)"을 직접 반증.**
- **"무한 발산 = why 재귀" 귀인 오진 (그러나 렌즈가 아이디어를 개선).** 참 메커니즘은 `U`의 non-coercivity / `Ω`의 non-compactness이며, "why"와 무관하다. 그리고 "모든 게 연결 ⇒ 무한 발산"은 topological reachability와 measure-theoretic significance를 혼동한다: coercive `U` + 온도 `T` 하에서 relevance는 `e^{−U/T}`로 지수감쇠하므로, 무한 개의 도달가능 방향이 유한(사실상 소멸)한 발산만 나른다(IB/relevance, Still+; Tishby). **즉 "무한 why"는 은유이지 메커니즘이 아니며, 발산은 `U`가 coercive면 이미 유한 — 이 렌즈가 naive 직관보다 오히려 더 정확하다.**
- **monotone F-하강이 필요한 발산을 벌한다.** verify-reject가 닫힌 분기를 재개방하는 비단조·버스티 궤적, basin 탈출용 uphill move를 gradient flow는 금지한다. reaction⁺ 재개방으로 non-monotonicity를 담아도 채점(잔차 `R=A_div−A_conv` 최소화)은 여전히 되접히지 않은 발산 1단위마다 실패로 과금 → 필요한 발산이 낭비로 오부호.

### 4.4 forced-analogy — **sound_with_caveats: 척추는 진짜, 곁가지는 억지**

- **진짜 동형 (살아남음).** (i) thermo↔OT: Fokker-Planck = `F(ρ)=∫Uρ+T∫ρlogρ`의 Wasserstein gradient flow (JKO 1998, 확인). (ii) FEP: 변분자유에너지 = `−log evidence`의 상한, `q=posterior`에서 등호 (확인). (iii) WFR transport⊕reaction = Onsager operator = Wasserstein diffusion + mass generation/absorption (Liero–Mielke–Savaré 2018, 확인 — "Optimal Transport **in Competition with Reaction**"). **이 셋은 은유가 아니라 구조적 isomorphism이며 모델 핵심 주장(수렴=transport, 발산=reaction)을 실제로 담지한다.**
- **Lyapunov = category error (모델 내부 모순, major).** `n`차원 위상공간 → 정확히 `n`개 Lyapunov exponent, 고정차원 + invariant measure 요구. 모델의 성장하는 `Ω_t`에서는 **애초에 정의되지 않는다.** 게다가 `λ_1>0`(팽창)은 고정 공간 위 flow의 stretching = **transport 채널**(속도장 `v`) 현상인데, 모델은 이를 발산=**reaction 채널**(질량생성 `α>0`)의 증거로 인용한다 — 자기 정의와 모순. 진짜 동형인 WFR reaction과 달리 Lyapunov는 loose 유비.
- **"4 렌즈 독립 도달"은 과장 (동어반복, major).** MDL·OT·FEP·thermo는 독립 확증이 아니라 log-partition `logZ_T`의 변분/Legendre 특성화라는 **단일 수학구조**의 4가지 재서술이다. `π∝e^{−U/T}`, 변분자유에너지, 엔트로피정칙 OT, `F=U−TS`는 문자 그대로 같은 대상. **keyInsight가 "검증된 항등식"이라 부르면서 동시에 "독립 도달"이라 부르는 건 자기모순 — 항등식이면 독립 증거가 될 수 없다.** 통합모델의 apparent robustness가 실제보다 부풀려짐. (다만 §0에서 밝혔듯 이것이 모델을 **틀리게** 만들진 않는다 — 하나의 견고한 정리가 여러 어휘로 확인된 것은 여전히 가치 있다. 과장된 것은 "증거의 개수"이지 "정리의 참"이 아니다.)
- **tree-search = loose analogy (major).** MCTS backup은 스칼라 value 추정치의 통계적 갱신(`Q←평균 rollout`)이지 측도의 Wasserstein transport(`∂_t q+div(qv)=0`)가 아니다 — 두 연산 사이 사상정리 부재. `A_conv=∫(transport 하강률)dt`를 tree backup으로 계산할 방법이 없다. WFR·JKO 같은 정리적 뒷받침이 이 렌즈엔 없음.
- **단일 `T` 과잉 동일시 (minor).** rate-distortion `β`↔thermo `β`는 genuine. 그러나 MCTS `c√(ln N/n)`의 `c`(UCB confidence 계수, 온도차원 아님)·soft-Q `α`·OT `ε`까지 "전부 같은 스칼라"는 dimensional analysis상 자동 아님. `T`가 BestEffort 예산 `B=1/β`를 정의하는 load-bearing 스칼라인데 pairwise만 되고 global identity는 미검증.
- **Bayesian model-expansion↔Fisher-Rao reaction (minor).** posterior contraction↔transport는 genuine(Ghosal–vdV). 그러나 이산적 가설추가를 매끄러운 mass-creation gradient flow(`α`)로 잇는 정리는 없다 — 발산측 다리는 아직 유비(후보 C와 일치).

### 4.5 요약: 무엇이 남았나

| 주장 | 판정 | 남은 형태 |
|---|---|---|
| 척추 `F=E_q[U]−T·H[q]` 실재 | **살아남음** | 검증된 정리(단, "독립 4-확증"은 동어반복) |
| 발산=reaction / 수렴=transport 구분 | **살아남음** | 진짜 동형(WFR/LMS 2018) |
| objective 이중역할(target+confinement) | **살아남음** | `Z_T<∞ ⟺ U coercive`, "무한 why"=`U≡const` |
| 유한최선 = 예산 바닥 접함 | **살아남음** | 7 렌즈 공유 구조 |
| **발산·수렴 독립 축 관리** | **정정** | 구분(attribution) O, 독립 제어 X — 슬레이빙된 두 국면 |
| **단일 `±` global 점수** | **부분 기각** | 고정-target 국소에서만; lossy 투영; reaction 부호축에선 오히려 `±`가 옳음 |
| **"수렴 = 최선"(A6)** | **약함** | `U≈U*`에서만 규범적; 비볼록/deceptive에서 오순위 |
| **관측 측정가능성** | **약함** | crude rate proxy만 식별; `F·κ_reabsorb`는 non-identified |
| Lyapunov / tree-search 렌즈 | **약함** | category error / loose analogy |

---

## 5. taskops 관측량으로의 측정 설계 스케치 (정직하게 scoped)

측정을 두 tier로 나눈다: **Tier-1 (지금 식별 가능, 견고)** 과 **Tier-2 (규약·오라클 고정 필요, aspirational)**. §4.2의 판정을 그대로 반영한다.

### 5.1 Tier-1 — run graph에서 직접 산출되는 조야한 rate proxy

이것만이 "규약 없이" 견고하다.

- **발산 rate** `d̂_t` = Δ(open leaf 수) + Δ(`Σ|unknowns|`) + `#(needs_decomposition→childTaskGroup)` + surprise spike. (관측: 재귀 tree 생성 leaf 누적, `unknowns[]` 길이.)
- **수렴-transport rate** `ĉ_t^tr` = `#(status→closed_with ∧ requiredCheck pass ∧ assuranceTier=verified)`. (오라클 게이팅된 닫힘만.)
- **수렴-elim rate** `ĉ_t^el` = `#(pruned/blocked/abandoned)`. (해 없이 닫힌 것 — transport와 **반드시 분리 계상**, §4.1의 solved vs abandoned.)
- **surprise** `ŝ_t` = `surpriseHistory` slope, 또는 `NCD(D_t, D_{t−1})` via gzip/zstd (step 자기거리; 절대진행 아님, surprise 대리).
- **해상도 비** `R̂_t = Σĉ^tr / (Σd̂)` ∈ [0,1] — "펼친 것 중 **인증된 해**로 접은 비율". (Tier-1의 1차 지표. `κ_reabsorb`의 관측 가능한 하위판.)

이 다섯은 A/B 실험·회귀·정지판정에 곧바로 쓸 수 있다. **단, 부호·가치는 못 준다** — 크기(magnitude)까지만.

### 5.2 Tier-2 — 규약·오라클을 명시적으로 고정한 뒤에만

`F, D_KL(q‖π), κ_reabsorb, 절대진행`을 원하면 다음을 **선언적으로** 고정해야 한다(그리고 그 선택을 기록해야 한다 — HATIR 원칙: 절대수 아닌 trend):
1. **ground metric on concept space** (unknown 간 거리) — embedding 선택. 임의적, 결과는 이 선택에 상대.
2. **`κ` (reaction↔transport 상대 가중)** 과 **`T` (온도)** — 관측 앵커 부재. 규약 고정.
3. **오라클 `U` proxy** — `completionCriteria` 충족 비율 + `understandingLevel` 가중(known=1/partial=½/unknown=0). **이 기수화는 근거 없음** — 순서통계로만 해석.

그 위에서:
- `F̂_t` ≈ `Σ(completionCriteria 거리) − T·H(frontier)`.
- `κ̂_reabsorb` = `(A_conv^tr + A_conv^el)/A_div` — **규약 상대값**. run 간 비교는 같은 규약 하에서만.
- 진단(수렴가능성 자체): `surpriseHistory` 누적곡선 성장 regime(BNT 2001) — **log 성장 ⇒ 유한 파라미터 = 유한시간 수렴가능; power-law ⇒ 비모수 = 진짜 "무한 why" = 유한시간 완전수렴 불가.** 이건 Tier-1 관측(surprise slope)으로 계산되면서 Tier-2 해석을 주는 다리다.

### 5.3 측정 설계의 정직한 한계

- **부호는 오라클 의존.** AND-tree(taskops 분해의 대부분)에서 branching은 "선택지 확대(좋음)"가 아니라 "필수 작업량 증가(중립/나쁨)" — 발산 부호가 OR-tree와 반대. 크기는 재도 부호는 objective 상대(§7-2).
- **인과 방향 지연.** 예측적/낭비 발산 판별(Still+ 2012)은 하류 closure를 봐야 하므로 **사후적** — 실시간 progress 점수에 지연, 유망 분기를 낭비로 오분류할 위험.
- **coverage(recall) 실시간 미관측.** `R̂_t = closed/opened`(precision)는 관측되나, "열었어야 할 것을 다 열었나"(recall)의 분모 relevant는 해가 나오기 전엔 미관측 — under-exploration은 **사후에만** 측정 가능. taskops의 진짜 측정 공백.

---

## 6. 반증가능한 예측

각 예측은 taskops 로그로 검증 가능하고, 참/거짓이 갈린다. 어느 모델(A/B/C 또는 적대 판정)이 옳은지 데이터가 정한다.

**P1 (슬레이빙 vs 독립 — §4.1 검정).** **best-effort로 판정된 run에서** step별 발산 proxy(`d̂_t`)와 수렴-transport proxy(`ĉ_t^tr`)의 시차상관이 **높아야** 한다(단일 `δF/δμ` 슬레이빙). 반대로 정체/차선 run에서는 상관이 무너진다.
→ *반증:* 최선 run에서도 두 rate가 통계적으로 독립(저상관)이면 "슬레이빙" 판정이 틀렸고 "자유 2축" 판본이 부활한다.

**P2 (수렴가능성 진단 — BNT regime).** `surpriseHistory` 누적곡선이 log 성장(slope ~ `1/t`)인 task는 예산 내 fixpoint(novelty-bounded retry 종료)에 도달하고, power-law 성장인 task는 **어떤 예산에서도** verified-close에 도달하지 못한다.
→ *반증:* power-law surprise task가 예산 내 안정적으로 닫히거나, log task가 만성적으로 안 닫히면 regime 진단이 틀림.

**P3 (Goodhart / deception — §4.3 검정, 규범 반증).** **deceptive task 하위집합**에서 `κ_reabsorb`(또는 `−F-gap`)는 오라클 최종 품질과 **무상관 또는 음의 상관**이어야 한다(조기 국소최소 = 높은 `κ_reabsorb` + 낮은 품질).
→ *반증:* deceptive subset에서도 `κ_reabsorb`가 품질과 강한 양의 상관이면 normative demolition이 과했고 "수렴=최선"이 더 강하게 성립.

**P4 (dark-room — §3.4(c) 검정).** 단일 `−F` 스칼라를 최대화하도록 라우팅하는 에이전트는 발산을 별도 관리하는 에이전트보다 **`A_div`가 낮고** oracle-rejected completion 비율이 **높아야** 한다(발산 회피로 자명 수렴).
→ *반증:* 단일 스칼라 에이전트의 탐색량·거부율이 이원 관리와 차이 없으면 dark-room 우려가 과장.

**P5 (AND vs OR 부호 반전 — §5.3 검정).** conjunctive(AND-heavy) taskGroup에서 branching(`d̂`)은 time-to-close와 **양의** 상관(필수 작업량↑), disjunctive(OR-heavy)에서는 **음의** 상관(선택지↑, 빨리 해결)이어야 한다.
→ *반증:* 두 경우에서 branching↔time-to-close 부호가 같으면 AND/OR 구분이 progress 부호에 무관.

**P6 (objective drift 리셋 — §3.4(a), 후보 C 검정).** `taskGroup` versioning으로 objective가 바뀐 run에서, drift **이전**의 누적 progress 점수는 drift **이후**의 최종 completion을 예측하지 못해야 한다(불연속 리셋). drift 없는 run에서는 예측해야 한다.
→ *반증:* pre-drift progress가 objective 변경을 가로질러도 completion을 잘 예측하면, "이동 target이 F를 리셋한다"는 명제가 약해지고 고정-target 렌즈가 생각보다 robust.

**P7 (발산의 생산성 사후판별 — Still+ 검정).** 하류에서 `closes_with`/`informs` 엣지로 수렴에 기여한 발산 분기(predictive)와 죽은 분기(dissipative)를 사후 분리하면, predictive 분기 비율이 높은 run이 동일 예산에서 더 높은 `R̂`를 달성해야 한다.
→ *반증:* predictive/wasteful 분기 비율이 최종 해상도와 무관하면 "유용 발산 vs 낭비 발산" 구분이 measurement noise.

---

## 7. 열린 문제

정직하게, 이 아이디어가 진짜로 미해결로 남긴 것들. (openProblems와 대응.)

**O1. 이동 target / `(q, U)` 결합 flow (가장 깊은 frontier, 후보 C).**
모든 렌즈의 깔끔한 결과가 target 고정을 가정하는데(Ghosal–vdV의 `θ₀`, MDL의 `g*`, OT의 `π`, tree의 root, FEP의 선호 `C`), melete의 핵심 주장 — **압축 context가 펼쳐지며 objective 자체가 드러난다** — 은 발산이 `U`를 재정의한다는 뜻으로 이 가정을 정면 위반한다. WFR조차 `U`를 고정한다. 필요한 것은 자기무모순 fixed-point / co-evolution `(q_t, U_t)` 결합 flow인데, 7 렌즈 어디에도 clean 형식이 없다. **이것이 아이디어의 가장 독창적이면서 가장 미형식화된 부분이다.**

**O2. 발산의 부호·가치를 오라클 없이 온라인 추정 가능한가.**
발산의 **크기**는 기하적(Fisher-Rao action, 측정가능)이나 그 **가치·부호**(생산적 vs 낭비, AND vs OR)는 objective 상대이자 오라클 게이팅이라 open-ended work에서 순환적이다. Still+ 2012의 predictive-information 판별은 하류 closure를 봐야 해 사후적. **ground-truth objective 없이 발산의 부호를 실시간 추정하는 원리가 있는가?**

**O3. 식별성(identifiability): 규약-불변 정규화가 존재하는가.**
`κ, T`, ground metric on concept space, `q_t` 구성법이 고정되기 전엔 `F, κ_reabsorb, 절대진행`이 non-identified다. **run graph로부터 `q_t`를 구성하는 canonical 절차와, 자유상수를 관측으로 앵커하는 방법 — 혹은 규약에 불변인 순서통계량 — 이 존재하는가?**

**O4. Goodhart gap을 관측으로 감지할 수 있는가.**
"수렴이 misspecified objective를 향하고 있음"(`U ≠ U*`)을 재는 항 `d(π, U_true)`가 모델에 없다. `U*`를 모르는 채 관측만으로 "우리는 지금 틀린 곳으로 잘 수렴하고 있다"를 조기 경보하는 신호가 있는가? (surprise regime 변화? verify-reject 재발산 패턴?)

**O5. deceptive landscape에 강건한 "최선" 규범.**
best-effort 기준(`F[q_τ]−F*_B≈0`)이 비볼록·기만적 `U`에서 조기 국소최소를 보상하고 필요한 uphill 탐색을 벌한다. **necessary exploration(basin 탈출용 발산)을 크레딧하는 "최선"의 정의** — novelty search·annealing의 통찰을 자유에너지 회계에 합치는 방법 — 은 아직 없다.

**O6. 이산 run graph 위 rate-integration의 실용 추정기.**
상태합산은 subadditivity로 틀리고 path-action 적분이 옳지만(§3.2), 이산·상징적 taskops 궤적에서 `A_div = ∫κ⁻²∫α²dq dt` 같은 연속량을 추정할 실제 estimator가 없다. **Jimmy 원안의 "엔트로피 델타 누적"을 가법 path-action으로 대체하는 구체 이산 알고리즘.**

**O7. AND-tree 회계의 WFR 통합.**
표준 search 렌즈는 OR-tree(자식 하나면 해결)를 가정하나 taskops 분해는 대개 conjunctive AND-tree. proof-number search(Allis+ 1994, **unverified**) 식 회계가 필요한데 이를 transport⊕reaction 그림에 정합적으로 넣는 형식이 아직 없다. AND-tree에서 발산 부호가 반대라는 사실(§5.3)이 `κ_reabsorb` 해석을 흔든다.

---

### 부록: 이번 세션 독립 확인한 핵심 문헌 (WebSearch)

- **Jordan, Kinderlehrer, Otto (1998)**, "The Variational Formulation of the Fokker-Planck Equation," *SIAM J. Math. Anal.* 29(1):1-17. — Fokker-Planck = 자유에너지의 Wasserstein steepest descent. (척추 C1)
- **Liero, Mielke, Savaré (2018)**, "Optimal Entropy-Transport problems and a new Hellinger-Kantorovich distance," *Invent. Math.* 211:969-1117. — transport + reaction(mass generation/absorption) 분해. (척추 C3, §4.4)
- **Tishby, Pereira, Bialek (1999)**, "The Information Bottleneck Method," *Proc. 37th Allerton.* — rate-distortion의 distortion-먼저 문제를 관련변수로 해결. (C2)
- **변분 자유에너지 = −log evidence 상한** (표준 변분추론; Friston FEP), 등호는 `q =` 참 posterior. (C1 identity, §4.4)
- **Cilibrasi, Vitányi (2005)**, "Clustering by Compression," *IEEE TIT* 51(4):1523-1545. — NCD는 singly + pairwise 압축 요구(∴ `g*` 필요, 온라인 불가). (§4.2)
- **Mitchell, Hraber, Crutchfield (1993)**, "Revisiting the Edge of Chaos," *Complex Systems* 7:89-130. — edge-of-chaos 최적성 주장 반박. (§2.1 렌즈2·7 반례)
- **WFR/Hellinger-Kantorovich gradient flow PDE**: `∂_t μ = div(μ∇δF/δμ) − μ(δF/δμ − ∫δF/δμ dμ)` — `v, α` 둘 다 `δF/δμ`의 함수(슬레이빙). (§4.1 blocker)
- **Lehman, Stanley (2011)**, "Abandoning Objectives: Evolution Through the Search for Novelty Alone," *Evolutionary Computation* 19(2). — objective 함수가 탐색을 dead end로 능동적 오도(deception). (§4.3 규범 반례)
- **Ghosal, Ghosh, van der Vaart (2000)**, "Convergence rates of posterior distributions," *Ann. Statist.* 28(2):500-531. — 수축률 = prior 집중 + metric entropy. (렌즈4)

*unverified(원문 미확인, 인용 시 그대로 표기):* Grünwald 2007, Li–Vitányi book, Schwartz 1965, Pesin 1977, Allis+ 1994, Parr–Pezzulo–Friston 2022. Kirkpatrick 1983(simulated annealing)·Strathern 1997(Goodhart)은 널리 확립되어 있으나 이번 세션 원문 재확인은 안 함.
---

## 추기 (2026-07-29): 예측된 공백의 실측과 그 처방

이 문서가 예측한 공백 — objective U 는 수렴 target 이자 **발산을 유한히 가두는 울타리**(Z_T<∞ ⟺ U coercive)이고
순수 why(U≡const)면 Z=∞, 평형 부재 = 무한발산 — 이 ALE 벤치에서 그대로 실측되었다.

`ranking_node_feature_parity_recovery`(full-spectrum tier, gpt-5.4/low, 31분) 1건:
decomposition 5 · exploration 5 · surprise 1 · **execute 0**. 예산을 전부 계획에 소비하고 산출물을 하나도 만들지 못했다.
realizedDepth 는 `expectedPlan.expectedDepth=2` 를 넘어 3+ 로 자랐고, 자식 17개는 전부 `requiredChecks` 가 없었다.

taskops 에는 발산 압력만 있고 수렴 압력이 없었다. execute 로 가는 유일한 문(`uncertaintyState:'known'` +
runnable contract)으로 미는 힘이 없었던 것이다.

처방은 `docs/specs/convergence-pressure.md` 의 **3축 × 2단계 게이트**다(예산 / 깊이 / 발산잔여, soft·hard, OR 결합).
soft 는 "발산이 실제로 새 possibility mass 를 여는가"(novelty)를 요구하고, hard 는 계획을 차단하고 실행만 남긴다.
실행할 것이 정말 없으면 억지로 done 을 만들지 않고 **정직하게 blocked** 로 끝낸다.

### 이 문서의 P4/P5 지표와의 경계

게이트는 `lib-progress-ledger.js` 의 `openDiv` / `closedShare` / `kappaReabsorb` / `confinementRatio` 를
**읽지 않는다.** 그 스칼라들의 gate·reward 사용 금지는 해당 파일 LIMITATIONS 에 명시돼 있고 그대로 유효하다.
게이트 전용 지표(`openPlanDebt`)는 ledger **밖**(`cli/lib-convergence.js`)에 새로 정의했으며, ledger 에서
재사용한 것은 순수 구조 측정 함수 `realizedDepthBelow` 의 export 하나뿐이다.
즉 이 추기는 **LIMITATIONS 의 개정이 아니다** — 그 제약을 우회하지 않고 지킨 채로 처방을 만든 기록이다.

## 추기 (2026-08-04): 3차 — 분해 품질 게이트

1·2차 게이트(3축 압력, soft/hard, 자식 계약 clamp, 예산 연장)를 넣고도 ALE 실측의 `execute` 는 여전히 0 이었다.
2차 실측(`conv2-K6gpho`)을 events.jsonl 로 직접 재확인한 결과 원인이 1차와 **다르다**:
게이트는 정상 발화했고(hard, `stopReason=convergence_blocked`) 억지 done 도 만들지 않았다.
문제는 **강제 실행 후보 풀이 구조적으로 비어 있었다**는 것이다.

- 생성된 자식 18개 중 `requiredChecks`/`requiredArtifacts` 를 가진 것은 **0개**. 검증 가능 acceptance 보유는
  루트 하나뿐이었고 그마저 분해가 `status=done` 으로 소비해 tier-1 에서 빠졌다.
- tier-2(연기된 부모 acceptance 재검증)는 살릴 수 있었으나 두 조건이 막았다.
  ① `convergenceDeferredAcceptance` 가 "부모 체크가 자식에 안 내려갔을 때만" 기록됐고,
  ② 설사 있어도 `hasOpenChildren` 이 걸렸다 — hard 미달 상황은 정의상 자식이 전부 열려 있으므로
  tier-2 는 **영원히 발화할 수 없었다**.

즉 병리는 "게이트가 약하다"가 아니라 **분해가 실행 가능한 단위를 하나도 만들지 못한다**는 것이다.
분해 LLM 은 "설계하기/도출하기" 류만 쏟아내고 실제로 만드는 일은 blocked/needs_exploration 으로 남겼다.

### 실행 가능(executable)의 정의 — 두 조건 AND

`readiness === 'runnable'` **AND** 검증 가능한 완료조건 보유(비어있지 않은 `requiredChecks` 명령 또는
`requiredArtifacts` 경로 1개 이상). 두 번째 조건이 빠지면 강제가 **거짓완료 공장**이 된다 — 실측 확인:
checks 도 artifacts 도 없는 task 는 `verifyChecks=true` 여도 검증을 건너뛰고 `status=done` 이 된다.
이 술어(`isExecutableTask`)는 **세 지점이 공유**한다: 분해 품질 평가 / `openPlanDebtPressure` / 강제 실행 후보 선택.

### 사다리 — 유도 → 강제 → 폴백 → 정직한 blocked

| 구간 | 동작 |
|---|---|
| soft 전(`level=none`) | **자유.** 넓은 분해를 막지 않는다(막으면 제1원칙 사고가 죽는다). 단 계측은 **항상** 한다. |
| soft | 거부하지 않고 **수치 피드백**만 다음 분해 프롬프트에 싣는다. |
| hard + enforce | `executable >= 1 AND unresolvedBlockerCount === 0` 요구. 미달이면 재분해 **1회**. |
| 재분해도 미달 | 분해 포기 → **부모를 통째로 실행**(부모가 검증 가능 acceptance 보유 시). |
| 부모도 검증 불가 | **정직한 blocked** + `needsManualReview`. `blockedBy` 는 건드리지 않는다(가짜 blocker 금지). |

경로 C — 자식 readiness 를 억지로 `runnable` 로 clamp — 는 **절대 금지**다. 실제로 못 하는데 할 수 있다고
우기는 것이 거짓완료다. 회귀 테스트(T8)가 "분해 직후 대비 상향된 자식 0개"를 전수 검사로 고정한다.

### soft 유도는 문구가 아니라 수치여야 한다

프롬프트에 "실행 가능하게 만들어라"라고 쓰는 것만으로는 행동이 안 바뀐다. 같은 교훈을 이 저장소에서 이미 얻었다 —
verify 재시도가 "실패했다"만 받고 *왜*를 못 받아 같은 접근을 반복했고(커밋 `ac2a545` 에서 수정), 분해도 똑같았다.
그래서 직전 분해의 **실측 정수**(자식 N개 중 실행가능 M개, runnable/verifiable/blocked/해소불가 blockedBy 내역)를
다음 분해 프롬프트에 싣는다. 피드백 소스는 부모 frontmatter `decompositionQuality` 우선,
없으면 런 스코프 미러(`runs/<runId>/index.md` 의 `convergenceDecompositionFeedback`, restart 내성).
이 피드백은 **pressure gate 의 통과/차단과 무관하게** 프롬프트 조립 단계에 붙는다 —
`divergenceNovelty` 의 `first_divergence` 규칙이 각 task/kind 의 첫 시도를 무조건 통과시키므로,
gate 결정에 얹으면 soft 가 행동을 바꿀 기회를 놓친다.

### 조기 종료의 급소 두 줄

- **적재를 항상 한다**: 부모가 검증 가능 acceptance 를 가지면 분해 성공 시 `convergenceDeferredAcceptance` 를
  **무조건** 기록한다(`uncovered` / `full` 분리 보관). `convergence_acceptance_descent_gap` **이벤트**는
  여전히 uncovered>0 일 때만 발화하므로 2차의 R2 의미는 불변이다.
- **`hasOpenChildren` → `hasExecutableOpenDescendant`**: 열린 자손 중 executable 이 하나라도 있으면 tier-2 제외,
  **전부 비실행일 때만** 부모가 되살아난다. 실행 가능한 자식이 있으면 tier-1 이 이미 그 자식을 골랐을 것이므로
  선점 위험이 없다. 이 한 줄이 폴백 B 를 실제로 작동시킨다.

### hard 에서 분해를 통과시키는 예외 (전체 스위트가 강제한 보정)

2차의 hard 는 planning 을 전면 차단한다. 그러면 hard 분해 품질 게이트가 **발화할 기회 자체가 없다**.
그래서 hard 에서 `decompose` 는 다음 두 조건이 **모두** 참일 때만 bounded 품질 게이트까지 통과시킨다:
① 이 런에 이미 `execute` 시도가 한 번이라도 있었고, ② 자기 자신을 제외한 강제 실행 후보가 하나도 없다.
실행 없이 planning 만 반복된 런은 기존 hard 사다리를 그대로 타 즉시 실행으로 수렴한다(2차 계약 불변,
`convergence-pressure-gate` 가 이를 고정한다). 통과한 분해도 수용/재분해 1회/부모 폴백/정직한 blocked 중
하나로 **반드시 종결**하므로 순환하지 않는다.

### 무한루프 방지 (5중)

(i) 재분해는 task 당 1회(`decompositionAttempt` + `CONVERGENCE_DEFAULTS.decomposition.maxRetries=1`).
(ii) `convergenceDecompositionAbandoned` 는 그 task 의 decompose 를 종결시킨다(어떤 level 에서도 execute 로 강등).
(iii) tier-2 는 `reverifiedAt` 스탬프로 부모당 1회.
(iv) `blockHonestly` 는 여전히 `stopReason` 을 세워 런을 종료한다 — 사다리가 길어졌을 뿐 순환하지 않는다.
(v) budget 축은 단조 증가라 level 이 hard 에서 내려가지 않는다.

구현 세부: `deriveDecompositionIds` 가 `tgv-<suffix>-v<attempt>` 를 반환하도록 확장했다(attempt=1 이면 기존 `-v1`).
이게 없으면 `performAgentDecomposition` 의 "이미 존재 → 재사용" 조기반환 때문에 재분해가 그대로 no-op 이 된다.

### debt 축의 두 결함도 함께 고쳤다

① `readiness === 'blocked'` 를 debt 계산에서 건너뛰고 있었다 — 분해 LLM 이 blocked 자식만 양산하면
debt 가 **오히려 내려가** 잡아야 할 병리를 축이 못 봤다. 이제 blocked 를 planDebt 에 포함하되
`blockedDebt` 로 분리 계상한다. ② executable 계산을 주입 술어로 교체해 정의를 통일했다.
debt 는 여전히 **soft 전용**이다 — hard 로 올리면 계획을 광범위하게 차단해 억지 분해를 유발한다.

### 관측

`decomposition_quality_evaluated` 는 mode(off/observe/enforce)와 level(none 포함) **무관하게 항상** 발화한다.
soft 전 자유 구간의 분해 품질을 계측해야 "유도 없이도 괜찮았는가"를 사후 판정할 수 있고, 게이트 도입 전/후 비교의
유일한 공통 지표가 되기 때문이다. 결정 이벤트는 `decomposition_quality_rejected` /
`decomposition_fallback_parent_execute` / `decomposition_quality_blocked_honest` 3종.
이벤트 payload 는 **정수와 id 배열만** 담는다 — 이벤트가 그대로 다음 프롬프트 피드백의 소스가 되므로
자유 텍스트를 실으면 프롬프트 인젝션 표면이 된다.

측정 타당성도 함께 고쳤다: `eval/adapters/run_ale.mjs` 의 `steps_used` 가 `countType('task_selected')` 였다 —
그건 **execute 스텝 수**이지 실제 소비 스텝이 아니다("예산 3/12" 라는 허상의 출처). 이제
`runner_stopped.stepsRun` 을 읽고 `execute_steps` 를 별도 필드로 분리한다.

## 추기 (2026-08-05): 5차 — `blocked_only` 앞의 사다리 선개입

### 진단: 게이트보다 먼저 이기는 종료

1~4차 내내 hard 사다리(재분해 → 폴백B → 정직한 blocked)는 **한 번도 발화하지 못했다**. 원인은 압력
임계가 아니라 **런루프의 순서**였다.

- `lib-runner.js` 런루프는 매 스텝 `pickNextAction` 을 부른다. 열린 task 가 전부 blocked 면
  `{ kind: 'stop', reason: 'blocked_only' }` 를 돌려준다.
- 그 `stop` 은 **즉시 `break`** 로 이어졌다. 반면 `computeConvergencePressure` /
  `applyConvergencePressure` 는 그 `if (next.kind === 'stop')` 블록 **뒤에** 있었다.

즉 게이트는 "next 가 있을 때만" 적용되는 후처리였고, "실행할 게 없다" 는 언제나 게이트보다 먼저 이겼다.
그래서 4차 실측이 `stepsRun 4 · stopReason=blocked_only · task_selected(execute)=0` 이었다.

### 처방: 후보가 비면 사다리를 먼저 한 번 태운다

`blocked_only` 로 끝내기 **전에** hard 사다리를 태운다(`attemptBlockedOnlyLadder`).

1. 강제 실행 후보 tier-1 → **tier-2**(`convergenceDeferredAcceptance` 를 가진 부모 되살리기)
2. 재분해를 포기한 부모 통째 실행(폴백B, `selectAbandonedParentExecutionCandidate`)
3. 그래도 없으면 그때 정직하게 `blocked_only`

**재분해가 이 사다리에 없는 이유**: 재분해 1회는 분해 품질 게이트(`closeDecomposeSuccess`)의 단계이고
그 시점엔 계획 후보가 존재한다. `blocked_only` 지점에서는 열린 계획 후보가 **정의상 0개**다(있었다면
`pickNextAction` 이 planning 을 반환했을 것). 그래서 사다리는 실행 단계에서 시작한다.

### tier-2 는 폴백B의 급소였다

루트처럼 **검증 가능한 acceptance 를 가진 부모**가 분해로 `status: done` 이 되면 후보 풀에서 영구
제외된다. 그 부모의 acceptance 는 `closeDecomposeSuccess` 가 `convergenceDeferredAcceptance` 로
스탬프해 두므로(mode≠off + 부모 검증가능일 때, 압력 level 과 무관), tier-2 가 그것을 되살려 재검증한다.
필드 적재는 이미 되고 있었고 — **소비 경로가 도달 불가능했을 뿐이다.**

### 거짓 완료 금지 / 자유도 보존 / 무한루프 금지

- 사다리는 후보를 **만들지 않는다**. `taskHasVerifiableAcceptance` 를 통과한 것만 고르고, 강제 실행
  스텝은 `verifyRequiredChecks: true` 로 runner 검증된다. 체크가 실패하면 부모는 `done` 이 아니다.
- `mode !== 'enforce'`(off/observe)에서는 절대 발화하지 않는다 — observe 는 측정만 한다.
- 무한루프 3중 방지: ① 런당 시도 상한(`BLOCKED_ONLY_LADDER_MAX_ATTEMPTS`), ② 이미 태운 taskId 재선택
  금지(런 스코프), ③ tier-2 는 `reverifiedAt` 스탬프가 찍힌 부모를 영구 제외(파일에 남는 단조 표식).
- 사다리 자체가 터져도(예: frontmatter 쓰기 EACCES) 런을 죽이지 않고
  `convergence_blocked_only_ladder_error` 를 남긴 뒤 원래의 정직한 `blocked_only` 로 되돌아간다.

### debt hard 임계는 그대로 둔다 (sustain=3)

4스텝 런은 dispatch 마다 평가하므로 debt 축을 4회 본다. 임계 초과가 계속되면 레벨은
`soft → soft → hard → hard` 로 3번째 평가에서 hard 에 **도달한다**. 즉 4스텝 런에서도 도달 가능하므로
임계를 낮출 근거가 없고, 낮추면 첫 평가부터 hard 가 되어 **soft 전 자유도(초기 넓은 분해)** 가 죽는다.
이 도달성은 `convergence-blocked-only-ladder.mjs` 가 결정적으로 검증한다.

### 관측

`convergence_blocked_only_ladder`(발화, `stopReasonDeferred` 포함) ·
`convergence_forced_execute`(`reason: 'blocked_only_ladder'`) ·
`convergence_deferred_acceptance_reverify` · `convergence_blocked_only_ladder_exhausted` ·
`convergence_blocked_only_ladder_error`. 런 결과에는 `convergence.blockedOnlyLadder`
(attempts / forcedExecutes / exhausted / errors / maxAttempts / rescuedTaskIds) 로 집계된다.
