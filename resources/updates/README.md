# 官方更新信任根

此目录预留给发布负责人审核后的 `root.json`。开发代码不生成正式根、不在客户端联网建立初始信任，也不包含私钥。

- 首次发布前，由发布负责人建立 TUF 仓库、保管私钥、确定根和在线角色的阈值、轮换与定期续签职责。
- 将核实过的公开 `root.json` 放到本目录，随应用发版；Electron 组装脚本会复制这个文件。私钥始终留在发布环境。
- 元数据发布到固定 `distribution` 分支的 `stable/`，数据发布到明确版本的 Releases。不能用 `latest` 替代资源版本目录。
- `pnpm updates:prepare INPUT.jsonl VERSION NEW_OUTPUT_DIRECTORY` 生成资源 asset 和待签入 targets 的 `target-entry.json`。资源 manifest 的版本保留原值，外层发布版本使用稳定 SemVer。
- 待签入条目必须由发布端的 TUF 工具生成和签署完整 targets、snapshot、timestamp 元数据。准备命令不签名、不上传，也不证明给定元数据已通过验证。
- 可追加已签元数据目录参数生成 `offline-update.json`，接收端仍用应用内置根和持久元数据缓存验证签名、有效期和回退。
- 先上传并验证 asset 的匿名下载和哈希，再发布整组元数据。Release 应设置为非 latest；资源 tag 以 `resources-` 开头，不触发 App 的 `v*` 发布任务。

未配置正式根时，检查与安装会报告不可用；内置翻译资源、现有译文和已安装本地版本不依赖远端可达。

实现和当前验证范围见 [更新技术文档](../../docs/technical/application-updates.md) §8。自动签名发布流水线和真实 GitHub 两版本验收仍待完成。
