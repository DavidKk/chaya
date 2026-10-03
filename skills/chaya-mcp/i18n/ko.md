# Chaya MCP: 에이전트가 게임을 조작하게 하기

## 전제

- 모든 경우 주소는 하나: `http://127.0.0.1:39271/mcp`(기본 포트 39271. 바꿨다면 콘솔 "연동 → MCP" 또는 게임 내 "MCP" 탭에 표시된 주소를 사용).
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

| 그룹                 | 도구                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 게임 라이브러리      | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                                                                                                              |
| 현재 게임            | `chaya_game_status` / `launch` / `quit` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window`                                                                                   |
| 게임 내 실시간       | `chaya_live_games` / `state` / `plugins` / `call` / `press`(`eval`은 기본 꺼짐)                                                                                                                                                  |
| 수정용 카탈로그      | `chaya_edit_catalog`                                                                                                                                                                                                             |
| 번역                 | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                                                                                                               |
| 공유 번역 라이브러리 | `chaya_cache_query` / `update` / `delete` / `import`                                                                                                                                                                             |
| 로그                 | `chaya_logs_query` / `clear`                                                                                                                                                                                                     |
| 플러그인 도구        | `chaya_plugin_edit_*`(gold / item / variable / switch / god / through / teleport / common_event / save / load / find), `chaya_plugin_boost_*`(on / off / status), `chaya_plugin_trans_*`(status / reload) — 게임이 온라인일 때만 |

전체 인자는 콘솔 "연동 → MCP"나 `tools/list`를 참고하세요. 플러그인 도구는 `chaya_live_call {plugin, tool, input}`로도 호출할 수 있고, `chaya_live_plugins`가 각 플러그인이 선언한 도구를 나열합니다.

## 표준 작업 흐름

1. **상태 보기**: `chaya_game_status`(선택, 셸, 플러그인, 온라인 여부). 게임 실행 중에는 `chaya_live_state`.
2. **id 찾기**: `chaya_edit_catalog`(예: `kind=items, q=ポーション`).
3. **실행**: `chaya_live_call` / `chaya_live_press` / 번역이나 번역 라이브러리 도구.
4. **확인**: 상태나 로그를 다시 읽고 전후 변화를 사용자에게 알립니다.

## 활용 예

| 목표                | 호출                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 소지금을 99999로    | `chaya_plugin_edit_gold {value:99999}`(또는 `chaya_live_call {plugin:"ChayaEdit", method:"gold", args:[99999]}`)   |
| 아이템 10개 주기    | `chaya_edit_catalog {kind:"items", q:"약"}` → `chaya_live_call {plugin:"ChayaEdit", method:"item", args:[id, 10]}` |
| 1번 캐릭터 HP 999   | `chaya_live_call {plugin:"ChayaEdit", method:"actor", args:[1], chain:[{method:"hp", args:[999]}]}`                |
| 무적 / 벽 통과      | `ChayaEdit.god(true)` / `ChayaEdit.through(true)`                                                                  |
| 순간이동            | `ChayaEdit.teleport(mapId, x, y)`                                                                                  |
| 대화 진행           | `chaya_live_state`로 대화 읽기 → `chaya_live_press {key:"ok"}`. 선택지는 `up` / `down` 후 `ok`                     |
| 세이브 후 수정      | 먼저 `ChayaEdit.save(1)`, 문제가 생기면 `ChayaEdit.load(1)`                                                        |
| 게임 전체 보충 번역 | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → 주기적으로 `{action:"status"}`                |
| 번역 하나 고치기    | `chaya_cache_query {q:"원문 일부"}` → `chaya_cache_update {src, zh}`                                               |
| 플러그인 오류 조사  | `chaya_logs_query {level:"fail"}` 또는 `{source:"ChayaEdit"}`                                                      |
| 게임 실행           | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → 몇 초 뒤 `chaya_live_games`                    |

## WebMCP(브라우저 안 에이전트)

콘솔의 모든 페이지는 `document.modelContext`로 WebMCP 도구를 등록하며, MCP의 상위 집합입니다:

- 모든 MCP 도구: App / 로컬 dev는 `/api/mcp`를 미러링하고, Edge 웹 버전은 브라우저 안에서 구현합니다(게임 실행, 제거 명령, 창, `eval`, 일괄 번역, 로그 지우기 제외).
- 추가: `page_*` 페이지 도구(이동, 스냅숏, 텍스트 읽기, 클릭, 입력, 키, 스크롤, 대기)와 `chaya_web_edit_*` 게임 내 수정 패널 도구. Edge는 게임이 연결되면 플러그인 도구를 자동 등록합니다.
- 활성화: Chrome 146+에서 `chrome://flags/#enable-webmcp-testing`을 엽니다. 자세한 내용은 콘솔 "연동 → WebMCP".

## 규칙

- **파괴적인 도구는 먼저 사용자에게 확인**: `chaya_library_remove`, `chaya_game_plugins_clear`, `chaya_game_shell_uninstall`, `chaya_cache_delete`, `chaya_logs_clear`, `chaya_live_eval`.
- 큰 수정 전에는 `ChayaEdit.save(slot)`으로 세이브를 권장합니다. `chaya_plugin_edit_save`는 세이브 슬롯을 덮어쓰고 `chaya_plugin_edit_load`는 현재 진행을 버리므로 둘 다 먼저 사용자에게 확인하세요.
- 온라인 게임이 하나뿐이면 `gameId`를 생략할 수 있습니다. 여러 개면 먼저 `chaya_live_games`로 확인하고 지정하세요.
- `chaya_live_eval`은 서버에 `CHAYA_MCP_EVAL=1`을 설정했을 때만 나타납니다. 플러그인 메서드로 되면 쓰지 마세요.
- 도구가 오류를 내면 오류 원문을 그대로 사용자에게 전합니다(예: "연결된 게임이 없습니다"는 대개 게임을 Chaya에서 실행하지 않았거나 ChayaAgent가 없는 경우입니다).
