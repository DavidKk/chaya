# UX 专项路由（按需加载）

真源（相对 **chaya 仓库根**）：`../../cloud-skills/ui-interaction-skills/skills/`

**不要一次全开。** 需要交互细则时：先读 `ui-interaction-baseline`，再按任务命中的行加载对应 `SKILL.md`。未命中的不要打开。

| 场景 / 关键词                                         | Skill                     | 相对仓库根                                                                         |
| ----------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| 任意 UI 起步                                          | `ui-interaction-baseline` | `../../cloud-skills/ui-interaction-skills/skills/ui-interaction-baseline/SKILL.md` |
| 面板 / 浮层壳 / header+body+footer / 面板空态         | `panel-shell`             | `../../cloud-skills/ui-interaction-skills/skills/panel-shell/SKILL.md`             |
| 对话框 / Backdrop / Escape 关闭 / 焦点（含 GameEdit） | `modal-focus`             | `../../cloud-skills/ui-interaction-skills/skills/modal-focus/SKILL.md`             |
| 数据表 / sticky 表头 / 列表滚动                       | `data-table`              | `../../cloud-skills/ui-interaction-skills/skills/data-table/SKILL.md`              |
| 空态 / 错误 / 无匹配筛选                              | `empty-error-state`       | `../../cloud-skills/ui-interaction-skills/skills/empty-error-state/SKILL.md`       |
| 搜索 / 筛选工具条                                     | `search-command`          | `../../cloud-skills/ui-interaction-skills/skills/search-command/SKILL.md`          |
| 表单校验 / 字段 error                                 | `form-validation`         | `../../cloud-skills/ui-interaction-skills/skills/form-validation/SKILL.md`         |
| 提交中 / 防连点 / skeleton                            | `async-loading-state`     | `../../cloud-skills/ui-interaction-skills/skills/async-loading-state/SKILL.md`     |
| 自定义滚动 / overflow                                 | `scroll-overflow`         | `../../cloud-skills/ui-interaction-skills/skills/scroll-overflow/SKILL.md`         |
| 危险确认（清空、灭敌、覆盖存档等）                    | `destructive-action`      | `../../cloud-skills/ui-interaction-skills/skills/destructive-action/SKILL.md`      |
| Toast / 短暂反馈                                      | `toast-notification`      | `../../cloud-skills/ui-interaction-skills/skills/toast-notification/SKILL.md`      |
| Tooltip / 浮层定位 / Escape 关闭                      | `floating-layer`          | `../../cloud-skills/ui-interaction-skills/skills/floating-layer/SKILL.md`          |
| z-index / 多层浮层                                    | `z-index-layering`        | `../../cloud-skills/ui-interaction-skills/skills/z-index-layering/SKILL.md`        |
| 触控 / 窄屏                                           | `mobile-touch`            | `../../cloud-skills/ui-interaction-skills/skills/mobile-touch/SKILL.md`            |

## 本仓常见组合

| 表面                                 | 建议加载                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| GameEdit 浮层（开关、表、Tab、搜索） | baseline + `modal-focus` + `panel-shell` + `data-table` + `empty-error-state` + `search-command`                                |
| Toolkit Dashboard / 日志 / 缓存页    | baseline + `panel-shell` + `scroll-overflow` +（有表则）`data-table` +（有空错）`empty-error-state` +（有提示）`floating-layer` |
| 破坏性按钮（清空解释器、灭敌、读档） | 再加 `destructive-action`                                                                                                       |

## 禁止

- 不要加载 `skill-authoring`（维护 `ui-interaction-skills` 仓库专用）。
- 不要把专项 skill 全文复制进本仓；只引用路径。
- 视觉 token / 字号 / 颜色以本仓 `docs/technical/chaya-ui-style-guide.md` 为准。
