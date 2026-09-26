/**
 * 用户可见品牌与产物命名（改名只动这里）。
 * 仓库目录名可与 slug 不同；内部 id / 插件名跟品牌走。
 */
export const PRODUCT_DISPLAY_NAME = 'Chaya'
export const PRODUCT_SLUG = 'chaya'

/**
 * 各平台注入 / 安装壳的统一基名。
 * - macOS：`{base}.app`
 * - Windows / Linux：同名目录 `{base}/`（内含 nw.exe 或 nw）
 * 判定「已装我们写入的壳」优先只认这些名字。
 */
export const SHELL_BUNDLE_BASE = PRODUCT_DISPLAY_NAME

/** macOS 壳目录名：`data/shell/Chaya.app` 或游戏旁 `Chaya.app` */
export const SHELL_APP_NAME = `${SHELL_BUNDLE_BASE}.app`

/** Windows / Linux 壳目录名（与基名相同；内含 nw.exe / nw） */
export const SHELL_WIN_DIR_NAME = SHELL_BUNDLE_BASE

/** 品牌更名前 / 旧注入名的壳目录（只作存在性回退，不新建） */
export const LEGACY_SHELL_APP_NAMES = ['ShiruKit.app', 'nwjs.app'] as const
/** 旧 Win/Linux 壳目录名 */
export const LEGACY_SHELL_WIN_DIR_NAMES = ['nw'] as const

export const WIN_SHELL_EXE_NAMES = ['nw.exe', 'Game.exe', `${PRODUCT_DISPLAY_NAME}.exe`] as const

/** 云端旁挂壳后的一键启动脚本（游戏原位，不嵌进壳） */
export const SHELL_LAUNCHER_WIN = `${PRODUCT_DISPLAY_NAME}启动.bat`
export const SHELL_LAUNCHER_MAC = `${PRODUCT_DISPLAY_NAME}启动.command`
export const SHELL_LAUNCHER_LINUX = `${PRODUCT_DISPLAY_NAME}启动.sh`

/** 工具根配置文件 */
export const CONFIG_FILE_NAME = `${PRODUCT_SLUG}.config.json`
export const LEGACY_CONFIG_FILE_NAMES = ['shiru-kit.config.json'] as const

/** 游戏内运行时插件（全部带品牌前缀） */
export const PLUGIN_RUNTIME_NAME = `${PRODUCT_DISPLAY_NAME}Log`
export const PLUGIN_ENV_NAME = `${PRODUCT_DISPLAY_NAME}Env`
/** 薄加载器：从本机 Chaya 拉 dist，失败回退磁盘缓存 */
export const PLUGIN_LOADER_NAME = `${PRODUCT_DISPLAY_NAME}Loader`
/** 局内翻译（本地 cache/seed；可选连本机服务补译） */
export const PLUGIN_TRANS_NAME = `${PRODUCT_DISPLAY_NAME}Trans`
/** 局内修改面板 */
export const PLUGIN_EDIT_NAME = `${PRODUCT_DISPLAY_NAME}Edit`
/** 局内加速 */
export const PLUGIN_BOOST_NAME = `${PRODUCT_DISPLAY_NAME}Boost`

/** 旧品牌运行时插件名（注入时从 plugins.js / js/plugins 清掉） */
export const LEGACY_PLUGIN_RUNTIME_NAMES = ['ShiruLog'] as const
/** 旧第三方 / 旧品牌翻译插件名（注入时从 plugins.js、磁盘与 index.html 清掉） */
export const LEGACY_PLUGIN_TRANS_NAMES = ['MTool_Trans_Loader'] as const
/** 未带品牌前缀的旧注入名 */
export const LEGACY_PLUGIN_EDIT_NAMES = ['GameEdit'] as const
export const LEGACY_PLUGIN_BOOST_NAMES = ['GameBoost'] as const

/** DevTools 日志徽章 */
export const CONSOLE_BADGE = 'CY'

/** 内容根产物文件名前缀 */
export const CONTENT_FILE_PREFIX = PRODUCT_SLUG
