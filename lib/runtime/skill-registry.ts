export type GameSkill = {
  id: string
  title: string
  summary: string
  tags: string[]
  parent?: string
  children?: string[]
  requires?: string[]
  guidance: string[]
}

/** Small, searchable skill index. Full guidance is loaded only when an agent reads a skill. */
export const GAME_SKILLS: readonly GameSkill[] = [
  {
    id: 'rpgmaker.basics',
    title: 'RPG Maker basics',
    summary: 'Common menu, input, window and save/load conventions; verify facts from game.ui.',
    tags: ['rpgmaker', 'menu', 'input', 'navigation'],
    children: ['rpgmaker.menu', 'rpgmaker.ui-observation', 'rpgmaker.save-load'],
    guidance: [
      'Escape often opens the menu on a map, but games may disable or remap it.',
      'OK usually confirms and Cancel usually returns; inspect the active window before assuming a command.',
      'Use structured game.ui data first and screenshots for custom or unreadable windows.',
      'After consequential input, observe again before sending another input.',
    ],
  },
  {
    id: 'rpgmaker.menu',
    title: 'RPG Maker menu navigation',
    summary: 'Navigate standard status, equipment, skills, items, options, save and load menus.',
    tags: ['menu', 'status', 'equipment', 'skills', 'items'],
    parent: 'rpgmaker.basics',
    guidance: [
      'Open the menu only after confirming the game is in a menu-capable map scene.',
      'Read the active command window and selected symbol before choosing an item.',
      'Use short directional inputs and re-read the UI after each selection.',
      'Custom menu plugins can reorder, remove or rename standard commands.',
    ],
  },
  {
    id: 'rpgmaker.ui-observation',
    title: 'RPG Maker UI observation',
    summary: 'Turn active RPG Maker windows into a structured description before using keys.',
    tags: ['ui', 'windows', 'selection', 'vision'],
    parent: 'rpgmaker.basics',
    guidance: [
      'Prefer scene name, window kind, active state, selected index, symbol, text and enabled state.',
      'If structured data is unavailable, capture a screenshot and identify the highlighted option.',
      'Never continue a long key sequence after the observed window or scene changes.',
      'Treat an unknown custom window as requiring fresh observation.',
    ],
  },
  {
    id: 'rpgmaker.save-load',
    title: 'RPG Maker save and load',
    summary: "Use the game's native save slots by default; use Chaya quick or automatic saves only when explicitly requested.",
    tags: ['save', 'load', 'native', 'quick', 'auto'],
    parent: 'rpgmaker.basics',
    guidance: [
      "Default to the game's native save menu and visible file slot 1 when the player does not specify a source.",
      'Use Chaya quick or automatic saves only when the player explicitly asks for quick, automatic, or Chaya saves.',
      'Use slot for native and quick saves; use entryId for Chaya automatic saves.',
      'Read save metadata and confirm before destructive loading or overwriting.',
      'After loading, re-read state because map, party, battle and history continuity may change.',
    ],
  },
  {
    id: 'combat.optimization',
    title: 'Combat optimization',
    summary: 'Select safer battle actions using party state, enemy threat, resources and escape cost.',
    tags: ['battle', 'combat', 'strategy', 'resources'],
    requires: ['combat.state-reading', 'planning.risk-evaluation'],
    children: ['combat.state-reading', 'combat.action-selection'],
    guidance: [
      'Read the battle state before choosing an action.',
      'Consider threat, party HP/MP, status effects, available targets and resource cost.',
      'Prefer actions that preserve critical resources when multiple actions safely win.',
      'After each action, observe the new battle state and stop if the scene changes unexpectedly.',
    ],
  },
  {
    id: 'combat.state-reading',
    title: 'Combat state reading',
    summary: 'Interpret actors, enemies, commands, targets and available battle actions.',
    tags: ['battle', 'state', 'targets'],
    parent: 'combat.optimization',
    guidance: [
      'Identify the active actor and command window.',
      'Check target availability and action costs before confirming.',
      'Distinguish a battle command from a story choice or custom reaction prompt.',
    ],
  },
  {
    id: 'combat.action-selection',
    title: 'Combat action selection',
    summary: 'Compare attacks, skills, items, defense, escape and recovery actions.',
    tags: ['battle', 'action', 'skills', 'items'],
    parent: 'combat.optimization',
    guidance: [
      'Do not spend scarce items or MP when a safe lower-cost action is sufficient.',
      'Use escape only after considering failure cost and encounter context.',
      'Require confirmation for forced victory, defeat, party HP changes or other edit actions.',
    ],
  },
  {
    id: 'planning.task-priority',
    title: 'Task priority selection',
    summary: 'Rank objectives by prerequisites, urgency, reward, risk and current resources.',
    tags: ['quest', 'priority', 'planning'],
    children: ['planning.route-selection', 'planning.resource-management'],
    guidance: [
      'List current objectives and their prerequisites before acting.',
      'Prefer objectives that unlock necessary routes or reduce imminent risk.',
      'Do not infer a quest completion from dialogue alone; verify state changes.',
    ],
  },
  {
    id: 'planning.route-selection',
    title: 'Multi-path route selection',
    summary: 'Compare alternate routes by distance, hazards, events, resources and reversibility.',
    tags: ['route', 'map', 'multi-path', 'planning'],
    parent: 'planning.task-priority',
    guidance: [
      'Enumerate known routes and their visible blockers.',
      'Prefer reversible exploration when the consequence of a route is unknown.',
      'Re-observe after transfers, events and map changes because the route graph may have changed.',
    ],
  },
  {
    id: 'planning.resource-management',
    title: 'Resource management',
    summary: 'Preserve HP, MP, items, money and save opportunities for higher-risk objectives.',
    tags: ['resources', 'items', 'money', 'planning'],
    parent: 'planning.task-priority',
    guidance: [
      'Track resources relevant to the current objective and next known risk.',
      'Avoid irreversible spending without a clear benefit or user authorization.',
      'Use a save before a risky branch when the user has authorized saving.',
    ],
  },
  {
    id: 'planning.risk-evaluation',
    title: 'Risk evaluation',
    summary: 'Decide when to pause, save, ask for confirmation or choose a safer branch.',
    tags: ['risk', 'confirmation', 'planning'],
    guidance: [
      'Treat save/load, forced battle outcomes, overwrites and irreversible edits as consequential.',
      'When the game state is unknown or changed since observation, stop and observe again.',
      'Prefer actions with a recoverable outcome when objectives are otherwise equivalent.',
    ],
  },
]

export function skillIndex() {
  return GAME_SKILLS.map(({ id, title, summary, tags, parent, children, requires }) => ({
    id,
    title,
    summary,
    tags,
    ...(parent ? { parent } : {}),
    ...(children ? { children } : {}),
    ...(requires ? { requires } : {}),
  }))
}

export function searchSkills(query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return skillIndex().filter((skill) => terms.every((term) => [skill.id, skill.title, skill.summary, ...skill.tags].join(' ').toLowerCase().includes(term)))
}

export function readSkill(id: string) {
  return GAME_SKILLS.find((skill) => skill.id === id) ?? null
}
