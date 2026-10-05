# Chaya MCP: 에이전트가 게임을 조작하게 하기

## 전제

- 모든 경우 주소는 하나: `http://127.0.0.1:39271/mcp`(기본 포트 39271. 바꿨다면 게임 내 "연동 → MCP" 탭에 표시된 주소를 사용). App / 로컬 dev는 자체 주소(콘솔 "연동 → MCP"에 표시, `http://127.0.0.1:3000/api/mcp`, App은 `3927`)로도 직접 연결할 수 있습니다.
- **App / 로컬 dev**가 실행 중이면 그것이 제공합니다(모든 도구). 아니면 Edge 웹 버전에서 플러그인을 설치하고 연 게임이 제공합니다(게임 내 도구와 플러그인 도구만, `eval` 없음). 둘 다 없으면 연결이 실패하며, 열면 다시 연결됩니다.
- 게임 내 도구(`chaya_live_*`)는 게임을 **Chaya에서 실행**하고 `ChayaAgent` 플러그인을 불러와야 합니다. 예전 게임은 먼저 `chaya_game_plugins_install`을 실행하고 다시 시작하세요.

## 연결

- 인증: 필요 없음. 게이트웨이는 `127.0.0.1`에서만 수신하며 토큰이 필요 없습니다. 연결하면 사용 가능한 모든 도구를 쓸 수 있습니다.
- Cursor `~/.cursor/mcp.json`:

  ```json
  {
    "mcpServers": {
      "chaya": { "url": "http://127.0.0.1:39271/mcp" }
    }
  }
  ```

- Claude Code: `claude mcp add --transport http --scope user chaya http://127.0.0.1:39271/mcp`
- Codex: `codex mcp add chaya --url http://127.0.0.1:39271/mcp`

## 도구 그룹

| 그룹                 | 도구                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 게임 라이브러리      | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                                                       |
| 현재 게임            | `chaya_game_status` / `launch` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window`                                     |
| 게임 내 실시간       | 게임 조작: `chaya_live_games` / `state` / `history` / `screenshot` / `press` / `play` / `tap` / `move_to` / `quit`(`eval`은 기본 꺼짐); 플러그인 도구: `plugins` / `call` |
| 수정                 | `chaya_edit_catalog` / `state` / `set` / `action`(게임 내 수정 페이지)                                                                                                    |
| 번역                 | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                                                        |
| 공유 번역 라이브러리 | `chaya_cache_query` / `update` / `delete` / `import`                                                                                                                      |
| 로그                 | `chaya_logs_query` / `clear`                                                                                                                                              |
| 플러그인 도구        | `chaya_plugin_boost_*`(on / off / status), `chaya_plugin_trans_*`(status / reload) — 게임이 온라인일 때만                                                                 |

전체 인자는 콘솔 "연동 → MCP"나 `tools/list`를 참고하세요. 플러그인 도구는 `chaya_live_call {plugin, tool, input}`로도 호출할 수 있고, `chaya_live_plugins`가 각 플러그인이 선언한 도구를 나열합니다. 에이전트는 게임 데이터를 직접 바꾸지 않으며, 수정은 수정 페이지 프리셋(`chaya_edit_*`)으로 합니다.

## 표준 작업 흐름

1. **상태 보기**: `chaya_game_status`(선택, 셸, 플러그인, 온라인 여부). 게임 실행 중에는 `chaya_live_state`.
2. **id 찾기**: `chaya_edit_catalog`(예: `kind=items, q=ポーション`).
3. **실행**: `chaya_edit_set` / `chaya_edit_action` / `chaya_live_press` / `chaya_live_tap` / 번역이나 번역 라이브러리 도구.
4. **확인**: 상태나 로그를 다시 읽고 전후 변화를 사용자에게 알립니다.

## 활용 예

| 목표                              | 호출                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 소지금을 99999로                  | `chaya_edit_set {op:"gold", value:99999}`                                                                             |
| 아이템 10개 주기                  | `chaya_edit_catalog {kind:"items", q:"약"}` → `chaya_edit_set {op:"count", kind:"item", id, value:10}`                |
| 1번 캐릭터 HP 999                 | `chaya_edit_set {op:"actor", id:1, patch:{hp:999}}`                                                                   |
| 무적 / 벽 통과                    | `chaya_edit_set {op:"runFlag", key:"god", value:true}` / `{op:"runFlag", key:"through", value:true}`                  |
| 순간이동                          | `chaya_edit_action {id:"teleport", mapId, x, y}`                                                                      |
| 대화 진행                         | `chaya_live_state`로 대화 읽기 → `chaya_live_press {key:"ok"}`. 선택지는 `up` / `down` 후 `ok`(또는 `chaya_live_tap`) |
| "다음엔 뭐 해?" / 스토리를 건너뜀 | `chaya_live_history`(최근 대화와 선택 요약) → `chaya_live_state`. 화면이 필요할 때만 `chaya_live_screenshot`          |
| 세이브 후 수정                    | 먼저 `chaya_edit_action {id:"save", slot:1}`, 문제가 생기면 `{id:"load", slot:1}`                                     |
| 게임 전체 보충 번역               | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → 주기적으로 `{action:"status"}`                   |
| 번역 하나 고치기                  | `chaya_cache_query {q:"원문 일부"}` → `chaya_cache_update {src, zh}`                                                  |
| 플러그인 오류 조사                | `chaya_logs_query {level:"fail"}` 또는 `{source:"ChayaEdit"}`                                                         |
| 게임 실행                         | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → 몇 초 뒤 `chaya_live_games`                       |

## WebMCP(브라우저 안 에이전트)

콘솔의 모든 페이지는 `document.modelContext`로 WebMCP 도구를 등록하며, MCP의 상위 집합입니다:

- 모든 MCP 도구: App / 로컬 dev는 `/api/mcp`를 미러링하고, Edge 웹 버전은 브라우저 안에서 구현합니다(게임 실행, 제거 명령, 창, `eval`, 일괄 번역, 로그 지우기 제외).
- 추가: `page_*` 페이지 도구(이동, 스냅숏, 텍스트 읽기, 클릭, 입력, 키, 스크롤, 대기). Edge는 게임이 연결되면 플러그인 도구를 자동 등록합니다. 게임 창 자체는 WebMCP 도구를 등록하지 않습니다.
- 활성화: Chrome 146+에서 `chrome://flags/#enable-webmcp-testing`을 엽니다. 자세한 내용은 콘솔 "연동 → WebMCP".

## 규칙

- **파괴적인 도구는 먼저 사용자에게 확인**: `chaya_library_remove`, `chaya_game_plugins_clear`, `chaya_game_shell_uninstall`, `chaya_cache_delete`, `chaya_logs_clear`, `chaya_live_quit`, `chaya_live_eval`, 그리고 `chaya_edit_action`의 save / load / fix:title / battle:defeat / battle:partyHp0.
- 큰 수정 전에는 `chaya_edit_action {id:"save"}`로 세이브를 권장합니다. save는 세이브 슬롯을 덮어쓰고 load는 현재 진행을 버리므로 둘 다 먼저 사용자에게 확인하세요.
- 온라인 게임이 하나뿐이면 `gameId`를 생략할 수 있습니다. 여러 개면 먼저 `chaya_live_games`로 확인하고 지정하세요.
- `chaya_live_eval`은 서버에 `CHAYA_MCP_EVAL=1`을 설정했을 때만 나타납니다. 수정 도구로 되면 쓰지 마세요.
- 도구가 오류를 내면 오류 원문을 그대로 사용자에게 전합니다(예: "연결된 게임이 없습니다"는 대개 게임을 Chaya에서 실행하지 않았거나 ChayaAgent가 없는 경우입니다).
