# extract

从内容根 `data/` 抽取可译字符串。

## 运行

```bash
pnpm extract -- --root /path/to/www
```

写出：

- `chaya-extract.strings.json`
- `chaya-extract.compare.json`（有 `chaya-trans.seed.json` 时）

有 `strings` 时翻译管线会用来做对话优先排序。
