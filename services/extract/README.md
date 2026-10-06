# extract

抽取 `data/*.json` 的数据库、事件和 MZ 插件命令文案，也读取 `js/plugins.js` 中启用插件的参数（包括参数内嵌套的 JSON）。不会执行或逐字扫描插件 JavaScript；运行时拼接的文字和图片内文字不属于离线抽取结果。

从游戏内容根抽取可译字符串。

## 运行

```bash
pnpm extract -- --root /path/to/www
```

写出：

- `chaya-extract.strings.json`
- `chaya-extract.compare.json`（有 `chaya-trans.seed.json` 时）

有 `strings` 时翻译管线会用来做对话优先排序。
