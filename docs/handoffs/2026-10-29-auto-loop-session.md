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
- **#3 거절 (봉인 검사 실패):** 빠른 검사·본 채점은 통과했지만 **다른 salt로 다시 검사하자 실패**했습니다. 봉인 검사가 "dev 시드에서만 운 좋게 통과한 변경"을 잡은 첫 사례입니다. 무엇이 seed에 따라 틀렸는지는 `logs/iter-3-*.txt`와 커밋 `e82e54e`로 확인할 수 있습니다(작업자에게는 일반 메시지만 전달됨).
- **그 직후 러너가 멈춤:** 최선본(#2, `56e5991`)으로 되돌리는 `git reset --hard`가 중간에 실패하고 worktree에 `index.lock`이 남았습니다(Windows 파일 잠금 추정). 세션 종료 전에 git 프로세스가 없는 것을 확인하고 잠금을 지운 뒤 `56e5991`로 되돌려 두었습니다. **러너에 "오래된 index.lock 정리 + reset 재시도"를 넣어야 합니다**(작은 수정, 다음 세션).
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

## 6. 사용자에게 아직 묻지 못한 것 / 대기 중인 결정

1. 공개된 최고 회로(Apache-2.0)를 기반으로 삼아도 되는지 (R 단계 조사 결과)
2. 예산 기본값(반복 횟수·시간)
3. #10의 invsqrt 제안값(봉인 salt 3개, 0.5%, final 층)
4. WSL 메모리 증설(`.wslconfig`)과 Kaggle 노트북 메모리 측정 — dqi를 제외해서 당장은 불필요
