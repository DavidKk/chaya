# Chaya：準備與啟動遊戲

## 準備

1. **local**（App / 本機開發）：遊戲庫選擇 `www`、含它的發行資料夾，或含 macOS `.app` / Windows `Game.exe` 的套件。自動辨識 MV / MZ 內容根目錄；移除遊戲庫項目僅刪除紀錄。
2. **cloud**：以 Chrome / Microsoft Edge 授權讀寫含 `www` 或 `index.html` 的資料夾。
3. 在遊戲庫詳情安裝共用 NW.js 殼（約 100 MB）；遊戲自帶殼時無須另裝。
4. 安裝外掛，每次更新後重新啟動遊戲。本機啟動也會自動注入外掛。

macOS 殼無法開啟時，先退出遊戲，在終端機執行並依提示選資料夾，再開啟 `Chaya.app`。保留存檔並備份舊殼：

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
```

## 外掛與使用

`ChayaLoader` 載入外掛並支援離線快取，`ChayaLog` 記錄日誌，`ChayaTrans` 翻譯，`ChayaBoost` 加速（`on()` / `off()`），`ChayaEdit` 修改、傳送與存讀檔（`help()`），`ChayaAgent` 橋接遊戲控制。

- **local**：遊戲庫按「啟動」，寫入工作階段設定並開啟遊戲；外掛連接本機服務，控制台顯示連線狀態。
- **cloud**：準備後開啟遊戲資料夾旁的 `Chaya.app` / `Chaya`；透過 WebRTC 通訊，網頁不能啟動程序。
- 修改（`/cheat`）：金錢、物品、變數、開關、角色、無敵、穿牆、速度、傳送、存讀檔；遊戲內快捷鍵開啟同一面板。
- 翻譯（`/translate`）：擷取 seed → 依已啟用引擎與排程設定執行整作補譯，可暫停；快取支援瀏覽、搜尋、編輯、刪除及匯入。遊戲內模式為預翻譯、即時、字幕。Cloud 作業由連線遊戲執行，本機共用庫需本機服務。
- 日誌（`/logs`）：依來源、層級排查錯誤。從控制台退出或關閉視窗；代使用者退出、破壞性修改、清除外掛、覆寫存檔或讀檔前先取得同意。

## 排錯

缺殼先安裝；外掛無效則重新安裝、重新啟動並查看 `ChayaLoader` 日誌。離線時確認 `ChayaAgent` 已載入及連線設定正確，再重新整理控制台。macOS 必要時使用上方修復命令。
