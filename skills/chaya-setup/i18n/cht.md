# Chaya：安裝與執行方式

Chaya 管理 RPG Maker 遊戲、NW.js 殼、外掛、修改、翻譯、日誌與 MCP。

## 選擇方式

- **local**：App（macOS / Windows）或本機開發，提供完整遊戲庫、啟動、本機翻譯與 MCP；App 資料位於系統應用程式目錄。
- **cloud**：開啟 `https://chaya-gray.vercel.app`，以 Chrome / Microsoft Edge 授權含 `www` 或 `index.html` 的資料夾，寫入外掛與殼，再自行啟動遊戲。網頁不能啟動程序，也不提供本機模型或本機服務的共用翻譯庫。
- **plugin**：在遊戲內執行，無須開啟控制台；MCP 提供遊戲操作、修改、翻譯、快取、日誌與遊戲技能，不提供遊戲庫管理、啟動、batch 或 eval。Cloud 補譯透過連線遊戲的 `chaya_translate_job`。

## 安裝 App / 本機開發

首頁下載區選擇 Apple Silicon、Intel Mac 或 Windows x64。macOS 終端機安裝：

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

手動安裝：解壓縮後將 `Chaya.app` 拖入「應用程式」；顯示「已損毀」時執行 `xattr -cr /Applications/Chaya.app`，或右鍵 → 打開 → 打開。Windows 解壓縮後執行 `Chaya.exe`。App 預設控制台為 `http://127.0.0.1:3927`。

開發需 Node ≥ 22.19、pnpm 9：

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

開啟 `http://localhost:3000`；`pnpm dev:lan` 開放區域網路，`pnpm dev:app` 包含 Electron。開發切換器為 Local / Cloud；原始檔變更時重建外掛。

## 存取與排錯

無須登入；本機 API 僅接受 localhost、IP 或 `CHAYA_PUBLIC_ORIGIN` 的同源請求。自訂網域遇到 401 時設定該變數並重新啟動。外掛使用限於自身工作階段的啟動 token，更新後重新啟動遊戲。3000 / 3927 被占用時關閉其他執行個體，或設定 App 的 `PORT`。

MCP 預設 `http://127.0.0.1:39271/mcp`；在遊戲內「整合 → MCP」改連接埠後同步用戶端。本機服務執行時網關轉送至本機 MCP。Cloud 無法選資料夾時使用桌面 Chrome / Microsoft Edge 並授權；準備後在電腦上開啟 `Chaya.app` / `Chaya`。
