# 游戏路径选择器（硬约束）

**实现：** `services/game/picker.ts` → `pickPath`  
**识别：** `lib/game/resolve.ts` → `resolveGame`

## 定稿 UX（不要再改回）

选游戏（`kind: 'game'` 或 `'folder'`）时：

1. **只弹一次**系统目录选择器。
2. **禁止**先问用户类型的二级框，例如：
   - macOS `display dialog`：「文件夹…」/「.app 包…」
   - Windows 自绘：「文件夹…」/「Game.exe…」
   - Linux zenity/kdialog radiolist：「文件夹」/「可执行文件」
3. 用户点选路径后，由 **`resolveGame` 自动识别**（www、内容根、`.app`、旁挂 `Game.exe` / `nw` 等）。
4. 识别失败再报错；不要用前置分叉「帮用户选类型」。

## 平台细节

| 平台    | 游戏选择                        | 说明                                                                       |
| ------- | ------------------------------- | -------------------------------------------------------------------------- |
| macOS   | AppleScript `choose folder`     | `.app` 是 bundle/目录，可直接点选；**不要**再用 `choose file` + 类型对话框 |
| Windows | `FolderBrowserDialog`           | 选发布目录即可；旁挂 exe 由 `resolveGame` 找                               |
| Linux   | zenity/kdialog/yad **目录**选择 | 同上；缺工具时提示安装或粘贴路径                                           |

壳源（`kind: 'app'`）才用**文件**选择器（`nw.exe` / `.app` / `nw`），与游戏选择无关。

## 曾踩过的坑（勿重复）

| 错误做法                                      | 为何出现过                                             | 正确做法                                                  |
| --------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| 游戏前先弹「文件夹 / .app」                   | 想兼容两种入口；JXA `NSOpenPanel` 从 Next 后台易被挡住 | 统一 `choose folder`（osascript）；识别交给 `resolveGame` |
| Win/Linux 对齐成「文件夹 / exe」二级框        | 抄 macOS 分叉                                          | 游戏只选目录；exe 旁挂靠解析                              |
| 提示文案写成「请选择文件夹或 .app」且配双按钮 | 文案与错误 UX 绑在一起                                 | 文案只描述「目录里可以是什么」；UI 仍是单次选目录         |

## 改动检查清单

改 `picker.ts` 前自问：

- [ ] `game` 是否仍只有**一次**系统选择器？
- [ ] 是否引入了任何「先选类型再选路径」的对话框？若是 → **驳回**
- [ ] 新形态是否仍由 `resolveGame` 消化？若解析不够 → 改 `resolve.ts`，不改选择器分叉
