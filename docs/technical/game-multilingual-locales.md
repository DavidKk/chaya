# 游戏多语言包自动探测、语料反哺与双向对照翻译技术方案

- **状态**：设计完成 / 待开工
- **版本**：v1.0
- **日期**：2026-10-18
- **对应需求文档**：[docs/game-multilingual-locales.md](../game-multilingual-locales.md)

---

## 1. 架构与设计原则

0. **全英文 API 与日志规范（详见 [api-and-logs-standard.md](api-and-logs-standard.md)）**：
   - 所有翻译与本地化提取相关的 HTTP 接口、后台日志、错误抛出信息一律统一使用英文；UI 展示通过前端 i18n 字典按当前语言映射。

1. **零污染与只存文字（Text ↔ Text Only）**：
   - 系统的翻译缓存数据库（`translate-cache.db` / SQLite）与在线缓存只收录真实自然语言。
   - 严禁将 RPG Maker / 插件内部的占位符 Key（如 `Map007-42`、`SystemText-3` 等）当成原文字符串写入数据库。
2. **多语言包松耦合自适应**：
   - 无论游戏是标准 `locales/{lang}/*.json` 目录结构，还是自研插件、扁平字典文件，由探测层统一抹平为 `LocalesCatalog` 抽象模型。
3. **安全回写门禁**：
   - 任何改写游戏本地语言包的操作必须经过原子写入与 `*.bak.json` 原生备份机制，防止意外损坏用户游戏原始文件。

---

## 2. 核心数据结构与模型

```typescript
/** 多语言包整体目录快照 */
export type GameLocalesCatalog = {
  hasLocales: boolean
  localesDir?: string
  /** 探测到的所有语言代码列表，如 ["ru", "en", "ch", "cht", "ja", "ko"] */
  languages: string[]
  /** 默认/主语言（通常为开发原语言 ru 或主要发布语言 en） */
  primaryLanguage: string
  /** 语言代码 -> (Key -> 文本内容) */
  dictionaries: Map<string, Map<string, string>>
  /** Key -> 所属文件相对路径（如 "Map007-42" -> "locales/ru/Act1.json"） */
  keyToFileMap: Map<string, string>
}

/** 语料库双向对齐单元 */
/** 扩展条目结构：支持本地化 Key 溯源 */
export type ExtractedTranslationItem = {
  id: string
  src: string
  zh: string
  savedZh?: string
  meta: ExtractedItemMeta & {
    localesKey?: string
    localesFile?: string
  }
}

export type ParallelCorpusPair = {
  src: string
  zh: string
  from: string
  to: string
  engine: 'game:locales'
}
```

---

## 3. 详细实现模块

### 3.1 多语言包扫描与解析引擎 (`services/extract/lib/game-locales.ts`)

1. **探测算法与底层资源过滤**：
   - **Chromium / NW.js 底层 `locales/*.pak` 排除守卫**：
     - NW.js / Electron 游戏外部根目录下自带的 `locales/*.pak` 属于浏览器引擎内部二进制资源（存放右键菜单、检查元素等系统文案，不含游戏剧本），对游戏翻译无用且强行解析会导致运行时异常；
     - 探测逻辑中设置严格守卫：**若目标目录下仅包含 `.pak` / `.pak.info` 等 Chromium 运行文件，一律静默忽略并跳过**；
     - 优先且精准识别真正包含游戏剧本 JSON / CSV 的业务子目录（如 `www/locales/`、`locales/` 下带语言子文件夹且包含 `*.json` 或 `*.csv` 的结构）。
   - **有效目录层级扫描**：
     - 依次检查：
       - `[contentRoot]/locales`、`[contentRoot]/www/locales`；
       - `[contentRoot]/languages`、`[contentRoot]/www/languages`；
       - `[contentRoot]/data/locales`；
       - 解析 `js/plugins.js` 中 `DKTools_Localization` 的 `Localization Folder` 参数。
2. **语言与字典索引构建**：
   - 读取该目录下的所有子文件夹，每个子文件夹作为一个语言代码（`locale`）；
   - 遍历各语言下的所有 `*.json` 文件，反序列化并将键值对收集到内存 Map 中；
   - 记录每个 Key 对应的基准文件名（如 `Act1.json`）。

---

### 3.2 抽取时的台词还原与 Key 标记 (`services/extract/lib/extract-items.ts`)

1. **台词还原**：
   - 当事件命令中遇到 `{Mapxxx-xxx}` 或纯 Key 字符串时，在 `LocalesCatalog` 中检索；
   - 依据当前选定的源语言（默认优先 `en` 或 `ru`）读取真实自然语言台词；
   - 若选定语言缺失某 Key，沿回退链 fallback：`当前语言 -> 英文 -> 俄文 -> Key 字面量`；
   - 将真实自然语言赋予条目的 `src` 字段。
2. **条目元数据注入**：
   - 在 `ExtractedTranslationItem` 增加 `localesKey` 字段；
   - 标记其所属的本地化文件相对路径（如 `locales/en/Act1.json`）。

---

### 3.3 语料反哺与数据库入库 (`services/translate/locales-corpus.ts`)

1. **两两全排列生成**：
   - 对每一个在多个语言中均有文本的 Key，生成全向对映：
     ```typescript
     for (const langA of availableLanguages) {
       for (const langB of availableLanguages) {
         if (langA === langB) continue
         const textA = dictA.get(key)
         const textB = dictB.get(key)
         if (textA && textB && textA.trim() !== textB.trim()) {
           pairs.push({ src: textA, zh: textB, from: langA, to: langB, engine: 'game:locales' })
         }
       }
     }
     ```
2. **批量事务入库**：
   - 调用 `batchInsertTranslateCache(pairs)`，写入系统的本地 SQLite 数据库（`translate-cache.db`），设置 `hitCount: 1`，冲突时跳过或合并。

---

### 3.4 前端同框语言选择器 (`components/sk/LanguagePairSelect.tsx`)

1. **样式与视觉规范**：
   - 采用同框一体化设计，外壳使用 `formControlChrome` + `h-8`；
   - 左侧为原语言 `Select`，右侧为目标语言 `Select`，中间渲染 `LiaExchangeAltSolid` 图标；
   - 统一遵循全局暗黑科技感主题与设计 Token。
2. **联动行为**：
   - 改变原语言：通知页面刷新 `item.src` 为所选语言的自然语言文本；
   - 改变目标语言：
     - 若该语言已有译文，从字典载入对应译文填充右侧编辑器；
     - 若该语言为未收录新语言，右侧编辑器留空供用户编写或触发 AI 翻译。

---

### 3.5 语言包安全保存与备份机制 (`services/extract/lib/save-locales-item.ts`)

1. **备份逻辑**：
   - 在写入目标语言文件（如 `locales/ch/Act1.json`）前，检查同目录下是否存在 `Act1.bak.json`；
   - 若不存在，则执行文件拷贝：`fs.copyFileSync(targetPath, backupPath)`。
2. **更新与持久化**：
   - 读取目标 JSON，更新 `jsonObj[key] = newZh`；
   - 采用原子写入方式（写临时文件后重命名覆盖）；
   - 同步调用翻译缓存更新接口，将最新的文字对存入 `translate-cache.db`。

---

## 4. 验证与测试规范

1. **多语言包解析单元测试**：验证各类多语言路径的识别与 Key 文本字典索引准确率。
2. **平行语料提取测试**：验证生成的双向文字对全排列无脏数据、无 Key 污染。
3. **回写与备份测试**：验证修改词条后正确生成 `*.bak.json` 并准确写回对应 JSON 字段。

### 3.6 API 接口契约增补 (`app/api/translate/route.server.ts`)

1. `mode: "extract-items"`：
   - 入参：`{ mode: "extract-items", sourceLang?: string, targetLang?: string }`
   - 返回：`{ ok: true, items: ExtractedTranslationItem[], locales?: { availableLanguages: string[], currentSourceLang: string, currentTargetLang: string } }`
2. `mode: "save-item"`：
   - 入参：`{ mode: "save-item", text: string, zh: string, localesKey?: string, targetLang?: string, targetFile?: string }`
   - 行为：
     - 若提供 `localesKey`，调用 `saveLocalesItem` 将译文安全写回对应的游戏本地化 JSON；
     - 同步写入主翻译数据库 `translate-cache.db` 与 `cache.ndjson`。
3. `mode: "import-locales-corpus"`：
   - 入参：`{ mode: "import-locales-corpus" }`
   - 行为：一键将游戏本地化多语言文字对全排列批量预热导入 `translate-cache.db`。
