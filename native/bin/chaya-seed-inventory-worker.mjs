import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

// services/translate/scheduler/seed-inventory-worker.ts
import fs15 from "node:fs";
import os2 from "node:os";
import path10 from "node:path";
import { parentPort, workerData } from "node:worker_threads";

// services/translate/scheduler/seed-inventory.ts
import fs14 from "node:fs";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

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
var SEED_JOB_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-seed-job-worker.mjs");
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
var STORAGE_DOCUMENT_KINDS = /* @__PURE__ */ new Set([
  "seed",
  "cacheNdjson",
  "switches",
  "translationPlay",
  "translationPreview",
  "gameEdit",
  "inputAssistance",
  "gameSaves"
]);
var registryCache = null;
function storageDirectoryRegistry() {
  if (typeof DATA_DIR !== "string" || !DATA_DIR) return null;
  const file = path4.join(DATA_DIR, "runtime", "game-directories.json");
  let mtimeMs = 0;
  try {
    mtimeMs = fs4.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  } catch {
    mtimeMs = 0;
  }
  if (!mtimeMs) {
    registryCache = null;
    return null;
  }
  if (registryCache && registryCache.file === file && registryCache.mtimeMs === mtimeMs) return registryCache;
  const byRoot = /* @__PURE__ */ new Map();
  try {
    const raw = JSON.parse(fs4.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [root, state] of Object.entries(raw)) {
        if (!state || typeof state !== "object") continue;
        const directory = state.directory;
        if (typeof directory === "string" && directory) byRoot.set(path4.resolve(root), path4.resolve(directory));
      }
    }
  } catch {
  }
  registryCache = { file, mtimeMs, byRoot };
  return registryCache;
}
function storageGameDirectory(contentRoot) {
  const registry = storageDirectoryRegistry();
  if (!registry) return null;
  const key2 = path4.resolve(contentRoot);
  const direct = registry.byRoot.get(key2);
  if (direct) return direct;
  try {
    const real = fs4.realpathSync(contentRoot);
    for (const [root, directory] of registry.byRoot) {
      try {
        if (fs4.realpathSync(root) === real) return directory;
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function gameContentPath(contentRoot, kind) {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) return publicGameFile(contentRoot, kind);
  return path4.join(path4.resolve(contentRoot), gameContentRelPath(kind));
}
function gameContentCandidatePaths(contentRoot, kind, opts) {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) return [publicGameFile(contentRoot, kind)];
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
function localGameContentFile(contentRoot, kind) {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) {
    const directory = storageGameDirectory(contentRoot);
    if (directory) {
      const canonical = path4.join(directory, GAME_CONTENT_RELS[kind]);
      if (fs4.existsSync(canonical)) return canonical;
    }
  }
  const roots = [path4.resolve(contentRoot)];
  const parent = path4.dirname(roots[0]);
  if (parent !== roots[0]) roots.push(parent);
  for (const root of roots) {
    const primary = path4.join(root, GAME_CONTENT_DIR, GAME_CONTENT_RELS[kind]);
    if (fs4.existsSync(primary)) return primary;
    for (const name of LEGACY_FLAT_FILES[kind]) {
      const candidate = path4.join(root, name);
      if (fs4.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
function ensureGameContentDir(contentRoot, kind) {
  const file = gameContentPath(contentRoot, kind);
  fs4.mkdirSync(path4.dirname(file), { recursive: true });
  return file;
}

// services/extract/lib/rgss.ts
import fs13 from "node:fs";
import path9 from "node:path";

// lib/translate/choice-meta.ts
function callEnd(text, start) {
  const name = /^(?:if|en)\s*\(/i.exec(text.slice(start));
  if (!name) return null;
  let depth = 1;
  let quote = "";
  for (let i = start + name[0].length; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i + 1;
  }
  return null;
}
function peelChoiceMetaTrail(text) {
  let core = String(text ?? "");
  let trail = "";
  for (; ; ) {
    const end = core.trimEnd().length;
    let start = null;
    for (const match of core.matchAll(/(?:if|en)\s*\(/gi)) {
      const at = match.index;
      if (at > 0 && /[A-Za-z0-9_]/.test(core[at - 1])) continue;
      if (callEnd(core, at) === end) {
        start = at;
        break;
      }
    }
    if (start == null) break;
    start = core.slice(0, start).trimEnd().length;
    trail = core.slice(start) + trail;
    core = core.slice(0, start);
  }
  return { core, trail };
}
function peelChoiceMetaShell(text) {
  const trailing = peelChoiceMetaTrail(text);
  let core = trailing.core;
  const trail = trailing.trail;
  let lead = "";
  for (; ; ) {
    const start = core.length - core.trimStart().length;
    const end = callEnd(core, start);
    if (end == null) break;
    const next = end + (core.slice(end).match(/^\s*/)?.[0].length || 0);
    lead += core.slice(0, next);
    core = core.slice(next);
  }
  return { lead, core, trail };
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
function validDynamicTranslation(source, target2) {
  if (!isDynamicTemplate(source)) return true;
  const lines = source.split(/\\n|\r?\n/);
  const translated = target2.split(/\\n|\r?\n/);
  return lines.length === translated.length && lines.every(
    (line, i) => sortedTokens(line, /_[A-Za-z][A-Za-z0-9_]*/g) === sortedTokens(translated[i], /_[A-Za-z][A-Za-z0-9_]*/g) && sortedTokens(line, DYNAMIC_VARIABLE) === sortedTokens(translated[i], DYNAMIC_VARIABLE) && sortedTokens(line, CONTROLS) === sortedTokens(translated[i], CONTROLS)
  );
}
var numericLabelParts = (src) => src.match(/^([A-Za-z]{2,60} ?)(\d{1,6})$/);
function numericLabelFamily(src) {
  return numericLabelParts(src)?.[1] || null;
}
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
        const target2 = record.zh.match(/^([^\d\r\n\\]*)(\d+)([^\d\r\n\\]*)$/);
        if (!target2 || target2[2] !== number || !/[\u3400-\u9FFF]/.test(target2[1] + target2[3])) return null;
        numbers.add(number);
        templates.add(JSON.stringify([target2[1], target2[3]]));
        if (templates.size > 1) return null;
      }
      if (numbers.size < 2 || templates.size !== 1) return null;
      const [prefix, suffix] = JSON.parse([...templates][0]);
      return prefix + query[2] + suffix;
    }
  };
}

// lib/translate/rm-escape.ts
var RM_DIGIT_CODE_SRC = String.raw`\\[A-Za-z]+\[\d+\]`;
function rmDigitCodeRe() {
  return new RegExp(RM_DIGIT_CODE_SRC, "g");
}
var RM_ESCAPE_RE = /\\[A-Za-z]+(?:\[[^\]]*\])?/g;
function isSemanticPlaceholder(token) {
  if (!token) return false;
  if (/^\\[NPV]\[[^\]]*\]$/i.test(token) || /^\\[Gg]$/.test(token)) return true;
  if (/^%[0-9]+$/i.test(token) || /^%[sdifSc]$/.test(token)) return true;
  if (/^\{[0-9A-Za-z_]+\}$/.test(token)) return true;
  if (/^_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])/i.test(token)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\[\d+\]$/.test(token)) return true;
  return false;
}
function hasRmDigitCodes(text) {
  return rmDigitCodeRe().test(String(text ?? ""));
}
function extractRmDigitCodes(text) {
  return [...String(text ?? "").matchAll(rmDigitCodeRe())].map((m) => m[0]);
}
function toRmDigitTemplate(text) {
  const src = String(text ?? "");
  if (!hasRmDigitCodes(src)) return src;
  return src.replace(rmDigitCodeRe(), (m) => {
    const letter = m.match(/^\\([A-Za-z]+)/)?.[1] ?? "";
    return `\\${letter.toLowerCase()}[#]`;
  });
}
function applyRmDigitCodes(template, codes) {
  if (!codes.length) return String(template ?? "");
  let i = 0;
  return String(template ?? "").replace(/\\[A-Za-z]+\[#\]/g, (slot) => {
    const code = codes[i++];
    return code != null ? code : slot;
  });
}
function lookupWithRmDigitTemplate(get, text) {
  const src = String(text ?? "");
  if (!src) return null;
  const direct = get(src);
  if (direct != null && direct !== "") return direct;
  const codes = extractRmDigitCodes(src);
  if (!codes.length) return null;
  const tpl = toRmDigitTemplate(src);
  if (tpl === src) return null;
  const hit = get(tpl);
  if (hit == null || hit === "") return null;
  return applyRmDigitCodes(hit, codes);
}

// lib/translate/segments.ts
var WRAPPERS = {
  "\u300C": "\u300D",
  "\u300E": "\u300F",
  "(": ")",
  "\uFF08": "\uFF09",
  "<": ">",
  "\uFF1C": "\uFF1E",
  "\u3010": "\u3011",
  "\u300A": "\u300B",
  "\u3008": "\u3009",
  "[": "]",
  "\uFF3B": "\uFF3D",
  "{": "}",
  "\uFF5B": "\uFF5D",
  "\u201C": "\u201D",
  "\u2018": "\u2019"
};
var SEPARATE_WRAPPERS = /* @__PURE__ */ new Set(["\u300C", "\u300E", "<", "\uFF1C"]);
var FRAGMENT_QUOTES = { "\u300C": "\u300D", "\u300E": "\u300F", "\u201C": "\u201D", "\u2018": "\u2019" };
function isOuterWrapper(text) {
  if (text.length < 2 || WRAPPERS[text[0]] !== text[text.length - 1]) return false;
  if (/^\{[A-Za-z0-9_]+\}$/.test(text) || /^<\/?(?:br|span|div|p|b|i|img|ruby|rt)(?:\s[^>]*)?\s*\/?>$/i.test(text)) return false;
  const stack = [];
  const controls = new Map([...text.matchAll(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g"))].map((match) => [match.index, match[0].length]));
  for (let i = 0; i < text.length; i++) {
    const length = controls.get(i);
    if (length) {
      i += length - 1;
      continue;
    }
    if (WRAPPERS[text[i]]) stack.push(WRAPPERS[text[i]]);
    else if (stack[stack.length - 1] === text[i]) {
      stack.pop();
      if (!stack.length) return i === text.length - 1;
    }
  }
  return false;
}
function splitSegments(text, splitOrphanQuotes) {
  if (isDynamicTemplate(text)) return [text];
  const choice = peelChoiceMetaShell(text);
  if (choice.lead || choice.trail) {
    const parts2 = splitSegments(choice.core, splitOrphanQuotes);
    if (!parts2.length) return [choice.lead + choice.trail];
    parts2[0] = choice.lead + parts2[0];
    parts2[parts2.length - 1] += choice.trail;
    return parts2;
  }
  const controls = new Map([...text.matchAll(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g"))].map((match) => [match.index, match[0].length]));
  const stack = [];
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const controlLength = controls.get(i);
    if (controlLength) {
      i += controlLength - 1;
      continue;
    }
    const char = text[i];
    if (/[.．,，]/.test(char) && /[0-9０-９]/.test(text[i - 1] || "") && /[0-9０-９]/.test(text[i + 1] || "")) continue;
    let closed = false;
    if (WRAPPERS[char]) {
      const separate = SEPARATE_WRAPPERS.has(char);
      if (separate && !stack.length && i > start && translationSegmentContent(text.slice(start, i)).core.trim()) {
        parts.push(text.slice(start, i));
        start = i;
      }
      stack.push({ close: WRAPPERS[char], separate });
    } else if (stack[stack.length - 1]?.close === char) {
      const wrapper = stack.pop();
      closed = stack.length === 0 && wrapper.separate;
    } else if (splitOrphanQuotes && !stack.length && /[」』]/.test(char)) {
      closed = true;
    }
    if (stack.length || !closed && !/[，,。．.!！?？]/.test(char)) continue;
    while (i + 1 < text.length && /[，,。．.!！?？]/.test(text[i + 1])) i++;
    parts.push(text.slice(start, i + 1));
    start = i + 1;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}
function translationSegments(text) {
  return splitSegments(text, false);
}
function segmentContent(text, keepChoiceMeta) {
  if (isDynamicTemplate(text)) return { lead: "", core: text, trail: "" };
  const control = new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g");
  const choice = peelChoiceMetaShell(text);
  let core = choice.core;
  let lead = keepChoiceMeta ? choice.lead : "";
  let trail = keepChoiceMeta ? choice.trail : "";
  for (; ; ) {
    const before = core;
    const meta = peelChoiceMetaShell(core);
    if (keepChoiceMeta) {
      lead += meta.lead;
      trail = meta.trail + trail;
    }
    core = meta.core;
    const prefix = core.match(/^[\s、，,。．.!！?？…]+/)?.[0] || [...core.matchAll(control)].find((match) => match.index === 0 && !/^\\RB\[/i.test(match[0]) && !isSemanticPlaceholder(match[0]))?.[0];
    if (prefix) {
      lead += prefix;
      core = core.slice(prefix.length);
    }
    const suffix = core.match(/[\s、，,。．.!！?？…]+$/)?.[0] || [...core.matchAll(control)].find((match) => match.index + match[0].length === core.length && !/^\\RB\[/i.test(match[0]) && !isSemanticPlaceholder(match[0]))?.[0];
    if (suffix) {
      trail = suffix + trail;
      core = core.slice(0, -suffix.length);
    }
    if (isOuterWrapper(core)) {
      lead += core[0];
      trail = core[core.length - 1] + trail;
      core = core.slice(1, -1);
    } else {
      const close = FRAGMENT_QUOTES[core[0]];
      if (close && !core.includes(close)) {
        lead += core[0];
        core = core.slice(1);
      }
      const open = Object.keys(FRAGMENT_QUOTES).find((key2) => FRAGMENT_QUOTES[key2] === core[core.length - 1]);
      if (open && !core.includes(open)) {
        trail = core[core.length - 1] + trail;
        core = core.slice(0, -1);
      }
    }
    if (core === before) break;
  }
  return { lead, core, trail };
}
function translationSegmentContent(text) {
  return segmentContent(text, true);
}
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
function matchingTranslationRubyPairs(source, target2) {
  const left = translationRubyChunks(source);
  const right = translationRubyChunks(target2);
  if (!left.some((chunk) => chunk.ruby) && !right.some((chunk) => chunk.ruby)) return null;
  if (left.length !== right.length || left.some((chunk, index) => chunk.ruby !== right[index].ruby)) return [];
  return left.flatMap((chunk, index) => {
    const other = right[index];
    if (chunk.ruby)
      return [
        { source: chunk.base, target: other.base },
        { source: chunk.reading, target: other.reading }
      ];
    if (!/[\p{L}\p{N}]/u.test(chunk.text) && !/[\p{L}\p{N}]/u.test(other.text)) return [];
    return [{ source: chunk.text, target: other.text }];
  });
}
function mapTranslationRubySegments(text, translate) {
  const chunks = translationRubyChunks(text);
  if (!chunks.some((part) => part.ruby)) return null;
  let result = "";
  let changed = false;
  for (const part of chunks) {
    if (!part.ruby) {
      const hit = translate(part.text);
      if (hit == null) {
        if (/[\p{L}]/u.test(translationSegmentContent(part.text).core)) return null;
        result += part.text;
        continue;
      }
      changed = true;
      result += hit;
      continue;
    }
    const base = translate(part.base);
    const reading = translate(part.reading);
    if (base == null || reading == null) {
      result += part.text;
      continue;
    }
    if (/[,\[\]\r\n]/.test(base + reading)) return null;
    changed = true;
    result += part.paren ? `${part.prefix}[${base}](${reading})` : `${part.prefix}[${base},${reading}]`;
  }
  return changed ? result : null;
}
function translationNumberedPrefixPair(source, target2) {
  const prefix = source.match(/^(?:[A-Za-z]+\d+_)+/)?.[0];
  if (!prefix || !target2.startsWith(prefix)) return null;
  const src = source.slice(prefix.length);
  const zh = target2.slice(prefix.length);
  if (/[_/\\]/.test(src) || /[_/\\]/.test(zh)) return null;
  if (!/[\p{L}\p{N}]/u.test(src) || !/[\p{L}\p{N}]/u.test(zh)) return null;
  return { source: src, target: zh };
}
function translationCacheLines(text) {
  if (isDynamicTemplate(text)) return [text];
  const { lead, core, trail } = translationSegmentContent(text);
  const controls = [...core.matchAll(RM_ESCAPE_RE)].filter((match) => match[0] !== "\\n");
  const lines = [];
  let start = 0;
  for (const match of core.matchAll(/\r\n|[\r\n]|\\n(?![A-Za-z]|\[)/g)) {
    const at = match.index;
    if (controls.some((control) => at >= control.index && at < control.index + control[0].length)) continue;
    const end = at + match[0].length;
    lines.push(core.slice(start, end));
    start = end;
  }
  if (!lines.length) return [text];
  lines.push(core.slice(start));
  lines[0] = lead + lines[0];
  lines[lines.length - 1] += trail;
  return lines;
}
function translationDisplayChunks(text) {
  if (isDynamicTemplate(text)) return [{ text, display: false }];
  const chunks = [];
  const controls = [...text.matchAll(new RegExp(RM_ESCAPE_RE.source, "g"))];
  let start = 0;
  for (const match of text.matchAll(/\\(?:RC\[(?:\d+|#[0-9a-f]+)\]|C\[(?:\d+|#[0-9a-f]+)\]|FS\[\d+\]|CL|FB|DF|G)(?![A-Za-z])/gi)) {
    const at = match.index;
    if (controls.some((control) => control.index < at && control.index + control[0].length > at)) continue;
    if (at > start) chunks.push({ text: text.slice(start, at), display: false });
    chunks.push({ text: match[0], display: true });
    start = at + match[0].length;
  }
  if (start < text.length) chunks.push({ text: text.slice(start), display: false });
  return chunks;
}
function mapTranslationDisplaySegments(text, translate) {
  const choice = peelChoiceMetaShell(text);
  const chunks = translationDisplayChunks(choice.core);
  if (!chunks.some((chunk) => chunk.display)) return text;
  return choice.lead + chunks.map((chunk) => chunk.display ? chunk.text : translate(chunk.text)).join("") + choice.trail;
}
function translationExportText(text) {
  if (isDynamicTemplate(text)) return text;
  const { lead, core, trail } = translationSegmentContent(text);
  const strip = (shell) => shell.replace(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g"), (code) => /^\\(?:[nbr]|C\[(?:\d+|#[0-9a-f]+)\]|FS\[\d+\]|[.!|><^{}$])$/i.test(code) ? "" : code);
  return strip(lead) + core + strip(trail);
}
function mapTranslationSegments(text, translate) {
  return mapSegments(translationSegments(text), translate);
}
function mapTranslationCacheLines(text, translate) {
  return mapSegments(translationCacheLines(text), translate);
}
function mapSegments(parts, translate) {
  return parts.map((part) => {
    const { lead, core, trail } = translationSegmentContent(part);
    return core ? lead + translate(core, part) + trail : part;
  }).join("");
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

// services/game/rgss-archive.ts
import fs5 from "node:fs";
import path5 from "node:path";
import { inflateSync } from "node:zlib";

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

// services/game/rgss-archive.ts
function readAceMember(archive, member) {
  const fd = fs5.openSync(archive, "r");
  let cursor = 0;
  const length = fs5.fstatSync(fd).size;
  const read = (size, offset = cursor) => {
    if (size < 0 || offset + size > length) throw new Error("Truncated RGSS archive");
    const bytes = Buffer.alloc(size);
    if (fs5.readSync(fd, bytes, 0, size, offset) !== size) throw new Error("Truncated RGSS archive");
    cursor = offset + size;
    return bytes;
  };
  try {
    const header = read(12);
    if (!header.subarray(0, 8).equals(Buffer.from("RGSSAD\0", "binary"))) throw new Error("Unsupported RGSS archive version");
    const key2 = Math.imul(header.readUInt32LE(8), 9) + 3 >>> 0;
    for (let count = 0; count < 1e5; count++) {
      const record = read(16);
      const offset = (record.readUInt32LE(0) ^ key2) >>> 0;
      if (!offset) return null;
      const size = (record.readUInt32LE(4) ^ key2) >>> 0;
      let fileKey = (record.readUInt32LE(8) ^ key2) >>> 0;
      const nameSize = (record.readUInt32LE(12) ^ key2) >>> 0;
      if (nameSize > 4096) throw new Error("Invalid RGSS archive filename");
      const name = read(nameSize);
      for (let i = 0; i < name.length; i++) name[i] ^= key2 >>> i % 4 * 8 & 255;
      if (name.toString().replaceAll("\\", "/").toLowerCase() !== member.toLowerCase()) continue;
      if (size > 32 * 1024 * 1024) throw new Error("RGSS script archive exceeds 32 MiB");
      const bytes = read(size, offset);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] ^= fileKey >>> i % 4 * 8 & 255;
        if (i % 4 === 3) fileKey = Math.imul(fileKey, 7) + 3 >>> 0;
      }
      return bytes;
    }
    throw new Error("RGSS archive has too many members");
  } finally {
    fs5.closeSync(fd);
  }
}
function readRgssScripts(contentRoot) {
  const names = fs5.readdirSync(contentRoot);
  const data = names.find((name) => name.toLowerCase() === "data");
  const script = data && fs5.readdirSync(path5.join(contentRoot, data)).find((name) => /^scripts\.rvdata2?$/i.test(name));
  const archive = names.find((name) => name.toLowerCase() === "game.rgss3a");
  const bytes = script ? fs5.readFileSync(path5.join(contentRoot, data, script)) : archive ? readAceMember(path5.join(contentRoot, archive), "Data/Scripts.rvdata2") : null;
  if (!bytes) return [];
  const value = parseRubyMarshal(bytes);
  if (!value || typeof value !== "object" || value.kind !== "array") return [];
  return value.items.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || entry.kind !== "array") return [];
    const [, name, packed] = entry.items;
    if (!packed || typeof packed !== "object" || packed.kind !== "string" || !packed.bytes) return [];
    return [
      {
        name: name && typeof name === "object" && name.kind === "string" ? name.value : "",
        source: inflateSync(packed.bytes, { maxOutputLength: 8 * 1024 * 1024 }).toString("utf8")
      }
    ];
  });
}

// services/translate/game-cache-context.ts
import { createHash } from "node:crypto";
import fs7 from "node:fs";

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

// lib/translate/cache-engine-rank.ts
function cacheEngineRank(engine) {
  if (engine === "manual") return 4;
  if (engine === "import" || engine?.startsWith("import:")) return 3;
  if (engine === "live:optimize" || engine?.startsWith("live:optimize:") || engine?.startsWith("live:agent")) return 2;
  if (engine === "manual:optimize") return 0;
  return 1;
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
var SENTENCE_RULE_VERSION = 10;
var PAIRS2 = { "<": ">", "\u300C": "\u300D", "\u300E": "\u300F", "\u3010": "\u3011", "\u300A": "\u300B", "\u3008": "\u3009", "\uFF08": "\uFF09", "(": ")", "[": "]", "{": "}", "\u201C": "\u201D" };
var WIDTH = { "\uFF1F": "?", "\uFF01": "!", "\uFF0C": ",", "\u3002": ".", "\uFF0E": ".", "\uFF1B": ";" };
function punctuationKey(text) {
  return text.replace(/(?:…|[.．]{3,})+/g, "...").replace(/[？！，。．；]/g, (c) => WIDTH[c]).replace(/([!?])\1{2,}/g, "$1$1");
}
function controlSignature(text) {
  return JSON.stringify(text.match(new RegExp(`${SENTENCE_TOKEN_SOURCE}|%\\d+|\\{[A-Za-z0-9_]+\\}|__[A-Za-z]\\d+__`, "g")) || []);
}
function wholeSentenceKey(text) {
  const normalized = text.trim();
  const plainKey = (part) => punctuationKey(part.replace(/\r\n?/g, "\n").replace(/[\t \u3000]*\n[\t \u3000]*/g, "\n"));
  let out = "", at = 0;
  for (const match of normalized.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))) {
    out += plainKey(normalized.slice(at, match.index)) + match[0];
    at = match.index + match[0].length;
  }
  return out + plainKey(normalized.slice(at));
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
function sameSentence(a, b) {
  return a.key === b.key && a.tone === b.tone && a.controls === b.controls;
}
function sentenceOuterShell(text) {
  const visible = text.trim();
  const trimmed = visible.replace(/[,，。．.!！?？;；]+$/, "");
  const suffix = visible.slice(trimmed.length);
  if (!trimmed || PAIRS2[trimmed[0]] !== trimmed.at(-1)) return { lead: "", core: text, trail: "" };
  const stack = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (PAIRS2[trimmed[i]]) stack.push(PAIRS2[trimmed[i]]);
    else if (stack.at(-1) === trimmed[i]) {
      stack.pop();
      if (!stack.length && i !== trimmed.length - 1) return { lead: "", core: text, trail: "" };
    }
  }
  const space = text.indexOf(trimmed);
  return { lead: text.slice(0, space) + trimmed[0], core: trimmed.slice(1, -1), trail: trimmed.at(-1) + suffix + text.slice(space + visible.length) };
}

// lib/translate/sentence-aliases.ts
function sentenceAliases(src, zh) {
  const aliases = [];
  const a = peelChoiceMetaShell(src), b = peelChoiceMetaShell(zh);
  if ((a.lead || a.trail) && (!b.lead && !b.trail || a.lead === b.lead && a.trail === b.trail) && !/(?:如果|启用|禁用)\s*[(（]/.test(b.core))
    aliases.push({ src: a.core, zh: b.core });
  const sourceOpening = src.match(/^(?:\s*[(（])+/)?.[0];
  const targetOpening = zh.match(/^(?:\s*[(（])+/)?.[0];
  if (sourceOpening && targetOpening && sourceOpening.normalize("NFKC").trim() === targetOpening.normalize("NFKC").trim() && !/[)）]/.test(src) && !/[)）]/.test(zh))
    aliases.push({ src: src.slice(sourceOpening.length), zh: zh.slice(targetOpening.length) });
  const numbered = translationNumberedPrefixPair(src, zh);
  if (numbered) aliases.push({ src: numbered.source, zh: numbered.target });
  const source = sentenceOuterShell(src), target2 = sentenceOuterShell(zh);
  if (source.core !== src && target2.core !== zh && !/[!?！？]/.test(source.trail)) aliases.push({ src: source.core, zh: target2.core });
  for (const pair of matchingTranslationRubyPairs(src, zh) || []) aliases.push({ src: pair.source, zh: pair.target });
  return aliases.filter((pair) => pair.src && pair.zh);
}
function structuredSentenceAliases(src, zh, structure) {
  const source = scanStructuredText(src, structure?.source);
  const target2 = scanStructuredText(zh, structure?.target);
  if (source.diagnostics.length || target2.diagnostics.length || [...source.units, ...target2.units].some((unit) => unit.state !== "accepted")) return [];
  const a = source.units.filter((unit) => unit.kind === "item");
  const b = target2.units.filter((unit) => unit.kind === "item");
  if (a.length < 2 || a.length !== b.length || a.some((unit, i) => unit.ordinal === void 0 || unit.ordinal !== b[i].ordinal)) return [];
  const pairs = a.map((unit, i) => ({ source: unit, target: b[i] }));
  const label = source.units.find((unit) => unit.kind === "label");
  const translatedLabel = target2.units.find((unit) => unit.kind === "label");
  if (label && translatedLabel) pairs.unshift({ source: label, target: translatedLabel });
  const context = source.units.filter((unit) => unit.kind === "text").reduce((length, unit) => length + unit.end - unit.start, 0);
  return pairs.flatMap((pair) => {
    const from = src.slice(pair.source.start, pair.source.end);
    let to = zh.slice(pair.target.start, pair.target.end);
    if (/[①-⑳][\t ]*$/u.test(zh.slice(0, pair.target.start))) to = to.replace(/^[.．][\t ]*/u, "");
    return from && to ? [{ src: from, zh: to, context }] : [];
  });
}

// lib/translate/sentence-auto-alignment.ts
function completeSentences(text, units) {
  if (!units.length || text.slice(0, units[0].start).trim() || text.slice(units.at(-1).end).trim()) return null;
  const out = [];
  let from = 0;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.boundary === "structure") return null;
    if (unit.boundary !== "stop") continue;
    const start = units[from].start, end = unit.end;
    out.push({ from, to: i + 1, start, end, tone: unit.tone, controls: JSON.stringify([controlSignature(text.slice(start, end)), text.slice(start, end).match(/%[sdif]/g) || []]) });
    from = i + 1;
  }
  return from === units.length && out.length >= 2 ? out : null;
}
function hasComplexControls(text) {
  return [...text.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))].some((match) => !/^\\(?:[VNP]\[\d+\]|G)$/i.test(match[0]));
}
function inferSentenceAlignment(record, units) {
  if (record.derived || record.alignments?.length || record.structure?.source?.mode === "disabled" || record.structure?.target?.mode === "disabled") return [];
  const structures = [
    scanStructuredText(record.src.replace(new RegExp(SENTENCE_TOKEN_SOURCE, "g"), " "), record.structure?.source),
    scanStructuredText(record.zh.replace(new RegExp(SENTENCE_TOKEN_SOURCE, "g"), " "), record.structure?.target)
  ];
  if (structures.some((s) => s.units.length || s.diagnostics.length)) return [];
  if (hasComplexControls(record.src) || hasComplexControls(record.zh)) return [];
  const targetUnits = sentenceUnits(record.zh, { structure: record.structure?.target });
  const source = completeSentences(record.src, units);
  const target2 = completeSentences(record.zh, targetUnits);
  const sentences = source && target2 && source.length === target2.length && source.every((s, i) => s.tone === target2[i].tone && s.controls === target2[i].controls) ? source.map((s, i) => ({ from: s.from, to: s.to, targetStart: target2[i].start, targetEnd: target2[i].end })) : [];
  return [...sentences, ...inferEllipsisClauses(record, units, targetUnits)];
}
function inferEllipsisClauses(record, source, target2) {
  if (source.length < 2 || source.length !== target2.length) return [];
  const signature = (text, unit) => JSON.stringify([unit.controls, text.slice(unit.start, unit.end).match(/%[sdif]/g) || []]);
  if (source.some(
    (unit, i) => unit.boundary !== target2[i].boundary || unit.tone !== target2[i].tone || unit.key.includes("...") !== target2[i].key.includes("...") || signature(record.src, unit) !== signature(record.zh, target2[i])
  ))
    return [];
  const clauses = source.flatMap(
    (unit, i) => unit.key.endsWith("...") && target2[i].key.endsWith("...") ? [{ from: i, to: i + 1, targetStart: target2[i].start, targetEnd: target2[i].end, kind: "ellipsis" }] : []
  );
  return clauses.length >= 2 ? clauses : [];
}
function inferredSentenceTarget(record, groups, from, to) {
  const group = groups.find((g) => g.from === from && g.to === to);
  return group ? record.zh.slice(group.targetStart, group.targetEnd) : null;
}

// lib/translate/sentence-query.ts
function sentenceQueryViews(src, opts) {
  const views = [{ text: src, offset: 0, opts }];
  if (opts?.structure?.mode === "disabled") return views;
  for (let depth = 0; depth < 8; depth++) {
    const view = views.at(-1);
    if (!/^\s*[「『“（(]/.test(view.text)) break;
    const shell = sentenceOuterShell(view.text);
    if (!shell.lead || !shell.core || shell.core === view.text || /[!?！？]/.test(shell.trail)) break;
    const offset = shell.lead.length;
    views.push({
      text: shell.core,
      offset: view.offset + offset,
      opts: {
        ...view.opts,
        newlines: view.opts?.newlines?.filter((n) => n.start >= offset && n.end <= offset + shell.core.length).map((n) => ({ ...n, start: n.start - offset, end: n.end - offset }))
      }
    });
  }
  return views;
}
function queryLines(src) {
  const breaks = listNewlineSpans(src);
  if (!breaks.length || breaks.length > 200) return [];
  let start = 0;
  return [...breaks, { start: src.length, end: src.length }].flatMap((br) => {
    const raw = src.slice(start, br.start);
    const at = start + (raw.match(/^\s*/)?.[0].length || 0);
    start = br.end;
    return raw.trim() ? [{ start: at, text: raw.trim() }] : [];
  });
}
function sentenceQueryViewUnits(src, opts) {
  const body = sentenceQueryViews(src, opts)[1];
  if (!body) return sentenceUnits(src, opts);
  const units = sentenceUnits(body.text, body.opts);
  if (units.length < 2) return sentenceUnits(src, opts);
  return units.map((unit, i) => ({
    ...unit,
    start: i === 0 ? 0 : unit.start + body.offset,
    end: i === units.length - 1 ? src.length : unit.end + body.offset,
    key: sentenceBodyKey((i === 0 ? src.slice(0, body.offset).trimStart() : "") + unit.key + (i === units.length - 1 ? src.slice(body.offset + body.text.length).trimEnd() : ""))
  }));
}
function sentenceQueryKeys(src, opts) {
  return [
    ...new Set(
      sentenceQueryViews(src, opts).flatMap((view) => [
        wholeSentenceKey(view.text),
        wholeSentenceKey(buildLogicText(view.text, view.opts).logic),
        ...sentenceQueryViewUnits(view.text, view.opts).map((unit) => wholeSentenceKey(view.text.slice(unit.start, unit.end))),
        ...queryLines(view.text).map((line) => wholeSentenceKey(line.text))
      ])
    )
  ];
}
function sentenceQueryUnits(src, opts) {
  return sentenceQueryViews(src, opts).flatMap(
    (view) => sentenceQueryViewUnits(view.text, view.opts).map((u) => ({ ...u, start: u.start + view.offset, end: u.end + view.offset }))
  );
}

// lib/translate/sentence-plan.ts
function recordUnitOpts(record) {
  return { newlines: record.newlines, structure: record.structure?.source };
}
function expandRecords(records) {
  return records.flatMap((record) => [
    record,
    ...sentenceAliases(record.src, record.zh).map((alias) => ({ ...record, ...alias, derived: true, alignments: void 0, newlines: void 0 })),
    ...structuredSentenceAliases(record.src, record.zh, record.structure).map(({ context, ...alias }) => ({
      ...record,
      ...alias,
      derived: true,
      structuralAlias: true,
      structureContext: context,
      alignments: void 0,
      newlines: void 0,
      structure: void 0
    }))
  ]);
}
function logicAuthorityKey(text, opts) {
  return wholeSentenceKey(buildLogicText(text, { newlines: opts?.newlines, srcLang: opts?.srcLang }).logic);
}
function target(record, units, from, to) {
  if (from === 0 && to === units.length && units[0]?.start === 0 && units.at(-1)?.end === record.src.length) return record.zh;
  const start = units[from].start;
  const end = units[to - 1].end;
  const groups = (record.alignments || []).filter((g) => g.evidence === "verified" && g.sourceStart >= start && g.sourceEnd <= end).sort((a, b) => a.sourceStart - b.sourceStart);
  if (!groups.length || groups[0].sourceStart !== start || groups.at(-1).sourceEnd !== end) return null;
  for (let i = 1; i < groups.length; i++) if (groups[i - 1].sourceEnd !== groups[i].sourceStart || groups[i - 1].targetEnd !== groups[i].targetStart) return null;
  return record.zh.slice(groups[0].targetStart, groups.at(-1).targetEnd);
}
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
function candidates(src, records, queryOpts, automaticOnly = false, budget) {
  const query = sentenceQueryViewUnits(src, queryOpts);
  const queryKey = logicAuthorityKey(src, queryOpts);
  const fragmentKeys = query.map((unit) => wholeSentenceKey(src.slice(unit.start, unit.end)));
  const out = [];
  let work = 0;
  for (const record of records) {
    const unitOpts = recordUnitOpts(record);
    const units = sentenceUnits(record.src, unitOpts);
    const recordKey = logicAuthorityKey(record.src, unitOpts);
    const inferred = automaticOnly ? inferSentenceAlignment(record, units) : [];
    if (automaticOnly && !inferred.length) continue;
    if (!automaticOnly && queryKey === recordKey && query.length) {
      out.push({
        start: 0,
        end: src.length,
        from: 0,
        to: query.length,
        text: record.zh,
        record,
        sourceStart: 0,
        sourceEnd: record.src.length,
        kind: "whole",
        queryCoverage: 1,
        recordCoverage: 1
      });
      continue;
    }
    for (let q = 0; !automaticOnly && q < query.length; q++) {
      if (++work > 5e4 || budget && --budget.remaining < 0) return Object.assign([], { limited: true });
      const unit = query[q];
      if (fragmentKeys[q] === recordKey)
        out.push({
          start: unit.start,
          end: unit.end,
          from: q,
          to: q + 1,
          text: record.zh,
          record,
          sourceStart: 0,
          sourceEnd: record.src.length,
          kind: "single",
          queryCoverage: 1 / query.length,
          recordCoverage: 1
        });
    }
    for (let q = 0; q < query.length; q++) {
      for (let r = 0; r < units.length; r++) {
        if (++work > 5e4 || budget && --budget.remaining < 0) return Object.assign([], { limited: true });
        let length = 0;
        while (q + length < query.length && r + length < units.length && sameSentence(query[q + length], units[r + length])) {
          if (++work > 5e4 || budget && --budget.remaining < 0) return Object.assign([], { limited: true });
          if (length && (query[q + length].block !== query[q].block || units[r + length].block !== units[r].block || query[q + length - 1].boundary !== units[r + length - 1].boundary))
            break;
          length++;
          const ellipsis = automaticOnly && inferred.some((g) => g.kind === "ellipsis" && g.from === r && g.to === r + length);
          if (automaticOnly && !ellipsis && (q > 0 && query[q - 1].boundary !== "stop" || query[q + length - 1].boundary !== "stop")) continue;
          const text = automaticOnly ? inferredSentenceTarget(record, inferred, r, r + length) : target(record, units, r, r + length);
          if (text == null) continue;
          out.push({
            start: query[q].start,
            end: query[q + length - 1].end,
            from: q,
            to: q + length,
            text,
            ...automaticOnly ? { alignment: "inferred" } : {},
            ...ellipsis ? { alignmentBasis: "ellipsis" } : {},
            queryCoverage: length / query.length,
            recordCoverage: length / units.length,
            record,
            sourceStart: units[r].start,
            sourceEnd: units[r + length - 1].end,
            kind: r === 0 && length === units.length && units[0].start === 0 && units.at(-1).end === record.src.length ? length === query.length ? "whole" : length === 1 ? "single" : "block" : "extracted"
          });
        }
      }
    }
  }
  return out;
}
function joinSentenceBlock(source, translated, trimCachedSeam = false) {
  const seam = source.match(/([,，、;；]\s*|\r?\n|\\n)$/)?.[0];
  if (!seam) return trimCachedSeam ? translated.replace(/[,，、;；]\s*$/u, "") : translated;
  return translated.replace(/[,，、;；\s]+$/u, "") + seam;
}
function renderSentencePlan(plan, gaps = /* @__PURE__ */ new Map()) {
  const pieces = [
    ...plan.matches.map((m) => ({
      start: m.start,
      end: m.end,
      text: m.text,
      restoreSeam: true,
      trimCachedSeam: /[,，、;；]\s*$/.test(m.record.src.slice(m.sourceStart, m.sourceEnd))
    })),
    ...plan.gaps.map((g) => ({ ...g, text: gaps.get(g.id) ?? g.text, restoreSeam: gaps.has(g.id), trimCachedSeam: false }))
  ].sort((a, b) => a.start - b.start);
  let at = 0, out = "";
  for (const part of pieces) {
    out += plan.src.slice(at, part.start) + (part.restoreSeam ? joinSentenceBlock(plan.src.slice(part.start, part.end), part.text, part.trimCachedSeam) : part.text);
    at = part.end;
  }
  return out + plan.src.slice(at);
}
function planSentenceTranslation(src, records, opts) {
  return planSentenceTranslationView(src, records, opts, true);
}
function planSentenceTranslationView(src, records, opts, unwrap) {
  const units = sentenceQueryViewUnits(src, opts);
  const expanded = expandRecords(records);
  const normal = candidates(src, expanded, opts);
  const initial = chooseSentencePlan(src, units, normal, normal.limited === true, opts?.category);
  if (initial.status === "full" || initial.limited || opts?.structure?.mode === "disabled") return initial;
  const views = unwrap ? sentenceQueryViews(src, opts) : [];
  if (views.length > 1 && !initial.ambiguous) {
    let best = initial;
    let covered = initial.matches.reduce((sum, m) => sum + m.end - m.start, 0);
    for (const body of views.slice(1)) {
      const inner = planSentenceTranslationView(body.text, records, body.opts, false);
      const shifted = {
        ...inner,
        src,
        matches: inner.matches.map((m) => ({ ...m, start: m.start + body.offset, end: m.end + body.offset })),
        gaps: inner.gaps.map((g) => ({ ...g, id: `${g.start + body.offset}:${g.end + body.offset}`, start: g.start + body.offset, end: g.end + body.offset })),
        zh: null
      };
      if (initial.matches.length) {
        const additions2 = remapSentenceMatches(
          shifted.matches.filter((m) => normal.every((hit) => m.end <= hit.start || m.start >= hit.end)),
          units,
          src,
          opts
        ).filter((m) => m.from >= 0 && m.to > m.from);
        const merged = chooseSentencePlan(src, units, [...initial.matches, ...additions2], !!shifted.limited, opts?.category);
        merged.ambiguous ||= shifted.ambiguous;
        if (merged.status === "full" || merged.limited || merged.ambiguous) return merged;
        const chars2 = merged.matches.reduce((sum, m) => sum + m.end - m.start, 0);
        if (chars2 > covered) {
          best = merged;
          covered = chars2;
        }
        continue;
      }
      if (shifted.status === "full") {
        shifted.zh = renderSentencePlan(shifted);
        return shifted;
      }
      if (shifted.limited || shifted.ambiguous) return shifted;
      const chars = shifted.matches.reduce((sum, m) => sum + m.end - m.start, 0);
      if (chars > covered) {
        best = shifted;
        covered = chars;
      }
    }
    return applyLineFallback(src, expanded, best, normal, opts);
  }
  const structure = scanStructuredText(src.replace(new RegExp(SENTENCE_TOKEN_SOURCE, "g"), " "), opts?.structure);
  const inferred = structure.units.length || structure.diagnostics.length ? [] : candidates(src, expanded, opts, true);
  if (inferred.limited) return { ...initial, limited: true };
  const additions = inferred.filter((m) => normal.every((hit) => m.end <= hit.start || m.start >= hit.end));
  const result = chooseSentencePlan(src, units, [...initial.matches, ...additions], false, opts?.category);
  result.ambiguous ||= initial.ambiguous;
  return applyLineFallback(src, expanded, result, normal, opts);
}
function remapSentenceMatches(matches, units, src, opts) {
  const bodies = sentenceQueryViews(src, opts).slice(1);
  return matches.map((m) => ({
    ...m,
    from: units.findIndex((u) => u.start === m.start || u.start === 0 && bodies.some((v) => m.start === v.offset)),
    to: units.findIndex((u) => u.end === m.end || u.end === src.length && bodies.some((v) => m.end === v.offset + v.text.length)) + 1
  }));
}
function applyLineFallback(src, records, plan, normal, opts) {
  if (plan.status === "full" || plan.limited) return plan;
  const lines = queryLines(src);
  if (!lines.length) return plan;
  const keys = new Set(lines.map((line) => wholeSentenceKey(line.text)));
  const independent = records.filter((r) => keys.has(logicAuthorityKey(r.src, recordUnitOpts(r))));
  if (!independent.length) return plan;
  const newlines = listNewlineSpans(src).map((br) => ({ ...br, kind: "hard" }));
  const lineOpts = { ...opts, newlines: [...opts?.newlines || [], ...newlines] };
  const units = sentenceQueryViewUnits(src, lineOpts);
  const previous = remapSentenceMatches(plan.matches, units, src, opts);
  if (previous.some((m) => m.from < 0 || m.to <= m.from)) return plan;
  const selected = candidates(src, independent, lineOpts);
  if (selected.limited) return { ...plan, limited: true };
  const additions = selected.filter(
    (m) => lines.some((line) => line.start === m.start && wholeSentenceKey(src.slice(m.start, m.end)) === wholeSentenceKey(line.text)) && normal.every((hit) => m.end <= hit.start || m.start >= hit.end) && plan.matches.every((hit) => m.end <= hit.start || m.start >= hit.end)
  );
  const result = chooseSentencePlan(src, units, [...previous, ...additions], false, opts?.category);
  result.ambiguous ||= plan.ambiguous;
  return result;
}
function chooseSentencePlan(src, units, possible, limited, category) {
  const locked = possible.filter((m) => m.alignment !== "inferred" && m.record.local && m.record.engine === "manual" && !m.record.derived);
  possible = possible.filter(
    (m) => locked.every((lock) => {
      if (m.end <= lock.start || m.start >= lock.end || m === lock) return true;
      return m.start === lock.start && m.end === lock.end && m.text === lock.text;
    })
  );
  let ambiguous = false;
  const ranges = /* @__PURE__ */ new Map();
  for (const m of possible) {
    const key2 = `${m.from}:${m.to}`;
    ranges.set(key2, [...ranges.get(key2) || [], m]);
  }
  possible = [];
  for (const group of ranges.values()) {
    const chosen = chooseAuthorityMatch(group, src, category);
    if (chosen.ambiguous) {
      ambiguous = true;
      continue;
    }
    possible.push(chosen.match);
  }
  const best = Array.from({ length: units.length + 1 }, () => ({ matches: [], covered: 0, chars: 0 }));
  for (let i2 = units.length - 1; i2 >= 0; i2--) {
    best[i2] = best[i2 + 1];
    for (const m of possible.filter((m2) => m2.from === i2)) {
      const rest = best[m.to];
      const next = { matches: [m, ...rest.matches], covered: m.to - m.from + rest.covered, chars: m.end - m.start + rest.chars };
      const old = best[i2];
      if (next.covered > old.covered || next.covered === old.covered && (next.chars > old.chars || next.chars === old.chars && next.matches.length < old.matches.length))
        best[i2] = next;
    }
  }
  const matches = best[0].matches;
  const gaps = [];
  let i = 0;
  while (i < units.length) {
    const hit = matches.find((m) => m.from === i);
    if (hit) {
      i = hit.to;
      continue;
    }
    const first = i++;
    while (i < units.length && units[i].block === units[first].block && !matches.some((m) => m.from === i)) i++;
    const start = units[first].start, end = units[i - 1].end;
    gaps.push({ id: `${start}:${end}`, start, end, text: src.slice(start, end) });
  }
  const status = matches.length ? gaps.length ? "partial" : "full" : "miss";
  const plan = { src, status, matches, gaps, zh: null, coverage: units.length ? best[0].covered / units.length : 0, ambiguous, limited };
  if (status === "full") plan.zh = renderSentencePlan(plan);
  return plan;
}
function chooseAuthorityMatch(group, src, category) {
  const output = (m) => joinSentenceBlock(src.slice(m.start, m.end), m.text, /[,，、;；]\s*$/.test(m.record.src.slice(m.sourceStart, m.sourceEnd)));
  const proven = group.filter((m) => m.alignment !== "inferred");
  let pool = proven.length ? proven : group;
  if (!proven.length && new Set(pool.map(output)).size > 1) return { ambiguous: true };
  const explicit = pool.filter((m) => !m.record.structuralAlias);
  if (explicit.length) pool = explicit;
  else {
    const context = Math.min(...pool.map((m) => m.record.structureContext || 0));
    pool = pool.filter((m) => (m.record.structureContext || 0) === context);
  }
  const rank = Math.max(...pool.map((m) => cacheEngineRank(m.record.engine)));
  pool = pool.filter((m) => cacheEngineRank(m.record.engine) === rank);
  const exact = pool.filter((m) => !m.record.derived && m.record.src === src && m.start === 0 && m.end === src.length);
  if (exact.length) pool = exact;
  const want = String(category || "").trim();
  if (want) {
    const matched = pool.filter((m) => m.record.category === want);
    if (matched.length) pool = matched;
  }
  if (new Set(pool.map(output)).size === 1) {
    const ordered = [...pool].sort(
      (a, b) => (a.record.local ? 0 : 1) - (b.record.local ? 0 : 1) || (a.kind === "extracted" ? 1 : 0) - (b.kind === "extracted" ? 1 : 0) || a.record.id.localeCompare(b.record.id)
    );
    return { match: ordered[0], ambiguous: false };
  }
  return { ambiguous: true };
}
function createSentenceResolver(records) {
  const inverted = /* @__PURE__ */ new Map();
  const whole = /* @__PURE__ */ new Map();
  const key2 = (s) => JSON.stringify([s.key, s.tone, s.controls]);
  const addWhole = (k, record) => {
    whole.set(k, [...whole.get(k) || [], record]);
  };
  for (const record of expandRecords(records)) {
    const unitOpts = recordUnitOpts(record);
    const raw = wholeSentenceKey(record.src);
    addWhole(raw, record);
    const logic = logicAuthorityKey(record.src, unitOpts);
    if (logic !== raw) addWhole(logic, record);
    for (const unit of sentenceUnits(record.src, unitOpts)) {
      const k = key2(unit), bucket = inverted.get(k) || /* @__PURE__ */ new Set();
      bucket.add(record);
      inverted.set(k, bucket);
    }
  }
  function select(src, opts) {
    const exact = whole.get(wholeSentenceKey(src)) || [];
    const selected = new Set(exact);
    let limited = false;
    for (const lookup of sentenceQueryKeys(src, opts)) {
      for (const record of whole.get(lookup) || []) {
        selected.add(record);
        if (selected.size > 500) return Object.assign([...exact], { limited: true });
      }
    }
    for (const unit of sentenceQueryUnits(src, opts)) {
      if (unit.boundary === "structure") for (const r of whole.get(wholeSentenceKey(src.slice(unit.start, unit.end))) || []) selected.add(r);
      if (selected.size > 500) return Object.assign([...exact], { limited: true });
      const bucket = inverted.get(key2(unit));
      if ((bucket?.size || 0) > 500) {
        limited = true;
        continue;
      }
      for (const record of bucket || []) {
        selected.add(record);
        if (selected.size > 500) return Object.assign([...exact], { limited: true });
      }
    }
    return Object.assign([...selected], { limited });
  }
  return {
    select,
    plan(src) {
      const selected = select(src);
      const plan = planSentenceTranslation(src, selected.limited ? [] : selected);
      return selected.limited ? { ...plan, limited: true } : plan;
    }
  };
}

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
var CONTROL_AFFIX = /^(?:\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\])/;
function matchControlAffixAt(text, atEnd) {
  if (!atEnd) {
    const m = text.match(CONTROL_AFFIX);
    return m && !/^\\RB\[/i.test(m[0]) && !isSemanticPlaceholder(m[0]) ? m[0] : null;
  }
  const re = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\]/g;
  let hit = null;
  for (const m of text.matchAll(re)) {
    if (/^\\RB\[/i.test(m[0])) continue;
    if (isSemanticPlaceholder(m[0])) continue;
    const i = m.index ?? 0;
    if (i + m[0].length === text.length) hit = m[0];
  }
  return hit;
}
function peelControlShell(text) {
  let rest = String(text ?? "");
  let lead = "";
  let trail = "";
  for (; ; ) {
    const space = rest.match(/^[\s\u3000]+/);
    if (space) {
      lead += space[0];
      rest = rest.slice(space[0].length);
      continue;
    }
    const tok = matchControlAffixAt(rest, false);
    if (!tok) break;
    lead += tok;
    rest = rest.slice(tok.length);
  }
  for (; ; ) {
    const space = rest.match(/[\s\u3000]+$/);
    if (space) {
      trail = space[0] + trail;
      rest = rest.slice(0, -space[0].length);
      continue;
    }
    const tok = matchControlAffixAt(rest, true);
    if (!tok) break;
    trail = tok + trail;
    rest = rest.slice(0, -tok.length);
  }
  return { lead, core: rest, trail };
}
function stripControlNoise(text) {
  return String(text ?? "").replace(PROTECT_TOKEN, " ").replace(/[\s\u3000]+/g, " ").trim();
}
function protectSentenceForTranslate(text) {
  const choice = peelChoiceMetaShell(text);
  const shell = peelControlShell(choice.core);
  const tokens = [];
  const plain = shell.core.replace(new RegExp(`${SENTENCE_TOKEN_SOURCE}|${PROTECT_TOKEN.source}`, "g"), (token) => {
    const id = tokens.length;
    tokens.push(token);
    return `__C${id}__`;
  });
  return { core: shell.core, lead: choice.lead + shell.lead, trail: shell.trail + choice.trail, plain, tokens };
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
  if (!JAPANESE.test(core) && !isSourceText(core, sourceLang === "en" ? "en" : "all")) return false;
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
import fs6 from "node:fs";
var snapshots = /* @__PURE__ */ new Map();
function gameTranslationFiles(contentRoot, opts) {
  const seed = opts?.localOnly ? localGameContentFile(contentRoot, "seed") : gameContentReadPath(contentRoot, "seed", { alsoParent: true });
  const cache = opts?.localOnly ? localGameContentFile(contentRoot, "cacheNdjson") : gameContentReadPath(contentRoot, "cacheNdjson", { alsoParent: true });
  const stamp = JSON.stringify(
    [seed, cache, opts?.localOnly ? 1 : 0].map((file) => {
      if (typeof file === "number") return file;
      const stat = file ? fs6.statSync(file, { throwIfNoEntry: false }) : void 0;
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size];
    })
  );
  return { seed, cache, stamp };
}
function loadGameTranslationRecords(contentRoot, current, opts) {
  const { seed, cache, stamp } = gameTranslationFiles(contentRoot, opts);
  let snapshot = snapshots.get(contentRoot);
  if (snapshot?.stamp !== stamp) {
    const rows = /* @__PURE__ */ new Map();
    if (seed) {
      let data;
      try {
        data = JSON.parse(fs6.readFileSync(seed, "utf8"));
      } catch {
        data = null;
      }
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [s, t] of Object.entries(data)) if (typeof t === "string" && t) rows.set(s, { s, t, engine: "seed" });
      }
    }
    if (cache)
      for (const line of fs6.readFileSync(cache, "utf8").split("\n")) {
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

// services/translate/game-cache-context.ts
var contexts = /* @__PURE__ */ new Map();
function buildContext(contentRoot) {
  const records = loadGameTranslationRecords(contentRoot, () => false);
  const blocked = /* @__PURE__ */ new Set();
  const file = gameTranslationFiles(contentRoot).cache;
  if (file && fs7.existsSync(file))
    for (const line of fs7.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = parseCacheRow(JSON.parse(line));
      if (!row?.origin) {
        if (row?.t === null) blocked.add(row.s);
        else if (row) blocked.delete(row.s);
      }
    }
  const numeric = /* @__PURE__ */ new Map();
  for (const record of records) {
    const family = numericLabelFamily(record.src);
    if (family) numeric.set(family, [...numeric.get(family) || [], record]);
  }
  const { seed } = gameTranslationFiles(contentRoot);
  const authorityVersion = createHash("sha256").update(JSON.stringify([seed, records.filter((record) => record.local), [...blocked].sort()])).digest("hex");
  return {
    records,
    blocked: (src) => blocked.has(src),
    resolver: createSentenceResolver(records),
    lookup: createGameTranslateLookup(records),
    numericRecords: (src) => numeric.get(numericLabelFamily(src) || "") || [],
    authorityVersion
  };
}
function getGameCacheContext(contentRoot) {
  const { stamp } = gameTranslationFiles(contentRoot);
  let context = contexts.get(contentRoot);
  if (context?.stamp !== stamp) {
    context = { ...buildContext(contentRoot), stamp };
    if (contexts.size >= 8 && !contexts.has(contentRoot)) contexts.delete(contexts.keys().next().value);
    contexts.set(contentRoot, context);
  }
  return context;
}

// services/translate/game-coverage.ts
import fs8 from "node:fs";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// services/translate/cache-lookup.ts
function lookupCandidates(src) {
  const choice = peelChoiceMetaShell(src);
  const key2 = choice.core || src;
  const guard = protectSentenceForTranslate(src);
  const display = translationExportText(key2);
  const shell = sentenceOuterShell(key2);
  const displayShell = translationSegmentContent(key2);
  const leadSpace = key2.match(/^\s*/)?.[0] ?? "";
  const trailSpace = key2.match(/\s*$/)?.[0] ?? "";
  const trimmed = key2.slice(leadSpace.length, key2.length - trailSpace.length);
  const description = key2.match(/^<SG説明:/);
  return [
    { key: key2, lead: choice.lead, trail: choice.trail },
    { key: normalizeTranslateKey(key2), lead: choice.lead, trail: choice.trail },
    ...trimmed && trimmed !== key2 ? [{ key: trimmed, lead: choice.lead + leadSpace, trail: trailSpace + choice.trail }] : [],
    ...description ? [{ key: key2.slice(description[0].length), lead: choice.lead + description[0], trail: choice.trail }] : [],
    ...display === key2 ? [] : [display, normalizeTranslateKey(display)].map((candidate) => ({
      key: candidate,
      lead: choice.lead + displayShell.lead,
      trail: displayShell.trail + choice.trail,
      displayOnly: true
    })),
    ...shell.core !== key2 && !/[!?！？]/.test(shell.trail) ? [{ key: shell.core, lead: choice.lead + shell.lead, trail: shell.trail + choice.trail, bodyOnly: true }] : [],
    { key: guard.core, lead: guard.lead, trail: guard.trail },
    { key: normalizeTranslateKey(guard.core), lead: guard.lead, trail: guard.trail }
  ];
}
function lookupWholeTranslation(get, src) {
  for (const { key: key2, lead, trail, bodyOnly, displayOnly } of lookupCandidates(src)) {
    if (!key2) continue;
    const hit = lookupWithRmDigitTemplate((k) => {
      const value = get(k);
      return value && isReusableTranslation(k, value) ? value : null;
    }, key2);
    if (hit != null) {
      const restored = lead + (displayOnly ? translationSegmentContent(hit).core : bodyOnly ? sentenceOuterShell(hit).core : hit) + trail;
      if (isReusableTranslation(src, restored)) return restored;
    }
  }
  return null;
}
function lookupCachedTranslation(get, src) {
  const whole = lookupWholeTranslation(get, src);
  if (whole != null) return whole;
  if (/\\(?:RB\[|ruby\[)/i.test(src)) return lookupDisplayParts(get, src) ?? mapTranslationRubySegments(src, (part) => lookupCachedTranslation(get, part));
  return lookupDisplayParts(get, src) ?? mapTranslationRubySegments(src, (part) => lookupCachedTranslation(get, part)) ?? lookupParts(get, src, mapTranslationSegments) ?? lookupParts(get, src, mapTranslationCacheLines);
}
function lookupDisplayParts(get, src) {
  let complete = true;
  let resolved = false;
  const result = mapTranslationDisplaySegments(src, (part) => {
    const hit = lookupCachedTranslation(get, part);
    if (hit != null) {
      resolved = true;
      return hit;
    }
    if (/\\(?:RB\[|ruby\[)/i.test(part) || /[\p{L}]/u.test(translationSegmentContent(part).core)) complete = false;
    return part;
  });
  return complete && resolved ? result : null;
}
function lookupParts(get, src, map) {
  let complete = true;
  let changed = false;
  const result = map(src, (part, original) => {
    const legacy = lookupWholeTranslation(get, original);
    const semantic = /[!?！？。．.]/.test(translationSegmentContent(original).trail);
    const hit = (semantic ? null : lookupWholeTranslation(get, part)) ?? (legacy == null ? null : translationSegmentContent(legacy).core);
    if (hit != null) {
      changed = true;
      return hit;
    }
    if (shouldTranslate(part)) complete = false;
    return part;
  });
  return complete && changed ? result : null;
}

// services/translate/shared-cache/match-index.ts
var toRecord = (r) => ({
  id: String(r.id),
  revision: r.revision,
  src: r.src,
  zh: r.zh,
  engine: r.engine,
  category: r.category || null,
  from: r.src_lang,
  to: r.tgt_lang
});
function createMatchIndex(client) {
  const statements = /* @__PURE__ */ new Map();
  function prepare(sql) {
    let statement = statements.get(sql);
    if (!statement) {
      statement = client.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  }
  const joined = "SELECT DISTINCT r.*,t.zh,t.engine,t.category FROM translation_records r JOIN translations t ON t.src=r.src AND t.src_lang=r.src_lang AND t.tgt_lang=r.tgt_lang";
  function reindexWithNewlines(row, newlines, structure) {
    const unitOpts = { newlines, structure: structure?.source, srcLang: row.src_lang };
    prepare("DELETE FROM sentence_positions WHERE record_id=?").run(row.id);
    prepare("DELETE FROM match_keys WHERE record_id=? AND kind IN ('alias','logic')").run(row.id);
    const logicKey = wholeSentenceKey(buildLogicText(row.src, unitOpts).logic);
    const canon = wholeSentenceKey(row.src);
    if (logicKey !== canon) {
      prepare("INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)").run(row.id, logicKey, row.src_lang, row.tgt_lang, "logic");
    }
    for (const alias of sentenceAliases(row.src, row.zh)) {
      prepare("INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)").run(row.id, wholeSentenceKey(alias.src), row.src_lang, row.tgt_lang, "alias");
    }
    const units = sentenceUnits(row.src, unitOpts);
    const insertPos = prepare("INSERT INTO sentence_positions VALUES (?,?,?,?,?,?)");
    units.forEach((unit, position) => insertPos.run(row.id, position, unit.key, unit.tone, row.src_lang, row.tgt_lang));
  }
  function attach(row) {
    const record2 = toRecord(row);
    const alignment = prepare("SELECT groups_json FROM alignment_groups WHERE record_id=? AND revision=?").get(row.id, row.revision);
    if (alignment) record2.alignments = JSON.parse(alignment.groups_json);
    const newlines = prepare("SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?").get(row.id, row.revision);
    if (newlines) record2.newlines = JSON.parse(newlines.annotations_json);
    const structure = prepare("SELECT annotations_json FROM structure_annotations WHERE record_id=? AND revision=?").get(row.id, row.revision);
    if (structure) record2.structure = JSON.parse(structure.annotations_json);
    return record2;
  }
  function record(src, pair) {
    const r = prepare(joined + " WHERE r.src=? AND r.src_lang=? AND r.tgt_lang=?").get(src, pair.from, pair.to);
    return r ? attach(r) : null;
  }
  function equivalent(src, pair) {
    const key2 = wholeSentenceKey(src);
    return client.prepare(joined + " JOIN match_keys k ON k.record_id=r.id WHERE k.match_key=? AND k.src_lang=? AND k.tgt_lang=? AND k.kind='canonical' LIMIT 501").all(key2, pair.from, pair.to).map(attach);
  }
  function candidates2(src, pair, opts) {
    const found = /* @__PURE__ */ new Map();
    const keyQuery = prepare(joined + " JOIN match_keys k ON k.record_id=r.id WHERE k.match_key=? AND k.src_lang=? AND k.tgt_lang=? LIMIT 501");
    const lookupKeys = sentenceQueryKeys(src, opts);
    for (const key2 of lookupKeys) {
      for (const row of keyQuery.all(key2, pair.from, pair.to)) {
        if (!found.has(String(row.id))) found.set(String(row.id), attach(row));
        if (found.size > 500) return { records: [], limited: true };
      }
    }
    const whole = [...found.values()];
    for (const unit of sentenceQueryUnits(src, opts)) {
      if (unit.boundary === "structure") {
        const exactItems = keyQuery.all(wholeSentenceKey(src.slice(unit.start, unit.end)), pair.from, pair.to);
        if (exactItems.length > 500) return { records: whole.length > 500 ? [] : whole, limited: true };
        for (const row of exactItems) {
          if (!found.has(String(row.id))) found.set(String(row.id), attach(row));
          if (found.size > 500) return { records: [], limited: true };
        }
      }
      const rows = client.prepare(joined + " JOIN sentence_positions p ON p.record_id=r.id WHERE p.body_key=? AND p.tone=? AND p.src_lang=? AND p.tgt_lang=? LIMIT 501").all(unit.key, unit.tone, pair.from, pair.to);
      if (new Set(rows.map((r) => r.id)).size > 500 || found.size > 500) return { records: whole.length > 500 ? [] : whole, limited: true };
      for (const row of rows) {
        if (!found.has(String(row.id))) found.set(String(row.id), attach(row));
        if (found.size > 500) return { records: [], limited: true };
      }
    }
    return found.size > 500 ? { records: [], limited: true } : { records: [...found.values()], limited: false };
  }
  return {
    record,
    equivalent,
    candidates: candidates2,
    numericRecords(pair, src) {
      const family = numericLabelFamily(src);
      const rows = family ? prepare(joined + " JOIN numeric_label_keys n ON n.record_id=r.id WHERE n.src_lang=? AND n.tgt_lang=? AND n.family=? LIMIT 501").all(
        pair.from,
        pair.to,
        family
      ) : [];
      return Object.assign(rows.map(attach), { limited: rows.length > 500 });
    },
    version: () => String(prepare("SELECT value FROM cache_meta WHERE key='sentence_version'").get().value),
    current(records) {
      return records.every((r) => Number(prepare("SELECT revision FROM translation_records WHERE id=?").get(r.id)?.revision) === r.revision);
    },
    plan(src, pair, local = [], opts) {
      client.exec("BEGIN");
      try {
        const selected = candidates2(src, pair, opts);
        const limited = selected.limited || local.limited === true;
        const resolved = planSentenceTranslation(src, limited ? [] : [...local, ...selected.records].filter((r) => pair.to !== "zh" || isReusableTranslation(r.src, r.zh)), opts);
        const plan = {
          ...resolved,
          limited: limited || resolved.limited,
          ruleVersion: SENTENCE_RULE_VERSION,
          corpusVersion: String(prepare("SELECT value FROM cache_meta WHERE key='sentence_version'").get().value)
        };
        client.exec("COMMIT");
        return plan;
      } catch (e) {
        client.exec("ROLLBACK");
        throw e;
      }
    },
    setAlignment(src, pair, groups, expectedRevision, opts) {
      const r = record(src, pair);
      if (!r || expectedRevision !== void 0 && r.revision !== expectedRevision || groups.length > 1e3) return false;
      const structure = opts?.structure ?? r.structure;
      if (structure && !validRecordStructure(structure)) return false;
      const nextNewlines = opts?.newlines !== void 0 ? opts.newlines : r.newlines;
      if (nextNewlines && !validateNewlineAnnotations(src, nextNewlines)) return false;
      const draft = { ...r, newlines: nextNewlines, structure };
      if (!validateAlignments(draft, groups)) return false;
      client.exec("BEGIN IMMEDIATE");
      try {
        if (!prepare("UPDATE translation_records SET revision=revision+1 WHERE id=? AND revision=?").run(r.id, r.revision).changes) {
          client.exec("ROLLBACK");
          return false;
        }
        const nextRevision = r.revision + 1;
        prepare("INSERT OR REPLACE INTO alignment_groups VALUES(?,?,?)").run(r.id, nextRevision, JSON.stringify(groups));
        if (nextNewlines?.length) {
          prepare("INSERT OR REPLACE INTO newline_annotations VALUES(?,?,?)").run(r.id, nextRevision, JSON.stringify(nextNewlines));
        }
        const row = prepare(joined + " WHERE r.id=?").get(r.id);
        if (structure) prepare("INSERT OR REPLACE INTO structure_annotations VALUES(?,?,?)").run(r.id, nextRevision, JSON.stringify(structure));
        reindexWithNewlines(row, nextNewlines, structure);
        client.exec("COMMIT");
        return true;
      } catch (e) {
        client.exec("ROLLBACK");
        throw e;
      }
    },
    authority(src, pair, opts) {
      const records = equivalent(src, pair);
      if (!records.length || records.length > 500) return null;
      const rank = Math.max(...records.map((r) => cacheEngineRank(r.engine)));
      let top = records.filter((r) => cacheEngineRank(r.engine) === rank);
      const want = String(opts?.category || "").trim();
      if (want) {
        const matched = top.filter((r) => r.category === want);
        if (matched.length) top = matched;
      }
      if (new Set(top.map((r) => r.zh)).size !== 1) return top.find((r) => r.src === src) || null;
      return top[0];
    }
  };
}

// services/translate/game-coverage.ts
function createGameCoverage(records, opts) {
  const lookup = createGameTranslateLookup(records);
  const resolver = createSentenceResolver(records);
  const numeric = createNumericLabelIndex(records);
  let client;
  let shared;
  let opened = false;
  const resolved = /* @__PURE__ */ new Map();
  return {
    resolve(src) {
      if (resolved.has(src)) return resolved.get(src);
      if (opts?.blocked?.(src)) return null;
      let hit = lookup[src] ?? numeric.resolve(src);
      if (hit == null) {
        if (!opened) {
          opened = true;
          const database = opts?.database ?? TRANSLATE_CACHE_DB_PATH;
          if (database && fs8.existsSync(database)) {
            client = new DatabaseSync2(database, { readOnly: true });
            client.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=250");
            if (client.prepare("SELECT 1 FROM sqlite_master WHERE name='match_keys'").get()) shared = createMatchIndex(client);
          }
        }
        const pair = { from: detectCacheLang(src), to: "zh" };
        const plan = shared ? shared.plan(src, pair, resolver.select(src)) : resolver.plan(src);
        if (!plan.limited) {
          hit = plan.status === "full" ? plan.zh : null;
          if (hit == null && shared && numericLabelFamily(src)) {
            const rows = shared.numericRecords(pair, src);
            if (!rows.limited) hit = createNumericLabelIndex([...rows, ...records]).resolve(src);
          }
          if (hit == null && /\\(?:C\[|FS\[|RB\[|ruby\[)/i.test(src)) {
            hit = lookupCachedTranslation((key2) => lookup[key2] ?? shared?.record(key2, pair)?.zh, src);
          }
        }
      }
      resolved.set(src, hit ?? null);
      return hit ?? null;
    },
    close() {
      client?.close();
    }
  };
}

// services/translate/seed-failures.ts
import fs10 from "node:fs";

// services/translate/seed-job-state.ts
import { createHash as createHash2 } from "node:crypto";
import fs9 from "node:fs";
import path6 from "node:path";
var MAX_SEED_JOB_LOGS = 120;
function idleSeedJob(contentRoot = "") {
  return {
    contentRoot,
    status: "idle",
    startedAt: null,
    updatedAt: Date.now(),
    sessionDone: 0,
    rounds: 0,
    performance: null,
    liveStatus: "",
    error: null,
    engines: [],
    logs: [],
    failedSources: [],
    inventoryPreparing: false
  };
}
function seedJobKey(contentRoot) {
  return createHash2("sha1").update(path6.resolve(contentRoot)).digest("hex").slice(0, 16);
}
function seedJobFile(contentRoot) {
  return path6.join(TRANSLATE_JOBS_DIR, `${seedJobKey(contentRoot)}.json`);
}
function readSeedJobState(contentRoot) {
  const file = seedJobFile(contentRoot);
  if (!fs9.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs9.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return {
      ...idleSeedJob(contentRoot),
      ...raw,
      contentRoot,
      failedSources: Array.isArray(raw.failedSources) ? raw.failedSources.filter((s) => typeof s === "string") : [],
      logs: Array.isArray(raw.logs) ? raw.logs.slice(-MAX_SEED_JOB_LOGS) : []
    };
  } catch {
    return null;
  }
}

// services/translate/seed-failures.ts
function seedFailureFile(contentRoot) {
  return seedJobFile(contentRoot).replace(/\.json$/, ".failures.ndjson");
}
function readSeedFailures(contentRoot) {
  const failures = new Map((readSeedJobState(contentRoot)?.failedSources ?? []).map((src) => [src, ""]));
  const file = seedFailureFile(contentRoot);
  let text;
  try {
    text = fs10.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return failures;
    throw error;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.error === null) failures.delete(event.src);
      else failures.set(event.src, event.error);
    } catch {
    }
  }
  return failures;
}

// services/extract/lib/data-fields.ts
var TEXT_FIELD = /^(?:name|displayName|nickname|description|profile|message\d*|text|label|title|help|caption|summary|dialogue|.*[ _-](?:text|message|label|title|description|name|help))$/i;
var TECH_FIELD = /^(?:.*(?:path|url|script|formula|texture)|file(?:name)?|code|eval|callback|handler|condition|expression|Battle Show List|mode|blendMode|spawnType|(?:character|battler|face|picture|animation\d*|battleback\d*|title\d*|parallax)Name|tilesetNames|bgm|bgs|se|me|audio|image|sound|parameters|params|meta|frames|data|flags|traits|effects|damage|timings)$/i;
var isTextField = (field) => TEXT_FIELD.test(field);
var isTechnicalField = (field) => TECH_FIELD.test(field);

// services/extract/lib/rgss/script-strings.ts
var ASSIGN_RE = /^\s*(?:[A-Z][\w:]*::)*[A-Z]\w*\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/;
var RETURN_RE = /^\s*return\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
var DRAW_RE = /\bdraw_text(?:_ex)?\s*\([^)]*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/;
var PATHISH = /[\\/]|\.(?:rvdata2?|png|jpe?g|ogg|mp3|wav|bmp|json|txt|rb)\b|Graphics\/|Audio\/|Data\//i;
var CODEISH = /&&|\|\||==|!=|\.(?:call|new|size|empty\?)\b|^\s*[\[{]|window\.|SceneManager|DataManager/;
function unescapeRubyLiteral(raw) {
  return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}
function consider(raw, script, found) {
  if (!raw) return;
  const text = unescapeRubyLiteral(raw).trim();
  if (!text || text.length < 2 || text.length > 200) return;
  if (PATHISH.test(text) || CODEISH.test(text)) return;
  if (!isSourceText(text)) return;
  if (!found.has(text)) found.set(text, script);
}
function extractRgssScriptUiStrings(contentRoot) {
  const found = /* @__PURE__ */ new Map();
  for (const script of readRgssScripts(contentRoot)) {
    const name = script.name || "Scripts";
    for (const line of script.source.split(/\r?\n/)) {
      if (line.length > 400) continue;
      consider(ASSIGN_RE.exec(line)?.[1], name, found);
      consider(RETURN_RE.exec(line)?.[1], name, found);
      consider(DRAW_RE.exec(line)?.[1], name, found);
    }
  }
  return [...found].map(([src, script]) => ({ src, script }));
}

// services/extract/lib/rgss/writeback.ts
import fs11 from "node:fs";
import path7 from "node:path";

// lib/translate/name-glossary.ts
var TOKEN_RE2 = new RegExp(SENTENCE_TOKEN_SOURCE, "g");

// services/extract/lib/rgss/writeback.ts
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
  if (className === "RPG::Actor" && (field === "profile" || field === "description")) return "actor_profile";
  const category = base[className] ?? fallback;
  if (field === "description" && (category === "item" || category === "weapon" || category === "armor" || category === "skill")) return `${category}_desc`;
  if (category === "state" && /^message/.test(field)) return "state_msg";
  return category;
}
function loadOneDataFile(dataDir, name) {
  const file = path7.join(dataDir, name);
  const value = parseRubyMarshal(fs11.readFileSync(file));
  const backup = `${file}.chaya.bak`;
  const original = fs11.existsSync(backup) ? parseRubyMarshal(fs11.readFileSync(backup)) : value;
  const current = strings(value);
  const texts = [];
  for (const [location, source] of strings(original)) {
    if (!isSourceText(source.value.value)) continue;
    const target2 = current.get(location);
    if (!target2) throw new Error(`RGSS data structure changed since backup: ${name}${location}`);
    texts.push({ source: source.value.value.trim(), current: target2, file: name, location });
  }
  return { file, value, texts };
}
var SKIP_DATA_STEMS = /^(?:FileSystem|Animations|Tilesets)(?:\.|$)/i;
function listDataFileNames(dataDir) {
  const names = fs11.readdirSync(dataDir).filter((name) => /\.rvdata2?$/i.test(name) && !SKIP_DATA_STEMS.test(name)).sort();
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
import fs12 from "node:fs";
import path8 from "node:path";
function rgssDataSignature(dataDir) {
  const files = fs12.readdirSync(dataDir).filter((name) => /\.rvdata2?(?:\.chaya\.bak)?$/i.test(name)).sort();
  return JSON.stringify(
    files.map((name) => {
      const stat = fs12.statSync(path8.join(dataDir, name));
      return [name, stat.size, stat.mtimeMs, stat.ctimeMs];
    })
  );
}
function readIndex(contentRoot) {
  const file = localGameContentFile(contentRoot, "rgssSourcesIndex");
  if (!file) return null;
  try {
    const raw = JSON.parse(fs12.readFileSync(file, "utf8"));
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
  fs12.writeFileSync(file, `${JSON.stringify(payload)}
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
    const hit = fs13.readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return hit ? path9.join(dir, hit) : null;
  } catch {
    return null;
  }
}
function extensionFor(dataDir) {
  try {
    const names = fs13.readdirSync(dataDir).map((name) => name.toLowerCase());
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
  const scripts = new Set(extractRgssScriptUiStrings(contentRoot).map((item) => item.src));
  return keys.filter((key2) => entry.sources.has(key2) || scripts.has(key2));
}

// services/translate/scheduler/seed-inventory.ts
function seedFileStamp(contentRoot) {
  const file = localGameContentFile(contentRoot, "seed");
  const stat = file ? fs14.statSync(file, { throwIfNoEntry: false }) : void 0;
  return JSON.stringify([file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size]);
}
function readSeedInventory(contentRoot) {
  const stamp = seedFileStamp(contentRoot);
  const progressStamp = seedProgressStamp(contentRoot);
  const file = localGameContentFile(contentRoot, "seed");
  const data = file ? JSON.parse(fs14.readFileSync(file, "utf8")) : {};
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
    records = loadGameTranslationRecords(
      contentRoot,
      (origin) => {
        if (unavailable || !TRANSLATE_CACHE_DB_PATH || origin.database !== TRANSLATE_CACHE_DB_PATH) return false;
        const key2 = `${origin.id}:${origin.revision}`;
        if (!revisions.has(key2)) {
          try {
            if (!client) {
              if (!fs14.existsSync(TRANSLATE_CACHE_DB_PATH)) return false;
              client = new DatabaseSync3(TRANSLATE_CACHE_DB_PATH, { readOnly: true });
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
      },
      { localOnly: true }
    );
  } finally {
    client?.close();
  }
  const coverage = createGameCoverage(records, { blocked: getGameCacheContext(contentRoot).blocked });
  const pending = [];
  const failures = readSeedFailures(contentRoot);
  try {
    for (const key2 of keys) {
      const chars = charCount(key2);
      progress.lines += lineCount(key2);
      if (!shouldTranslate(key2)) {
        progress.skipCount++;
        progress.skipChars += chars;
      } else {
        progress.needCount++;
        progress.needChars += chars;
        if (coverage.resolve(key2) != null) {
          progress.done++;
          progress.doneChars += chars;
        } else if (failures.has(key2)) {
          progress.failedCount = (progress.failedCount ?? 0) + 1;
          progress.failedChars = (progress.failedChars ?? 0) + chars;
        } else {
          progress.missing++;
          progress.missingChars += chars;
          pending.push(key2);
        }
      }
    }
  } finally {
    coverage.close();
  }
  progress.batchesLeft = Math.ceil(progress.missing / 40);
  return { progress, pending, stamp, progressStamp };
}
function seedProgressStamp(contentRoot) {
  const files = [localGameContentFile(contentRoot, "seed"), localGameContentFile(contentRoot, "cacheNdjson"), seedFailureFile(contentRoot)];
  return JSON.stringify([
    6,
    files.map((file) => {
      const stat = file ? fs14.statSync(file, { throwIfNoEntry: false }) : void 0;
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size];
    })
  ]);
}

// services/translate/scheduler/seed-inventory-worker.ts
try {
  const contentRoot = String(workerData?.contentRoot || "");
  if (!contentRoot) throw new Error("seed-inventory-worker: missing contentRoot");
  const inv = readSeedInventory(contentRoot);
  const out = path10.join(os2.tmpdir(), `chaya-seed-inv-${process.pid}-${Date.now()}.json`);
  fs15.writeFileSync(out, JSON.stringify(inv));
  parentPort?.postMessage({ ok: true, path: out, pending: inv.pending.length, total: inv.progress.total });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
