import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'

/**
 * Fixed per-CLI home directories owned by Chaya. CLIs never see the player's global rules, skills, MCP servers or
 * plugins (`~/.cursor`, `~/.codex`, `~/.agents`, `~/.claude`, …); whatever the game agent should know comes from Chaya.
 */
export const GAME_AGENT_CLI_HOME_DIR = path.join(DATA_DIR, 'game-agent', 'cli-home')

/** Cursor's built-in file / shell / web / MCP tools are denied outright; the game agent only gets Chaya's tools. */
const CURSOR_DENIED_TOOLS = ['Shell(*)', 'Read(**)', 'Write(**)', 'WebFetch(*)', 'Mcp(*:*)']

/** Transcripts the CLI keeps of game conversations; cleared once per Chaya process. */
const CURSOR_TRANSCRIPT_DIRS = ['acp-sessions', 'chats', 'projects']

const cleaned = new Set<string>()

export function cliHomeDir(name: 'cursor' | 'codex', root = GAME_AGENT_CLI_HOME_DIR) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function link(target: string, at: string) {
  if (!fs.existsSync(target) || fs.lstatSync(at, { throwIfNoEntry: false })) return
  fs.mkdirSync(path.dirname(at), { recursive: true, mode: 0o700 })
  fs.symlinkSync(target, at)
}

function readJson(file: string): Record<string, unknown> {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function prepareCursorDir(cursorDir: string) {
  fs.mkdirSync(cursorDir, { recursive: true, mode: 0o700 })
  if (!cleaned.has(cursorDir)) {
    cleaned.add(cursorDir)
    for (const name of CURSOR_TRANSCRIPT_DIRS) fs.rmSync(path.join(cursorDir, name), { recursive: true, force: true })
  }
  // The CLI installs its own skill pack here on start; a read-only file in its place keeps the pack out.
  const skills = path.join(cursorDir, 'skills-cursor')
  if (fs.existsSync(skills) && fs.statSync(skills).isDirectory()) fs.rmSync(skills, { recursive: true, force: true })
  if (!fs.existsSync(skills)) fs.writeFileSync(skills, '', { mode: 0o444 })
  const configFile = path.join(cursorDir, 'cli-config.json')
  const config = readJson(configFile)
  fs.writeFileSync(configFile, `${JSON.stringify({ version: 1, ...config, permissions: { allow: [], deny: CURSOR_DENIED_TOOLS } }, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Env for Cursor runs: HOME is Chaya's fixed Cursor directory, holding only links to the local login. Nothing is
 * copied; macOS keeps the token in the login keychain, Linux / Windows in Cursor's `auth.json`.
 */
export function cursorIsolatedHome(root = GAME_AGENT_CLI_HOME_DIR, realHome = os.homedir(), env: Record<string, string | undefined> = process.env, platform = process.platform) {
  const home = cliHomeDir('cursor', root)
  prepareCursorDir(path.join(home, '.cursor'))
  const extra: Record<string, string> = { HOME: home, USERPROFILE: home }
  if (platform === 'darwin') {
    link(path.join(realHome, 'Library', 'Keychains'), path.join(home, 'Library', 'Keychains'))
    link(path.join(realHome, '.cursor', 'auth.json'), path.join(home, '.cursor', 'auth.json'))
  } else if (platform !== 'win32') {
    const config = path.join(home, '.config')
    link(path.join(env.XDG_CONFIG_HOME || path.join(realHome, '.config'), 'cursor', 'auth.json'), path.join(config, 'cursor', 'auth.json'))
    extra.XDG_CONFIG_HOME = config
  }
  return extra
}
