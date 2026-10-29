# 인수인계: 프롬프트 보기 작업 → auto-loop 세션 (2026-10-29)

auto-loop 설계(`docs/specs/2026-10-29-auto-loop-design.md`)를 진행하는 세션에 전달하는 메모입니다.
같은 날 다른 세션에서 Argus의 "프롬프트 보기"를 만들었고, 그 결과가 `main`(`ceb2e6d`)에 합쳐졌습니다.
겹치는 부분, 재사용할 것, 꼭 알아야 할 설정 변경을 정리했습니다.

---

## 0. 먼저 할 일

1. `feat/auto-loop`를 최신 `main`(`ceb2e6d`) 위로 rebase하세요. 이 브랜치의 설계 문서는 이미 `main`에 합쳐져 있습니다.
2. 아래 **2장(설정 변경)**을 먼저 읽어 주세요. 설계 §6.1과 §16의 "미확인" 항목 하나에 직접 영향이 있습니다.

---

## 1. 지금 `main`에 있는 것 (요약)

| 기능 | 위치 | 비고 |
|---|---|---|
| 턴 트리: 세션 이벤트 → 시스템 / 프롬프트 / 서브에이전트(중첩) | `app/client/src/lib/turn-tree.ts` (`buildTurnTree`) | `prompt_id` 기준으로 묶음. task-notification은 원래 프롬프트에 합쳐짐 |
| 계획: 할 일 목록 → 단계·상태·진행도, 여러 프롬프트에 걸친 할 일 | `app/client/src/lib/plan.ts` (`buildPlan`, `buildSessionPlanContext`) | TaskCreate/TaskUpdate·TodoWrite. 없으면 답변 단위 단계로 대체 |
| ETA: 과거 실행 기록 기반 진행 추정 | `app/client/src/lib/eta.ts` (`estimateProgress`, 조건부 중앙값) | 기록 3개 미만이면 추정하지 않음. 상한 95% |
| 서브에이전트 실행 기록 API | `GET /api/stats/subagent-runs` (`routes/stats.ts`, `getSubagentRuns`) | 요청 때마다 DB에서 계산하므로 기록이 쌓일수록 자동으로 정확해짐 |
| 살아있음 신호·멈춤 경고 | `components/prompt-view/subagent-progress.tsx` (`LivenessLine`, `useNodeProgress`, `stallThresholdMs`) | "지금: 도구 · N초 전", 3분 이상 조용하면 경고 |
| 프롬프트 보기 화면 | `components/prompt-view/` | 왼쪽 트리 + 오른쪽 [계획 \| 대화 \| 로그] / 서브에이전트는 [결과 \| 대화 \| 로그] |
| 워터폴 | `lib/waterfall.ts`, `components/timeline/waterfall-view.tsx` | 막대 클릭 → `ui-store.selectedTurn`으로 프롬프트 보기와 연결 |
| Claude 답변(transcript) API | `GET /api/sessions/:id/assistant-messages?promptId=a,b` 또는 `?agentId=` | 쉼표로 여러 prompt id |
| 캐시 만료 추정 | `GET /api/sessions/:id/cache-status` | 마지막 응답 + 캐시 TTL(1h/5m) |
| 할 일 목록 도구 사용 가능 여부 | `GET /api/sessions/:id/tool-availability` | 꺼져 있으면 계획 탭에 경고 |
| 계정 기록 | 세션 metadata `account` / `accounts` | hook이 `~/.claude.json`의 oauthAccount를 읽음 |
| 세션 비교 보기 | `feat/ws-multi-subscribe`에서 합쳐짐 | 설계 §9.2 "[최선본과 비교]"가 쓰는 화면 |

---

## 2. 꼭 알아야 할 설정 변경 (설계 §6.1, §16과 직접 관련)

`~/.claude/settings.json`이 이렇게 바뀌었습니다. `claude -p` 작업자도 기본으로 이 설정을 물려받습니다.

1. **`UserPromptSubmit`와 `SubagentStart` hook 명령이 바뀌었습니다.**
   - 전: `bash …/hooks/scripts/hook.sh` (비동기, 출력 없음)
   - 후: `node …/hooks/scripts/observe_cli.mjs hook-prompt` (동기)
   - `hook-prompt`는 **Argus 기록**과 **계획 안내 문구 추가**를 같이 합니다.
2. **계획 안내는 환경 변수 하나로 켜고 끕니다:** `AGENTS_OBSERVE_PLAN_NUDGE=1`(지금 켜져 있음).
   - 켜져 있으면, 프롬프트마다 "3단계 이상이면 할 일 목록을 만들라"는 추가 맥락이 붙고, 서브에이전트 시작 때도 비슷한 안내가 붙습니다.
   - **작업자에서 이 안내만 빼려면 hook을 제거할 필요가 없습니다.** 작업자 프로세스 환경에 `AGENTS_OBSERVE_PLAN_NUDGE=0`을 주면 됩니다. Argus 기록은 그대로 유지됩니다. 설계 §6.1의 "`--setting-sources`로 다른 hook을 빼는 구성"보다 간단합니다. hook 자체를 빼면 Argus 기록도 같이 빠질 수 있으니 주의하세요.
3. **`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`을 env에 추가했습니다.**
   - Claude Code 2.1.233부터 새 모델(Opus 4.8+, Sonnet 5, Fable 계열)에는 TaskCreate/TodoWrite가 기본으로 주어지지 않습니다. 이 변수로 다시 켰습니다. 공식 문서에는 없고 `claude -p`로 직접 확인했습니다.
   - 작업자에게 할 일 목록이 필요 없으면 `0`으로 꺼도 됩니다. 켜 두면 반복마다 계획과 진행도가 Argus에 기록되어, 아래 3장의 재사용에 도움이 됩니다.

---

## 3. 재사용하면 좋은 것 (같은 걸 두 번 만들지 않기)

| 설계의 항목 | 재사용 |
|---|---|
| §9.2 반복 표 **[세션 보기]** | 기존 세션 화면은 이제 프롬프트 보기입니다. 작업자 세션의 계획·대화·결과를 그대로 볼 수 있습니다 |
| §9.2 상태 줄 / 작업 중 표시 | `LivenessLine`(지금 하는 일, 마지막 활동 시각, 멈춤 경고)을 반복 행이나 상태 줄에 붙일 수 있습니다 |
| §8 ② 경보 중 **"작업자 막힘"** | `stallThresholdMs` + 세션의 `lastEventAt`으로 "N분째 활동 없음"을 감지할 수 있습니다. 점수 기반 이상 감지(발산·급등)는 별개입니다 |
| §9.2 예산 게이지 (시간) / 반복 남은 시간 | `estimateProgress(elapsed, 과거 소요시간[])`를 반복 소요 시간 기록에 그대로 쓸 수 있습니다(조건부 중앙값) |
| 반복 안의 작업 진행도 | 작업자 세션에 `buildTurnTree` + `buildPlan`을 적용하면 반복 하나의 계획 진행도("3/5 단계")가 나옵니다 |
| §9.2 **[최선본과 비교]** | 합쳐진 비교 보기를 사용 |
| §9.1 사람 확인 대기 강조 | 기존 알림 벨(`notification-indicator.tsx`)과 같은 방식 |

---

## 4. 서브에이전트·알림 관련해서 확인된 사실 (실제 데이터)

- 서브에이전트 이벤트는 부모 프롬프트와 **같은 `prompt_id`**를 씁니다.
- **포그라운드 서브에이전트는 SubagentStop이 오지 않는 경우가 많습니다.** 종료 신호는 부모의 `PostToolUse:Agent`의 `tool_response.status === 'completed'`이고, 여기에 `content`(결과), `totalDurationMs`, `totalTokens`, `totalToolUseCount`가 들어 있습니다.
- **백그라운드 서브에이전트**는 바로 `status: 'async_launched'`를 반환합니다. 끝나면 `<task-notification>` 사용자 턴이 **새 `prompt_id`**로 들어오고, 안에 `<task-id>`, `<tool-use-id>`, `<status>`, `<result>`, `<usage>`가 들어 있습니다. 턴 트리는 `tool-use-id`로 원래 프롬프트를 찾아 합칩니다.
- `agent_type`이 빈 SubagentStop(자기 이벤트 없음)은 Claude Code 내부 에이전트입니다. 무시해도 됩니다.
- 위 내용은 `claude -p` 작업자 세션에도 그대로 적용될 것으로 보입니다(미확인).

---

## 5. 작업 규칙 (여러 세션이 같은 저장소를 쓰므로)

- 커밋할 때는 파일별로 `git diff --numstat`을 확인하고 **자기 파일만** stage합니다. 다른 세션 파일에 prettier를 돌리지 않습니다.
- 줄바꿈(CRLF/LF)만 다른 "수정됨" 파일이 많이 보일 수 있는데, 실제 변경이 아닙니다.
- 화면 문자열은 모두 `t('English source')`로 쓰고 `app/client/src/lib/i18n/ko.ts`에 한국어를 추가합니다(키 = 영어 원문).
- 환경 변수는 `hooks/scripts/lib/config.mjs`에서만 읽습니다.
- Windows에서 원래부터 실패하는 테스트: 서버 9개, hook 17개(경로·권한 관련). 이 숫자가 늘지 않으면 정상입니다.
- `npm`/`npx`/`tsc`는 Git Bash가 아니라 **PowerShell**에서 실행해야 합니다. Git Bash에서는 npm 스크립트가 `node`를 못 찾습니다.
- 실행 중인 hook 파일(`hooks/scripts/`)을 고치면 이 PC의 **모든 세션** 기록에 바로 영향이 갑니다. 고친 직후 `node --check`로 문법을 확인하세요(실제로 1분간 기록이 멈춘 적이 있습니다).
