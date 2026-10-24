# Chaya：導入と実行形態

Chaya は RPG Maker ゲーム、NW.js シェル、プラグイン、編集、翻訳、ログ、MCP を管理します。

## 実行形態

- **local**：App（macOS / Windows）またはローカル開発。ライブラリ、起動、ローカル翻訳、MCP の全機能を提供します。App のデータはシステムのアプリ用フォルダーに保存されます。
- **cloud**：`https://chaya-gray.vercel.app` を Chrome / Microsoft Edge で開き、`www` または `index.html` を含むフォルダーへのアクセスを許可してシェルとプラグインを導入します。ゲームは手動で起動します。ブラウザーはプロセス起動、ローカルモデル、本機サービスの共有翻訳ライブラリを提供しません。
- **plugin**：開いているゲーム内で動作し、コンソールは不要です。MCP はゲーム操作、編集、翻訳、キャッシュ、ログ、ゲームスキルに対応しますが、ライブラリ管理、起動、batch、eval は対象外です。Cloud の補完翻訳は接続済みゲームの `chaya_translate_job` を使います。

## App と開発環境

ホームのダウンロード欄で Apple Silicon、Intel Mac、Windows x64 を選びます。macOS のターミナルから：

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

手動では展開後 `Chaya.app` をアプリケーションへ移動します。「壊れている」場合は `xattr -cr /Applications/Chaya.app`、または右クリック → 開く → 開く。Windows は展開して `Chaya.exe` を起動します。App の標準コンソールは `http://127.0.0.1:3927`。

開発には Node ≥ 22.19、pnpm 9 が必要です：

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

`http://localhost:3000` を開きます。`pnpm dev:lan` は LAN 公開、`pnpm dev:app` は Electron 付きです。開発スイッチは Local / Cloud。ソース変更時にプラグインを再ビルドします。

## 接続と問題解決

ログイン不要。ローカル API は localhost、IP、`CHAYA_PUBLIC_ORIGIN` からの同一オリジン要求のみ受け付けます。独自ホストで 401 になる場合は変数を設定して再起動します。プラグインの起動 token はそのセッション専用です。更新後はゲームを再起動します。3000 / 3927 が使用中なら他のインスタンスを終了するか App の `PORT` を設定します。

MCP の標準は `http://127.0.0.1:39271/mcp`。ゲーム内の「連携 → MCP」でポートを変更したらクライアントも更新します。ローカル稼働中はゲートウェイが本機 MCP に転送します。Cloud のフォルダー選択にはデスクトップ Chrome / Microsoft Edge と許可が必要です。準備後、コンピューター上で `Chaya.app` / `Chaya` を開きます。
