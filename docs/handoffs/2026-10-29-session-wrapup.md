# 세션 마무리 인수인계 (2026-10-29) — 다음 세션은 이 문서부터 읽기

이 문서는 2026-10-29 하루 동안 한 세션(Argus 대시보드 담당)에서 한 일을 정리한 것입니다. 다음 세션이 이어서 작업할 수 있도록 상태, 결정 사항, 남은 일, 주의할 점을 담았습니다.
사용자에게는 **항상 한국어로** 답합니다(진행 안내 한 줄까지 포함). 코드, 커밋 메시지, 식별자는 영어로 씁니다.

---

## 0. 한눈에 보기

- **Argus란:** simple10/agents-observe(MIT)를 포크한 사용자의 제품 저장소입니다. 위치는 `C:\Users\Jun\agents-observe`이고 원격은 `origin = jun789-lee/Argus`, `upstream = simple10/agents-observe`입니다.
- **최종 목표:** AI Native / AI 오케스트라. 팀장(메인 AI)·팀원(서브에이전트)의 **설계 → 실행 → 평가 → 판단** 루프를 그림으로 한눈에 보고, 나중에는 지휘하는 대시보드입니다.
- **지금 작업 폴더 브랜치:** `wip/team-board`. 대시보드 서버도 이 브랜치 빌드로 돌고 있습니다(http://localhost:4981).
- **main과의 차이:** `wip/team-board`에 커밋 3개(팀 보드, 순환 고리, 팀원 역할)가 있고, **아직 main에 합치지 않았습니다**. 사용자가 화면을 직접 확인한 뒤 합칠 예정입니다.

## 1. 브랜치·작업 폴더 상태

| 브랜치 | 상태 | 비고 |
|---|---|---|
| `main` (`6468b71`) | push됨 | 프롬프트 보기·계획 탭·알림 합치기·ETA·비교 보기·auto-loop 설계 문서·라이선스 분리까지 포함 |
| `wip/team-board` (`04ecd0b` 이후) | push됨, **main 미반영** | 팀 보드 → 순환 고리 개편, 루프 화면(M2 화면), 팀원 역할 아이콘 |
| `feat/auto-loop` | 다른 세션 작업 중 | 러너 M1 완료(`408a285`, `app/loop-runner/`). worktree `.worktrees/auto-loop` |
| `feat/ws-multi-subscribe` | main에 합쳐짐 | 세션 비교 보기. worktree `.worktrees/ws-multi-subscribe`는 정리 가능 |

- 다른 세션의 worktree(`.worktrees/*`)는 **건드리지 않습니다.**
- main에 합칠 때는 `wip/team-board` → `main` 순서로 합치고, 그다음 `feat/auto-loop`의 M2 데이터 작업을 받습니다.

## 2. 오늘 만든 것 (대시보드 기능)

1. **턴 트리** (`app/client/src/lib/turn-tree.ts`)
   - 이벤트를 시스템 / 프롬프트 / 서브에이전트로 묶습니다. `prompt_id` 기준이에요.
   - task-notification(백그라운드 완료 알림)은 원래 프롬프트에 합칩니다.
   - 포그라운드 서브에이전트는 `PostToolUse:Agent`의 `status: completed` 응답을 종료 신호로 씁니다.
2. **프롬프트 보기** (`components/prompt-view/`)
   - 왼쪽 트리, 오른쪽 탭 구성이에요.
     - 프롬프트: [계획 | 대화 | 로그]
     - 서브에이전트: [결과 | 대화 | 로그]
   - 대화 탭은 Input → 중간 답변 + 도구 묶음 → 최종 답변 순서로 보여줍니다.
3. **계획** (`lib/plan.ts`)
   - 할 일 목록(TaskCreate/TaskUpdate, TodoWrite)을 단계·진행도로 바꿉니다.
   - **할 일은 처음 만든 프롬프트에 속합니다**(`buildSessionPlanContext`). 뒤 프롬프트에서는 "이어서 한 작업"으로 표시돼요.
4. **ETA·살아있음 신호** (`lib/eta.ts`, `components/prompt-view/subagent-progress.tsx`)
   - 과거 서브에이전트 실행 기록의 조건부 중앙값으로 진행도를 추정합니다(`GET /api/stats/subagent-runs`).
   - "지금: 도구 · N초 전"과 멈춤 경고를 보여줍니다.
5. **워터폴** (`lib/waterfall.ts`): Activity의 [워터폴] 보기입니다.
6. **팀 보드 → 순환 고리** (`wip/team-board`)
   - `lib/cycle.ts`(공통 4단계 모델)와 `components/cycle/cycle-ring.tsx`(SVG 고리)를 만들었습니다.
   - `components/team-board/team-board.tsx` 구성: 미션 줄([주요 | 전체] 필터) + [고리 | 선택한 단계 상세].
   - 평소 미션은 1바퀴예요. "평가"는 테스트·빌드 명령, 검증원·리뷰어 팀원, 이름이 검증류인 할 일로 **추정**합니다.
7. **루프 화면 (M2 화면 쪽, `wip/team-board`)**
   - `lib/loops.ts`(설계 §10 계약의 타입, `cycleFromRun`), 사이드바 [루프] 탭, `components/loops/loop-run-view.tsx`(큰 고리·점수 그래프·확인 요청·반복 표·중지)를 만들었습니다.
   - **데이터 API가 아직 없어서(404)** "루프 데이터가 아직 연결되지 않았어요"가 표시됩니다.
8. **기타**
   - 한국어 UI 전체(`lib/i18n/ko.ts`, 키 = 영어 원문)
   - 계정 표시, 캐시 만료 카운트다운
   - 할 일 목록 도구 꺼짐 경고(`GET /api/sessions/:id/tool-availability`)

## 3. 사용자 환경 설정 (이 PC)

`~/.claude/settings.json`에 이렇게 되어 있습니다. 백업 파일 `settings.json.bak-before-*`도 있습니다.
- **hook 명령:** `UserPromptSubmit`과 `SubagentStart`는 `node …/agents-observe/hooks/scripts/observe_cli.mjs hook-prompt`를 씁니다(Argus 기록 + 계획 지시). 나머지 hook은 `bash …/hook.sh`예요.
- **`env` 설정:**
  - `AGENTS_OBSERVE_API_BASE_URL`
  - `AGENTS_OBSERVE_LOCAL_DATA_ROOT`
  - `AGENTS_OBSERVE_PLAN_NUDGE=1` (계획 지시 켬)
  - `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`: 새 모델에서 꺼진 TaskCreate/TodoWrite를 다시 켭니다. 공식 문서에 없는 변수라 Claude Code를 업데이트한 뒤 다시 확인이 필요해요.
- **팀원 3명 (사용자 공통):** `~/.claude/agents/`
  - `researcher`: 읽기 전용 조사, 병렬
  - `verifier`: 검사만 실행, 수정 안 함
  - `reviewer`: 읽기 전용 리뷰
  - 사본은 `docs/team-agents/`에 있어요. `claude -p`로 인식되는 것도 확인했습니다.
- **서버 실행:** `start-local.cmd`로 Docker 없이 로컬에서 띄웁니다. 로그는 `~/.agents-observe/logs/server.log`예요. 컴퓨터를 켤 때마다 다시 실행해야 합니다.

## 4. 결정 사항 (사용자 합의)

- **팀 = 세션, 미션 = 프롬프트.** 위 레이어는 글이 아니라 그림 위주로 보여줍니다. 카드는 아이콘 + 이름 수준이고, 애니메이션은 나중에 넣습니다.
- **루프 그림:** 순환 고리 하나로 평소 작업(1바퀴)과 auto-loop(여러 바퀴)를 같이 보여줍니다.
- **M2 분담:** **화면은 이 세션, 데이터(서버 테이블·API·러너 진행 보고)는 auto-loop 세션**이 맡습니다. 약속은 `docs/specs/2026-10-29-auto-loop-design.md` §10과 `docs/handoffs/2026-10-29-plan-view-to-auto-loop.md` §6이에요.
- **단일 vs 다중 에이전트 (문헌 조사 결과):**
  - 순차적인 코딩은 팀장 혼자 하는 편이 낫습니다.
  - 병렬로 나눌 수 있는 조사는 팀원 여러 명에게 맡깁니다.
  - 검증은 분리합니다.
  - **"중앙 조율 + 쓰기는 한 명 + 외부 검증"** 구조로 갑니다. 그래서 팀원 3명은 읽기와 검사 위주로 만들었어요.
- **라이선스:** `LICENSE`는 Argus 고유 부분의 All rights reserved, `THIRD_PARTY_NOTICES.md`에는 원작자 MIT를 그대로 둡니다. 저장소 비공개 전환은 지금은 안 합니다.

## 5. 다음에 할 일 (추천 순서)

1. **화면 확인 후 합치기:** 사용자가 팀 보드·순환 고리·루프 탭을 써보고 피드백하면 반영하고, `wip/team-board`를 main에 합칩니다.
2. **팀원 활성화 측정:** 팀원 3명을 정의한 뒤로 실제로 얼마나 불리는지 Argus 데이터로 확인합니다. 정의 전에는 서브에이전트를 쓴 프롬프트가 5%, 팀원 도구 비중이 12%였어요.
   - 필요하면 분담 지시 hook을 추가하고, 켜고 끌 수 있게 합니다.
   - CLAUDE.md에 역할 규칙을 넣을지도 검토합니다.
3. **M2 연결:** auto-loop 세션이 `/api/loops/*`를 만들면 루프 화면을 실제 데이터로 확인합니다. 그다음 WebSocket `loop_update`로 실시간 갱신을 붙입니다.
4. **팀원 관리 화면 (이전에 미뤄 둔 아이디어):** 대시보드에서 팀원을 정의·수정하고, 출동 횟수·성공률·"안 불리는 팀원"을 보여줍니다.
5. **로드맵 나머지:**
   - (A) 대시보드에서 새 작업 시작(인증 먼저)
   - (B) 프롬프트 다듬기
   - (C) worktree 관리
   - 회사 보기(여러 세션)
   - 사이드바 우클릭 메뉴, 서버 자동 시작

## 6. 작업 규칙과 주의 (오늘 실제로 겪은 것)

- **여러 세션이 같은 저장소를 씁니다.**
  - 커밋 전에 `git -c core.safecrlf=false diff --numstat`으로 실제 변경 파일을 보고, **자기 파일만** stage합니다.
  - 다른 세션 파일에 prettier를 돌리지 않습니다.
  - 줄바꿈만 다른 "수정됨" 표시는 실제 변경이 아니에요.
- **npm, npx, tsc, vitest는 PowerShell에서 실행합니다.** Git Bash에서는 npm 스크립트가 `node`를 못 찾습니다.
- **실행 중인 hook 파일(`hooks/scripts/`)을 고친 직후에는 `node --check`로 문법을 확인합니다.** 오늘 1분 동안 이 PC의 모든 세션 기록이 멈춘 적이 있어요.
- **Python으로 소스를 고칠 때 `\n` 같은 이스케이프가 깨집니다.** 여러 줄 수정은 Edit 도구를 쓰거나, 스크립트를 파일로 저장해서 실행하세요.
- **Windows에서 원래 실패하는 테스트:** 서버 9개, hook 17개(경로·권한 관련). 이 숫자가 늘지 않으면 정상입니다.
- **서버 재시작 방법:** `start-local.cmd` 관련 node·cmd 프로세스를 종료한 뒤 다시 실행합니다(`.worktrees` 경로가 든 프로세스는 제외).
- **실제 데이터 확인용 스크립트:** scratchpad의 `real-*.mts` 패턴을 씁니다. `npx tsx`를 PowerShell에서 실행하고, DB는 `~/.agents-observe/data/observe.db`예요.
- **관찰된 세션 ID:** `01613525-…`는 대회와 auto-loop 작업 세션이고(서브에이전트 6명 조사 미션이 있음), `3e5e0476-…`는 이 대시보드 세션입니다.
