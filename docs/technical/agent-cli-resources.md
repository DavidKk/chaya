# CLI 资源管理技术方案

> 有效性：现行；实现进度：已实现并完成 CR，验收结果见 §4。
> 日期：2026-11-01。
> 需求：[CLI 按需启动与空闲资源回收](../agent-cli-resources.md)。
> 范围：替代 [CLI 设计](agent-cli-providers.md) §7.0 的空闲池容量与进程列表策略。旧 §5.5 的完整会话池、并发 4 个会话等仍是历史方案，不能视为当前实现保证。

## 1. 生命周期与容量

继续由 `services/game-agent/cli/warm-pool.server.ts` 管理 Cursor / Codex。入口 `withWarmCli` 仅在无可用空闲句柄时调用 `create`。领取时移出空闲 Map 并清除定时器，成功完成才重新入池；失败调用直接释放。

保留 `WARM_IDLE_MS = 300000`，增加 `WARM_MAX_IDLE = 2`。Map 插入顺序代表最后完成使用的顺序：每次领取删除、归还插入，因此头部为最久未使用项。归还时：

1. 排除死亡、同 key 已有空闲项及授权 epoch 过期的句柄。
2. 释放同 provider / profileId、不同 key 的旧空闲句柄。
3. 池已满时释放 Map 头部，直到新句柄可加入。
4. 插入新项并启动 unref 空闲计时器。

淘汰只操作 idle Map，不遍历或终止忙碌句柄。并发请求仍可各自创建进程；同 key 多个请求结束后只保留一个。复用键包括供应商、实例、归一化的各协议代理地址和排序后的代理请求头，避免代理配置变化后复用旧进程，或仅请求头顺序不同导致冷启动。沿用调用方 dispose：关闭客户端或 app-server，删除独立工作目录，释放引用计数凭证租约。凭证回写及最后释放删除由既有 runtime-dir 负责。

## 2. 进程来源与采样

`listLiveAgentProcesses({ includeSystem?: boolean })` 默认只读取当前模块登记表。无 PID 时直接返回空列表；否则使用 `ps -p <pid,...>` 读取登记 PID 的 CPU / RSS / elapsed，不读取全机命令表。采样失败时仍通过存活检查返回登记项，统计字段为空，不误报“没有进程”。

`includeSystem: true` 才读取全机命令及可执行路径。macOS `comm` 保留含空格的可执行路径；用 PID 关联统计表。CLI 分类以可执行文件 basename 为起点；Node / Bun 包装器只识别已知 CLI 脚本入口。外部条目只表示未登记于当前服务，不能据此断言泄漏。保持已有 `system-*` ID 和 `orphan` kind 兼容接口，页面显示为外部 CLI。

API `GET /api/game-agent/processes` 默认本服务；`?includeSystem=1` 加入外部 CLI。DELETE 外部条目前重新读取目标并检查是否为 CLI，拒绝桌面应用辅助进程。

## 3. 日志页

`AgentCliProcessesPanel` 复用现有 Button 增加本机 CLI 切换，带 `aria-pressed`。描述和空态区分当前服务与本机扫描范围，说明保温策略与来源边界，所有语言消息同步补齐。

采样改为每 10 秒一次；隐藏页不发请求，恢复可见时立即刷新。每次采样取消前一请求，组件卸载或切换范围时取消旧请求，避免旧范围结果覆盖新范围。

## 4. 验证与限制

单测覆盖计时、容量、LRU、同实例多配置、并发和授权失效；进程列表测试检查实际传给 `ps` 的参数，以及失败降级。真实本机只做进程读取，不终止外部应用或发起付费模型请求。

测试模拟句柄证明回收决策，不证明特定供应商版本必然响应 SIGTERM；保温进程实际 RSS、真实冷启动耗时及 Windows 全机扫描不作为本次实测结论。端口 3000 当前由其他工作树开发服务提供，本工作树提交不会自动加载到那个服务。

2026-11-01 验证结果：

- `pnpm exec jest --runInBand __tests__/services/game-agent/cli __tests__/components/agent-cli-processes.spec.tsx __tests__/app/game-agent-processes-api.spec.ts`：12 组、81 项通过。
- `pnpm typecheck`、`pnpm lint:check`、变更文件 Prettier 检查及 `pnpm build` 通过；CR 后页面修正另通过 `pnpm build:next`。
- 全仓 Jest：461/462 组、3289/3291 项通过。`auto-battle-items.spec.ts` 中两个无武器时选择投掷道具的用例收到防御动作；原始 HEAD 隔离运行同样失败，与本次改动无关。
- 隔离生产服务在端口 3301 验证 `/logs/cli`、默认 GET 与 `includeSystem=1` 均返回 200；浏览器切换两种范围结果正确。空登记表返回 0，单独登记测试 PID 后可读取 RSS；全机扫描只返回识别出的外部 CLI。
- CR 检查了忙碌句柄不参与淘汰、授权 epoch、代理协议及请求头复用键、范围切换取消与 Linux `comm` 降级识别；发现项已修正并通过相关测试复验。

本次冒烟使用独立临时数据目录，未改动端口 3000 服务、全局存储定位器及其他应用的进程。
