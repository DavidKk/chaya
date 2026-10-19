import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, openInFinder, requireDisk, revealInFinder } from '@/services/disk-ops'

export const runtime = 'nodejs'

export const POST = defineApiRoute('post:/api/reveal', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    target?: 'project' | 'shell' | 'content' | 'translation-settings'
    reveal?: boolean
  }
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error)
  }

  if (body.target === 'translation-settings') {
    if (process.platform !== 'darwin') {
      return apiBadRequest('Translation settings can only be opened on macOS')
    }
    try {
      const { spawn } = await import('node:child_process')
      const proc = spawn('open', ['x-apple.systempreferences:com.apple.Localization-Settings.extension'], {
        detached: true,
        stdio: 'ignore',
      })
      proc.unref()

      setTimeout(() => {
        const appleScript = `
tell application "System Settings" to activate
tell application "System Events"
    tell process "System Settings"
        set frontmost to true
        try
            click button "翻译语言…" of group 1 of scroll area 1 of group 1 of group 2 of splitter group 1 of group 1 of window 1
        on error
            try
                click button "Translation Languages…" of group 1 of scroll area 1 of group 1 of group 2 of splitter group 1 of group 1 of window 1
            end try
        end try
    end tell
end tell`
        const scriptProc = spawn('osascript', ['-e', appleScript], {
          detached: true,
          stdio: 'ignore',
        })
        scriptProc.unref()
      }, 600)

      return apiOk({ opened: true })
    } catch (err) {
      return apiError(500, 'REVEAL_FAILED', err instanceof Error ? err.message : String(err))
    }
  }

  const target = body.target === 'shell' ? resolved.shellApp : body.target === 'content' ? resolved.contentRoot : resolved.projectRoot

  try {
    if (body.reveal !== false && body.target === 'shell') {
      await revealInFinder(target)
    } else if (body.reveal) {
      await revealInFinder(target)
    } else {
      await openInFinder(target)
    }
    return apiOk({ path: target })
  } catch (err) {
    return apiError(500, 'REVEAL_FAILED', err instanceof Error ? err.message : String(err))
  }
})
