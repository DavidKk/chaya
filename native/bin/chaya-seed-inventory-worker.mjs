import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

// services/translate/scheduler/seed-inventory-worker.ts
import fs10 from "node:fs";
import os2 from "node:os";
import path9 from "node:path";
import { parentPort, workerData } from "node:worker_threads";

// services/translate/scheduler/seed-inventory.ts
import fs9 from "node:fs";
import path8 from "node:path";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// constants/paths.ts
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// constants/brand.ts
var PRODUCT_DISPLAY_NAME = "Chaya";
var PRODUCT_SLUG = "chaya";
var SHELL_BUNDLE_BASE = PRODUCT_DISPLAY_NAME;
var SHELL_APP_NAME = `${SHELL_BUNDLE_BASE}.app`;
var SHELL_WIN_DIR_NAME = SHELL_BUNDLE_BASE;
var LEGACY_SHELL_APP_NAMES = ["ShiruKit.app", "nwjs.app"];
var WIN_SHELL_EXE_NAMES = ["nw.exe", "Game.exe", `${PRODUCT_DISPLAY_NAME}.exe`];
var SHELL_LAUNCHER_WIN = `${PRODUCT_DISPLAY_NAME}\u542F\u52A8.bat`;
var SHELL_LAUNCHER_MAC = `${PRODUCT_DISPLAY_NAME}\u542F\u52A8.command`;
var SHELL_LAUNCHER_LINUX = `${PRODUCT_DISPLAY_NAME}\u542F\u52A8.sh`;
var CONFIG_FILE_NAME = `${PRODUCT_SLUG}.config.json`;
var LEGACY_CONFIG_FILE_NAMES = ["shiru-kit.config.json"];
var PLUGIN_RUNTIME_NAME = `${PRODUCT_DISPLAY_NAME}Log`;
var PLUGIN_ENV_NAME = `${PRODUCT_DISPLAY_NAME}Env`;
var PLUGIN_LOADER_NAME = `${PRODUCT_DISPLAY_NAME}Loader`;
var PLUGIN_TRANS_NAME = `${PRODUCT_DISPLAY_NAME}Trans`;
var PLUGIN_EDIT_NAME = `${PRODUCT_DISPLAY_NAME}Edit`;
var PLUGIN_BOOST_NAME = `${PRODUCT_DISPLAY_NAME}Boost`;
var PLUGIN_AGENT_NAME = `${PRODUCT_DISPLAY_NAME}Agent`;
var CONTENT_FILE_PREFIX = PRODUCT_SLUG;

// constants/path-names.ts
var DATA_DIR_NAME = "data";
var SHELL_DIR_NAME = "shell";
var SHELL_CACHE_DIR_NAME = "shell-cache";
var TRANSLATE_CACHE_DIR_NAME = "translate-cache";
var TRANSLATE_CACHE_DB_NAME = "shared.sqlite";
var TRANSLATE_JOBS_DIR_NAME = "translate-jobs";
var LOGS_DIR_NAME = "logs";
var PLUGIN_LOGS_DIR_NAME = "plugins";
var AGENT_ACTIVITY_LOGS_DIR_NAME = "agent-activity";
var GAME_ACTIVITY_LOGS_DIR_NAME = "game-activity";
var COMPANION_MEMORY_DIR_NAME = "companion-memory";
var COMPANION_MEMORY_DB_NAME = "companion.sqlite";
var GAME_AGENT_DIR_NAME = "game-agent";
var TRANSLATION_PACKS_DIR_NAME = "translation-packs";
var DOWNLOAD_JOBS_FILE_NAME = "download-jobs.json";
var PLUGINS_DIR_NAME = "plugins";
var NODE_MODULES_DIR_NAME = "node_modules";

// constants/paths.ts
function findRepoRoot(startDir) {
  let curr = startDir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(join(curr, "package.json"))) return curr;
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return resolve(startDir, "..");
}
var ROOT_PATH = process.env.CHAYA_ROOT ? resolve(process.env.CHAYA_ROOT) : findRepoRoot(dirname(fileURLToPath(import.meta.url)));
function defaultDataDir() {
  if (process.env.CHAYA_DATA_DIR) return resolve(process.env.CHAYA_DATA_DIR);
  if (process.platform === "darwin" && process.env.HOME) {
    return join(process.env.HOME, "Library", "Application Support", "Chaya", "data");
  }
  return join(ROOT_PATH, DATA_DIR_NAME);
}
var DATA_DIR = defaultDataDir();
var CONFIG_FILE_PATH = process.env.CHAYA_DATA_DIR ? join(DATA_DIR, CONFIG_FILE_NAME) : join(ROOT_PATH, CONFIG_FILE_NAME);
var LEGACY_CONFIG_FILE_PATHS = [
  ...LEGACY_CONFIG_FILE_NAMES.map((name) => join(ROOT_PATH, name)),
  ...process.env.CHAYA_DATA_DIR ? [join(ROOT_PATH, CONFIG_FILE_NAME), ...LEGACY_CONFIG_FILE_NAMES.map((name) => join(DATA_DIR, name))] : []
];
var SHELL_DIR = join(DATA_DIR, SHELL_DIR_NAME);
var SHELL_CACHE_DIR = join(DATA_DIR, SHELL_CACHE_DIR_NAME);
var SHELL_APP_PATH = join(SHELL_DIR, SHELL_APP_NAME);
var SHELL_WIN_PATH = join(SHELL_DIR, SHELL_WIN_DIR_NAME);
var LEGACY_SHELL_AT_DATA_PATHS = LEGACY_SHELL_APP_NAMES.map((name) => join(DATA_DIR, name));
var LEGACY_SHELL_IN_SHELL_PATHS = LEGACY_SHELL_APP_NAMES.map((name) => join(SHELL_DIR, name));
var IS_WIN32 = process.platform === "win32";
var TRANSLATE_CACHE_DIR = join(DATA_DIR, TRANSLATE_CACHE_DIR_NAME);
var TRANSLATE_CACHE_DB_PATH = join(TRANSLATE_CACHE_DIR, TRANSLATE_CACHE_DB_NAME);
var TRANSLATE_JOBS_DIR = join(DATA_DIR, TRANSLATE_JOBS_DIR_NAME);
var CACHE_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-cache-worker.mjs");
var RGSS_EXTRACT_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-rgss-extract-worker.mjs");
var SEED_INVENTORY_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-seed-inventory-worker.mjs");
var TRANSLATION_PACKS_DIR = join(DATA_DIR, TRANSLATION_PACKS_DIR_NAME);
var DOWNLOAD_JOBS_PATH = join(DATA_DIR, DOWNLOAD_JOBS_FILE_NAME);
var GAME_AGENT_DIR = join(DATA_DIR, GAME_AGENT_DIR_NAME);
var LOGS_DIR = process.env.CHAYA_LOGS_DIR ? resolve(process.env.CHAYA_LOGS_DIR) : join(ROOT_PATH, LOGS_DIR_NAME);
var PLUGIN_LOGS_DIR = join(LOGS_DIR, PLUGIN_LOGS_DIR_NAME);
var AGENT_ACTIVITY_LOGS_DIR = join(LOGS_DIR, AGENT_ACTIVITY_LOGS_DIR_NAME);
var GAME_ACTIVITY_LOGS_DIR = join(LOGS_DIR, GAME_ACTIVITY_LOGS_DIR_NAME);
var COMPANION_MEMORY_DIR = join(DATA_DIR, COMPANION_MEMORY_DIR_NAME);
var COMPANION_MEMORY_DB_PATH = join(COMPANION_MEMORY_DIR, COMPANION_MEMORY_DB_NAME);
var PLUGINS_DIR = join(ROOT_PATH, PLUGINS_DIR_NAME);
var PLUGINS_MANIFEST_PATH = join(PLUGINS_DIR, "mv", "manifest.json");
var NODE_MODULES_DIR = join(ROOT_PATH, NODE_MODULES_DIR_NAME);
var KUROMIJI_DICT_PATH = join(NODE_MODULES_DIR, "kuromoji", "dict");

// lib/game/content-files.ts
import fs4 from "node:fs";
import path4 from "node:path";

// lib/game/content-paths.ts
var GAME_CONTENT_DIR = CONTENT_FILE_PREFIX;
var GAME_CONTENT_RELS = {
  seed: "translate/seed.json",
  cacheNdjson: "translate/cache.ndjson",
  switches: "translate/switches.json",
  translationPlay: "config/translation-play.json",
  translationPreview: "config/translation-preview.json",
  glossaryCache: "translate/glossary.cache.json",
  skippedNdjson: "translate/skipped.ndjson",
  merged: "translate/merged.json",
  extractStrings: "translate/extract.strings.json",
  extractCompare: "translate/extract.compare.json",
  /** Data signature + source keys for seed filter / list warm — see translation-mainthread-offload §3.3.5 */
  rgssSourcesIndex: "translate/rgss-sources.index.json",
  gameEdit: "config/game-edit.json",
  inputAssistance: "config/input-assistance.json",
  gameSaves: "config/game-saves.json",
  gameSavesIndex: "saves/index.json"
};
var LEGACY_FLAT_FILES = {
  seed: [`${CONTENT_FILE_PREFIX}-trans.seed.json`, "shiru-trans.seed.json", "translate-both.seed.json"],
  cacheNdjson: [`${CONTENT_FILE_PREFIX}-trans.cache.ndjson`, "shiru-trans.cache.ndjson", "translate-both.cache.ndjson"],
  switches: [`${CONTENT_FILE_PREFIX}-trans.switches.json`, "shiru-trans.switches.json", "translate-switches.json", "translate-both.switches.json"],
  translationPlay: [],
  translationPreview: [],
  glossaryCache: [`${CONTENT_FILE_PREFIX}-glossary.cache.json`, "translate-glossary.cache.json"],
  skippedNdjson: [`${CONTENT_FILE_PREFIX}-trans.skipped.ndjson`, "translate-both.skipped.ndjson"],
  merged: [`${CONTENT_FILE_PREFIX}-trans.merged.json`],
  extractStrings: [`${CONTENT_FILE_PREFIX}-extract.strings.json`, "extracted-strings.json"],
  extractCompare: [`${CONTENT_FILE_PREFIX}-extract.compare.json`, "extracted-compare.json"],
  rgssSourcesIndex: [],
  gameEdit: [`${CONTENT_FILE_PREFIX}-game-edit.json`],
  inputAssistance: [],
  gameSaves: [],
  gameSavesIndex: []
};
function gameContentRelPath(kind) {
  return `${GAME_CONTENT_DIR}/${GAME_CONTENT_RELS[kind]}`;
}

// services/storage/game-files.ts
import path3 from "node:path";

// services/storage/client.ts
import { spawn } from "node:child_process";
import fs3 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { Worker } from "node:worker_threads";

// lib/integration/mcp-port.ts
function joinPath(platform, ...parts) {
  const sep = platform === "win32" ? "\\" : "/";
  return parts.filter(Boolean).map((part, i) => i === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")).join(sep);
}
function mcpPortConfigDir(env) {
  if (env.platform === "darwin") return joinPath(env.platform, env.home, "Library", "Application Support", "Chaya");
  if (env.platform === "win32") return joinPath(env.platform, env.appData || joinPath(env.platform, env.home, "AppData", "Roaming"), "Chaya");
  return joinPath(env.platform, env.xdgConfigHome || joinPath(env.platform, env.home, ".config"), "chaya");
}
function processMcpPortEnv(home) {
  const env = typeof process !== "undefined" ? process.env : {};
  return {
    platform: typeof process !== "undefined" ? process.platform : "linux",
    home: home || env.HOME || env.USERPROFILE || "",
    appData: env.APPDATA || void 0,
    xdgConfigHome: env.XDG_CONFIG_HOME || void 0
  };
}

// services/storage/daemon-lock.ts
import fs2 from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error.code;
    return code !== "ESRCH";
  }
}
function readMetaSafe(file) {
  try {
    if (!fs2.existsSync(file)) return null;
    const raw = JSON.parse(fs2.readFileSync(file, "utf8"));
    if (raw && Number.isInteger(raw.pid) && typeof raw.startedAt === "number" && typeof raw.port === "number" && typeof raw.authToken === "string" && typeof raw.dataDir === "string") {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}
function readStorageDaemonMeta(dataDir) {
  const resolvedDir = typeof dataDir === "string" && dataDir ? dataDir : path.join(process.cwd(), "data");
  const metaFile = path.join(resolvedDir, "runtime", "storage-daemon.json");
  const lockFile = path.join(resolvedDir, "runtime", "storage-daemon.lock");
  const meta = readMetaSafe(metaFile);
  const owner = readMetaSafe(lockFile);
  if (!meta || !owner || !meta.instanceId || meta.instanceId !== owner.instanceId) return null;
  if (!isPidAlive(meta.pid)) return null;
  return meta;
}

// services/storage/client.ts
function resolveNativeBin(name) {
  const root = typeof ROOT_PATH === "string" && ROOT_PATH ? ROOT_PATH : process.cwd();
  const direct = path2.join(root, "native/bin", name);
  if (fs3.existsSync(direct)) return direct;
  const cwdCandidate = path2.join(process.cwd(), "native/bin", name);
  if (fs3.existsSync(cwdCandidate)) return cwdCandidate;
  return direct;
}
function resolveDataDir() {
  return typeof DATA_DIR === "string" && DATA_DIR ? DATA_DIR : path2.join(process.cwd(), "data");
}
var worker;
var responseBuffer;
var pause = new Int32Array(new SharedArrayBuffer(4));
var locatorPublished = false;
function publishLocator() {
  if (locatorPublished) return;
  const dir = mcpPortConfigDir(processMcpPortEnv(os.homedir()));
  fs3.mkdirSync(dir, { recursive: true, mode: 448 });
  const file = path2.join(dir, "storage-runtime.json");
  const tmp = `${file}.${process.pid}.tmp`;
  const entry = resolveNativeBin("chaya-storage-daemon.mjs");
  const dataDir = resolveDataDir();
  const rootDir = typeof ROOT_PATH === "string" && ROOT_PATH ? ROOT_PATH : process.cwd();
  fs3.writeFileSync(tmp, JSON.stringify({ dataDir, entry, executable: process.execPath, root: rootDir }), {
    mode: 384
  });
  fs3.renameSync(tmp, file);
  locatorPublished = true;
}
function ensureStorageDaemon() {
  publishLocator();
  const dataDir = resolveDataDir();
  let meta = readStorageDaemonMeta(dataDir);
  if (meta?.port) return meta;
  const entry = resolveNativeBin("chaya-storage-daemon.mjs");
  if (!fs3.existsSync(entry)) throw new Error("Storage runtime is missing; run pnpm build:translate");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      CHAYA_ROOT: typeof ROOT_PATH === "string" && ROOT_PATH && fs3.existsSync(path2.join(ROOT_PATH, "native/bin")) ? ROOT_PATH : process.cwd(),
      CHAYA_DATA_DIR: typeof DATA_DIR === "string" && DATA_DIR ? DATA_DIR : path2.join(process.cwd(), "data")
    }
  });
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.unref();
  const deadline = Date.now() + 15e3;
  while (Date.now() < deadline) {
    meta = readStorageDaemonMeta(dataDir);
    if (meta?.port) return meta;
    if (spawnError) throw spawnError;
    Atomics.wait(pause, 0, 0, 25);
  }
  throw new Error("Storage daemon did not become ready");
}
function storageCall(method, args = []) {
  const meta = ensureStorageDaemon();
  if (!worker) {
    const entry = resolveNativeBin("chaya-storage-client.mjs");
    worker = Reflect.construct(Worker, [entry]);
    worker.on("error", () => {
      worker = void 0;
    });
    worker.unref();
  }
  const shared = responseBuffer ??= new SharedArrayBuffer(16 * 1024 * 1024);
  const signal = new Int32Array(shared, 0, 2);
  Atomics.store(signal, 0, 0);
  Atomics.store(signal, 1, 0);
  worker.postMessage({ port: meta.port, token: meta.authToken, body: { method, args }, shared });
  if (Atomics.wait(signal, 0, 0, 25e3) === "timed-out") {
    responseBuffer = void 0;
    throw new Error("Storage request timed out; retry with the same mutation key");
  }
  const result = JSON.parse(Buffer.from(shared, 8, Atomics.load(signal, 1)).toString("utf8"));
  if (result.error) throw new Error(result.error);
  const value = result.value;
  return value?.storageMap ? new Map(value.storageMap) : value;
}

// services/storage/game-files.ts
var ownerDirectories = /* @__PURE__ */ new Map();
var mountedDirectories = /* @__PURE__ */ new Map();
function publicGameFiles(contentRoot) {
  const key2 = path3.resolve(contentRoot);
  const local = ownerDirectories.get(key2) ?? mountedDirectories.get(key2);
  if (local) return local;
  if (process.env.CHAYA_STORAGE_OWNER === "1") {
    const mounted = ownerDirectories.get(key2);
    if (!mounted) throw new Error("Game storage must be mounted before accessing its read views");
    return mounted;
  }
  const remote = storageCall("game.mount", [contentRoot]);
  mountedDirectories.set(key2, remote);
  return remote;
}
function publicGameFile(contentRoot, kind) {
  return path3.join(publicGameFiles(contentRoot).directory, GAME_CONTENT_RELS[kind]);
}

// lib/game/content-files.ts
function gameContentPath(contentRoot, kind) {
  if (["seed", "cacheNdjson", "switches", "translationPlay", "translationPreview", "gameEdit", "inputAssistance", "gameSaves"].includes(kind))
    return publicGameFile(contentRoot, kind);
  return path4.join(path4.resolve(contentRoot), gameContentRelPath(kind));
}
function gameContentCandidatePaths(contentRoot, kind, opts) {
  if (["seed", "cacheNdjson", "switches", "translationPlay", "translationPreview", "gameEdit", "inputAssistance", "gameSaves"].includes(kind))
    return [publicGameFile(contentRoot, kind)];
  const root = path4.resolve(contentRoot);
  const dirs = opts?.alsoParent ? [root, path4.dirname(root)] : [root];
  const out = [];
  for (const dir of dirs) {
    out.push(path4.join(dir, gameContentRelPath(kind)));
    for (const name of LEGACY_FLAT_FILES[kind]) {
      out.push(path4.join(dir, name));
    }
  }
  return out;
}
function gameContentReadPath(contentRoot, kind, opts) {
  return gameContentCandidatePaths(contentRoot, kind, opts).find((p) => fs4.existsSync(p)) ?? null;
}
function ensureGameContentDir(contentRoot, kind) {
  const file = gameContentPath(contentRoot, kind);
  fs4.mkdirSync(path4.dirname(file), { recursive: true });
  return file;
}

// lib/translate/dynamic-template.ts
var DYNAMIC_VARIABLE = /_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])/g;
function isDynamicTemplate(text) {
  return new RegExp(DYNAMIC_VARIABLE.source).test(text);
}
function sortedTokens(text, re) {
  return JSON.stringify((text.match(re) || []).sort());
}
var CONTROLS = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|_se\[[^\]]*\]/g;
function validDynamicTranslation(source, target) {
  if (!isDynamicTemplate(source)) return true;
  const lines = source.split(/\\n|\r?\n/);
  const translated = target.split(/\\n|\r?\n/);
  return lines.length === translated.length && lines.every(
    (line, i) => sortedTokens(line, /_[A-Za-z][A-Za-z0-9_]*/g) === sortedTokens(translated[i], /_[A-Za-z][A-Za-z0-9_]*/g) && sortedTokens(line, DYNAMIC_VARIABLE) === sortedTokens(translated[i], DYNAMIC_VARIABLE) && sortedTokens(line, CONTROLS) === sortedTokens(translated[i], CONTROLS)
  );
}
var numericLabelParts = (src) => src.match(/^([A-Za-z]{2,60} ?)(\d{1,6})$/);
function createNumericLabelIndex(records = []) {
  const groups = /* @__PURE__ */ new Map();
  const parse = numericLabelParts;
  function note(record) {
    const match = parse(record.src);
    if (!match) return;
    const group = groups.get(match[1]) || /* @__PURE__ */ new Map();
    group.set(record.id || record.src, record);
    groups.set(match[1], group);
  }
  records.forEach(note);
  return {
    note,
    resolve(src) {
      const query = parse(src);
      if (!query) return null;
      const group = groups.get(query[1]);
      if (!group) return null;
      const numbers = /* @__PURE__ */ new Set();
      const templates = /* @__PURE__ */ new Set();
      for (const record of group.values()) {
        const number = parse(record.src)[2];
        const target = record.zh.match(/^([^\d\r\n\\]*)(\d+)([^\d\r\n\\]*)$/);
        if (!target || target[2] !== number || !/[\u3400-\u9FFF]/.test(target[1] + target[3])) return null;
        numbers.add(number);
        templates.add(JSON.stringify([target[1], target[3]]));
        if (templates.size > 1) return null;
      }
      if (numbers.size < 2 || templates.size !== 1) return null;
      const [prefix, suffix] = JSON.parse([...templates][0]);
      return prefix + query[2] + suffix;
    }
  };
}

// services/extract/lib/rgss.ts
import fs8 from "node:fs";
import path7 from "node:path";

// lib/translate/rm-escape.ts
var RM_DIGIT_CODE_SRC = String.raw`\\[A-Za-z]+\[\d+\]`;
var RM_ESCAPE_RE = /\\[A-Za-z]+(?:\[[^\]]*\])?/g;

// lib/translate/segments.ts
function translationRubyChunks(text) {
  if (isDynamicTemplate(text)) return [{ text, ruby: false }];
  const chunks = [];
  let start = 0;
  const controls = [...text.matchAll(new RegExp(RM_ESCAPE_RE.source, "g"))];
  for (const match of text.matchAll(/\\RB\[([^,\[\]\r\n]+),([^,\[\]\r\n]+)\]|\\ruby\[([^\[\]\r\n]+)\]\(([^)\r\n]+)\)/gi)) {
    const at = match.index;
    if (controls.some((control) => control.index < at && control.index + control[0].length > at)) continue;
    if (at > start) chunks.push({ text: text.slice(start, at), ruby: false });
    const paren = match[3] != null;
    chunks.push({
      text: match[0],
      ruby: true,
      base: paren ? match[3] : match[1],
      reading: paren ? match[4] : match[2],
      prefix: match[0].slice(0, match[0].indexOf("[")),
      paren
    });
    start = at + match[0].length;
  }
  if (start < text.length) chunks.push({ text: text.slice(start), ruby: false });
  return chunks;
}

// lib/translate/game-terms.ts
var GAME_TERM_LANGUAGES = ["zh", "en", "ja", "ko"];
var GAME_TERMS = {
  flame: { translations: { zh: "\u708E", en: "Flame", ja: "\u708E", ko: "\uD654\uC5FC" }, aliases: { en: ["Fire"] } },
  lightning: { translations: { zh: "\u96F7", en: "Lightning", ja: "\u96F7", ko: "\uBC88\uAC1C" } },
  water: { translations: { zh: "\u6C34", en: "Water", ja: "\u6C34", ko: "\uBB3C" } },
  earth: { translations: { zh: "\u571F", en: "Earth", ja: "\u571F", ko: "\uB300\uC9C0" } },
  light: { translations: { zh: "\u5149", en: "Light", ja: "\u5149", ko: "\uBE5B" } },
  sword: { translations: { zh: "\u5251", en: "Sword", ja: "\u5263", ko: "\uAC80" } },
  axe: { translations: { zh: "\u65A7", en: "Axe", ja: "\u65A7", ko: "\uB3C4\uB07C" } },
  staff: { translations: { zh: "\u6756", en: "Staff", ja: "\u6756", ko: "\uC9C0\uD321\uC774" } },
  bow: { translations: { zh: "\u5F13", en: "Bow", ja: "\u5F13", ko: "\uD65C" } },
  gun: { translations: { zh: "\u67AA", en: "Gun", ja: "\u9283", ko: "\uCD1D" } },
  claw: { translations: { zh: "\u722A", en: "Claw", ja: "\u722A", ko: "\uBC1C\uD1B1" } },
  spear: { translations: { zh: "\u957F\u67AA", en: "Spear", ja: "\u69CD", ko: "\uCC3D" } },
  // System & Menu terms
  save: {
    translations: { zh: "\u4FDD\u5B58", en: "Save", ja: "\u30BB\u30FC\u30D6", ko: "\uC800\uC7A5" },
    aliases: { en: ["Save Game"], ja: ["\u30BB\u30FC\u30D6\u3059\u308B"] },
    badTranslations: { zh: ["\u8282\u7701", "\u62EF\u6551", "\u7701\u4E0B", "\u5B58\u76D8"] }
  },
  load: {
    translations: { zh: "\u8BFB\u53D6", en: "Load", ja: "\u30ED\u30FC\u30C9", ko: "\uBD88\uB7EC\uC624\uAE30" },
    aliases: { en: ["Load Game"], ja: ["\u30ED\u30FC\u30C9\u3059\u308B"] },
    badTranslations: { zh: ["\u8D1F\u8377", "\u4F9B\u7535\u91CF", "\u8D1F\u8F7D", "\u88C5\u8F7D", "\u52A0\u8F7D", "\u88C5\u5165"] }
  },
  new_game: {
    translations: { zh: "\u65B0\u6E38\u620F", en: "New Game", ja: "\u30CB\u30E5\u30FC\u30B2\u30FC\u30E0", ko: "\uC0C8 \uAC8C\uC784" },
    badTranslations: { zh: ["\u65B0\u7684\u6E38\u620F", "\u65B0\u6BD4\u8D5B"] }
  },
  continue: {
    translations: { zh: "\u7EE7\u7EED\u6E38\u620F", en: "Continue", ja: "\u30B3\u30F3\u30C6\u30A3\u30CB\u30E5\u30FC", ko: "\uC774\uC5B4\uD558\uAE30" },
    aliases: { ja: ["\u3064\u3065\u304D\u304B\u3089"] },
    badTranslations: { zh: ["\u7EE7\u7EED", "\u5EF6\u62D3"] }
  },
  options: {
    translations: { zh: "\u8BBE\u7F6E", en: "Options", ja: "\u8A2D\u5B9A", ko: "\uC124\uC815" },
    aliases: { en: ["Option", "Config", "Settings"], ja: ["\u30AA\u30D7\u30B7\u30E7\u30F3"] },
    badTranslations: { zh: ["\u9009\u9879", "\u671F\u6743"] }
  },
  item: {
    translations: { zh: "\u9053\u5177", en: "Item", ja: "\u30A2\u30A4\u30C6\u30E0", ko: "\uC544\uC774\uD15C" },
    aliases: { en: ["Items"] },
    badTranslations: { zh: ["\u9879\u76EE", "\u6761\u6B3E", "\u7269\u4EF6"] }
  },
  skill: {
    translations: { zh: "\u6280\u80FD", en: "Skill", ja: "\u30B9\u30AD\u30EB", ko: "\uC2A4\uD0AC" },
    aliases: { en: ["Skills"] },
    badTranslations: { zh: ["\u6280\u672F", "\u6280\u80FD\u6761"] }
  },
  equip: {
    translations: { zh: "\u88C5\u5907", en: "Equip", ja: "\u88C5\u5099", ko: "\uC7A5\uBE44" },
    aliases: { en: ["Equipment"] },
    badTranslations: { zh: ["\u914D\u5907", "\u88C5\u8BBE"] }
  },
  status: {
    translations: { zh: "\u72B6\u6001", en: "Status", ja: "\u30B9\u30C6\u30FC\u30BF\u30B9", ko: "\uC0C1\uD0DC" },
    badTranslations: { zh: ["\u5730\u4F4D", "\u8EAB\u5206", "\u72B6\u51B5"] }
  },
  quit: {
    translations: { zh: "\u9000\u51FA", en: "Quit", ja: "\u7D42\u4E86", ko: "\uC885\uB8CC" },
    aliases: { en: ["Exit", "Game Over"] },
    badTranslations: { zh: ["\u505C\u6B62", "\u653E\u5F03", "\u79BB\u5F00\u6E38\u620F"] }
  },
  gold: {
    translations: { zh: "\u91D1\u5E01", en: "Gold", ja: "\u6240\u6301\u91D1", ko: "\uC18C\uC9C0\uAE08" },
    aliases: { en: ["Money"] },
    badTranslations: { zh: ["\u9EC4\u91D1", "\u91D1\u8272"] }
  }
};
function key(text) {
  return text.normalize("NFKC").toLowerCase();
}
var indexes = Object.fromEntries(GAME_TERM_LANGUAGES.map((language) => [language, /* @__PURE__ */ new Map()]));
for (const [id, entry] of Object.entries(GAME_TERMS)) {
  for (const language of GAME_TERM_LANGUAGES) {
    for (const source of [entry.translations[language], ...entry.aliases?.[language] || []]) {
      const normalized = key(source);
      const ids = indexes[language].get(normalized) || /* @__PURE__ */ new Set();
      ids.add(id);
      indexes[language].set(normalized, ids);
    }
  }
}

// lib/translate/source-text.ts
var KANA = /[\u3041-\u3096\u30A1-\u30FA\u31F0-\u31FF\uFF66-\uFF9D]/;
var HAN = /[\u3400-\u9FFF]/;
var LATIN = /[A-Za-z]/;
var markupTags = ["br", "span", "div", "p", "b", "i", "img", "ruby", "rt"].map((tag) => [...tag].map((char) => `[${char}${char.toUpperCase()}]`).join("")).join("|");
var TEXT_MARKUP_RE = new RegExp(`<\\/?(?:${markupTags})(?:\\s[^<>]*?)?\\s*\\/?>`, "g");
function sourceTextBody(value) {
  return value.replace(TEXT_MARKUP_RE, " ").replace(/\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|%\d+|%[sdif]|\{[A-Za-z0-9_]+\}/g, " ").replace(DYNAMIC_VARIABLE, " ").replace(/_[A-Z][A-Z0-9_]+/g, " ").trim();
}
function isSourceText(value, language = "all") {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || /^(?:true|false|null|undefined|EV\d+|#[\da-f]{3,8})$/i.test(text)) return false;
  if (/^(?:https?:\/\/|[a-z]:[\\/]|\/|(?:\.\.?[\\/])|(?:img|audio|movies|fonts|js|data|assets|images|sounds)[\\/])/i.test(text)) return false;
  if (/\.(?:png|jpe?g|webp|gif|ogg|wav|mp3|m4a|mp4|webm|js|json|csv|txt|rpgmvp|rpgmvo)$/i.test(text)) return false;
  if (/^[A-Za-z_]\w*\[\d+\]$/.test(text)) return false;
  if (/^(?:HP|MP|TP|EXP|LV|FPS|ATK|DEF|MAT|MDF|AGI|LUK)\s*[:=]?\s*[\d.,/%+\s-]+$/i.test(text)) return false;
  if (/^(?:(?:async\s+)?function\b|(?:if|for|while)\s*\(|(?:const|let|var)\s+[$\w]+\s*[=:;]|return\s+(?:['"`$({]|[A-Za-z_$][\w$]*[.(])|return\b[^\n]*;|\$[A-Za-z_]|\(?[\w,\s]*\)?\s*=>)/.test(
    text
  ))
    return false;
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:[+*/-]=|=(?!=)|\+\+|--)/.test(text) || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\(/.test(text)) return false;
  if (!isDynamicTemplate(text) && /^\S*_\S*$/.test(text)) return false;
  const body = sourceTextBody(text);
  const kana = KANA.test(body);
  const han = HAN.test(body);
  const latin = LATIN.test(body);
  if (language === "ja") return kana || han;
  if (language === "zh") return han && !kana;
  if (language === "en") return latin && !kana && !han;
  return kana || han || latin;
}

// services/extract/lib/rgss/marshal.ts
var HEADER_MAJOR = 4;
var HEADER_MINOR = 8;
function assert(condition, message) {
  if (!condition) throw new Error(`Invalid Ruby Marshal data: ${message}`);
}
function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
var Reader = class {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
    this.symbols = [];
    this.objects = [];
  }
  readByte() {
    assert(this.offset < this.bytes.length, "unexpected end of input");
    return this.bytes[this.offset++];
  }
  readBytes(length) {
    assert(length >= 0 && this.offset + length <= this.bytes.length, "truncated payload");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  readIntegerBody() {
    const first = this.readByte();
    if (first === 0) return 0;
    if (first >= 5 && first <= 127) return first - 5;
    if (first >= 128 && first <= 250) return first - 251;
    if (first >= 1 && first <= 4) {
      let value2 = 0;
      for (let i = 0; i < first; i += 1) value2 += this.readByte() * 2 ** (8 * i);
      return value2;
    }
    const length = 256 - first;
    assert(length <= 8, "integer is too large");
    let value = 0;
    for (let i = 0; i < length; i += 1) value += this.readByte() * 2 ** (8 * i);
    return value - 2 ** (8 * length);
  }
  readSymbol() {
    const tag = String.fromCharCode(this.readByte());
    if (tag === ";") {
      const index = this.readIntegerBody();
      assert(index >= 0 && index < this.symbols.length, "symbol link out of range");
      return { kind: "symbol", value: this.symbols[index] };
    }
    assert(tag === ":", `expected symbol, got ${JSON.stringify(tag)}`);
    const value = decodeUtf8(this.readBytes(this.readIntegerBody()));
    this.symbols.push(value);
    return { kind: "symbol", value };
  }
  readIvars(value) {
    const count = this.readIntegerBody();
    const pairs = [];
    for (let i = 0; i < count; i += 1) pairs.push({ key: this.readSymbol(), value: this.readValue() });
    const ivars = { kind: "hash", pairs };
    if (value && typeof value === "object" && "kind" in value) {
      if (value.kind === "string" || value.kind === "array" || value.kind === "hash" || value.kind === "user-defined" || value.kind === "regexp") value.ivars = ivars;
    }
    return value;
  }
  readValue() {
    const tag = String.fromCharCode(this.readByte());
    switch (tag) {
      case "0":
        return null;
      case "T":
        return true;
      case "F":
        return false;
      case "i":
        return this.readIntegerBody();
      case '"': {
        const bytes = this.readBytes(this.readIntegerBody()).slice();
        const value = { kind: "string", value: decodeUtf8(bytes) };
        Object.defineProperty(value, "bytes", { value: bytes, writable: true });
        this.objects.push(value);
        return value;
      }
      case "f": {
        const length = this.readIntegerBody();
        const bytes = this.readBytes(length).slice();
        const value = { kind: "float", value: decodeUtf8(bytes) };
        Object.defineProperty(value, "bytes", { value: bytes, writable: true });
        this.objects.push(value);
        return value;
      }
      case "/": {
        const value = { kind: "regexp", data: this.readBytes(this.readIntegerBody()).slice(), options: this.readByte() };
        this.objects.push(value);
        return value;
      }
      case ":":
      case ";":
        this.offset -= 1;
        return this.readSymbol();
      case "[": {
        const result = { kind: "array", items: [] };
        this.objects.push(result);
        const count = this.readIntegerBody();
        for (let i = 0; i < count; i += 1) result.items.push(this.readValue());
        return result;
      }
      case "{": {
        const result = { kind: "hash", pairs: [] };
        this.objects.push(result);
        const count = this.readIntegerBody();
        for (let i = 0; i < count; i += 1) result.pairs.push({ key: this.readValue(), value: this.readValue() });
        return result;
      }
      case "}": {
        const result = { kind: "hash", pairs: [] };
        this.objects.push(result);
        const count = this.readIntegerBody();
        for (let i = 0; i < count; i += 1) result.pairs.push({ key: this.readValue(), value: this.readValue() });
        result.defaultValue = this.readValue();
        return result;
      }
      case "l": {
        const sign = String.fromCharCode(this.readByte());
        assert(sign === "+" || sign === "-", "invalid bignum sign");
        const count = this.readIntegerBody();
        const value = { kind: "bignum", sign, bytes: this.readBytes(count * 2).slice() };
        this.objects.push(value);
        return value;
      }
      case "I":
        return this.readIvars(this.readValue());
      case "o": {
        const className = this.readSymbol().value;
        const count = this.readIntegerBody();
        const result = { kind: "object", className, ivars: { kind: "hash", pairs: [] } };
        this.objects.push(result);
        for (let i = 0; i < count; i += 1) result.ivars.pairs.push({ key: this.readSymbol(), value: this.readValue() });
        return result;
      }
      case "u": {
        const className = this.readSymbol().value;
        const length = this.readIntegerBody();
        const result = { kind: "user-defined", className, data: this.readBytes(length).slice() };
        this.objects.push(result);
        return result;
      }
      case "U": {
        const className = this.readSymbol().value;
        const result = { kind: "user-marshal", className, value: null };
        this.objects.push(result);
        result.value = this.readValue();
        return result;
      }
      case "C": {
        const className = this.readSymbol().value;
        const index = this.objects.length;
        const result = { kind: "user-class", className, value: null };
        result.value = this.readValue();
        this.objects[index] = result;
        return result;
      }
      case "S": {
        const className = this.readSymbol().value;
        const count = this.readIntegerBody();
        const result = { kind: "struct", className, members: [] };
        this.objects.push(result);
        for (let i = 0; i < count; i += 1) result.members.push({ key: this.readSymbol(), value: this.readValue() });
        return result;
      }
      case "@": {
        const index = this.readIntegerBody();
        assert(index >= 0 && index < this.objects.length, "object link out of range");
        return this.objects[index];
      }
      default:
        throw new Error(`unsupported Ruby Marshal tag ${JSON.stringify(tag)}`);
    }
  }
};
function symbolName(value) {
  return value && typeof value === "object" && value.kind === "symbol" ? value.value : String(plainValue(value));
}
function plainValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (value.kind === "string" || value.kind === "symbol") return value.value;
  if (value.kind === "array") return value.items.map(plainValue);
  if (value.kind === "hash") {
    const out2 = {};
    for (const pair of value.pairs) out2[String(plainValue(pair.key))] = plainValue(pair.value);
    return out2;
  }
  if (value.kind === "float") return Number(value.value.split("\0", 1)[0]);
  if (value.kind === "regexp") return { __rubyRegexp: Array.from(value.data), options: value.options };
  if (value.kind === "bignum") {
    let integer = BigInt(0);
    for (let i = value.bytes.length - 1; i >= 0; i -= 1) integer = integer * BigInt(256) + BigInt(value.bytes[i]);
    return (value.sign === "+" ? integer : -integer).toString();
  }
  if (value.kind === "user-defined") return { __rubyClass: value.className, data: Array.from(value.data) };
  if (value.kind === "user-marshal" || value.kind === "user-class") return { __rubyClass: value.className, value: plainValue(value.value) };
  if (value.kind === "struct") {
    const out2 = { __rubyClass: value.className };
    for (const member of value.members) out2[member.key.value] = plainValue(member.value);
    return out2;
  }
  const out = {};
  for (const pair of value.ivars.pairs) out[String(plainValue(pair.key)).replace(/^@/, "")] = plainValue(pair.value);
  return out;
}
function parseRubyMarshal(bytes) {
  if (bytes.length < 2 || bytes[0] !== HEADER_MAJOR || bytes[1] !== HEADER_MINOR) throw new Error("Not a Ruby Marshal 4.8 file");
  return new Reader(bytes.subarray(2)).readValue();
}
function rubyObjectField(value, field) {
  if (!value || typeof value !== "object" || value.kind !== "object") return void 0;
  const pair = value.ivars.pairs.find((item) => symbolName(item.key) === `@${field}`);
  return pair?.value;
}

// lib/translate/cache-lang.ts
var DEFAULT_CACHE_SRC_LANG = "ja";
var KANA2 = /[\u3041-\u3096\u30A1-\u30FA\u31F0-\u31FF\uFF66-\uFF9D]/;
var HAN2 = /[\u3400-\u9FFF]/;
var LATIN2 = /[A-Za-z]/;
var HANGUL = /[\uAC00-\uD7A3]/;
var CYRILLIC = /[\u0400-\u04FF]/;
function detectCacheLang(text, fallback = DEFAULT_CACHE_SRC_LANG) {
  const body = sourceTextBody(String(text || ""));
  if (!body) return fallback;
  if (CYRILLIC.test(body)) return "ru";
  if (HANGUL.test(body)) return "ko";
  if (KANA2.test(body)) return "ja";
  if (LATIN2.test(body) && !HAN2.test(body) && !KANA2.test(body)) return "en";
  if (HAN2.test(body)) return fallback;
  return fallback;
}

// lib/translate/logic-text.ts
var TOKEN_RE = new RegExp(`${RM_ESCAPE_RE.source}|${TEXT_MARKUP_RE.source}|https?:\\/\\/[^\\s<>]+`, "g");
var INDENT = /[\t \u3000]/;
var WORD = /[A-Za-z0-9']/;
var SENTENCE_END = /[。．.!！?？;；]/;
var WORDISH = /[\p{L}\p{N}]/u;
function inferNewlineKind(text, start, end) {
  const src = String(text ?? "");
  if (start < 0 || end <= start || end > src.length) return "unknown";
  let left = start - 1;
  while (left >= 0 && INDENT.test(src[left])) left -= 1;
  let right = end;
  while (right < src.length && INDENT.test(src[right])) right += 1;
  const L = left >= 0 ? src[left] : void 0;
  const R = right < src.length ? src[right] : void 0;
  if (L == null || R == null) return "unknown";
  if (SENTENCE_END.test(L) || SENTENCE_END.test(R)) return "hard";
  if (WORDISH.test(L) && WORDISH.test(R)) return "soft";
  return "unknown";
}
function newlineKindAt(start, end, annotations, text) {
  if (annotations?.length) {
    for (const note of annotations) {
      if (note.start === start && note.end === end) return note.kind;
      if (note.start <= start && end <= note.end) return note.kind;
    }
  }
  return text != null ? inferNewlineKind(text, start, end) : "unknown";
}
function usesSpacedSoftBreaks(srcLang, sample) {
  const lang = srcLang || detectCacheLang(sample, "en");
  return lang !== "ja" && lang !== "zh" && lang !== "ko";
}
function shouldInsertSpace(left, right, spaced) {
  if (!spaced || left == null || right == null) return false;
  if (/\s/.test(left) || /\s/.test(right) || INDENT.test(left) || INDENT.test(right)) return false;
  return WORD.test(left) && WORD.test(right);
}
function buildLogicText(original, opts) {
  const text = String(original ?? "");
  const spaced = usesSpacedSoftBreaks(opts?.srcLang, text);
  const controls = new Map([...text.matchAll(TOKEN_RE)].map((m) => [m.index, m[0]]));
  const logicToOriginal = [];
  const logicNewlines = [];
  let logic = "";
  for (let i = 0; i < text.length; ) {
    const code = controls.get(i);
    if (code && !/^\\[nr]$/i.test(code)) {
      for (let k = 0; k < code.length; k++) {
        logic += code[k];
        logicToOriginal.push(i + k);
      }
      i += code.length;
      continue;
    }
    const c = text[i];
    const literalLine = Boolean(code && /^\\[nr]$/i.test(code));
    if (c === "\n" || c === "\r" || literalLine) {
      const end = literalLine ? i + code.length : c === "\r" && text[i + 1] === "\n" ? i + 2 : i + 1;
      const kind = newlineKindAt(i, end, opts?.newlines, text);
      if (kind === "soft") {
        let j = end;
        while (j < text.length && INDENT.test(text[j])) j += 1;
        const left = logic.length ? logic[logic.length - 1] : void 0;
        const right = j < text.length ? text[j] : void 0;
        if (shouldInsertSpace(left, right, spaced)) {
          logic += " ";
          logicToOriginal.push(-1);
        }
        i = j;
        continue;
      }
      const logicStart = logic.length;
      for (let k = i; k < end; k++) {
        logic += text[k];
        logicToOriginal.push(k);
      }
      logicNewlines.push({ start: logicStart, end: logic.length, kind });
      i = end;
      continue;
    }
    logic += c;
    logicToOriginal.push(i);
    i += 1;
  }
  return { original: text, logic, logicToOriginal, logicNewlines };
}
function listNewlineSpans(text) {
  const src = String(text ?? "");
  const controls = new Map([...src.matchAll(TOKEN_RE)].map((m) => [m.index, m[0]]));
  const spans = [];
  for (let i = 0; i < src.length; ) {
    const code = controls.get(i);
    if (code && !/^\\[nr]$/i.test(code)) {
      i += code.length;
      continue;
    }
    const c = src[i];
    const literalLine = Boolean(code && /^\\[nr]$/i.test(code));
    if (c === "\n" || c === "\r" || literalLine) {
      const end = literalLine ? i + code.length : c === "\r" && src[i + 1] === "\n" ? i + 2 : i + 1;
      spans.push({ start: i, end, kind: inferNewlineKind(src, i, end) });
      i = end;
      continue;
    }
    i += 1;
  }
  return spans;
}
function validateNewlineAnnotations(text, annotations) {
  if (!annotations) return true;
  if (!Array.isArray(annotations) || annotations.length > 500) return false;
  const allowed = new Set(listNewlineSpans(text).map((s) => `${s.start}:${s.end}`));
  for (const note of annotations) {
    if (!note || typeof note !== "object") return false;
    if (!["soft", "hard", "unknown"].includes(note.kind)) return false;
    if (!Number.isInteger(note.start) || !Number.isInteger(note.end) || note.end <= note.start) return false;
    if (!allowed.has(`${note.start}:${note.end}`)) return false;
  }
  return true;
}
function mapLogicRangeToOriginal(view, logicStart, logicEnd) {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const lo = Math.max(0, logicStart);
  const hi = Math.min(view.logicToOriginal.length, logicEnd);
  for (let i = lo; i < hi; i++) {
    const o = view.logicToOriginal[i];
    if (o < 0) continue;
    if (o < start) start = o;
    if (o + 1 > end) end = o + 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, end: 0 };
  return { start, end };
}

// lib/translate/structured-segments.ts
var STRUCTURE_MAX_UNITS = 200;
var CIRCLED = "\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u2469\u246A\u246B\u246C\u246D\u246E\u246F\u2470\u2471\u2472\u2473";
var ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1e3 };
var TOKEN = /https?:\/\/[^\s<>]+|<[^>]*>|\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|\{[A-Za-z0-9_]+\}|%\d+|__[A-Za-z]\d+__|\b\d+(?:[.．:/-]\d+)+\b/g;
var PAIRS = { "\u300C": "\u300D", "\u300E": "\u300F", "\u201C": "\u201D", "\u3010": "\u3011", "\u300A": "\u300B", "[": "]", "{": "}", "(": ")", "\uFF08": "\uFF09" };
function ordinal(raw) {
  const value = raw.normalize("NFKC");
  if (/^\d+$/.test(value)) return Number(value);
  if (!/^(?=[IVXLCDM]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(value)) return void 0;
  const chars = value.toUpperCase();
  let n = 0;
  for (let i = 0; i < chars.length; i++) n += ROMAN[chars[i]] * (ROMAN[chars[i]] < (ROMAN[chars[i + 1]] || 0) ? -1 : 1);
  return n || void 0;
}
function validStructureAnnotation(value) {
  return !!value && typeof value === "object" && ["accept", "disabled"].includes(value.mode);
}
function validRecordStructure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value;
  return (r.source === void 0 || validStructureAnnotation(r.source)) && (r.target === void 0 || validStructureAnnotation(r.target));
}
function scanStructuredText(text, annotation) {
  const result = { units: [], layout: text ? [{ kind: "literal", start: 0, end: text.length }] : [], diagnostics: [] };
  if (!text || annotation?.mode === "disabled") return result;
  if (/\\(?:[A-Za-z]+\[|[^A-Za-z\s])/.test(text) || /<[^>]*>/.test(text)) {
    result.diagnostics.push({ code: "protected_token", start: 0, end: text.length });
    return result;
  }
  const protectedAt = new Map([...text.matchAll(TOKEN)].map((m) => [m.index, m[0].length]));
  let markers = [];
  const stack = [];
  for (let i = 0; i < text.length; ) {
    const token = protectedAt.get(i);
    if (token) {
      i += token;
      continue;
    }
    const before = text[i - 1] || "";
    const boundary = i === 0 || /[\s:：,，、;；]/.test(before) || /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/.test(text[i]);
    let marker;
    const circled = CIRCLED.indexOf(text[i]);
    if (!stack.length && circled >= 0) marker = { start: i, end: i + 1, family: "circled", ordinal: circled + 1 };
    if (!stack.length && /[·•]/.test(text[i])) marker = { start: i, end: i + 1, family: "bullet" };
    if (!stack.length && boundary) {
      const match = text.slice(i).match(
        /^(?:([（(])([0-9０-９]+|[ivxlcdmIVXLCDM]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+)[）)]|([0-9０-９]+|[ivxlcdmIVXLCDM]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+)([.．、):：]|(?=\s)|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])))/u
      );
      if (match) {
        const raw = match[2] || match[3];
        const n = ordinal(raw);
        const suffix = match[4] || "";
        if (n !== void 0 && !(/[.．]/.test(suffix) && /[0-9０-９]/.test(text[i + match[0].length] || ""))) {
          const family = /^\d+$/.test(raw.normalize("NFKC")) ? "arabic" : "roman";
          marker = {
            start: i,
            end: i + match[0].length,
            family: `${family}:${match[1] ? "paren" : suffix || "bare"}`,
            ordinal: n,
            weak: !match[1] && !suffix && !/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/.test(raw)
          };
        }
      }
    }
    if (marker) {
      markers.push(marker);
      i = marker.end;
      continue;
    }
    if (PAIRS[text[i]]) stack.push(PAIRS[text[i]]);
    else if (stack.at(-1) === text[i]) stack.pop();
    i++;
  }
  if (markers.some((m) => !m.weak)) markers = markers.filter((m) => !m.weak);
  if (markers.length >= 2 && markers.every((m) => m.family === "bullet") && !/^\s*$/.test(text.slice(0, markers[0].start))) {
    const colon = text.slice(0, markers[0].start).match(/[:：]/);
    if (colon && text.slice(colon.index + 1, markers[0].start).trim()) markers.unshift({ start: colon.index + 1, end: colon.index + 1, family: "bullet" });
  }
  if (!markers.length) return result;
  if (markers.length > STRUCTURE_MAX_UNITS - 1) {
    result.diagnostics.push({ code: "candidate_limit", start: 0, end: text.length });
    return result;
  }
  const prefix = text.slice(0, markers[0].start);
  const labelMatch = prefix.match(/(?:^|\n)([^\n:：]+)[:：]\s*$/u);
  if (prefix.trim() && !labelMatch) return result;
  if (markers.length < 2) return result;
  const numbered = markers.filter((m) => m.ordinal !== void 0);
  const sameFamily = markers.every((m) => m.family === markers[0].family);
  const sequence = numbered.every((m, i) => !i || m.ordinal === numbered[i - 1].ordinal + 1);
  const bulletStrong = markers[0].family !== "bullet" || markers.every((m) => /^\s*$/.test(text.slice(text.lastIndexOf("\n", m.start - 1) + 1, m.start)));
  const strong = sameFamily && sequence && bulletStrong && markers.every((m) => !m.weak);
  const state = strong || annotation?.mode === "accept" ? "accepted" : "suggested";
  if (!sequence || !sameFamily) result.diagnostics.push({ code: "invalid_sequence", start: markers[0].start, end: text.length });
  else if (!strong) result.diagnostics.push({ code: "ambiguous_marker", start: markers[0].start, end: text.length });
  const add = (start, end, kind, n) => {
    const raw = text.slice(start, end);
    const leading = raw.match(/^\s*/)?.[0].length || 0;
    const trailing = raw.match(/[\s,，、;；]*$/)?.[0].length || 0;
    start += leading;
    end -= trailing;
    if (end <= start) return false;
    result.units.push({ id: `${start}:${end}`, start, end, kind, state, ...n !== void 0 ? { ordinal: n } : {} });
    return true;
  };
  if (labelMatch) {
    const labelStart = prefix.lastIndexOf(labelMatch[1]);
    if (labelStart > 0) add(0, labelStart, "text");
    add(labelStart, labelStart + labelMatch[1].length, "label");
  }
  for (let i = 0; i < markers.length; i++) {
    if (!add(markers[i].end, markers[i + 1]?.start ?? text.length, "item", markers[i].ordinal)) {
      result.units = [];
      return result;
    }
  }
  if (result.units.length > STRUCTURE_MAX_UNITS) {
    result.units = [];
    result.diagnostics.push({ code: "candidate_limit", start: 0, end: text.length });
    return result;
  }
  result.layout = [];
  let cursor = 0;
  for (const unit of result.units) {
    if (cursor < unit.start) result.layout.push({ kind: "literal", start: cursor, end: unit.start });
    result.layout.push({ kind: "unit", unitId: unit.id, start: unit.start, end: unit.end });
    cursor = unit.end;
  }
  if (cursor < text.length) result.layout.push({ kind: "literal", start: cursor, end: text.length });
  return result;
}

// lib/translate/sentence-units.ts
var SENTENCE_TOKEN_SOURCE = `${RM_ESCAPE_RE.source}|${TEXT_MARKUP_RE.source}|https?:\\/\\/[^\\s<>]+`;
var PAIRS2 = { "<": ">", "\u300C": "\u300D", "\u300E": "\u300F", "\u3010": "\u3011", "\u300A": "\u300B", "\u3008": "\u3009", "\uFF08": "\uFF09", "(": ")", "[": "]", "{": "}", "\u201C": "\u201D" };
var WIDTH = { "\uFF1F": "?", "\uFF01": "!", "\uFF0C": ",", "\u3002": ".", "\uFF0E": ".", "\uFF1B": ";" };
function punctuationKey(text) {
  return text.replace(/(?:…|[.．]{3,})+/g, "...").replace(/[？！，。．；]/g, (c) => WIDTH[c]).replace(/([!?])\1{2,}/g, "$1$1");
}
function controlSignature(text) {
  return JSON.stringify(text.match(new RegExp(`${SENTENCE_TOKEN_SOURCE}|%\\d+|\\{[A-Za-z0-9_]+\\}|__[A-Za-z]\\d+__`, "g")) || []);
}
function sentenceBodyKey(text) {
  let out = "", at = 0;
  for (const match of text.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))) {
    out += punctuationKey(text.slice(at, match.index).normalize("NFKC")) + match[0];
    at = match.index + match[0].length;
  }
  return out + punctuationKey(text.slice(at).normalize("NFKC"));
}
function newlineKindOnLogic(start, end, annotations) {
  for (const note of annotations) {
    if (note.start === start && note.end === end) return note.kind;
    if (note.start <= start && end <= note.end) return note.kind;
  }
  return "unknown";
}
function ellipsisEndAt(text, index) {
  if (!/[.．…]/.test(text[index] || "")) return null;
  const match = text.slice(index).match(/^(?:…|[.．]{3,})+/);
  return match ? index + match[0].length : null;
}
function sentenceTail(text) {
  const tail = text.match(/[,.!?;，、。．！？；…\s]+$/u)?.[0] || "";
  let afterEllipsis = 0;
  for (const match of tail.matchAll(/(?:…|[.．]{3,})+/g)) afterEllipsis = match.index + match[0].length;
  return tail.slice(afterEllipsis);
}
function sentenceBoundaryAt(text, index) {
  const c = text[index];
  if (!/[,，、。．.!！?？;；]/.test(c || "")) return null;
  if (/[,.，．]/.test(c) && /[0-9０-９]/.test(text[index - 1] || "") && /[0-9０-９]/.test(text[index + 1] || "")) return null;
  if (/[.．]/.test(c) && (/[.．]/.test(text[index - 1] || "") || /[.．]/.test(text[index + 1] || ""))) return null;
  let end = index + 1;
  while (end < text.length && /[,，、。．.!！?？;；]/.test(text[end]) && !ellipsisEndAt(text, end)) end++;
  return { end, boundary: /[,，、]/.test(c) ? "," : /[;；]/.test(c) ? ";" : "stop" };
}
function splitSentenceUnitsOn(text, hardOrUnknown) {
  const units = [];
  const controls = new Map([...text.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))].map((m) => [m.index, m[0]]));
  const stack = [];
  const opening = text.match(/^\s*[「『“]/)?.[0];
  const openDialogueAt = opening && !text.includes(PAIRS2[opening.at(-1)]) ? opening.length - 1 : -1;
  let start = 0;
  let block = 0;
  function push(end, boundary) {
    const raw = text.slice(start, end);
    const tail = sentenceTail(raw);
    const body = raw.slice(0, raw.length - tail.length).trim();
    const marks = punctuationKey(tail.replace(/\s/g, ""));
    const tone = marks.match(/[!?]+/)?.[0] || (marks.includes(".") ? "." : "");
    if (body) units.push({ start: start + (raw.match(/^\s*/)?.[0].length || 0), end, key: sentenceBodyKey(body), tone, boundary, controls: controlSignature(raw), block });
    start = end;
  }
  for (let i = 0; i < text.length; i++) {
    const code = controls.get(i);
    if (code && !/^\\[nr]$/i.test(code)) {
      i += code.length - 1;
      continue;
    }
    const c = text[i];
    if (PAIRS2[c] && i !== openDialogueAt) stack.push(PAIRS2[c]);
    else if (stack.at(-1) === c) stack.pop();
    if (stack.length) continue;
    const literalLine = code && /^\\[nr]$/i.test(code);
    if (c === "\n" || c === "\r" || literalLine) {
      const end = i + (literalLine ? code.length : c === "\r" && text[i + 1] === "\n" ? 2 : 1);
      const kind = newlineKindOnLogic(i, end, hardOrUnknown);
      if (kind === "hard") {
        push(end, "line");
        block++;
      }
      i = end - 1;
      continue;
    }
    const ellipsis = ellipsisEndAt(text, i);
    if (ellipsis != null) {
      i = ellipsis - 1;
      continue;
    }
    const seam = sentenceBoundaryAt(text, i);
    if (!seam) continue;
    push(seam.end, seam.boundary);
    i = seam.end - 1;
  }
  if (start < text.length) push(text.length, "end");
  return units;
}
function sentenceUnits(text, opts) {
  if (opts?.structure?.mode === "disabled")
    return text.trim() ? [{ start: 0, end: text.length, key: sentenceBodyKey(text), tone: "", boundary: "end", controls: controlSignature(text), block: 0 }] : [];
  const opening = text.match(/^(?:\s*[(（])+/)?.[0];
  if (opening && !/[)）]/.test(text)) {
    const offset = opening.length;
    const innerOpts = { ...opts, newlines: opts?.newlines?.filter((n) => n.start >= offset).map((n) => ({ ...n, start: n.start - offset, end: n.end - offset })) };
    return sentenceUnits(text.slice(offset), innerOpts).map((u) => ({ ...u, start: u.start + offset, end: u.end + offset }));
  }
  const structured = scanStructuredText(text, opts?.structure);
  if (structured.units.length && structured.units.every((unit) => unit.state === "accepted")) {
    return structured.units.map((unit, block) => {
      const raw = text.slice(unit.start, unit.end);
      const logic = buildLogicText(raw, {
        srcLang: opts?.srcLang,
        newlines: opts?.newlines?.filter((n) => n.start >= unit.start && n.end <= unit.end).map((n) => ({ ...n, start: n.start - unit.start, end: n.end - unit.start }))
      }).logic;
      const tail = sentenceTail(logic);
      const body = logic.slice(0, logic.length - tail.length).trim();
      const marks = punctuationKey(tail.replace(/\s/g, ""));
      return {
        start: unit.start,
        end: unit.end,
        key: sentenceBodyKey(body || logic),
        tone: marks.match(/[!?]+/)?.[0] || (marks.includes(".") ? "." : ""),
        boundary: "structure",
        controls: controlSignature(raw),
        block
      };
    });
  }
  const view = buildLogicText(text, { newlines: opts?.newlines, srcLang: opts?.srcLang });
  const units = splitSentenceUnitsOn(view.logic, view.logicNewlines);
  if (view.logic === text) return units;
  return units.map((unit) => {
    const span = mapLogicRangeToOriginal(view, unit.start, unit.end);
    return { ...unit, start: span.start, end: span.end };
  });
}

// lib/translate/sentence-plan.ts
function cutsSurrogate(text, index) {
  if (index <= 0 || index >= text.length) return false;
  const c = text.charCodeAt(index);
  return c >= 56320 && c <= 57343;
}
function validateAlignments(record, groups) {
  if (!Array.isArray(groups) || groups.length > 1e3 || groups.some((g) => !g || typeof g !== "object" || !["verified", "structural"].includes(g.evidence))) return false;
  const src = sentenceUnits(record.src, { newlines: record.newlines, structure: record.structure?.source });
  const tgt = sentenceUnits(record.zh, { structure: record.structure?.target });
  const starts = new Set(src.map((s) => s.start)), ends = new Set(src.map((s) => s.end));
  const targetStarts = new Set(tgt.map((s) => s.start)), targetEnds = new Set(tgt.map((s) => s.end));
  let sourceEnd = 0, targetEnd = 0;
  for (const g of groups) {
    if (![g.sourceStart, g.sourceEnd, g.targetStart, g.targetEnd].every(Number.isInteger)) return false;
    if (g.sourceStart < sourceEnd || g.targetStart < targetEnd || g.sourceStart >= g.sourceEnd || g.targetStart >= g.targetEnd) return false;
    if (g.sourceStart < 0 || g.sourceEnd > record.src.length || g.targetStart < 0 || g.targetEnd > record.zh.length) return false;
    if (cutsSurrogate(record.src, g.sourceStart) || cutsSurrogate(record.src, g.sourceEnd)) return false;
    if (cutsSurrogate(record.zh, g.targetStart) || cutsSurrogate(record.zh, g.targetEnd)) return false;
    const onUnits = starts.has(g.sourceStart) && ends.has(g.sourceEnd) && targetStarts.has(g.targetStart) && targetEnds.has(g.targetEnd);
    if (!onUnits) {
      if (g.evidence !== "verified") return false;
      if (src.length !== 1 || src[0].start !== 0 || src[0].end !== record.src.length) return false;
      if (tgt.length !== 1 || tgt[0].start !== 0 || tgt[0].end !== record.zh.length) return false;
      sourceEnd = g.sourceEnd;
      targetEnd = g.targetEnd;
      continue;
    }
    const a = src.filter((s) => s.start >= g.sourceStart && s.end <= g.sourceEnd).map((s) => s.controls).filter((s) => s !== "[]").join("");
    const b = tgt.filter((s) => s.start >= g.targetStart && s.end <= g.targetEnd).map((s) => s.controls).filter((s) => s !== "[]").join("");
    if (a !== b) return false;
    sourceEnd = g.sourceEnd;
    targetEnd = g.targetEnd;
  }
  return true;
}

// lib/translate/lookup.ts
function normalizeTranslateKey(text) {
  let s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/^"+/, "").replace(/("\);|"\))$/, "");
  try {
    s = s.normalize("NFKC");
  } catch {
  }
  return s;
}

// services/translate/text-classify.ts
var JAPANESE = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FD-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/;
var HAN3 = /[\u4e00-\u9fff]/;
function containsJapaneseText(text) {
  return JAPANESE.test(String(text ?? ""));
}
function retainsJapaneseHanPhrase(src, zh) {
  if (!containsJapaneseText(src)) return false;
  const japaneseForms = /[応駅図広気帰転戦楽読売発変実対観関験険]/;
  return (src.match(/[\u4e00-\u9fff]{3,}/g) || []).some((phrase) => japaneseForms.test(phrase) && zh.includes(phrase));
}
var ENGINE_TOKEN = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|%[0-9]+|%[sdifSc]|\{[0-9A-Za-z_]+\}|[A-Za-z_][A-Za-z0-9_]*\[\d+\]|_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])|_se\[[^\]]*\]|_[A-Z][A-Z0-9_]{1,}|[♡♥❤❥💕♪☆★✦✧※]{1,}|(?:\.{3}|…{1,}|・{2,}|･{2,})/g;
var PROTECT_TOKEN = new RegExp(`${TEXT_MARKUP_RE.source}|${ENGINE_TOKEN.source}`, "g");
function normCmp(s) {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}
function stripControlNoise(text) {
  return String(text ?? "").replace(PROTECT_TOKEN, " ").replace(/[\s\u3000]+/g, " ").trim();
}
function isIdenticalTranslation(src, zh) {
  return normCmp(src) === normCmp(zh);
}
function isStorableTranslation(src, zh, targetLang = "zh") {
  if (!validDynamicTranslation(src, zh)) return false;
  if (translationRubyChunks(zh).some((part) => part.ruby && JAPANESE.test(part.base + part.reading))) return false;
  if (!String(src ?? "").trim() || !String(zh ?? "").trim() || isIdenticalTranslation(src, zh)) return false;
  const sourceText = normCmp(stripControlNoise(src));
  const translatedText = normCmp(stripControlNoise(zh));
  if (!translatedText || sourceText && sourceText === translatedText) return false;
  if (JAPANESE.test(translatedText)) return false;
  if (retainsJapaneseHanPhrase(sourceText, translatedText)) return false;
  const isTargetZh = !targetLang || targetLang === "zh" || targetLang === "ch" || targetLang === "zh-CN" || targetLang === "zh-Hans" || targetLang === "zh-TW" || targetLang === "cht";
  if (isTargetZh) {
    return HAN3.test(translatedText);
  }
  return true;
}
function isReusableTranslation(src, zh) {
  if (isStorableTranslation(src, zh)) return true;
  if (!src.trim() || !zh.trim() || !isIdenticalTranslation(src, zh)) return false;
  const body = stripControlNoise(src);
  return !JAPANESE.test(body) && /[A-Za-z\u4e00-\u9fff]/.test(body);
}
function shouldTranslate(text, sourceLang) {
  if (typeof sourceLang === "number") sourceLang = void 0;
  const core = stripControlNoise(text);
  if (!core) return false;
  if (sourceLang && sourceLang !== "ja" && sourceLang !== "en") {
    const compact2 = core.replace(/[\s\u3000]+/g, "");
    return compact2.length > 0 && !/^[\p{P}\p{S}]+$/u.test(compact2);
  }
  if (!JAPANESE.test(core) && !isSourceText(core, "en")) return false;
  const compact = core.replace(/[\s\u3000]+/g, "");
  return !(compact.length > 0 && /^[\p{P}\p{S}]+$/u.test(compact));
}
function charCount(text) {
  return Array.from(String(text ?? "")).length;
}
function lineCount(text) {
  const src = String(text ?? "");
  if (!src) return 0;
  return src.split(/\r\n|\n|\r/).length;
}

// services/translate/game-records.ts
import fs5 from "node:fs";

// lib/translate/cache-row.ts
function parseCacheRow(value) {
  if (Array.isArray(value)) return typeof value[0] === "string" && (typeof value[1] === "string" || value[1] === null) ? { s: value[0], t: value[1] } : null;
  if (!value || typeof value !== "object") return null;
  const r = { ...value };
  if (typeof r.engine !== "string") r.engine = void 0;
  if (typeof r.event !== "string") r.event = void 0;
  if (typeof r.s !== "string" || typeof r.t !== "string" && r.t !== null) return null;
  if (r.origin && (typeof r.origin.id !== "string" || !Number.isInteger(r.origin.revision) || typeof r.origin.database !== "string")) return null;
  if (r.structure && !validRecordStructure(r.structure)) r.structure = void 0;
  if (r.alignments && (!r.t || !validateAlignments({ src: r.s, zh: r.t, newlines: r.newlines, structure: r.structure }, r.alignments)))
    return { ...r, alignments: void 0 };
  if (r.newlines && !validateNewlineAnnotations(r.s, r.newlines)) return { ...r, newlines: void 0 };
  return r;
}
function applyCacheRow(rows, row) {
  const previous = rows.get(row.s);
  if (row.t === null) {
    if (!row.origin || previous?.origin?.database === row.origin.database && previous.origin.id === row.origin.id) rows.delete(row.s);
  } else if (row.origin && previous && !previous.origin) {
    return;
  } else rows.set(row.s, row);
}

// services/translate/game-records.ts
var snapshots = /* @__PURE__ */ new Map();
function gameTranslationFiles(contentRoot) {
  const seed = gameContentReadPath(contentRoot, "seed", { alsoParent: true });
  const cache = gameContentReadPath(contentRoot, "cacheNdjson", { alsoParent: true });
  const stamp = JSON.stringify(
    [seed, cache].map((file) => {
      const stat = file ? fs5.statSync(file, { throwIfNoEntry: false }) : void 0;
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size];
    })
  );
  return { seed, cache, stamp };
}
function loadGameTranslationRecords(contentRoot, current) {
  const { seed, cache, stamp } = gameTranslationFiles(contentRoot);
  let snapshot = snapshots.get(contentRoot);
  if (snapshot?.stamp !== stamp) {
    const rows = /* @__PURE__ */ new Map();
    if (seed) {
      let data;
      try {
        data = JSON.parse(fs5.readFileSync(seed, "utf8"));
      } catch {
        data = null;
      }
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [s, t] of Object.entries(data)) if (typeof t === "string" && t) rows.set(s, { s, t, engine: "seed" });
      }
    }
    if (cache)
      for (const line of fs5.readFileSync(cache, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = parseCacheRow(JSON.parse(line));
          if (row) applyCacheRow(rows, row);
        } catch {
        }
      }
    const entries = [...rows.values()].filter((r) => r.t && isReusableTranslation(r.s, r.t)).map((row) => ({
      row,
      record: {
        id: row.origin?.id || `local:${row.s}`,
        revision: row.origin?.revision || 0,
        src: row.s,
        zh: row.t,
        engine: row.engine || "legacy-local",
        alignments: row.alignments,
        structure: row.structure,
        newlines: row.newlines,
        local: !row.origin
      }
    }));
    snapshot = { stamp, entries };
    if (snapshots.size >= 8 && !snapshots.has(contentRoot)) snapshots.delete(snapshots.keys().next().value);
    snapshots.set(contentRoot, snapshot);
  }
  return snapshot.entries.filter(({ row }) => !row.origin || !current || current(row.origin)).map(({ record }) => record);
}

// services/translate/game-lookup.ts
function applyPair(lookup, src, zh) {
  if (src == null || zh == null) return;
  const k = String(src);
  const v = String(zh);
  if (!isReusableTranslation(k, v)) return;
  lookup[k] = v;
  const nk = normalizeTranslateKey(k);
  if (nk && nk !== k) lookup[nk] = v;
}
function createGameTranslateLookup(records) {
  const lookup = /* @__PURE__ */ Object.create(null);
  try {
    for (const record of records) applyPair(lookup, record.src, record.zh);
  } catch {
  }
  return lookup;
}

// services/extract/lib/data-fields.ts
var TEXT_FIELD = /^(?:name|displayName|nickname|description|profile|message\d*|text|label|title|help|caption|summary|dialogue|.*[ _-](?:text|message|label|title|description|name|help))$/i;
var TECH_FIELD = /^(?:.*(?:path|url|script|formula|texture)|file(?:name)?|code|eval|callback|handler|condition|expression|Battle Show List|mode|blendMode|spawnType|(?:character|battler|face|picture|animation\d*|battleback\d*|title\d*|parallax)Name|tilesetNames|bgm|bgs|se|me|audio|image|sound|parameters|params|meta|frames|data|flags|traits|effects|damage|timings)$/i;
var isTextField = (field) => TEXT_FIELD.test(field);
var isTechnicalField = (field) => TECH_FIELD.test(field);

// services/extract/lib/rgss/writeback.ts
import fs6 from "node:fs";
import path5 from "node:path";
function strings(value) {
  const result = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new WeakSet();
  const walk = (entry, slot, text, set, category = "other") => {
    if (!entry || typeof entry !== "object") return;
    if (entry.kind === "string") {
      if (text) result.set(slot, { value: entry, set, category });
      return;
    }
    if (seen.has(entry)) return;
    seen.add(entry);
    if (entry.kind === "array") {
      entry.items.forEach(
        (child, index) => walk(
          child,
          `${slot}/${index}`,
          text,
          (next) => {
            entry.items[index] = next;
          },
          category
        )
      );
    } else if (entry.kind === "hash") {
      entry.pairs.forEach((pair, index) => {
        const name = pair.key && typeof pair.key === "object" && (pair.key.kind === "symbol" || pair.key.kind === "string") ? pair.key.value : "";
        walk(
          pair.value,
          `${slot}/h${index}`,
          !isTechnicalField(name) && (text || isTextField(name)),
          (next) => {
            pair.value = next;
          },
          category
        );
      });
    } else if (entry.kind === "object") {
      if (/^RPG::(?:AudioFile|BGM|BGS|ME|SE)$/.test(entry.className)) return;
      const command = entry.className === "RPG::EventCommand";
      const code = command ? rubyObjectField(entry, "code") : null;
      entry.ivars.pairs.forEach((pair, index) => {
        const name = pair.key && typeof pair.key === "object" && pair.key.kind === "symbol" ? pair.key.value.replace(/^@/, "") : "";
        if (command) {
          if (name !== "parameters" || !pair.value || typeof pair.value !== "object" || pair.value.kind !== "array") return;
          const parameter = code === 401 || code === 405 || code === 102 ? 0 : code === 402 || code === 320 || code === 324 || code === 325 ? 1 : -1;
          const child = pair.value.items[parameter];
          const parameters = pair.value;
          if (child !== void 0)
            walk(
              child,
              `${slot}/o${index}/${parameter}`,
              true,
              (next) => {
                parameters.items[parameter] = next;
              },
              code === 102 || code === 402 ? "choice" : "dialogue"
            );
        } else {
          if (name === "name" && ["RPG::Event", "RPG::CommonEvent", "RPG::Troop", "RPG::Animation", "RPG::Tileset"].includes(entry.className)) return;
          if (/^(?:character|battler|face|picture|animation\d*|battleback\d*|title\d*|parallax)_name$/i.test(name)) return;
          const systemText = /^(?:terms|words|basic|params|etypes|commands|elements|skill_types|weapon_types|armor_types|currency_unit|game_title)$/i.test(name);
          walk(
            pair.value,
            `${slot}/o${index}`,
            (systemText || !isTechnicalField(name)) && (isTextField(name) || systemText || text),
            (next) => {
              pair.value = next;
            },
            fieldCategory(entry.className, name, category)
          );
        }
      });
    }
  };
  walk(value, "", false, () => {
  });
  return result;
}
function fieldCategory(className, field, fallback) {
  const base = {
    "RPG::Actor": "actor",
    "RPG::Item": "item",
    "RPG::Weapon": "weapon",
    "RPG::Armor": "armor",
    "RPG::Skill": "skill",
    "RPG::Enemy": "enemy",
    "RPG::State": "state",
    "RPG::Map": "map",
    "RPG::MapInfo": "map",
    "RPG::System": "system"
  };
  if (className === "RPG::Actor" && field === "nickname") return "actor_nickname";
  if (className === "RPG::Actor" && field === "profile") return "actor_profile";
  const category = base[className] ?? fallback;
  if (field === "description" && (category === "item" || category === "weapon" || category === "armor" || category === "skill")) return `${category}_desc`;
  if (category === "state" && /^message/.test(field)) return "state_msg";
  return category;
}
function loadOneDataFile(dataDir, name) {
  const file = path5.join(dataDir, name);
  const value = parseRubyMarshal(fs6.readFileSync(file));
  const backup = `${file}.chaya.bak`;
  const original = fs6.existsSync(backup) ? parseRubyMarshal(fs6.readFileSync(backup)) : value;
  const current = strings(value);
  const texts = [];
  for (const [location, source] of strings(original)) {
    if (!isSourceText(source.value.value)) continue;
    const target = current.get(location);
    if (!target) throw new Error(`RGSS data structure changed since backup: ${name}${location}`);
    texts.push({ source: source.value.value.trim(), current: target, file: name, location });
  }
  return { file, value, texts };
}
var SKIP_DATA_STEMS = /^(?:FileSystem|Animations|Tilesets)(?:\.|$)/i;
function listDataFileNames(dataDir) {
  const names = fs6.readdirSync(dataDir).filter((name) => /\.rvdata2?$/i.test(name) && !SKIP_DATA_STEMS.test(name)).sort();
  if (!names.length) throw new Error("RGSS data is unavailable. Unpack the encrypted archive into Data/ first.");
  return names;
}
function loadFiles(dataDir) {
  return listDataFileNames(dataDir).map((name) => loadOneDataFile(dataDir, name));
}
function itemsFromFiles(files) {
  const groups = /* @__PURE__ */ new Map();
  for (const file of files) {
    for (const text of file.texts) {
      const group = groups.get(text.source) ?? [];
      group.push(text);
      groups.set(text.source, group);
    }
  }
  return [...groups].map(([src, locations], index) => {
    const translated = locations.every((item) => item.current.value.value === locations[0].current.value.value) ? locations[0].current.value.value : "";
    const zh = translated.trim() !== src ? translated : "";
    return {
      id: String(index + 1),
      src,
      zh,
      savedZh: zh || void 0,
      initialZh: zh || void 0,
      meta: { category: locations[0].current.category, label: "RGSS", file: `Data/${locations[0].file}` }
    };
  });
}
function loadRgssItems(dataDir) {
  return itemsFromFiles(loadFiles(dataDir));
}

// services/extract/lib/rgss-sources-index.ts
import fs7 from "node:fs";
import path6 from "node:path";
function rgssDataSignature(dataDir) {
  const files = fs7.readdirSync(dataDir).filter((name) => /\.rvdata2?(?:\.chaya\.bak)?$/i.test(name)).sort();
  return JSON.stringify(
    files.map((name) => {
      const stat = fs7.statSync(path6.join(dataDir, name));
      return [name, stat.size, stat.mtimeMs, stat.ctimeMs];
    })
  );
}
function readIndex(contentRoot) {
  const file = gameContentReadPath(contentRoot, "rgssSourcesIndex");
  if (!file) return null;
  try {
    const raw = JSON.parse(fs7.readFileSync(file, "utf8"));
    if (!raw || typeof raw.signature !== "string" || !Array.isArray(raw.sources)) return null;
    return raw;
  } catch {
    return null;
  }
}
function writeRgssSourcesIndex(contentRoot, signature, sources) {
  const file = ensureGameContentDir(contentRoot, "rgssSourcesIndex");
  const payload = {
    signature,
    sources: [...sources],
    updatedAt: Date.now()
  };
  fs7.writeFileSync(file, `${JSON.stringify(payload)}
`);
}
function ensureRgssSourcesIndex(contentRoot, dataDir, build) {
  const signature = rgssDataSignature(dataDir);
  const hit = readIndex(contentRoot);
  if (hit && hit.signature === signature) return new Set(hit.sources);
  const sources = build();
  writeRgssSourcesIndex(contentRoot, signature, sources);
  return new Set(sources);
}

// services/extract/lib/rgss.ts
function findChild(dir, name) {
  try {
    const hit = fs8.readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return hit ? path7.join(dir, hit) : null;
  } catch {
    return null;
  }
}
function extensionFor(dataDir) {
  try {
    const names = fs8.readdirSync(dataDir).map((name) => name.toLowerCase());
    if (names.some((name) => name.endsWith(".rvdata2"))) return ".rvdata2";
    if (names.some((name) => name.endsWith(".rvdata"))) return ".rvdata";
  } catch {
  }
  return null;
}
var seedSources = /* @__PURE__ */ new Map();
function filterRgssSeedKeys(contentRoot, keys) {
  const dir = findChild(contentRoot, "data");
  if (!dir || !extensionFor(dir)) return keys;
  const signature = rgssDataSignature(dir);
  let entry = seedSources.get(contentRoot);
  if (entry?.signature !== signature) {
    const sources = ensureRgssSourcesIndex(contentRoot, dir, () => loadRgssItems(dir).map((item) => item.src));
    entry = { signature, sources };
    if (seedSources.size >= 20) seedSources.delete(seedSources.keys().next().value);
    seedSources.set(contentRoot, entry);
  }
  return keys.filter((key2) => entry.sources.has(key2));
}

// services/translate/scheduler/seed-inventory.ts
function localGameContentFile(contentRoot, kind) {
  const roots = [path8.resolve(contentRoot)];
  const parent = path8.dirname(roots[0]);
  if (parent !== roots[0]) roots.push(parent);
  for (const root of roots) {
    const primary = path8.join(root, GAME_CONTENT_DIR, GAME_CONTENT_RELS[kind]);
    if (fs9.existsSync(primary)) return primary;
    for (const name of LEGACY_FLAT_FILES[kind]) {
      const candidate = path8.join(root, name);
      if (fs9.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
function seedFileStamp(contentRoot) {
  const file = localGameContentFile(contentRoot, "seed");
  const stat = file ? fs9.statSync(file, { throwIfNoEntry: false }) : void 0;
  return JSON.stringify([file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size]);
}
function readSeedInventory(contentRoot) {
  const file = gameContentReadPath(contentRoot, "seed", { alsoParent: true });
  const data = file ? JSON.parse(fs9.readFileSync(file, "utf8")) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Seed must be an object mapping source text to translation");
  const entries = data;
  const keys = filterRgssSeedKeys(
    contentRoot,
    Object.keys(entries).filter((key2) => key2.trim())
  );
  const progress = {
    contentRoot,
    hasSeed: keys.length > 0,
    total: keys.length,
    done: 0,
    missing: 0,
    needCount: 0,
    skipCount: 0,
    needChars: 0,
    skipChars: 0,
    missingChars: 0,
    doneChars: 0,
    lines: 0,
    batchSize: 40,
    batchesLeft: 0
  };
  let client;
  let revisionQuery;
  let unavailable = false;
  const revisions = /* @__PURE__ */ new Map();
  let records;
  try {
    records = loadGameTranslationRecords(contentRoot, (origin) => {
      if (unavailable || !TRANSLATE_CACHE_DB_PATH || origin.database !== TRANSLATE_CACHE_DB_PATH) return false;
      const key2 = `${origin.id}:${origin.revision}`;
      if (!revisions.has(key2)) {
        try {
          if (!client) {
            if (!fs9.existsSync(TRANSLATE_CACHE_DB_PATH)) return false;
            client = new DatabaseSync2(TRANSLATE_CACHE_DB_PATH, { readOnly: true });
            client.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=250; BEGIN");
            revisionQuery = client.prepare("SELECT revision FROM translation_records WHERE id=?");
          }
          const row = revisionQuery.get(origin.id);
          revisions.set(key2, row?.revision === origin.revision);
        } catch (error) {
          unavailable = true;
          console.warn("Saved translation revision check unavailable:", error instanceof Error ? error.message : String(error));
          return false;
        }
      }
      return revisions.get(key2);
    });
  } finally {
    client?.close();
  }
  const local = createGameTranslateLookup(records);
  const numeric = createNumericLabelIndex(records);
  const pending = [];
  for (const key2 of keys) {
    const chars = charCount(key2);
    progress.lines += lineCount(key2);
    if (!shouldTranslate(key2)) {
      progress.skipCount++;
      progress.skipChars += chars;
    } else {
      progress.needCount++;
      progress.needChars += chars;
      if (local[key2] != null || numeric.resolve(key2) != null) {
        progress.done++;
        progress.doneChars += chars;
      } else {
        progress.missing++;
        progress.missingChars += chars;
        pending.push(key2);
      }
    }
  }
  progress.batchesLeft = Math.ceil(progress.missing / 40);
  return { progress, pending, stamp: seedFileStamp(contentRoot) };
}

// services/translate/scheduler/seed-inventory-worker.ts
try {
  const contentRoot = String(workerData?.contentRoot || "");
  if (!contentRoot) throw new Error("seed-inventory-worker: missing contentRoot");
  const inv = readSeedInventory(contentRoot);
  const out = path9.join(os2.tmpdir(), `chaya-seed-inv-${process.pid}-${Date.now()}.json`);
  fs10.writeFileSync(out, JSON.stringify(inv));
  parentPort?.postMessage({ ok: true, path: out, pending: inv.pending.length, total: inv.progress.total });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
