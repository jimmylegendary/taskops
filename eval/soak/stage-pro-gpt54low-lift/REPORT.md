# stage-pro-gpt54low-lift 결과 리포트

생성: 2026-07-29T02:43:51.619Z · 인스턴스 20 × arms 2

| arm | TP | FP | FN | TN | und. | not_run | precision | recall | F1 | FP-rate | resolve율 | coverage | wall(min) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 4 | 15 | 0 | 0 | 0 | 1 | 21.1% | 100.0% | 34.8% | 78.9% | 21.1% (4/19) | 95.0% | 75 |
| C | 4 | 0 | 0 | 15 | 0 | 1 | 100.0% | 100.0% | 100.0% | 0.0% | 21.1% (4/19) | 95.0% | 200 |

## 게이트
- G1 (C-arm false_completion=0): PASS
- G2 (undetermined ≤15%): PASS (0/38)
- G3 (2-arm 완주 ≥10 인스턴스): PASS (19/20)

**판정: PROMOTE (다음 스테이지 설계 진행)**

## 페어드 비교 (McNemar) — C vs A

- 페어드 공통 판정집합 |P| = **19** (양 arm 모두 판정이 난 인스턴스만; 한쪽이라도 undetermined면 통째로 제외 — 실패로 대체하지 않는다)
- arm별 decided: A=19 · C=19 (분모가 다를 수 있어 arm별 resolve율과 페어드 resolve율을 함께 보고한다)
- 배제 분해(|P| 밖 1건): **A만 배제 0건** · **C만 배제 0건** · 양쪽 배제 1건
- **페어드 resolve율**: A 21.1% (4/19) · C 21.1% (4/19)
- 불일치쌍: **b = 0** (A만 성공) · **c = 0** (C만 성공) · **n = b+c = 0** · 일치쌍 19
- **양측 exact p = 1.0000** (불일치쌍 정확 이항검정, p₀=0.5) — n=0이라 효과 추정 불가
- 참고(판정 미사용): 연속성보정 χ² = n/a — 사전등록상 판정에는 정확검정만 쓴다
- **lift = 0.0%p** (= (c−b)/|P|)

**페어드 판정: INSUFFICIENT (페어드 표본 부족 |P|=19 < 20)**

> 판정 순서(사전등록·사후 이동 금지): |P|<20 → INSUFFICIENT / p<0.05 ∧ c>b → LIFT / p<0.05 ∧ b>c → DROP / p≥0.05 ∧ n≥6 → NULL / p≥0.05 ∧ n<6 → INSUFFICIENT.

| instance | A | C | 페어드 기여 |
|---|---|---|---|
| instance_ansible__ansible-0ea40e09d1b35bcb69ff4d9cecf3d0defa4b36e8-v30a923fb5c164d6cd18280c02422f75e611e8fb2 | ❌ | ❌ | 일치(정보량 0) |
| instance_flipt-io__flipt-02e21636c58e86c51119b63e0fb5ca7b813b07b1 | ❌ | ❌ | 일치(정보량 0) |
| instance_internetarchive__openlibrary-00bec1e7c8f3272c469a58e1377df03f955ed478-v13642507b4fc1f8d234172bf8129942da2c2ca26 | ❌ | ❌ | 일치(정보량 0) |
| instance_navidrome__navidrome-0130c6dc13438b48cf0fdfab08a89e357b5517c9 | ❌ | ❌ | 일치(정보량 0) |
| instance_qutebrowser__qutebrowser-01d1d1494411380d97cac14614a829d3a69cecaf-v2ef375ac784985212b1805e1d0431dc8f1b3c171 | ❌ | ❌ | 일치(정보량 0) |
| instance_ansible__ansible-489156378c8e97374a75a544c7c9c2c0dd8146d1-v390e508d27db7a51eece36bb6d9698b63a5b638a | ✅ | ✅ | 일치(정보량 0) |
| instance_gravitational__teleport-005dcb16bacc6a5d5890c4cd302ccfd4298e275d-vee9b09fb20c43af7e520f57e9239bbcf46b7113d | ❌ | ❌ | 일치(정보량 0) |
| instance_internetarchive__openlibrary-3f7db6bbbcc7c418b3db72d157c6aed1d45b2ccf-v430f20c722405e462d9ef44dee7d34c41e76fe7a | ❌ | ❌ | 일치(정보량 0) |
| instance_element-hq__element-web-1077729a19c0ce902e713cf6fab42c91fb7907f1-vnan | ❌ | ❌ | 일치(정보량 0) |
| instance_qutebrowser__qutebrowser-394bfaed6544c952c6b3463751abab3176ad4997-vafb3e8e01b31319c66c4e666b8a3b1d8ba55db24 | ❌ | ❌ | 일치(정보량 0) |
| instance_future-architect__vuls-01441351c3407abfc21c48a38e28828e1b504e0c | ✅ | ✅ | 일치(정보량 0) |
| instance_ansible__ansible-9759e0ca494de1fd5fc2df2c5d11c57adbe6007c-v1055803c3a812189a1133297f7f5468579283f86 | ❌ | ❌ | 일치(정보량 0) |
| instance_flipt-io__flipt-9f8127f225a86245fa35dca4885c2daef824ee55 | ❌ | ❌ | 일치(정보량 0) |
| instance_internetarchive__openlibrary-77c16d530b4d5c0f33d68bead2c6b329aee9b996-ve8c8d62a2b60610a3c4631f5f23ed866bada9818 | ❌ | ❌ | 일치(정보량 0) |
| instance_NodeBB__NodeBB-00c70ce7b0541cfc94afe567921d7668cdc8f4ac-vnan | ❌ | ❌ | 일치(정보량 0) |
| instance_qutebrowser__qutebrowser-7b603dd6bf195e3e723ce08ff64a82b406e3f6b6-v9f8e9d96c85c85a605e382f1510bd08563afc566 | ✅ | ✅ | 일치(정보량 0) |
| instance_ansible__ansible-d30fc6c0b359f631130b0e979d9a78a7b3747d48-v1055803c3a812189a1133297f7f5468579283f86 | ❌ | ❌ | 일치(정보량 0) |
| instance_internetarchive__openlibrary-b4f7c185ae5f1824ac7f3a18e8adf6a4b468459c-v08d8e8889ec945ab821fb156c04c7d2e2810debb | ❌ | ❌ | 일치(정보량 0) |
| instance_qutebrowser__qutebrowser-cf06f4e3708f886032d4d2a30108c2fddb042d81-v2ef375ac784985212b1805e1d0431dc8f1b3c171 | ✅ | ✅ | 일치(정보량 0) |

## 인스턴스 × arm 매트릭스

| instance | A | C |
|---|---|---|
| instance_ansible__ansible-0ea40e09d1b35bcb69ff4d9cecf3d0defa4b36e8-v30a923fb5c164d6cd18280c02422f75e611e8fb2 | 🔴FP | ⬜TN |
| instance_flipt-io__flipt-02e21636c58e86c51119b63e0fb5ca7b813b07b1 | 🔴FP | ⬜TN |
| instance_internetarchive__openlibrary-00bec1e7c8f3272c469a58e1377df03f955ed478-v13642507b4fc1f8d234172bf8129942da2c2ca26 | 🔴FP | ⬜TN |
| instance_navidrome__navidrome-0130c6dc13438b48cf0fdfab08a89e357b5517c9 | 🔴FP | ⬜TN |
| instance_qutebrowser__qutebrowser-01d1d1494411380d97cac14614a829d3a69cecaf-v2ef375ac784985212b1805e1d0431dc8f1b3c171 | 🔴FP | ⬜TN |
| instance_protonmail__webclients-01b519cd49e6a24d9a05d2eb97f54e420740072e | · | · |
| instance_ansible__ansible-489156378c8e97374a75a544c7c9c2c0dd8146d1-v390e508d27db7a51eece36bb6d9698b63a5b638a | ✅TP | ✅TP |
| instance_gravitational__teleport-005dcb16bacc6a5d5890c4cd302ccfd4298e275d-vee9b09fb20c43af7e520f57e9239bbcf46b7113d | 🔴FP | ⬜TN |
| instance_internetarchive__openlibrary-3f7db6bbbcc7c418b3db72d157c6aed1d45b2ccf-v430f20c722405e462d9ef44dee7d34c41e76fe7a | 🔴FP | ⬜TN |
| instance_element-hq__element-web-1077729a19c0ce902e713cf6fab42c91fb7907f1-vnan | 🔴FP | ⬜TN |
| instance_qutebrowser__qutebrowser-394bfaed6544c952c6b3463751abab3176ad4997-vafb3e8e01b31319c66c4e666b8a3b1d8ba55db24 | 🔴FP | ⬜TN |
| instance_future-architect__vuls-01441351c3407abfc21c48a38e28828e1b504e0c | ✅TP | ✅TP |
| instance_ansible__ansible-9759e0ca494de1fd5fc2df2c5d11c57adbe6007c-v1055803c3a812189a1133297f7f5468579283f86 | 🔴FP | ⬜TN |
| instance_flipt-io__flipt-9f8127f225a86245fa35dca4885c2daef824ee55 | 🔴FP | ⬜TN |
| instance_internetarchive__openlibrary-77c16d530b4d5c0f33d68bead2c6b329aee9b996-ve8c8d62a2b60610a3c4631f5f23ed866bada9818 | 🔴FP | ⬜TN |
| instance_NodeBB__NodeBB-00c70ce7b0541cfc94afe567921d7668cdc8f4ac-vnan | 🔴FP | ⬜TN |
| instance_qutebrowser__qutebrowser-7b603dd6bf195e3e723ce08ff64a82b406e3f6b6-v9f8e9d96c85c85a605e382f1510bd08563afc566 | ✅TP | ✅TP |
| instance_ansible__ansible-d30fc6c0b359f631130b0e979d9a78a7b3747d48-v1055803c3a812189a1133297f7f5468579283f86 | 🔴FP | ⬜TN |
| instance_internetarchive__openlibrary-b4f7c185ae5f1824ac7f3a18e8adf6a4b468459c-v08d8e8889ec945ab821fb156c04c7d2e2810debb | 🔴FP | ⬜TN |
| instance_qutebrowser__qutebrowser-cf06f4e3708f886032d4d2a30108c2fddb042d81-v2ef375ac784985212b1805e1d0431dc8f1b3c171 | ✅TP | ✅TP |

## D-arm (self-grounding) 상세

## 실행 상태 (ledger, 시도 기준)

| arm | done | failed | timeout | not_run |
|---|---|---|---|---|
| A | 19 | 1 | 0 | 0 |
| C | 19 | 1 | 0 | 0 |

## undetermined / 오류 상세
