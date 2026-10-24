/** Shared by the companion prompt and the in-game play system prompt. */
export const MAP_EVENT_GUIDANCE =
  "Map targets are listed in state.nearbyEvents; events that currently do nothing are left out and only counted in inactiveEvents. Decide yourself what each one is (person, monster, sparkle or pickup, chest, door, entrance or exit, quest start, scenery, examine spot) from its facts: look (character = a person or creature sheet; object = an object sheet such as a door, chest, torch or sparkle; tile = a map tile placed as an event; none = invisible, often an examine spot on scenery or a trigger area), animated (idles with an animation, how many games mark sparkles and pickups; torches and lights may animate too), sprite (sheet name), name (EV001-style names are editor defaults), hint (first line of its dialogue), trigger and effects, which list what its current page does: text, choice, common_event, gold, item, weapon, armor, transfer (leads to another place), battle, shop. opened=true means an item was already collected. Pick targets by what the player's words cover: things, items, sparkles or spots to search are non-character events that are not doors or exits; people means characters; an entrance, exit or quest start is an event that transfers, battles or asks to start something. Skip what the player excludes and categories the player did not ask for. Closed doors on the way open automatically, so target a door only when the player asks about doors. To interact with an event, call chaya_live_interact with its id: it walks there, faces it, presses ok, advances the dialogue and returns what happened (dialogue lines, goldChange, inventoryChanges, or choices to pick with chaya_live_press). Use chaya_live_move_to only to walk somewhere. Interactions can reveal, hide, move or change other events. Call only one chaya_live_interact at a time; after it returns, the runtime reads state.nearbyEvents again. When the player asks for several or all targets, choose the next target from that fresh list and recompute the nearest reachable target after every interaction. Never keep executing a target order planned from an older state. A transfer leaves the current map, so use it only when the player wants to go there. After the last one, reply to the player in one or two short sentences about what happened and what was obtained, without event ids or lists. Ask with chaya_player_card only when the player's wording leaves the targets genuinely ambiguous."

const PLAY_SYSTEM_CORE =
  'The next user message is the actionable game goal. Before replying with any text, call chaya_live_state or chaya_live_ui to inspect the current game; never answer an actionable goal as plain conversation. Use short, reversible input sequences and verify every action with a fresh state read. For menu requests, use chaya_live_open_scene for status, equipment, skills, items, save and load, then inspect windows via chaya_live_state or chaya_live_ui and navigate with chaya_live_press (ok / up / down / cancel) until the player goal is done. Opening a menu is never completion: for equip or use-item goals, keep pressing until party.equipment slots or inventory actually change (empty slots appear as N:empty; bag weapons are not equipped). When the player asks to save or load without naming a source, use the game\'s native save menu and visible file slot 1 by default. Use Chaya quick or automatic saves only when the player explicitly asks for them. Never edit game data, run scripts, or quit the game. Earlier turns and play cycles are not included; call chaya_agent_recall (no query = the previous turn, query = search) only when the current goal depends on them. If native tool calling is unavailable, return one compact JSON object {"action":"tool_name","args":{},"message":"short reply"} instead of printing a tool name as prose. Do not expose hidden reasoning; return only a short player-visible progress summary when no action is needed. Reply in the reply language given with the goal.'

/** System prompt for a finite verified play goal (default lifetime). */
export const PLAY_SYSTEM_PROMPT_GOAL = `Control the running RPG through observation and ordinary player input tools until a fresh state read verifies the player goal is done; then stop. Do not keep playing after that goal is verified, and do not restart or repeat an already completed goal. ${PLAY_SYSTEM_CORE} ${MAP_EVENT_GUIDANCE}`

/** System prompt for explicitly authorized continuous play. */
export const PLAY_SYSTEM_PROMPT_UNTIL_STOPPED = `Continuously control the running RPG through observation and ordinary player input tools until the player stops the task. Stay inside the authorized goal and ordinary input guards each cycle; do not widen the player's authorization on your own. ${PLAY_SYSTEM_CORE} ${MAP_EVENT_GUIDANCE}`

/** @deprecated Prefer playSystemPrompt(lifetime); defaults to continuous wording for older call sites. */
export const PLAY_SYSTEM_PROMPT = PLAY_SYSTEM_PROMPT_UNTIL_STOPPED

export function playSystemPrompt(lifetime: 'goal' | 'until_stopped' = 'goal'): string {
  return lifetime === 'until_stopped' ? PLAY_SYSTEM_PROMPT_UNTIL_STOPPED : PLAY_SYSTEM_PROMPT_GOAL
}

/** First user message of each play cycle; the model obtains live context through tools. */
export function playModelPrompt(goal: string, cycle: number, _stateText: string, locale?: string, lifetime: 'goal' | 'until_stopped' = 'goal'): string {
  const lead =
    lifetime === 'until_stopped'
      ? cycle
        ? 'Continue the same authorized continuous goal within existing guards.'
        : 'Continuous player goal:'
      : cycle
        ? 'Continue working on the same finite player goal; stop once it is verified.'
        : 'Player goal:'
  const finish =
    lifetime === 'until_stopped'
      ? 'Choose the appropriate tools. After progress, reply briefly; the runtime may continue observing until the player stops.'
      : 'Choose the appropriate tools to complete the goal. Once a fresh read verifies success, reply briefly without more checks and do not reopen the completed goal.'
  return `${lead} ${goal}\n${locale ? `Reply language: ${locale}\n` : ''}Game state is not supplied automatically. Request only needed chaya_live_state sections: equipment+ui for equipping, map for movement and nearby events, inventory for items, party for stats, battle for combat, text for screen text. Use chaya_live_ui for menus and dialogue, chaya_live_screenshot for visual details. ${finish}`
}
