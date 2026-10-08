import type { EventCommand } from './types'

export type ExecutionSafetyIssue = 'depth' | 'too-many-events' | 'recursive-call' | 'unbounded-loop' | 'script' | 'plugin-command'
export type ExecutionSafety = { safe: true; visited: number } | { safe: false; issue: ExecutionSafetyIssue; message: string; visited: number }

const number = (value: unknown) => Math.floor(Number(value) || 0)

/** Conservative gate for events started by Chaya. Opaque commands never run through this entry. */
export function analyzeExecutionSafety(
  commands: readonly EventCommand[],
  resolveCommon: (id: number) => readonly EventCommand[] | null,
  options?: { maxDepth?: number; maxUniqueEvents?: number }
): ExecutionSafety {
  const maxDepth = options?.maxDepth ?? 8
  const maxUnique = options?.maxUniqueEvents ?? 128
  const visited = new Set<number>()
  const stack = new Set<number>()
  const fail = (issue: ExecutionSafetyIssue, message: string): ExecutionSafety => ({ safe: false, issue, message, visited: visited.size })

  const inspect = (list: readonly EventCommand[], depth: number): ExecutionSafety | null => {
    if (depth > maxDepth) return fail('depth', `公共事件调用超过 ${maxDepth} 层`)
    for (let index = 0; index < list.length; index++) {
      const command = list[index]
      if (command.code === 355 || command.code === 655) return fail('script', '事件包含脚本指令，不能由 Chaya 启动')
      if (command.code === 356 || command.code === 357) return fail('plugin-command', '事件包含插件指令，不能由 Chaya 启动')
      if (command.code === 112) {
        let nested = 0
        let hasBreak = false
        for (let cursor = index + 1; cursor < list.length; cursor++) {
          if (list[cursor].code === 112) nested++
          else if (list[cursor].code === 413) {
            if (nested === 0) break
            nested--
          } else if (list[cursor].code === 113 && nested === 0) hasBreak = true
        }
        if (!hasBreak) return fail('unbounded-loop', '事件包含没有退出指令的循环')
      }
      if (command.code !== 117) continue
      const id = number(command.parameters[0])
      if (id <= 0) continue
      if (stack.has(id)) return fail('recursive-call', `公共事件 ${id} 形成递归调用`)
      if (!visited.has(id)) {
        visited.add(id)
        if (visited.size > maxUnique) return fail('too-many-events', `公共事件调用超过 ${maxUnique} 个`)
      }
      const target = resolveCommon(id)
      if (!target) continue
      stack.add(id)
      const nestedResult = inspect(target, depth + 1)
      stack.delete(id)
      if (nestedResult) return nestedResult
    }
    return null
  }

  return inspect(commands, 0) ?? { safe: true, visited: visited.size }
}
