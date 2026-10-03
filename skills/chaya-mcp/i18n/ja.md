# Chaya MCP：エージェントにゲームを操作させる

## 前提

- Chaya が **App かローカル dev** で動いていること（Edge の Web 版には MCP がありません）。
- ゲーム内ツール（`chaya_live_*`）は、ゲームを **Chaya から起動** し `ChayaAgent` プラグインを読み込んでいる必要があります。古いゲームは先に `chaya_game_plugins_install` を実行して再起動してください。

## 接続

- アドレス：`http://127.0.0.1:3927/api/mcp`
- 認証：リクエストヘッダー `Authorization: Bearer <token>`。token はコンソールの「連携 → MCP」ページでコピーするか、ローカル dev の `data/access/token` にあります。
- Cursor `~/.cursor/mcp.json`：

  ```json
  {
    "mcpServers": {
      "chaya": {
        "url": "http://127.0.0.1:3927/api/mcp",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
  ```

- Claude Code：`claude mcp add --transport http --scope user chaya http://127.0.0.1:3927/api/mcp --header "Authorization: Bearer <token>"`

## ツールのグループ

| グループ             | ツール                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ゲームライブラリ     | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                                                                                                                           |
| 現在のゲーム         | `chaya_game_status` / `launch` / `quit` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window`                                                                                                |
| ゲーム内リアルタイム | `chaya_live_games` / `state` / `plugins` / `call` / `press`（`eval` は既定でオフ）                                                                                                                                                            |
| 改造用カタログ       | `chaya_edit_catalog`                                                                                                                                                                                                                          |
| 翻訳                 | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                                                                                                                            |
| 共有翻訳ライブラリ   | `chaya_cache_query` / `update` / `delete` / `import`                                                                                                                                                                                          |
| ログ                 | `chaya_logs_query` / `clear`                                                                                                                                                                                                                  |
| プラグインツール     | `chaya_plugin_edit_*`（gold / item / variable / switch / god / through / teleport / common_event / save / load / find）、`chaya_plugin_boost_*`（on / off / status）、`chaya_plugin_trans_*`（status / reload）——ゲームがオンラインのときのみ |

引数の詳細はコンソールの「連携 → MCP」か `tools/list` を参照してください。プラグインツールは `chaya_live_call {plugin, tool, input}` でも呼び出せ、`chaya_live_plugins` が各プラグインの宣言したツールを一覧表示します。

## 標準ワークフロー

1. **状態を見る**：`chaya_game_status`（選択、シェル、プラグイン、オンラインか）。ゲーム実行中は `chaya_live_state`。
2. **id を調べる**：`chaya_edit_catalog`（例：`kind=items, q=ポーション`）。
3. **実行**：`chaya_live_call` / `chaya_live_press` / 翻訳や翻訳ライブラリのツール。
4. **確認**：もう一度状態かログを読み、変更前後をユーザーに報告します。

## レシピ

| やりたいこと           | 呼び出し                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 所持金を 99999 に      | `chaya_plugin_edit_gold {value:99999}`（または `chaya_live_call {plugin:"ChayaEdit", method:"gold", args:[99999]}`） |
| アイテムを 10 個       | `chaya_edit_catalog {kind:"items", q:"薬"}` → `chaya_live_call {plugin:"ChayaEdit", method:"item", args:[id, 10]}`   |
| 1 番キャラの HP を 999 | `chaya_live_call {plugin:"ChayaEdit", method:"actor", args:[1], chain:[{method:"hp", args:[999]}]}`                  |
| 無敵 / 壁抜け          | `ChayaEdit.god(true)` / `ChayaEdit.through(true)`                                                                    |
| テレポート             | `ChayaEdit.teleport(mapId, x, y)`                                                                                    |
| 会話を進める           | `chaya_live_state` で会話を読む → `chaya_live_press {key:"ok"}`。選択肢は `up` / `down` のあと `ok`                  |
| セーブしてから改造     | 先に `ChayaEdit.save(1)`、問題が出たら `ChayaEdit.load(1)`                                                           |
| ゲーム全体の補完翻訳   | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → 定期的に `{action:"status"}`                    |
| 訳文を 1 件修正        | `chaya_cache_query {q:"原文の一部"}` → `chaya_cache_update {src, zh}`                                                |
| プラグインのエラー調査 | `chaya_logs_query {level:"fail"}` または `{source:"ChayaEdit"}`                                                      |
| ゲームを起動           | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → 数秒待って `chaya_live_games`                    |

## WebMCP（ブラウザ内エージェント）

コンソールの各ページは `document.modelContext` で WebMCP ツールを登録しており、MCP の上位互換です：

- すべての MCP ツール：App / ローカル dev は `/api/mcp` をミラー、Edge の Web 版はブラウザ内で実装（ゲーム起動、削除系コマンド、ウィンドウ、`eval`、一括翻訳、ログ消去を除く）。
- 追加：`page_*` ページツール（移動、スナップショット、テキスト読み取り、クリック、入力、キー、スクロール、待機）と `chaya_web_edit_*` ゲーム内改造パネルのツール。Edge はゲーム接続後にプラグインツールを自動登録します。
- 有効化：Chrome 146+ で `chrome://flags/#enable-webmcp-testing` を開く。詳しくはコンソールの「連携 → WebMCP」。

## 取り決め

- **破壊的なツールは先にユーザーに確認**：`chaya_library_remove`、`chaya_game_plugins_clear`、`chaya_game_shell_uninstall`、`chaya_cache_delete`、`chaya_logs_clear`、`chaya_live_eval`。
- 大きな改造の前は `ChayaEdit.save(slot)` でセーブを推奨。`chaya_plugin_edit_save` はセーブ枠を上書きし、`chaya_plugin_edit_load` は現在の進行を破棄するので、どちらも先にユーザーに確認します。
- オンラインのゲームが 1 つなら `gameId` は省略可。複数あるときは先に `chaya_live_games` で確認して指定します。
- `chaya_live_eval` はサーバーで `CHAYA_MCP_EVAL=1` を設定したときだけ現れます。プラグインのメソッドで済むなら使わないでください。
- ツールがエラーを返したら原文をそのままユーザーに伝えます（例：「接続中のゲームがありません」は、ゲームを Chaya から起動していないか ChayaAgent が未導入のことが多いです）。
