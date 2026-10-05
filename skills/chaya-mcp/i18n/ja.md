# Chaya MCP：エージェントにゲームを操作させる

## 前提

- どの場合もアドレスは 1 つ：`http://127.0.0.1:39271/mcp`（既定ポート 39271。変更した場合はゲーム内「連携 → MCP」タブに表示されるアドレスを使います）。App / ローカル dev には自身のアドレス（コンソールの「連携 → MCP」に表示、`http://127.0.0.1:3000/api/mcp`、App は `3927`）でも直接接続できます。
- **App / ローカル dev** が動いていればそれが提供します（全ツール）。そうでなければ Edge の Web 版でプラグインを入れて開いたゲームが提供します（ゲーム内ツールとプラグインツールのみ、`eval` なし）。どちらもなければ接続に失敗し、開けば復帰します。
- ゲーム内ツール（`chaya_live_*`）は、ゲームを **Chaya から起動** し `ChayaAgent` プラグインを読み込んでいる必要があります。古いゲームは先に `chaya_game_plugins_install` を実行して再起動してください。

## 接続

- 認証：不要。ゲートウェイは `127.0.0.1` だけで待ち受け、トークンは不要です。接続すると利用可能なすべてのツールを使えます。
- Cursor `~/.cursor/mcp.json`：

  ```json
  {
    "mcpServers": {
      "chaya": { "url": "http://127.0.0.1:39271/mcp" }
    }
  }
  ```

- Claude Code：`claude mcp add --transport http --scope user chaya http://127.0.0.1:39271/mcp`
- Codex：`codex mcp add chaya --url http://127.0.0.1:39271/mcp`

## ツールのグループ

| グループ             | ツール                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ゲームライブラリ     | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                                                              |
| 現在のゲーム         | `chaya_game_status` / `launch` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window`                                            |
| ゲーム内リアルタイム | ゲーム操作：`chaya_live_games` / `state` / `history` / `screenshot` / `press` / `play` / `tap` / `move_to` / `quit`（`eval` は既定でオフ）；プラグインツール：`plugins` / `call` |
| 改造                 | `chaya_edit_catalog` / `state` / `set` / `action`（ゲーム内の改造ページ）                                                                                                        |
| 翻訳                 | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                                                               |
| 共有翻訳ライブラリ   | `chaya_cache_query` / `update` / `delete` / `import`                                                                                                                             |
| ログ                 | `chaya_logs_query` / `clear`                                                                                                                                                     |
| プラグインツール     | `chaya_plugin_boost_*`（on / off / status）、`chaya_plugin_trans_*`（status / reload）——ゲームがオンラインのときのみ                                                             |

引数の詳細はコンソールの「連携 → MCP」か `tools/list` を参照してください。プラグインツールは `chaya_live_call {plugin, tool, input}` でも呼び出せ、`chaya_live_plugins` が各プラグインの宣言したツールを一覧表示します。エージェントはゲームデータを直接変更しません：改造は改造ページのプリセット（`chaya_edit_*`）経由です。

## 標準ワークフロー

1. **状態を見る**：`chaya_game_status`（選択、シェル、プラグイン、オンラインか）。ゲーム実行中は `chaya_live_state`。
2. **id を調べる**：`chaya_edit_catalog`（例：`kind=items, q=ポーション`）。
3. **実行**：`chaya_edit_set` / `chaya_edit_action` / `chaya_live_press` / `chaya_live_tap` / 翻訳や翻訳ライブラリのツール。
4. **確認**：もう一度状態かログを読み、変更前後をユーザーに報告します。

## レシピ

| やりたいこと                       | 呼び出し                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 所持金を 99999 に                  | `chaya_edit_set {op:"gold", value:99999}`                                                                                      |
| アイテムを 10 個                   | `chaya_edit_catalog {kind:"items", q:"薬"}` → `chaya_edit_set {op:"count", kind:"item", id, value:10}`                         |
| 1 番キャラの HP を 999             | `chaya_edit_set {op:"actor", id:1, patch:{hp:999}}`                                                                            |
| 無敵 / 壁抜け                      | `chaya_edit_set {op:"runFlag", key:"god", value:true}` / `{op:"runFlag", key:"through", value:true}`                           |
| テレポート                         | `chaya_edit_action {id:"teleport", mapId, x, y}`                                                                               |
| 会話を進める                       | `chaya_live_state` で会話を読む → `chaya_live_press {key:"ok"}`。選択肢は `up` / `down` のあと `ok`（または `chaya_live_tap`） |
| 「次は何？」/ ストーリーを飛ばした | `chaya_live_history`（最近の会話と選択をまとめる）→ `chaya_live_state`。画面が必要なときだけ `chaya_live_screenshot`           |
| セーブしてから改造                 | 先に `chaya_edit_action {id:"save", slot:1}`、問題が出たら `{id:"load", slot:1}`                                               |
| ゲーム全体の補完翻訳               | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → 定期的に `{action:"status"}`                              |
| 訳文を 1 件修正                    | `chaya_cache_query {q:"原文の一部"}` → `chaya_cache_update {src, zh}`                                                          |
| プラグインのエラー調査             | `chaya_logs_query {level:"fail"}` または `{source:"ChayaEdit"}`                                                                |
| ゲームを起動                       | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → 数秒待って `chaya_live_games`                              |

## WebMCP（ブラウザ内エージェント）

コンソールの各ページは `document.modelContext` で WebMCP ツールを登録しており、MCP の上位互換です：

- すべての MCP ツール：App / ローカル dev は `/api/mcp` をミラー、Edge の Web 版はブラウザ内で実装（ゲーム起動、削除系コマンド、ウィンドウ、`eval`、一括翻訳、ログ消去を除く）。
- 追加：`page_*` ページツール（移動、スナップショット、テキスト読み取り、クリック、入力、キー、スクロール、待機）。Edge はゲーム接続後にプラグインツールを自動登録します。ゲームウィンドウ自体は WebMCP ツールを登録しません。
- 有効化：Chrome 146+ で `chrome://flags/#enable-webmcp-testing` を開く。詳しくはコンソールの「連携 → WebMCP」。

## 取り決め

- **破壊的なツールは先にユーザーに確認**：`chaya_library_remove`、`chaya_game_plugins_clear`、`chaya_game_shell_uninstall`、`chaya_cache_delete`、`chaya_logs_clear`、`chaya_live_quit`、`chaya_live_eval`、および `chaya_edit_action` の save / load / fix:title / battle:defeat / battle:partyHp0。
- 大きな改造の前は `chaya_edit_action {id:"save"}` でセーブを推奨。save はセーブ枠を上書きし、load は現在の進行を破棄するので、どちらも先にユーザーに確認します。
- オンラインのゲームが 1 つなら `gameId` は省略可。複数あるときは先に `chaya_live_games` で確認して指定します。
- `chaya_live_eval` はサーバーで `CHAYA_MCP_EVAL=1` を設定したときだけ現れます。改造ツールで済むなら使わないでください。
- ツールがエラーを返したら原文をそのままユーザーに伝えます（例：「接続中のゲームがありません」は、ゲームを Chaya から起動していないか ChayaAgent が未導入のことが多いです）。
