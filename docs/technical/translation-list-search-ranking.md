# 翻译列表多语言分词与相关度排序技术设计

- 日期：2026-10-25
- 状态：现行设计（已实现并纳入回归测试）
- 需求：[多语言搜索与相关度排序需求](../translation-list-search-ranking.md)。

## 架构与落点

依照 `chaya-structure` 规范，纯分词与排序算法属于无 UI 逻辑模块，落点在 `lib/translate/`：

```
lib/translate/
├── list-search.ts          # 搜索过滤与打分排序入口（保留现有函数签名）
└── text-segmenter.ts       # 跨语言轻量分词、文本归一化与 Token 抽取
```

调用方 `components/translate/TranslateListContent.tsx` 保持调用 `filterTranslationListItems(items, opts)`，无需调整页面组件层交互。

## 多语言分词方案设计

### 1. 为什么不用第三方分词包（Kuromoji / Jieba）

- `kuromoji.js` 字典文件超过 5MB，若在浏览器端加载会导致首屏或页面交互明显延迟；且仅适用于纯日文。
- `nodejieba` 等依赖原生编译，无法在 Web / 前端运行。

### 2. 采用原生 `Intl.Segmenter` API

现代浏览器（Chrome 87+、Safari 14.1+、Firefox 125+）及 Node.js 16+ 原生内置 `Intl.Segmenter`（基于系统底层 ICU 库）：

- 零打包体积增量，零网络下载。
- C++ 级别的执行速度（万条文本切词几十毫秒完成）。
- 原生支持日文（`ja`）、中文（`zh`）和通用/英文（`en`）的 `granularity: 'word'` 分词。
- **片假名词组保持**：ICU 分词器对部分片假名人名（如 `レイカ`）可能切碎为单字词素（如 `レ` + `イカ`），分词管线对连续片假名与长音符（`ー`）自动合并，确保外来语与角色名（如 `レイカ`、`ポーション`）保持为完整词元。

```typescript
// 针对三种核心语言创建分词器实例（单例复用）
const segmenters = {
  ja: new Intl.Segmenter('ja', { granularity: 'word' }),
  zh: new Intl.Segmenter('zh', { granularity: 'word' }),
  en: new Intl.Segmenter('en', { granularity: 'word' }),
}
```

### 3. 环境降级机制

若运行在极罕见的极简测试环境或未开启 Intl 的环境，自动降级为基于 Unicode 字符属性的正则边界切词：
`/(?:[^\p{L}\p{N}]+)/u`，保证绝不抛错。

## 文本标准化与预处理

在分词与比对前，执行统一归一化：

1. **Unicode NFKC 归一化**：自动把全角字母/数字（如 `Ｒｅｉ`）转为半角 `rei`，合并日文浊音假名。
2. **转小写（toLowerCase）**：大小写不敏感匹配。
3. **去除 RPG 标记与控制符**：复用既有的 `sourceTextBody`，过滤 `\C[2]`、`\V[1]`、`<br>` 等引擎标记，防止控制字符干扰词边界。

## 打分与排名算法

### 1. 词元提取与分类

对字段文本进行分词，提取所有有效 Token（过滤纯空白与标点符号）：

- `tokens`: `string[]`

### 2. Tier 判定逻辑

```typescript
function evaluateFieldTier(norm: string, q: string): { tier: number; penalty: number } | null {
  if (norm === q) return { tier: 0, penalty: 0 } // Tier 0: 全等

  let penalty = 0
  const pos = norm.indexOf(q)
  if (pos < 0) return null

  // 多词短语搜索：含空格时整体短语匹配
  if (q.includes(' ')) {
    if (pos === 0) return { tier: 10, penalty: 0 }
    const charBefore = norm[pos - 1]
    const isBoundary = /[^\p{L}\p{N}]/u.test(charBefore)
    return {
      tier: isBoundary ? 20 : 30,
      penalty: Math.min(pos * 0.005, 0.5),
    }
  }

  // 单词/词元搜索：基于分词 Token 判定
  const tokens = tokenizeSearchText(norm)
  let exactToken = false
  let minPrefixDiff: number | null = null

  for (const token of tokens) {
    if (token === q) {
      exactToken = true
      break
    }
    if (token.startsWith(q)) {
      const diff = token.length - q.length
      if (minPrefixDiff == null || diff < minPrefixDiff) minPrefixDiff = diff
    }
  }

  if (exactToken) {
    if (pos > 0) penalty += Math.min(pos * 0.005, 0.5)
    return { tier: 10, penalty }
  }
  if (minPrefixDiff != null) {
    penalty += Math.min(minPrefixDiff * 0.1, 5)
    if (pos > 0) penalty += Math.min(pos * 0.005, 0.5)
    return { tier: 20, penalty }
  }
  if (norm.startsWith(q)) {
    penalty += Math.min((norm.length - q.length) * 0.05, 5)
    return { tier: 20, penalty }
  }

  // 普通子串包含
  if (pos > 0) penalty += Math.min(pos * 0.005, 0.5)
  return { tier: 30, penalty }
}
```

### 3. 性能优化：惰性 Token 缓存

在前端搜索框连续输入时，避免对上万条数据的相同字符串反复调用分词器：

- 使用全局或模块级 `Map<string, string[]>` 对 `fieldValue` 的分词结果做惰性缓存（上限 50,000 条，LRU 或清空保护）。
- 同一个字段的文本只切一次，后续过滤只进行极快的高速数组遍历与字符比对。

## 验证与测试规范

1. **算法单测 (`__tests__/lib/translate/list-search.spec.ts`)**：
   - 覆盖英文单词全等 vs 前缀：`Rei` 优先于 `Reika` / `Reiji`。
   - 覆盖日文分词：`レイの剣` 优先于 `レイカ`。
   - 覆盖中文字词：`待确认` 优先于散落字包含。
   - 覆盖全半角混杂与大小写无关性。
2. **列表组件集成测试 (`__tests__/components/translate/TranslateListContent.spec.tsx`)**：
   - 验证 URL 参数 `?q=Rei` 驱动下列表各行 DOM 渲染顺序符合预期。
3. **Lint 与类型检查**：
   - `tsc --noEmit` 无类型错误。
   - Prettier 校验格式一致。
