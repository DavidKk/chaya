# Bergamot 本地离线翻译与语言包管理技术设计

- 创建日期：2026-10-19
- 更新日期：2026-10-23
- 状态：第一阶段实现与验证中；本次实现记录见下，后续章节保留完整目标设计
- 需求文档：[Bergamot 本地离线翻译与语言包管理需求](../linux-offline-translation.md)

## 本次实施记录（2026-10-23）

仅 Bergamot 使用应用内下载器。Apple 语言包保持系统操作指引，由用户在 macOS 下载。

- 固定清单落在 `services/translate/bergamot/models.json`，当前开放 **darwin-arm64、en → zh**；采用 Mozilla Release `llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g`，四个 gzip 文件合计 36,745,493 字节。每个文件记录压缩与展开后的 SHA-256 和长度，许可证及来源随计划显示。
- 已实现 `bergamot-packs` 的 plan／install／status／cancel，所有 action 在分发前检查本机管理权限。status／cancel 同时携带 `from / to`，cancel 另带 jobId；普通游戏会话显示绑定服务控制台入口。
- 同根目录使用 PID 存活检测与磁盘独占锁；相同计划复用进行中任务。首版不同计划返回 busy，由用户稍后重试；多计划排队与共享包调度属于后续扩展。
- 下载使用固定 HTTPS 资源、禁止重定向，大模型分段并行下载；实际字节进度持久化。校验、受限 gzip 展开、独立原生进程试译全部成功后，发布不可变 installId 目录并原子切换 active。失败／取消清理本次 staging；损坏修复生成新 installId。
- 原生接入采用 **进程固定模型根目录**：Node 从 active 解析安全安装引用，以内部环境变量为该进程指定不可变根目录；模型文件在其 `<from>_<to>` 内。继续使用现有 JSON-Lines 协议，未新增能力握手。安装记录绑定程序 SHA-256；程序变化必须重新安装验证。不同安装引用使用不同 daemon，空闲 60 秒回收。
- 受管就绪检查校验清单、文件元数据和哈希，并以独立进程验证译文；按安装与程序身份合并缓存，通过有界并发队列执行。当前接口等待检查结果；异步 checking／readinessCheckId 协议仍是后续设计。
- 控制台行内显示安装／取消／重试、下载进度及验证阶段；关闭面板不取消服务任务，完成后重新检测但不自动开启引擎。列表所选语向贯穿状态和安装，插件系统翻译也传递目标语向；非简中结果不写入现有简中缓存。
- Electron 准备脚本对清单开放的宿主平台检查原生文件及 check 协议，缺失或不兼容则失败；尚未进行完整发行包安装验收。
- 已实际通过网络下载全部四个文件至全新临时根目录，校验、试译、发布和受管翻译成功：`Hello, world!` → `你好,世界!`。另测 `__C0__Hello, world!__C1__`，占位符保持完整；首次受管调用含完整性复核约 1.7 秒。配置必须包含 `mini-batch-words: 1024`，否则当前原生构建会触发 batching 断言。
- 未开放其它语言／平台，英语中转仍属第二阶段。后续章节中的扩展状态、任务排队和新协议要求不代表已经交付。

## 1. 现状与问题

### 1.1 已有实现

- `services/translate/lib/bergamot-translate.ts`：启动原生程序，以 JSON-Lines 请求 `check`／`translate`，维护请求映射、5 秒看门狗及 60 秒空闲回收。
- `native/bergamot-translator/main.cpp`：按单个方向查找 `config.yml`，加载一个模型并完成同步翻译；当前仅保留最后加载的模型。
- `app/api/translate/route.server.ts`：提供 `bergamot-status`／`bergamot`，状态返回 `ready | model_pack_missing | unavailable`、`installed` 及语向信息。
- `components/translate/TranslateEngineRail.tsx`：就绪 Badge、专用 loading、未就绪说明及重新检测入口。现有说明不具备下载安装能力。
- 已接入现有引擎开关、实时翻译、单条翻译、seed 补译与缓存来源筛选，默认关闭。

程序探测顺序为 `CHAYA_BERGAMOT_BINARY`、平台架构目录、通用 `native/bin/`、`~/.local/bin/`、PATH。只接受 Chaya JSON-Lines 协议的 `chaya-bergamot-translator`，不能用上游一次性 CLI 替代。

语言包根目录：`CHAYA_BERGAMOT_PACKS_DIR`，否则优先工具箱 `data/translation-packs/`（`TRANSLATION_PACKS_DIR`），便于与其它本机数据一并备份。若新目录不存在而旧路径 `${XDG_DATA_HOME:-$HOME/.local/share}/chaya/translation-packs` 仍有内容，启动时尝试迁入；迁入失败则继续读旧路径。现有目录格式为 `<source>_<target>/config.yml`。

2026-10-20 已在 macOS arm64 完成英语 → 德语的真实模型验证；这不证明最新 Mozilla 中文模型、其它平台或全部语向兼容。2026-10-23 本机检查英语 → 中文返回 `model_pack_missing`，根目录不存在。

### 1.2 未实现与交付缺口

尚无固定可安装模型清单、下载任务、进度、资源校验、原子安装及英语中转。普通 `pnpm build` 不构建 Bergamot，Electron 准备过程复制已有原生产物，因此不能保证发行包包含可用程序。

现有模型切换会释放上一模型，中转时反复切换可能导致每句重复加载。现有 5 秒超时包含首次加载，不适合直接套用到模型安装验证。

## 2. 模型来源与发布清单

### 2.1 上游依据

Mozilla 官方资料：

- [已发布模型](https://mozilla.github.io/translations/firefox-models/)
- [模型注册表](https://mozilla.github.io/translations/model-registry/)
- [注册表 JSON](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json)
- [旧仓库迁移说明](https://github.com/mozilla/firefox-translations-models)

2026-10-23 查询的注册表生成于 `2026-10-22T00:48:30Z`，模型存放于 Mozilla Google Cloud Storage。文件可能包含压缩后的模型、共享或分离的 SentencePiece 词表，以及 lexical shortlist。不能假设下载单个权重就足够，也不能把任意 Marian 模型或 Argos 包当作兼容包。

当前模型来源覆盖 `en` 与 `zh / zh_hant / ja / ko / fr / de / es / ru / pt` 的双向方向。非英语两两之间的覆盖需要中转；上游登记或标记 Release 不等于已通过 Chaya 验证。

### 2.2 Chaya 固定清单

首版仅支持按文件下载 `identity` 或 `gzip` 资源，不引入任意归档格式解包；如采用 Chaya 托管资源，也发布为这两种文件形式。

首版随应用交付经过审查的固定清单，不在用户点击安装时动态信任最新上游注册表。后续更新通过应用版本更新清单。清单版本、模型版本不可混用；使用不可变资源 URL，并保留上游来源与许可证信息。

每个包至少包含：

| 字段                                                   | 用途                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `packId`, `version`, `catalogVersion`                  | 方向、内容版本和清单身份                                                      |
| `source`, `target`, `upstreamPair`                     | 应用规范语言代码及上游代码                                                    |
| `engineCompatibility`, `platforms`, `cpuFeatures`      | 已验证的原生构建／协议、系统架构与必需 CPU 指令集约束                         |
| `files[]`                                              | HTTPS URL、相对目标文件名、压缩方式、下载字节数及 SHA-256、解压大小及 SHA-256 |
| `configTemplate`, `configHash`                         | 与该模型匹配的受控配置及版本                                                  |
| `downloadBytes`, `installedBytes`, `requiredFreeBytes` | 安装计划和空间预检                                                            |
| `license`, `attribution`, `sourceUrl`                  | 使用和再分发依据                                                              |
| `validation`                                           | 验证环境、实际加载、样例翻译与时间记录                                        |

优先直接下载上游不可变文件；若因格式或兼容性使用 Chaya 托管包，需先核对再分发条件并记录原始来源。清单不得留空哈希、虚构大小或以示例 URL 作为可发布资源。

首次纳入某个模型时必须完成：核对许可证、下载文件完整性、正确配置、当前原生引擎可加载、非空且语言正确的真实译文、控制符保护、目标架构兼容、内存及冷／热耗时测试。失败的模型不进入可安装清单。

## 3. 原生程序交付

发行构建先生成对应 `linux-{arch}`／`macos-{arch}` 的程序，再检查打包后路径与可执行权限。支持矩阵由实机验证决定；缺失受支持架构产物应让该发行构建失败，而不是等用户安装模型后才发现程序缺失。

开发者仍可运行 `pnpm build:bergamot`。所需 Git、CMake 3.24+、C++17 编译器、PCRE2，以及 Linux BLAS／macOS Accelerate 属于构建环境，不是用户安装语言包的前置操作。不能未经验证承诺 Musl 全静态链接、所有 Linux 发行版或固定 CPU 指令集兼容。

模型安装器只负责模型资源，不从模型服务下载并运行任意原生程序。不支持的平台直接返回 `platform_unsupported`。

## 4. 语言代码与翻译路径

| Chaya 输入                     | 应用规范代码 | Mozilla 代码 | 说明                              |
| ------------------------------ | ------------ | ------------ | --------------------------------- |
| `en`                           | `en`         | `en`         | 英语                              |
| `zh`, `ch`, `zh-CN`, `zh-Hans` | `zh`         | `zh`         | 简体中文                          |
| `cht`, `zh-TW`, `zh-Hant`      | `cht`        | `zh_hant`    | 独立繁体模型，不映射到简体        |
| `ja / ko / fr / de / es / ru`  | 同输入       | 同输入       | 对应语言                          |
| `pt-BR`, `pt`                  | `pt`         | `pt`         | 通用葡萄牙语，UI 保留地域适配说明 |

现有 TypeScript 把繁体映射成 `zh-TW`，原生正则不允许下划线。目标方案由 Node 统一规范化，应用内部使用 `cht`，清单负责映射 `zh_hant` 的远端文件；不把上游代码直接传入旧原生协议。配置目录使用清单生成的安全 ID。

路径解析只读取已验证且适用于当前平台的清单：

1. 规范化后源语言等于目标语言：返回 `same_language`，不启动安装或引擎。
2. 有受支持直接模型：选择该模型。
3. 否则存在 `source → en` 与 `en → target`：第二阶段选择两段中转。
4. 否则返回 `pair_unsupported`，区分无路径和资源尚未验证。

同一方向已有 active 版本且仍在当前清单的兼容版本集合中时，首版继续使用该版本，不自动升级；否则使用清单指定版本规划安装。模型版本更新不自动扩大为下载操作。

路径选择与是否已经安装分开：未安装直接模型时仍展示其安装计划，不因碰巧存在其它包而悄悄更改路径。每个计划固定到清单版本与包版本。`planId` 是由清单版本、规范语向、有序路径及包版本列表计算的稳定内容标识，不依赖进程内存；缺失包集合与下载大小是计划的动态快照，不参与标识。创建任务时重算计划并验证标识，清单变化则返回 `BERGAMOT_PLAN_STALE`，要求重新展示安装内容，不静默安装不同资源。任务固化当时的清单记录，服务升级后不继续执行旧的未完成下载。

所有入口必须显式传递用户实际选择的源语言和目标语言。现有游戏内 `systemStatus`／`requestSystem` 会推断源语言并固定目标为 `zh`，需在第一阶段改为贯穿请求语向；状态、计划、安装和翻译共用规范化结果。保留 `requestedSource / requestedTarget` 供 UI 呈现，避免 `pt-BR → pt` 等内部映射覆盖用户选择。

### 4.1 受管目录读取协议（第一阶段前置）

受管目录支持与安装器同时交付。Node 从 active 指针取得 `{ packId, version, installId }`，验证路径、清单和完整性后，为该不可变安装引用创建独立原生进程。通过仅供服务内部使用的 `CHAYA_BERGAMOT_PACKS_DIR` 环境变量，将该进程的模型根目录固定到安装目录；HTTP 调用方不能指定文件路径。进程继续使用已有 JSON-Lines 协议。

安装验证同样启动独立进程，但将根目录固定到本次 staging，发送清单内固定样例。验证 manifest 绑定原生程序 SHA-256；程序变化后不沿用旧验证结果，需要重新安装并试译。发行准备脚本检查原生可执行权限及 check 协议。第一阶段不依赖未交付的能力握手。

Node daemon 缓存键为不可变安装根目录，包含 packId、version 和 installId，最多保留 8 个进程；空闲 60 秒回收。更新或修复后新请求取得新引用，已进入旧进程的请求继续使用原目录。第二阶段在此基础上增加两段调度；若未来转为单进程多模型，届时需新增版本化模型引用协议。

## 5. 安装任务与进度

### 5.1 任务生命周期

本机服务持有任务，前端只创建、查询和取消。任务不绑定 HTTP 请求或页面生命周期，关闭浮层不终止下载。用户主动取消走明确接口。

```text
state: queued → running → completed | failed
queued / running → cancelling → cancelled（若全部包已提交则 completed）
服务退出遗留 queued / running / cancelling → 恢复核对后 completed | interrupted
phase（running 内）: downloading → verifying → installing → validating → publishing
```

`state` 表示任务生命周期，`phase` 表示当前工作阶段，禁止混用。phase 可以按文件／包重复；组合任务只有全部必需包可用才完成，失败仍保留已经提交的单包。终态不可再被迟到的进度回调覆盖。phase 在 queued 和终态为 null，取消中保留最后阶段用于说明，pending cancel 不再汇报新的下载进度。

任务快照包括 `jobId / planId / revision / state / phase / requestedSource / requestedTarget / source / target / route / packs / downloadedBytes / totalDownloadBytes / currentPack / currentFile / error / updatedAt`。`revision` 在同一 job 内单调递增，前端按 jobId 隔离并忽略旧快照。

### 5.2 进度口径

- 字节进度以实际写入临时下载文件、尚未进行 gzip 解压的资源字节计数；请求禁用 HTTP 内容编码转换（`Accept-Encoding: identity`），拒绝不符合预期的 Content-Encoding，防止自动解码后大小／哈希口径不一致。总量使用清单固定大小，校验响应长度，不能盲信服务器 Content-Length。
- 下载百分比只代表下载阶段，校验、发布、加载验证使用独立阶段文案与不定进度条。
- 未知总量时显示已下载字节和不定进度，不伪造总百分比；发布清单应提供完整大小。
- 排队任务开始运行时重新排除已安装包，再冻结本次 `totalDownloadBytes`，之后不因其它任务完成而改变分母。重试创建新的 job，并以 `retryOf` 关联旧任务；已安装包不计入新任务下载量。单次 job 内的自动文件重试另记 `attempt`，当前尝试计数重新开始，UI 明示重试，避免把重复网络流量计算为安装进度。
- 活跃任务首版约每秒轮询快照，完成或离页停止轮询；重入通过语向计划查找当前任务。无需首版引入 SSE。

### 5.3 去重、取消与恢复

以规范化根目录为单位只允许一个安装协调器持有跨进程租约锁，租约包含所有者及存活检测。相同根目录的第二个服务实例不得自行执行任务或清理 staging，应返回 `PACK_INSTALLER_BUSY`；仅确认旧所有者退出后才能接管并恢复任务。

协调器同一时间只运行一个安装计划，按 `planId` 复用活跃或排队任务，其它计划排队，执行时重新排除已经安装且完整的共享包。已完成／失败／取消任务不能被误当作新安装结果：缺包或损坏时创建新 job。已全部可用的计划返回当前就绪结果，不创建下载任务。

任务是共享的全局任务，多个页面订阅同一 `jobId`。取消是全局操作，界面提示对其它界面的影响；浏览器关闭不等于取消。取消后中止网络及解压，并终止本任务独立验证进程；等待文件句柄关闭后清理未发布 staging，不回滚已成功安装的独立包。进入发布临界区前检查取消标记，进入后不打断该单包提交；指针发布和取消结算在同一协调器锁下串行执行。若最后一个所需包已提交，则结算 completed；否则保留已提交包并结算 cancelled。对终态取消返回原终态，不能重写成功结果。

在持有根目录租约锁后，原子持久化任务摘要和包阶段，并记录发布提交意图。服务启动恢复时先核对 active 指针、目标 manifest 与验证记录，再处理旧任务：全部计划包已提交且仍有效则修正为 completed；其余标记 interrupted 并列出可复用包。不得仅凭未写入 completed 的旧任务摘要判断模型安装失败。

清理仅限已确认失去所有者且不被 active 引用的 staging；已发布但未更新 active 的目录作为未激活版本保留，不参与就绪。首版不承诺断点续传，重试复用成功包、从头下载未完成文件。后续实现续传时需校验 ETag／版本及最终完整哈希。

## 6. 文件安装与一致性

保留现有根目录及开发环境覆盖项。目标布局：

```text
translation-packs/
  catalog-state.json
  jobs/<jobId>.json
  .staging/<jobId>/<packId>/<version>/
  packs/<packId>/<version>/<installId>/
    config.yml
    manifest.json
    <模型、词表和其它清单文件>
  active/<packId>.json
```

安装步骤：

1. 检查原生组件与计划兼容性，检查写权限和临时／最终空间；空间估计不代替写入时的 ENOSPC 处理。
2. 下载到同文件系统 staging，以临时文件写入，限制下载大小、超时与重试次数；每次实际安装分配新的 `installId`。
3. 校验下载 SHA-256；仅按清单进行 identity 复制或单文件 gzip 解压，限制展开大小与文件数，校验解压后 SHA-256。
4. 使用受控模板生成 `config.yml`，开启相对路径，引用该版本内文件；不执行下载的脚本，不直接采用不受控 YAML 配置。
5. 在独立验证进程中加载 staging 模型并执行小型冒烟翻译，避免阻塞或终止正在服务游戏的原生进程。
6. 当前包验证成功后写入验证 manifest，持久化文件及提交意图，原子重命名为不可变安装目录，再原子更新并持久化 `active/<packId>.json`（包含版本、installId、manifest 摘要）；最后标记该包完成。多包逐包提交，全部所需包完成后才刷新整条路径为就绪。元数据和目录更新按目标平台文件系统能力执行同步，跨文件更新中断由恢复核对处理，不能假设多个 rename 构成一个事务。

禁止绝对路径、`..`、符号链接／硬链接逃逸。下载只接受清单中的 HTTPS 资源及允许的重定向目标，不允许客户端传入任意 URL、目标路径、文件名或配置内容。

同版本文件损坏也允许“修复”：通过新 `installId` 下载验证并发布，新 active 指向新目录；损坏目录保留为非 active 版本，不就地覆写。如此既不因不可变目录已存在而跳过修复，也不破坏已固定引用的请求。

失败仅清理 staging，不覆盖已有 active 版本。升级安装完成前旧版本仍可用；已有翻译请求固定到旧版本，新请求使用新版本。首版不自动删除旧版本，避免删除仍被进程引用的文件；卸载和磁盘清理另行设计。

旧目录 `<from>_<to>/config.yml` 通过只读兼容解析保留，包括历史繁体 `zh-TW` 目录别名，已有有效手工包可继续直译；无兼容受管路径时，匹配旧包的检查必须早于“清单无路径”的最终判定，但不将其声明为可下载安装资源。未纳入清单的包不自动更新、不参与受支持中转声明。安装同方向官方包后优先使用受管 active 版本，不删除旧文件。新协议通过受控包身份解析路径，不开放任意文件系统路径给 HTTP 调用方。

## 7. 就绪状态与接口契约（拟新增）

保留 `POST /api/translate` 的现有 `bergamot-status`／`bergamot` 入口。安装相关 action 使用独立的逻辑模式 `bergamot-packs`，由当前本机翻译服务分发；以下是目标契约，尚未实现。

| 请求                                                              | 行为                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| `{ mode: 'bergamot-packs', action: 'plan', from, to }`            | 返回计划、所需包、缺失包、下载与空间估计及当前任务        |
| `{ mode: 'bergamot-packs', action: 'install', from, to, planId }` | 校验计划并创建／复用任务，返回任务 ID，不阻塞等待下载完成 |
| `{ mode: 'bergamot-packs', action: 'status', jobId }`             | 返回任务快照                                              |
| `{ mode: 'bergamot-packs', action: 'cancel', jobId }`             | 幂等取消该任务                                            |

所有请求保留现有响应 envelope，错误使用 `apiError` 结构。`plan` 只读，不下载、不创建安装任务。install 同时携带语向和 planId，服务可以无会话状态地重算计划，不能仅凭不可逆哈希查找已经随重启丢失的内存对象。

就绪与安装任务是两个独立维度。服务端 `status` 使用 `checking | ready | model_pack_missing | model_pack_invalid | pair_unsupported | platform_unsupported | component_unavailable | not_required | error`；`checking` 表示服务已经受理、尚未完成的异步就绪检查，前端请求本身尚未返回时也使用相同的加载呈现。`installing` 通过独立 `activeJobId` 与任务快照表达，不覆盖仍可使用旧模型的 ready。

| 场景                         | status             | installed | canInstall                         |
| ---------------------------- | ------------------ | --------- | ---------------------------------- |
| 当前路径已验证可用           | ready              | true      | false；首版无手动升级入口          |
| 尚无有效就绪记录且复核进行中 | checking           | false     | false，返回 readinessCheckId       |
| 缺包且有兼容清单资源         | model_pack_missing | false     | 取决于管理权限与安装协调器可用性   |
| 受管模型文件损坏且有修复资源 | model_pack_invalid | false     | 同上，UI 操作为“修复语言包”        |
| 相同规范语言                 | not_required       | false     | false，reasonCode 为 same_language |
| 不支持、组件异常或其它错误   | 对应状态           | false     | false                              |

状态附加 `requestedSource / requestedTarget / source / target / route / packIds / missingPackIds / invalidPackIds / canInstall / activeJobId / readinessCheckId / reasonCode / accessReason`。文件缺失归入 missing，存在但未通过完整性或加载检查归入 invalid；不能仅凭目录或旧 job 的 completed 判定 ready。升级任务存在时有效旧版本仍 ready；纯翻译权限客户端可以查询语向状态，但不得获得文件路径、下载 URL 或全局任务列表。

已有 `unavailable` 作为旧客户端兼容值，不与上述新 schema 混杂发布。扩展响应增加 `schemaVersion: 2`，现有旧客户端继续只依赖 installed；错误原因由新 UI 读取，未知状态按不可开启处理；not_required 返回无需翻译，不触发离线引擎请求。plan 和安装 API 同步返回实际语向，确保请求返回途中切换语言不会污染当前页面状态。

状态查询不向正在服务翻译的原生进程排入模型加载请求，避免轮询挤占翻译队列并触发 5 秒全进程看门狗。就绪记录按安装身份、引擎构建与协议版本缓存；服务首次识别、文件元数据变更或显式重新检测时，通过独立进程复核，尚无有效结果时返回 `checking` 与 `readinessCheckId`，后续同语向 `bergamot-status` 查询读取并复用同一检查，不反复启动进程。复核进行中若已有未失效的可用记录，则保持 ready 并附 readinessCheckId；文件变化或推理报告模型异常时立即使该记录失效。复核失败返回 error 或 model_pack_invalid，不无限使用旧 ready。

独立检查与安装验证共用有界的验证队列，同一模型身份合并检查，一次只运行一个验证进程；避免多个页面轮询造成反复加载和内存峰值。每次检查有总超时，排队也计入时限，前端约每秒查询直到终态或服务公布的截止时间，到期显示可重试错误。普通后台状态轮询复用缓存；显式“重新检测”传 `refresh: true`，仅在无同身份检查时触发新检查。安装任务查询始终只读本地任务快照。

错误码至少覆盖 `BERGAMOT_PAIR_UNSUPPORTED`、`BERGAMOT_COMPONENT_UNAVAILABLE`、`BERGAMOT_PLAN_STALE`、`PACK_DOWNLOAD_FAILED`、`PACK_DISK_FULL`、`PACK_PERMISSION_DENIED`、`PACK_CHECKSUM_FAILED`、`PACK_MODEL_INCOMPATIBLE`、`PACK_VALIDATION_FAILED`、`PACK_INSTALL_INTERRUPTED`、`PACK_INSTALLER_BUSY`。

`bergamot-packs` 全部 action（包括 plan／任务查询）要求 `hasManagementAccess`，沿用当前同源本机控制台或有效 Bearer 管理凭据规则；无盘服务先拒绝。普通 `bergamot-status` 沿用翻译访问控制，只返回语向能力及 canInstall，不把 launch token 当作管理凭据。管理鉴权必须位于新 action 的分发前，不能因请求进入现有 translate 路由就认为已获安装权限。实施时同步扩展控制台与游戏内 `TranslationRuntime` 请求分发白名单和权限检查；无安装权限的游戏内会话不请求全量安装计划或创建任务，提供前往当前服务控制台安装的入口，不扩大普通翻译 token 权限。控制台入口来源为已绑定服务地址，不携带管理令牌或任意下载 URL；页面关闭不自动返回令牌给游戏。

Remote／云端无盘服务拒绝本地安装。连接本机服务的界面明确标识安装发生在该服务设备，不能根据浏览器运行平台决定下载资源。

## 8. 英语中转与推理生命周期（第二阶段）

路径由 Node 规划，两段推理均由本地 Bergamot 完成，翻译请求固定模型版本。第一段输出只作为第二段输入；最终结果的目标语言仍为用户选择的语言。

沿用第一阶段的受管模型引用与原生协议。缓存最多保留当前路径所需的两个模型，路径切换和空闲回收释放不再使用的模型；两个模型同时驻留的峰值内存必须实测。若设备无法承载，返回明确资源错误，不无限加载其它模型。

若保持现有同步 IPC，每个任务的两段调用必须作为一个调度单元处理，避免并发请求交错导致不断切换模型。需要区分准备加载和稳态推理，复用现有翻译调度及取消信号；两段共享调用方总时限，不各自重新获得完整超时预算。排队、首载及中转超时分别可观测。

安装验证使用独立、较长但有上限的超时，具体值由实机加载测量确定，不能沿用现有 5 秒默认值。运行时稳态请求仍受现有管线时限约束，不能因安装器引入无限等待。

占位符保护跨两段保持，不在第一段恢复控制码。第二段输入另需校验长度：第一段可能膨胀，超出原生 80000 字节上限时明确失败，不能截断；对每段分别检查占位符集合完整性，发现缺失或新增即让该请求失败。只发布最终结果，来源保留 `bergamot` 并记录 `route`、模型版本等诊断信息；中间英语不以用户目标语言写入缓存。不得绕过现有缓存命名空间、文本恢复和有效译文判定。

## 9. UI 接入与状态刷新

继续复用 `TranslateEngineRail`／`TranslateEngineRow` 及共享 Badge、Button、Modal。进度条沿用现有进度呈现规范；若缺少共享组件，在实施时补齐可复用的进度组件，不能在两个入口各自实现。具体视觉跟现行 UI 规范，控制台和 GameEdit 使用相同任务组件与服务快照。

缺包时有管理权限的界面将旧的静态说明替换为安装计划和安装入口，无管理权限的游戏内界面显示前往控制台安装；组件不可用、不支持、无安装权限分别展示原因。安装进度在行内显示，展开后查看模型明细、取消／重试；切换语言对时按任务 ID 隔离进度，不把旧语向完成结果套到新语向。

下载完成后仍保持未就绪，直到校验、发布与加载验证结束。完成后重新查询当前语向状态，不自动修改开关。Apple 安装指引保持系统语言包路径，与 Bergamot 安装任务独立。

## 10. 验证与分阶段交付

第一阶段同时交付受管模型读取协议、实际语言对贯穿各入口及经过验证的直接语向安装能力，以安装后真实翻译成功为闭环；第二阶段交付中转能力。18 个直接方向、90 个互译方向均为覆盖目标；按清单逐项开放，不能将此数量作为当前实现承诺。

| 层级           | 必须验证                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| 清单与规划     | 10 种语言代码、繁简区分、pt 适配、相同语言、旧包无清单兼容、游戏内非中文目标、直接优先、两段缺失包计算   |
| 下载与文件     | 字节进度、断网／超时、错误长度、坏哈希、展开超限、路径逃逸、权限／空间不足                               |
| 任务一致性     | 重复请求、不同计划共享模型、全局取消、提交临界区、发布后未记完成即重启、多进程接管、切页重入、旧快照丢弃 |
| 原子发布       | 验证失败不改 active、更新时旧请求继续、已完成单包被重试复用、同版本损坏修复、锁互斥                      |
| 权限与运行形态 | 全部 packs action 鉴权、翻译 token 不越权、Remote 拒绝、无管理权限时控制台安装闭环                       |
| 真实模型       | 每个开放模型／平台加载和翻译；冷／热时延、CPU、内存、控制码、繁体及葡语样例                              |
| 中转           | 两段成功、任一段失败、取消／总超时、并发隔离、只缓存最终译文                                             |
| UI             | 初始 loading、直接／中转计划、真实进度、失败／取消／恢复、完成后手动开启、10 语言文案                    |

源码检查与 mock 测试不能替代真实模型和打包安装验证。验收结果记录模型版本、原生构建版本、平台架构与实测数据，再决定清单是否对该环境开放。

### 下载中心与开发调试

Bergamot 安装任务直接复用持久化任务 ID，下载中心通过 `/api/downloads` 与 SSE 的快照同步读取相同任务，不创建第二个下载任务。SSE 每秒检查磁盘任务变化，覆盖安装器位于不同服务进程、刷新和重连的情况；只保留一小时内的完成记录。顶栏下载入口在桌面和窄屏均可见，不藏入导航菜单。展示区分下载与校验安装：下载显示真实字节进度，校验和试译显示不定进度，不将已下载 100% 视为安装完成。结束提示使用 Bergamot 文案，不复用 NW.js 的续传承诺。

开发模式的控制台挂载贴边调试入口，可拖动切换左右边缘并记住纵向位置，Escape 或点击外部关闭。功能通过 `useDebugMenuRegistration` 注册分组和动作，卸载时自动注销。Bergamot 预览嵌在现行翻译工具详情页（`TranslateEngineDetailView`）内，复用底部检测／保存栏与离线状态区；安装卡片仍与真实安装器共用 `BergamotPackGuide`，不挂载请求逻辑。模拟下载可显式放入右上角任务栏，标记为预览，切换到非下载状态、关闭模拟或卸载时移除，不影响真实任务。生产环境不挂载调试入口。Apple 继续只提供系统操作指引。
