#!/usr/bin/env node

/**
 * Automated missing import resolver using TypeScript Language Service code fixes.
 * Detects TS2304 / TS2552 ("Cannot find name") diagnostics in modified or specified
 * files and automatically inserts unambiguous imports.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

const rootDir = process.cwd()

function resolveTargetFiles() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  if (args.length > 0) {
    return args.map((f) => path.resolve(f)).filter((f) => fs.existsSync(f) && /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'))
  }

  // Auto-detect git modified, staged, or untracked TypeScript files
  const files = new Set()
  try {
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' })
    for (const line of gitStatus.split('\n')) {
      const match = line.match(/^[\sMADRCU?]{1,2}\s+(.+)$/)
      if (!match) continue
      const rel = match[1].trim().replace(/^".*"$/, (m) => m.slice(1, -1))
      const full = path.resolve(rel)
      if (fs.existsSync(full) && /\.(ts|tsx)$/.test(full) && !full.endsWith('.d.ts')) {
        files.add(full)
      }
    }
  } catch {
    /* Ignore git failure */
  }
  return [...files]
}

function getTsconfigPath(filePath) {
  if (filePath.includes(path.sep + 'plugins' + path.sep + 'mv' + path.sep)) {
    return path.resolve('plugins/mv/tsconfig.json')
  }
  if (filePath.includes(path.sep + 'plugins' + path.sep + 'rgss' + path.sep)) {
    return path.resolve('plugins/rgss/tsconfig.json')
  }
  return path.resolve('tsconfig.json')
}

class ProjectService {
  constructor(tsconfigPath) {
    this.tsconfigPath = tsconfigPath
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
    this.parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath))
    this.fileVersions = new Map()
    this.inMemoryContent = new Map()

    this.host = {
      getScriptFileNames: () => {
        const set = new Set([...this.parsed.fileNames, ...this.inMemoryContent.keys()])
        return [...set]
      },
      getScriptVersion: (f) => this.fileVersions.get(f) || '1',
      getScriptSnapshot: (f) => {
        if (this.inMemoryContent.has(f)) {
          return ts.ScriptSnapshot.fromString(this.inMemoryContent.get(f))
        }
        if (!ts.sys.fileExists(f)) return undefined
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(f) || '')
      },
      getCurrentDirectory: () => rootDir,
      getCompilationSettings: () => this.parsed.options,
      getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
      fileExists: (f) => this.inMemoryContent.has(f) || ts.sys.fileExists(f),
      readFile: (f) => (this.inMemoryContent.has(f) ? this.inMemoryContent.get(f) : ts.sys.readFile(f)),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    }

    this.languageService = ts.createLanguageService(this.host)
  }

  setFileContent(filePath, content) {
    const version = String(Number(this.fileVersions.get(filePath) || '0') + 1)
    this.fileVersions.set(filePath, version)
    this.inMemoryContent.set(filePath, content)
  }

  getFileContent(filePath) {
    if (this.inMemoryContent.has(filePath)) {
      return this.inMemoryContent.get(filePath)
    }
    return fs.readFileSync(filePath, 'utf8')
  }
}

function selectBestFix(fixes) {
  const importFixes = fixes.filter((f) => f.fixName === 'import')
  if (!importFixes.length) return null

  // 1. Highest priority: update an existing import from the same module
  const updateFix = importFixes.find((f) => f.description.startsWith('Update import from'))
  if (updateFix) return updateFix

  // 2. Parse candidate module specifiers from fix description
  const parsed = importFixes.map((f) => {
    const match = f.description.match(/from\s+["']([^"']+)["']/)
    return { fix: f, specifier: match ? match[1] : '' }
  })

  // 3. Priority for Chaya design system: prefer "@/components/sk"
  const skFix = parsed.find((p) => p.specifier === '@/components/sk' || p.specifier.startsWith('@/components/sk/'))
  if (skFix) return skFix.fix

  // 4. Prefer project alias (@/...) over relative (./...)
  const aliasCandidates = parsed.filter((p) => p.specifier.startsWith('@/'))
  const candidates = aliasCandidates.length ? aliasCandidates : parsed

  // 5. Prefer barrel index if one is prefix of another (e.g. "@/lib/utils" vs "@/lib/utils/cn")
  const sorted = candidates.slice().sort((a, b) => a.specifier.length - b.specifier.length)
  if (sorted.length > 1) {
    const root = sorted[0].specifier
    const isPrefixOfAll = sorted.slice(1).every((c) => c.specifier.startsWith(root))
    if (isPrefixOfAll) return sorted[0].fix
  }

  // 6. If all candidates target the same module, pick it
  const unique = new Set(candidates.map((c) => c.specifier))
  if (unique.size === 1) return candidates[0].fix

  return null
}

function applyTextChanges(text, changes) {
  const sorted = [...changes].sort((a, b) => b.span.start - a.span.start)
  let result = text
  for (const change of sorted) {
    const prefix = result.slice(0, change.span.start)
    const suffix = result.slice(change.span.start + change.span.length)
    result = prefix + change.newText + suffix
  }
  return result
}

function fixFile(service, filePath) {
  let content = service.getFileContent(filePath)
  service.setFileContent(filePath, content)

  const appliedFixes = []
  const maxIterations = 20

  for (let iter = 0; iter < maxIterations; iter++) {
    const diags = service.languageService.getSemanticDiagnostics(filePath).filter((d) => d.code === 2304 || d.code === 2552)

    if (!diags.length) break

    let fixedAny = false
    for (const d of diags) {
      const fixes = service.languageService.getCodeFixesAtPosition(
        filePath,
        d.start,
        d.start + d.length,
        [d.code],
        {},
        {
          importModuleSpecifierPreference: 'non-relative',
          importModuleSpecifierEnding: 'minimal',
        }
      )

      const best = selectBestFix(fixes)
      if (best) {
        content = applyTextChanges(content, best.changes[0].textChanges)
        service.setFileContent(filePath, content)
        appliedFixes.push(best.description)
        fixedAny = true
        break // re-query diagnostics so AST text positions remain accurate
      }
    }

    if (!fixedAny) break
  }

  if (appliedFixes.length > 0) {
    fs.writeFileSync(filePath, content, 'utf8')
  }

  return appliedFixes
}

async function main() {
  const targetFiles = resolveTargetFiles()
  if (!targetFiles.length) {
    console.log('[fix:imports] No target TypeScript files to check.')
    return
  }

  console.log(`[fix:imports] Checking ${targetFiles.length} file(s)...`)

  const serviceCache = new Map()
  function getService(tsconfigPath) {
    if (!serviceCache.has(tsconfigPath)) {
      serviceCache.set(tsconfigPath, new ProjectService(tsconfigPath))
    }
    return serviceCache.get(tsconfigPath)
  }

  let totalFixes = 0
  const modifiedFiles = []

  for (const file of targetFiles) {
    const tsconfig = getTsconfigPath(file)
    const service = getService(tsconfig)
    const fixes = fixFile(service, file)
    if (fixes.length > 0) {
      totalFixes += fixes.length
      modifiedFiles.push(file)
      const rel = path.relative(rootDir, file)
      console.log(`  ✓ ${rel}: applied ${fixes.length} import fix(es):`)
      for (const desc of fixes) console.log(`    · ${desc}`)
    }
  }

  if (modifiedFiles.length > 0) {
    // Format modified files with Prettier
    try {
      const quoted = modifiedFiles.map((f) => `"${f}"`).join(' ')
      execSync(`pnpm prettier --config .prettierrc.cjs --write ${quoted}`, { stdio: 'ignore' })
    } catch {
      /* */
    }
    console.log(`[fix:imports] Successfully resolved ${totalFixes} missing import(s) across ${modifiedFiles.length} file(s).`)
  } else {
    console.log('[fix:imports] All imports are already up to date.')
  }
}

main().catch((err) => {
  console.error('[fix:imports] Error:', err)
  process.exit(1)
})
