import type { ScriptMessages } from '@/lib/remote-scripts/i18n'

import messages from './mac-shell-messages.json'

/** Terminal copy for `/sh/mac-shell.sh` (see `lib/remote-scripts/i18n.ts`); values are also passed to AppleScript as arguments. */
export type MacShellMessageKey = keyof (typeof messages)['en']

export const MAC_SHELL_MESSAGES: ScriptMessages<MacShellMessageKey> = messages
