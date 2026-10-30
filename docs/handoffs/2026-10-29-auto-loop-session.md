# 인수인계: auto-loop 세션 → 다음 세션 (2026-10-29)

다음 세션은 **이 파일부터 읽고** 시작합니다. 사용자에게는 **모든 설명을 한국어로** 합니다. 코드, 명령어, 경로만 영어로 둡니다(오늘 여러 번 영어로 답해서 지적받았습니다).

---

## 0. 한 줄 요약

Argus를 "관찰 대시보드"에서 **"AI 자동 루프(작업 → 검사 → 수정 → 반복)를 설계·지휘·관찰하는 도구"**로 키우는 중입니다. 첫 실전은 Kaggle **Google Quantum AI 양자 회로 컴파일 대회의 invsqrt 문제**입니다. 러너(M1)는 완성되어 실제 루프가 돌았고(반복 2회 연속 채택, −10.8%), **화면은 다른 세션(`wip/team-board`)이, 데이터(서버 API)는 이 세션이 맡기로** 했습니다. 서버 API가 다음 작업입니다.

---

## 1. 사용자가 정한 것 (바꾸지 말 것)

- **Argus의 정체성:** 관찰만 하지 않고, 세션에 내용을 주입하는 **조정자**까지 간다.
- **루프 구조:** **`ml-improve` 클래스**(모든 대회 공통 고정 요소) + **프리셋 3개**(optimization / data / simulation) + **대회별 짧은 스펙**. 설계 문서 §5.4.
- **검사 3단:** quick(smoke test, 매번) → score(validation, 매번) → sealed(held-out, 채택 직전만, 결과 비공개).
- **작업자 권한:** `bypassPermissions`(모든 권한). 단 `git push`와 Kaggle 제출은 차단.
- **설계 화면:** v1은 YAML 파일 + Argus 검사·미리보기.
- **대회:** Kaggriculture는 종료됨. 첫 대회는 [Google Quantum AI - Verifiable Quantum Circuit Compilation](https://www.kaggle.com/competitions/google-verifiable-quantum-circuit-compilation)(마감 2027-01-20, 규칙 동의 완료). **invsqrt → dfthcsos 순서, dqi는 제외**(PC 메모리 부족).
- **예산(반복 횟수·시간)은 미정.** 지금은 첫 시험용 임시값(5회·4시간).
- **M2 역할 분담:** 화면 = 프롬프트 보기 세션(`wip/team-board`), 데이터(서버 API·러너 보고) = auto-loop 세션.
- 병렬 세션은 **세션마다 브랜치 + `.worktrees/<이름>`**에서 작업한다.

---

## 2. 위치

| 무엇 | 어디 |
|---|---|
| 설계 문서 | `docs/specs/2026-10-29-auto-loop-design.md` (Argus, `main`에 합쳐짐 + 이 브랜치에서 갱신) |
| 선행연구 보고서 | `C:\Users\Jun\reports\AI 자동 루프 설계 선행연구.md` (조사 노트: `C:\Users\Jun\research_notes\AI 자동 루프 설계 선행연구\`) |
| 러너 코드 | `app/loop-runner/` (브랜치 `feat/auto-loop`, worktree `C:\Users\Jun\agents-observe\.worktrees\auto-loop`, 푸시 완료 `2778170`) |
| 화면 코드 (다른 세션) | 브랜치 `wip/team-board` (`app/client/src/lib/loops.ts`, `components/loops/*`, `components/cycle/cycle-ring.tsx`) |
| 화면 쪽 요청서 | `main`의 `docs/handoffs/2026-10-29-plan-view-to-auto-loop.md` §6 (`wip/team-board`에서 추가된 절) |
| 대회 작업 저장소 | `C:\Users\Jun\quantum-circuit-2026` (원격 없음, 로컬 커밋만). 기준 회로 생성 코드 `circuits/invsqrt/build.py` |
| 대회 데이터·공식 검증기 | `C:\Users\Jun\quantum-circuit-2026\data\` (git 제외) |
| 루프 폴더 | `C:\Users\Jun\.agents-observe\loops\qc-invsqrt\` (`spec.yaml`, `verifiers/`(고정 복사본·check.py·known_bad·sealed_salt), `runs/`, `research/`) |
| 첫 실행 | `runs/20261029-195431/` (journal.jsonl, logs/) — worktree `quantum-circuit-2026\.worktrees\loop-qc-invsqrt-20261029-195431`, 브랜치 `loop/qc-invsqrt/20261029-195431` |
| R 단계 조사 결과 | `loops\qc-invsqrt\research\papers.md`, `community.md`, `tooling.md`, `scripts/`(측정 스크립트), `notebooks/`(공개 노트북 35개, 실행 안 함) |

---

## 3. 지금 상태

### 3.1 첫 루프 (qc-invsqrt, 실행 `20261029-195431`)
- 평가기 점검: 기준 회로 2번 채점 모두 **2,076,774**(결정적), 봉인 통과, 나쁜 버전 거부 → 사용자 승인 후 시작.
- **#1 채택:** `c3` 상수 등록기를 필요할 때만 할당 → 260→246 큐비트, **1,964,948 (−5.38%)**.
- **#2 채택:** **1,853,122 (−5.69%)**. 누계 **−10.8%**.
- **#3 "거절"은 잘못된 판정입니다 (봉인 검사 시간 초과).** 처음에 "봉인 검사가 잡은 사례"라고 보고했지만 틀렸습니다. 실제로는:
  - 빠른 검사·본 채점 통과, **비용 1,605,810 = 232 큐비트 × 6,921.6 (최선본 대비 −13.3%)**. 커밋 `e82e54e`.
  - 봉인 검사가 **아무 출력 없이 13,904초(약 3시간 52분) 걸려 시간 초과**로 끝났습니다(21:10 시작 → 01:02 종료, 제한은 45분).
  - Windows 전원 기록상 그 사이 PC가 **절전(모던 스탠바이)에 들어갔고**, 02:34에 절전(Kernel-Power 42), 09:55에 깨어났습니다. 검사가 절전 중 멈췄고 타이머도 늦게 발동한 것으로 보입니다.
  - **러너 버그:** 검사 시간 초과를 "후보 실패"로 취급했습니다. 시간 초과는 후보가 아니라 **환경 문제**이므로 거절하지 말고 재시도하거나 일시정지해야 합니다(다음 세션 첫 수정).
  - **할 일:** `e82e54e`를 봉인 검사로 다시 채점하세요. 통과하면 #3은 채택이어야 합니다. 재개 전에 journal의 #3 판정을 어떻게 바로잡을지(수동 정정 이벤트 등) 정해야 합니다.
- **그 직후 러너가 멈춤:** 최선본(#2, `56e5991`)으로 되돌리는 `git reset --hard`가 02:34 절전 진입 무렵 실패하고 worktree에 `index.lock`이 남았습니다. git 프로세스가 없는 것을 확인하고 잠금을 지운 뒤 `56e5991`로 되돌려 두었습니다. **러너에 "오래된 index.lock 정리 + reset 재시도"도 넣어야 합니다.**
- **장시간 실행 시 PC 절전을 막아야 합니다**(예: 실행 중 `powercfg /requestsoverride` 또는 러너가 `SetThreadExecutionState`로 절전 방지). 사용자에게 방식 확인 필요.
- 따라서 실행은 **반복 3회 완료, 미종료** 상태입니다. 재개하면 반복 4부터 시작합니다(5회 예산 중 2회 남음).
- **확인·재개 방법 (PowerShell에서):**
  ```
  cd C:\Users\Jun\agents-observe\.worktrees\auto-loop\app\loop-runner
  node bin\argus-loop.mjs status qc-invsqrt
  cmd.exe /d /c "node bin\argus-loop.mjs resume qc-invsqrt 20261029-195431 > C:\Users\Jun\.agents-observe\loops\qc-invsqrt\run-console.log 2>&1"
  ```
  - 반복 도중 끊겼으면 재개 시 그 반복을 처음부터 다시 합니다. 작업자가 커밋까지 했다면 `candidate` 기록으로 **다시 채점만** 합니다.
  - `runs\.lock`이 남아 있고 그 pid가 죽었으면 자동으로 무시됩니다.
  - 이 실행은 **새 러너 코드 이전에 시작**되어 journal에 `state`/`iteration_started` 이벤트가 없습니다. 서버 API는 이런 옛 journal도 처리해야 합니다(§4.1).
  - 예산 5회가 끝나면 이제는 **budget 확인 요청**을 띄우고 대시보드나 터미널의 답을 기다립니다(`--yes`면 그냥 종료).
- 첫 루프가 끝나면 **사용자와 결과를 같이 검토**하기로 했습니다(작업 #7).

### 3.2 R 단계 조사 결과 (핵심만, 반드시 사용자에게 보고할 것)
- **공개 최고 회로와의 격차가 매우 큼:** 공개 노트북 최고는 **63 큐비트 × 1,329.5 = 102,349 (기준 대비 20.3배)**. 우리 루프는 1.12배 수준. 공개 상위 회로는 모두 **뉴턴-랩슨을 버리고** "정규화 → 구간별 2차 다항식 lookup → 덧셈·뺄셈만으로 Horner → 결과 비트로 바로 위상 → 측정으로 정리" 구조입니다(`community.md`).
- 최고 공개 회로(mrmeows/busyaprime)는 **Apache-2.0**이라 그대로 가져다 쓸 수 있지만, **그래도 되는지는 사용자 결정**이 필요합니다(대회 규칙상 공개 자료는 허용, 출처 표시 필요).
- 논문 조사(`papers.md`): 같은 방향(구간 lookup + 2차식)으로 비용 약 0.5M 추정(모델 계산, 미검증).
- 도구 조사(`tooling.md`): kickmix의 큐비트 수 = 접촉한 최대 qubit id + 1. 지연 할당·`3−z` 접기·이진 시프터로 **약 −11%를 실측**(공식 검증기 미실행). lookup 기반 추정 1.18M.
- **시사점:** 지금 루프는 "한 번에 작은 변경 하나"라서 **구조를 갈아엎는 개선(20배)**에 도달하기 어렵습니다. 아이디어 보드 + R 단계(작업 #11)와 "큰 재설계"를 허용하는 작업 방식이 필요합니다.

### 3.3 코드 상태
- `feat/auto-loop`(푸시됨): 러너 M1 + 오늘 추가분
  - 채점 중 오류가 나도 후보 보존(`candidate` 이벤트)
  - 진행 상태 `state` 이벤트(10단계), `iteration_started`, `gate_requested`(start/alert/budget/review, id 부여)
  - 대시보드 결정·중지는 `runs/<id>/control.jsonl`로 받음(터미널과 먼저 온 쪽), 중지 시 작업자 프로세스 종료
  - budget 확인 요청 → `extend`면 원래 예산만큼 연장
  - 작업자 세션 metadata에 `loop: {name, runId, n, operator}` 기록 + 이름 `loop:<이름> #<실행>-<반복>`
  - 계획 안내 hook은 `--settings` env로 끔(프로세스 env로는 안 꺼짐, 실측)
  - 테스트 37개 통과(`npx vitest run`, PowerShell)
- **서버 API는 아직 없음** → 화면은 404를 받아 "준비 중"을 표시하는 상태.

---

## 4. 다음 할 일 (순서대로)

### 4.1 서버 루프 API (작업 #15, 가장 먼저)
화면 쪽 요청서(`plan-view-to-auto-loop.md` §6)의 응답 모양을 그대로 맞춥니다.
- `GET /api/loops/runs` → `LoopRun[]`
- `GET /api/loops/runs/:id` → `{ run, iterations, gates }`
- `POST /api/loops/gates/:id/decision` `{ decision }` → 해당 실행의 `control.jsonl`에 `{type:'gate_decision', gateId, decision, by:'ui'}` 추가
- `POST /api/loops/runs/:id/stop` → `control.jsonl`에 `{type:'stop', by:'ui'}`
- (추가 제안) `GET /api/loops/sessions/:sessionId` → `{ runId, n }`: 세션 화면이 "이 세션은 루프 반복"임을 보여 줄 때
- **구현 방향(제안):** 설계 §10.2의 SQLite 테이블 대신 **서버가 `~/.agents-observe/loops/*/runs/*/journal.jsonl`을 직접 읽어 변환**합니다. journal이 진실의 원본이라 동기화 문제가 없고, 서버가 꺼져 있던 동안의 실행도 그대로 보입니다. 설계 문서 §10에 이 변경을 적어야 합니다.
  - 실행 id: 실행 ID가 루프마다 겹칠 수 있으니 `<루프이름>:<실행ID>` 같은 형태로.
  - state가 없는 옛 journal: 마지막 이벤트로 추정(`iteration`이면 working, `run_finished`면 finished 등).
  - gate 상태: journal의 `gate`(결정) 또는 `control.jsonl`의 `gate_decision`이 있으면 decided. review는 러너가 기다리지 않으므로 control 쪽으로만 decided가 됩니다.
  - 옛 start gate(id 없음, decision `continue`)도 decided로 처리.
  - 루프 폴더 경로: 서버 config에 `AGENTS_OBSERVE_LOOPS_DIR`(기본 `<데이터 루트>/loops`, 이 PC는 `C:/Users/Jun/.agents-observe/loops`).
- 변환은 순수 함수로 만들고 테스트(서버 vitest). 서버는 Windows에서 원래 실패하는 테스트 9개가 있음(숫자가 늘지 않으면 정상).

### 4.2 화면과 합쳐 확인 (작업 #16)
`wip/team-board`와 이 브랜치를 임시 worktree에서 합쳐 미리보기 서버(4999 포트, 실제 DB 복사본)로 띄우고, 첫 실행이 루프 목록·실행 상세·순환 고리에 보이는지 스크린샷(Edge headless + playwright-core, scratchpad에 설치했었음)으로 확인합니다. 그 뒤 화면 세션에 결과 메모를 남깁니다.

### 4.3 첫 루프 결과 검토 (작업 #7) → 그다음
- #10 검증 세트 설계(dev/sealed/final 3층, 무작위성 지도 등 7항목)와 심사위원 점검 7항목(재현성·고장·오답·속임수·변별력·봉인 독립성·시간)을 클래스 고정 요소로
  - invsqrt 제안: 봉인 salt 3개, 비용 허용차 0.5%, 제출 직전 final 층(새 salt + 4배 실행). **사용자 결정 대기.**
  - 근거: Kaggle 채점은 **비밀 salt**를 씀, 공식 문서가 "seed grinding"을 경고(`data/verifiers/dfthcsos/SCORING_README.md` 164~181, 300~315행).
- #11 R&D 구조: 아이디어 보드(카드: 가설·예상 효과·출처·난이도·상태·결과) + R 단계(논문·비슷한 대회 우승 솔루션·토론·공개 노트북). 오늘 조사 결과를 첫 보드로.
- 그다음 dfthcsos 루프.

---

## 5. 꼭 알아야 할 함정

- **Claude Code의 Bash 도구에서 띄운 프로세스는 `C:\Windows\System32\wsl.exe`를 못 봅니다**(node spawn ENOENT, cmd "인식할 수 없음"). 러너 등 wsl.exe를 부르는 것은 **PowerShell 도구에서** 실행합니다. UTF-8 로그가 필요하면 `cmd.exe /d /c "... > log 2>&1"`.
- `npm`/`npx`/`tsc`는 PowerShell에서 실행합니다(Git Bash에서는 `node`를 못 찾음).
- **파이썬 heredoc으로 TS/JS 코드를 문자열 치환하지 마세요.** 역슬래시(`\r`, `\n`, `C:\Windows`)가 실제 제어 문자로 바뀌어 코드가 깨졌습니다(오늘 2번). 코드 수정은 Edit 도구로.
- `wsl.exe`는 인자의 역슬래시를 지웁니다 → Windows 경로는 `/`로 넘깁니다(러너가 자동 처리).
- kickmix.so는 **Python 3.13에서만** import됩니다 → WSL의 `/root/qc-venv`.
- invsqrt 공식 검사: 전체 약 4분 40초 / 0.5GB, dfthcsos 95초 / 1.1GB, dqi는 7GB WSL에서 메모리 부족(제외).
- 저장소 전체 `npm run fmt` 금지(CRLF→LF로 수백 파일 변경). 바뀐 파일만 prettier.
- 여러 세션이 같은 저장소를 씁니다. 커밋 전 `git diff --numstat`로 **자기 파일만** stage.
- 대회 저장소는 autocrlf 환경이라 `.gitattributes`로 sh/py를 LF로 고정해 두었습니다.

---

## 5.1 캐시·비용 관련 발견 (2026-10-30 아침)

- **1시간 캐시 쓰기는 입력 단가의 2배**입니다(Opus 5.5: $8/M). 작업자 #1 비용 $0.736이 출력 $0.22 + 캐시 읽기 $0.09 + **1시간 캐시 쓰기 53,727×$8/M = $0.43**으로 정확히 맞습니다. **Argus 가격표(`/api/models/pricing`)는 `cacheCreate1hPerM`을 $5로 두고 있어 비용을 낮게 계산합니다** → 수정 필요.
- `claude -p` 작업자와 이 대화는 1시간 TTL, 이 세션의 서브에이전트는 5분 TTL로 기록됐습니다.
- **작업자 반복 비용의 약 절반이 캐시 쓰기**였습니다(새 세션마다 시스템 프롬프트·도구·읽은 파일을 새로 씀).
- 밤사이 대화 캐시가 만료되어, 아침 첫 응답에서 약 91만 토큰을 다시 써서 **약 $7.3**가 들었습니다.
- 사용자 요청: **자동 루프를 캐시까지 고려해서 돌리기**. 제안한 방향(사용자 확인 전):
  - 반복마다 바뀌지 않는 부분(목표·규칙·문제 설명)은 `--append-system-prompt`로 옮겨 반복 간에 캐시를 공유
  - 다음 모델 호출까지의 예상 공백이 TTL(1시간)보다 짧으면 같은 세션 이어 쓰기(`--resume`), 길면 새 세션 + 요약
  - 반복별 캐시 읽기·쓰기 토큰을 journal에 기록해 대시보드에 표시
  - 긴 대기(사람 확인 등) 중 캐시 유지 핑은 "공백/TTL < 쓰기단가/읽기단가(=40)"일 때만 이득

## 6. 사용자에게 아직 묻지 못한 것 / 대기 중인 결정

1. 공개된 최고 회로(Apache-2.0)를 기반으로 삼아도 되는지 (R 단계 조사 결과)
2. 예산 기본값(반복 횟수·시간)
3. #10의 invsqrt 제안값(봉인 salt 3개, 0.5%, final 층)
4. WSL 메모리 증설(`.wslconfig`)과 Kaggle 노트북 메모리 측정 — dqi를 제외해서 당장은 불필요
