# constants

全局公共常量（根模块）。改品牌 / 壳名 / 端口 / 路径名只动这里。

| 文件            | 内容                                                      | 运行时      |
| --------------- | --------------------------------------------------------- | ----------- |
| `brand.ts`      | 产品名、壳名、配置文件名、插件名、产物前缀                | 通用        |
| `path-names.ts` | `data/` 等**目录名**字符串                                | 通用        |
| `paths.ts`      | 仓库根与配置 / 壳 / 缓存等**绝对路径**（`fileURLToPath`） | **仅 Node** |
| `listen.ts`     | 默认监听端口与本机 API 根                                 | 通用        |

客户端组件只 import `brand` / `path-names` / `listen`；绝对路径仅服务端 / CLI import `@/constants/paths`。

模块私有常量仍放 `{module}/` 内，不要为迁移造 bridge。
