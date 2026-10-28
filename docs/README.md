# 开发文档索引

路径明确则直读；否则仅在需要文档时按关键词选行。先看目标页头的有效范围与替代关系，再读相关章节；技术细节不足才看技术列，勿顺链全读。若缺少关联方案，定向查正文 / 代码，勿把摘要当完整约束。

<!-- prettier-ignore -->
| 任务关键词 | 需求 / 定义 | 技术说明（按需） |
| --- | --- | --- |
| local / cloud / plugin、命名 | [运行模式](run-modes.md) | [部署判定](technical/deployment-platforms.md) §2 |
| 服务门禁、浏览器改盘、O2 / O8 | [能力边界](requirements-service-modes.md) | [服务形态](technical/service-modes.md)；范围见需求页头 |
| MCP 能力、环境矩阵 | [能力总表](capabilities.md) §3–4 | `lib/integration/mcp-{catalog,availability}.ts`；`lib/webmcp/mode-matrix.ts` |
| 本机 MCP、集成页 | [本地 MCP](mcp-local.md) / [集成](integration.md) | [本机协议](technical/integration-mcp.md) |
| 插件 MCP、网关、端口 | [插件 MCP](mcp-plugin.md) | [网关](technical/mcp-gateway.md) |
| Cloud MCP、WebMCP | [Cloud 空态](mcp-remote.md) / [WebMCP](webmcp.md) | [浏览器工具与通道](technical/webmcp.md) |
| Agent 配置、聊天、工具权限 | [助手基线](game-agent.md)：配置 §6.8–6.9，Prompt §7，权限 §9 | [Agent 实现](technical/game-agent.md)；先看页头的托管替代关系 |
| 自主托管、连续目标 | [托管](game-assistance.md) | [托管实现](technical/game-assistance.md)；覆盖助手基线旧停止契约 |
| CLI Agent、授权、供应商 | [CLI 接入](agent-cli-providers.md) | [CLI 设计](technical/agent-cli-providers.md)；仅相关供应商章节 |
| 活动日志、游戏操作轨迹 | [活动记录](agent-activity-log.md) / [操作轨迹](agent-gameplay-trace.md) | [日志实现](technical/agent-activity-log.md)；覆盖范围见轨迹页头 |
| Agent 分层任务、batch | [助手](game-agent.md) / [托管](game-assistance.md) | [任务执行](technical/game-agent-jobs.md)；只覆盖执行层 |
| 旅伴陪玩、反射引擎、情绪反馈 | [旅伴](companion.md) / [现状问题](companion-optimization.md) | [陪玩实现](technical/companion.md) |
| 旅伴核心重构、本地执行、动态战术、并发决策与多模型预留 | [重构需求](companion-core-rebuild.md)（草案；下一阶段目标） | [重构技术方案](technical/companion-core-rebuild.md)；现有实现不代表已按重构目标交付 |
| 旅伴游玩记忆、死亡 / 读档采集 | [游玩记忆](companion-memory.md) | [记忆实现](technical/companion-memory.md) |
| 本波补齐、可恢复性、冻结清单 | [能力补齐](capability-supplement.md) §3–9 | [补齐设计](technical/capability-supplement.md)；排期才读 [backlog](backlog-2026-10-08.md) |
| 数据修改、地图事件 | [数据](edit-save-data.md) / [地图](edit-map-events.md) | [数据设计](technical/edit-save-data.md) / [地图设计](technical/edit-map-events.md) |
| 当前战斗、敌群 | [战斗](edit-battle.md) / [敌群](edit-troops.md) | [战斗设计](technical/edit-battle.md) / [敌群设计](technical/edit-troops.md) |
| 存档、键鼠、迷你面板、寻路 | [存档](game-saves.md) / [键鼠](input-assistance.md) / [面板](mini-panels.md) / [寻路](smart-path.md) | 各需求页头链接到对应技术方案，仅选相关功能 |
| RGSS、内嵌 WebView、WebRTC | [RGSS 重构](rgss-webview-overlay.md) | [宿主与通信](technical/rgss-webview-overlay.md) |
| RGSS 游玩实时翻译、悬浮字幕 | [游玩翻译](rgss-play-realtime-translation.md) | [实时翻译技术设计](technical/rgss-play-realtime-translation.md) |
| 翻译调度、并发、重试、限流 | [调度基线](translation-scheduling.md) §9 差距、§13–14 性能与接线 | [管线](technical/translation-pipeline.md) 相关章节 |
| Agent 翻译单请求多句打包、字符上限、超长拆句 | [Agent 打包需求](translation-agent-prompt-batching.md) | [Agent 打包技术方案](technical/translation-agent-prompt-batching.md) |
| 翻译主线程卡死、多 Tab、list/seed 库存与 shared 后台化 | [主线程卸载](translation-mainthread-offload.md) | 现行（P0–P2 已落地）；技术方案未立页前以需求文为准 |
| 缓存匹配、语义分段、索引 | [缓存优化](translation-cache-optimization.md) | [缓存设计](technical/translation-cache-optimization.md)；底层存储才读 [管线](technical/translation-pipeline.md) §14 |
| 缓存批次慢、命中后仍跑引擎、回填假过期、缓存优先预取 | [缓存批处理性能](translation-cache-batch-performance.md) §5–9 | [缓存批次设计](technical/translation-cache-optimization.md) §11–12；调度边界见 [调度基线](translation-scheduling.md) §14 |
| 缓存小窗口、结果跨分片聚合、缓存批次吞吐 | [结果窗口聚合](translation-cache-result-window-batching.md) | [窗口聚合设计](technical/translation-cache-result-window-batching.md)；先看页头的替代边界 |
| 标签、列表、结构化分段编辑 | [结构化分段](translation-structured-segmentation.md) | [分段设计](technical/translation-structured-segmentation.md) |
| 整句缓存对齐回退 | [整句回退](translation-sentence-fallback.md) | [回退算法](technical/translation-sentence-fallback.md) |
| 翻译列表搜索、多语言分词、相关度排序 | [列表相关度搜索](translation-list-search-ranking.md) | [多语言分词排序设计](technical/translation-list-search-ranking.md) |
| RPG Maker 文本来源、说话人与剧情上下文抽取 | [上下文抽取](translation-rpgmaker-context-extraction.md) | [上下文抽取设计](technical/translation-rpgmaker-context-extraction.md) |
| 专名/名称优化、术语纠偏、闲时润色 | [质量优化](translation-optimization.md) UI §3 · 入口 §5 · MVP §6 | [质量设计](technical/translation-optimization.md) 秩 §2 · 候选 §3 · 开工清单 §8 |
| 专名句内一致、Rei/蕾漂移、同步到句子 | [专名一致性](translation-name-consistency.md) **适用 §3** · 人名表 §4 · 锁 span §5 | [专名设计](technical/translation-name-consistency.md) 表 §2 · 锁点 §3 · 接线 §4 |
| 游戏翻译多语言、外置译文、特殊发声、分类采集 | [翻译优化与分类](translation-game-special-classification.md) 当前交付 §10 · 第一期 §7–9 · 分类 §3；排期才读 §4 | [多语言与数据设计](technical/translation-game-special-classification.md) 实现/操作/限制 §10 · 目标设计 §2–6 |
| 引擎独立开关、探活、徽标 | [有效约定](translation-concurrency-and-badges.md) §2.2–2.3、§4 | [探活与徽标](technical/translation-concurrency-and-badges.md)；调度示例为历史 |
| Apple / Bergamot / Windows 离线翻译 | [Apple](apple-native-translation.md) / [Bergamot](linux-offline-translation.md) / [Windows](windows-native-translation.md) | 仅选相应需求页头的技术方案；实现进度以各页为准 |
| 游戏语言包、语料回写 | [语言包](game-multilingual-locales.md) | [语言包设计](technical/game-multilingual-locales.md) |
| 安装、启动、外部 Agent 用法 | [setup](../skills/chaya-setup/SKILL.md) / [launch](../skills/chaya-launch/SKILL.md) / [mcp](../skills/chaya-mcp/SKILL.md) | Agent 安装英文源；`i18n` 仅页面译文，改译文时才读 |
| 下载中心、打包、API / 日志规范 | [下载](technical/download-center.md) / [App](technical/electron-app.md) / [代码与日志规范](technical/api-and-logs-standard.md) | 独立开发文档，无需补同名需求 |
| GitHub 分发、资源/匹配算法下发、插件/业务包/App 更新 | [更新前置需求](application-updates.md) | [统一更新设计](technical/application-updates.md)；排期与阶段验收才读 [更新里程碑](milestones/application-updates.md) |
| 本机 data/ 布局、备份、Agent 配置多副本 | [数据布局](technical/data-layout.md) | 与 `constants/paths`、局内 `content-paths` 对照 |
| 存储三桶：公共 / 游戏内 / IndexedDB | [存储策略](technical/storage-policy.md) | 技术方案；公共单实例服务、SQLite 分库、身份签名与迁移自愈 |
| 文档维护、token 与索引优化 | [优化需求](ai-docs-optimization.md) | 无独立技术方案，仅维护时读取 |

状态只在目标页维护：有效性（草案 / 现行 / 冻结 / 历史）与实现进度分开；冻结不等于未实现，现行不等于全实现。混合文档按章节及替代入口判断。

历史追溯才读 [会议纪要](会议纪要-2026-09-19.md) 与 [MVP 定稿](方案定稿-2026-09-19.md)。不按日期自动归档；排期索引和混合文档中的有效约定继续保留。
