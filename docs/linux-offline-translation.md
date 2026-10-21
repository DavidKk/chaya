# Linux 本地离线翻译工具接入需求

- 日期：2026-10-19
- 状态：目标需求；Bergamot 基础接入已实现，安装说明及未实现项见技术文档
- 适用范围：Linux 版 Chaya（Ubuntu / Debian / Fedora / Arch / Steam Deck 等 x86_64 及 aarch64）
- 技术设计：[Linux 本地离线翻译接入技术设计](technical/linux-offline-translation.md)

---

## 1. 背景与核心分层定位

### 1.1 明确“工具级（Tool-level）”与“大模型级（Model-level）”的界限

在本地离线翻译能力建设中，必须清晰区分**轻量离线工具**与**本地大语言模型（LLM）**的职责边界：

| 维度         | 轻量离线工具级（Tool-level，当前首要落地）                       | 本地大模型级（Model-level，后续一键安装演进）            |
| :----------- | :--------------------------------------------------------------- | :------------------------------------------------------- |
| **典型代表** | macOS Apple Translation, Windows WinRT, Linux Bergamot/Argos CLI | Ollama, vLLM, llama.cpp, Qwen2.5-7B, DeepSeek 等         |
| **硬件要求** | 极低（纯 CPU / SIMD / ANE / NPU，内存占用 < 100MB）              | 极高（需要 4GB~16GB 显存或高性能统一内存）               |
| **环境依赖** | 零复杂环境（单静态二进制或系统服务，无需 Python/PyTorch/CUDA）   | 复杂驱动栈（NVIDIA Driver, CUDA, ROCm, Python 运行时等） |
| **响应速度** | 极速（10ms ~ 50ms / 句，适合高频短语与批量脚本抽取）             | 较慢（1s ~ 5s / 句，适合需要复杂上下文润色与推理的剧情） |
| **系统定位** | **高可靠、零开销、零门槛的底层安全兜底**                         | **高文学性、长上下文的高阶定制化翻译**                   |

**核心策略**：先全面做实三端（macOS、Windows、Linux）**免运维、免部署环境、秒级启动的工具级离线翻译兜底**，保证用户在任何纯离线、无网或网络不佳的环境下都有可用翻译；后续再推出本地大模型的一键下载、模型管理与显卡加速模块。

### 1.2 Linux 平台的生态特征与目标

不同于 macOS（Apple 原生框架）和 Windows 11（WinRT NPU），Linux 平台缺乏单一垄断性商业 OS 厂商的全局翻译 API，但拥有成熟优秀的开源离线机器翻译工具生态（如欧盟 Bergamot / Mozilla Firefox 端侧翻译引擎、Argos Translate / LibreTranslate 引擎、Apertium 等）。Bergamot 是跨平台 C++ 引擎，也可以在 macOS 上使用 Apple Accelerate 编译运行；macOS 版本优先使用 Apple Translation Framework，Bergamot 作为统一的工具级跨平台备用通道。

本需求旨在为 Linux 桌面端、SteamOS（Steam Deck 掌机环境）及 macOS 提供**纯开箱即用、无环境负担的单文件 CLI / 守护进程工具**。

---

## 2. 全局翻译优先级链路

在完整翻译架构中，各翻译源遵循清晰严格的降级顺序：

```text
1. 手动人工翻译 (Manual Editor)
   ↓ 未覆盖
2. 游戏原生多语言包与语料库 (Game Locales & Corpus)
   ↓ 未覆盖
3. 大语言模型翻译 (LLM: DeepSeek / OpenAI / 本地大模型)
   ↓ 未覆盖或未开启
4. 操作系统原生 / 离线翻译工具 (Native & Tool-level Offline)
   ├─ macOS: Apple Translation Framework (ANE 加速)
   ├─ Windows: WinRT NPU 神经翻译 / DirectML 通用离线引擎
   └─ Linux: Bergamot (Mozilla Translate) / Argos 静态 CLI 引擎
   ↓ 未覆盖或离线包未下载
5. 商业翻译平台 API (Cloud Translation: DeepL, Google, 百度等)
   ↓ 均不可用
6. 保留原文并标记状态 (Untranslated / Needs Manual Review)
```

---

## 3. 支持语言范围

与 Chaya 整体国际化 10 种核心语言完全对齐，支持互相双向翻译：

1. 英语 (`en`)
2. 简体中文 (`zh`)
3. 繁体中文 (`cht`)
4. 日语 (`ja`)
5. 韩语 (`ko`)
6. 法语 (`fr`)
7. 德语 (`de`)
8. 西班牙语 (`es`)
9. 俄语 (`ru`)
10. 巴西葡萄牙语 (`pt-BR`)

---

## 4. 业务功能与场景需求

### 4.1 运行时环境自动探测与能力就绪检查

Linux 或 macOS 版 Chaya 启动时，自动探测系统环境与离线工具可用性：

1. **内建静态工具探测**：按当前平台检查 `native/bin/{platform}-{arch}/chaya-bergamot-translator` 是否存在且具备可执行权限。
2. **系统环境包探测**：探测系统 PATH 中是否存在现成可用的开源翻译工具（如 `bergamot-translator`、`argos-translate`）。
3. **离线语言对包探测**：扫描本地数据目录（如 `~/.local/share/chaya/translation-packs/`）中已安装的语言对词典/权重模型。
4. **状态上报**：向 Web 控制台及 MCP 接口返回明确的就绪状态：
   - `ready`: 工具二进制已就绪，当前翻译对可用。
   - `model_pack_missing`: 引擎就绪，但该语言对的轻量词库未就绪。
   - `unavailable`: 仅在不支持的平台或 binary 无法执行时返回。

### 4.2 离线语言包轻量管理与引导

- 轻量词库包体积极小（单个语言对仅 15MB ~ 40MB，远小于大模型的几个 GB）。
- 若用户选择某一语言对翻译但离线数据包未就绪：
  - 界面提供友好弹窗说明，标明当前缺少的语言对（例如“英语 ➔ 简体中文 离线轻量包（约 25MB）尚未下载”）。
  - 支持从官方 Release / CDN 一键自动下载解压到用户本地目录，无需用户手动敲终端命令。

### 4.3 零配置极速批量翻译

- 单句响应延迟必须在 **50ms 以内**（纯 CPU SIMD 优化）。
- 批量处理能力：支持在全量抽取剧本（上千条条目）时以批流方式快速跑完初版机翻，为后续人工审校与大模型精修打底。

### 4.4 接口语言与交互规范

- 所有后端 HTTP 接口、MCP 协议暴露的方法、系统错误与终端日志**严格统一使用英文**。
- 用户可见的前端界面（Web UI / In-game Overlay）全量遵循 10 种语言本地化。
