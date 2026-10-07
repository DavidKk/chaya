/**
 * Enemies of the current battle: read for the edit page, transform / add mid-battle, resize a troop right
 * after `BattleManager.setup` (before the battle scene builds its sprites).
 */
import { type BattleState, ENEMY_SIZE_GUESS, type EnemyRect, MAX_BATTLE_ENEMIES, pickEnemySpot, pickEnemySpots } from '@/lib/game/battle'

type Bitmap = { width: number; height: number; isReady?: () => boolean }
type Enemy = {
  enemyId: () => number
  name: () => string
  battlerName?: () => string
  hp: number
  mhp: number
  mmp?: number
  isAlive: () => boolean
  isHidden: () => boolean
  hide?: () => void
  screenX: () => number
  screenY: () => number
  transform: (enemyId: number) => void
  setHp?: (hp: number) => void
  setMp?: (mp: number) => void
  onBattleStart?: (advantageous?: boolean) => void
  _screenX?: number
  _screenY?: number
}
type EnemySprite = { _battler?: Enemy | null; bitmap?: Bitmap | null; setHome?: (x: number, y: number) => void }
type Container = { children?: unknown[]; addChild: (child: unknown) => void; removeChild: (child: unknown) => void }
type Spriteset = { _battleField?: Container; _enemySprites?: EnemySprite[]; update?: () => void }
type Troop = { _enemies: Enemy[]; _namesCount?: Record<string, number>; members: () => Enemy[]; makeUniqueNames?: () => void; isAllDead?: () => boolean }

const g = () =>
  globalThis as unknown as {
    SceneManager?: { _scene?: { _spriteset?: Spriteset; _enemyWindow?: { active?: boolean; refresh?: () => void } } | null; _nextScene?: unknown }
    Scene_Battle?: new () => unknown
    BattleManager?: { _phase?: string }
    $gameTroop?: Troop
    $dataEnemies?: (object | null)[]
    Game_Enemy?: new (enemyId: number, x: number, y: number) => Enemy
    Sprite_Enemy?: new (enemy: Enemy) => EnemySprite
    Graphics?: { boxWidth?: number; boxHeight?: number }
  }

const UNSUPPORTED = '该游戏的战斗画面不支持追加敌人'

function battleScene() {
  const { SceneManager, Scene_Battle } = g()
  const scene = SceneManager?._scene
  return scene && Scene_Battle && scene instanceof Scene_Battle ? scene : null
}

function battleEnded(): boolean {
  const phase = g().BattleManager?._phase
  return phase === 'battleEnd' || phase === 'aborting' || !!g().$gameTroop?.isAllDead?.()
}

/** Only while the battle scene is active */
export function readBattleState(): BattleState | null {
  const troop = g().$gameTroop
  if (!battleScene() || !troop) return null
  try {
    const enemies = troop.members().map((enemy, index) => ({
      index,
      enemyId: enemy.enemyId(),
      name: String(enemy.name() ?? ''),
      hp: Math.max(0, Math.floor(enemy.hp)),
      mhp: Math.max(0, Math.floor(enemy.mhp)),
      alive: enemy.isAlive() || enemy.isHidden(),
      appeared: !enemy.isHidden(),
    }))
    return { enemies, ended: battleEnded() }
  } catch {
    return null
  }
}

function assertBattleEditable(enemyId: number) {
  if (!battleScene()) throw new Error('只能在战斗中使用')
  if (g().SceneManager?._nextScene) throw new Error('场景切换中，请稍后再试')
  if (battleEnded()) throw new Error('战斗已结束')
  if (!g().$gameTroop) throw new Error('游戏未就绪')
  if (!(enemyId > 0 && g().$dataEnemies?.[enemyId])) throw new Error(`敌人 ${enemyId} 不存在`)
}

export function transformEnemy({ index, fromEnemyId, enemyId }: { index: number; fromEnemyId: number; enemyId: number }): void {
  assertBattleEditable(enemyId)
  const troop = g().$gameTroop!
  const enemy = troop.members()[index]
  if (!enemy || enemy.enemyId() !== fromEnemyId) throw new Error('场上敌人已变化，请重试')
  if (enemy.isHidden()) throw new Error('该敌人尚未出现')
  if (!enemy.isAlive()) throw new Error('该敌人已倒下')
  enemy.transform(enemyId)
  // Engine transform only clamps HP / MP to the new maximum
  enemy.setHp?.(enemy.mhp)
  if (enemy.mmp != null) enemy.setMp?.(enemy.mmp)
  troop.makeUniqueNames?.()
}

function bounds() {
  const gr = g().Graphics
  return { width: gr?.boxWidth || 816, height: gr?.boxHeight || 624 }
}

function readySize(bitmap: Bitmap | null | undefined) {
  return bitmap && (bitmap.isReady?.() ?? true) && bitmap.width > 0 ? { width: bitmap.width, height: bitmap.height } : null
}

function spriteOf(spriteset: Spriteset | undefined, enemy: Enemy): EnemySprite | null {
  const pool = [...(spriteset?._enemySprites ?? []), ...((spriteset?._battleField?.children ?? []) as EnemySprite[])]
  return pool.find((s) => s?._battler === enemy) ?? null
}

function rectOf(enemy: Enemy, sprite: EnemySprite | null): EnemyRect {
  return { x: enemy.screenX(), y: enemy.screenY(), ...(readySize(sprite?.bitmap) ?? ENEMY_SIZE_GUESS) }
}

function medianY(enemies: readonly Enemy[]): number | undefined {
  if (!enemies.length) return undefined
  const ys = enemies.map((e) => e.screenY()).sort((a, b) => a - b)
  return ys[ys.length >> 1]
}

function moveEnemy(enemy: Enemy, sprite: EnemySprite | null, spot: { x: number; y: number }) {
  enemy._screenX = spot.x
  enemy._screenY = spot.y
  sprite?.setHome?.(spot.x, spot.y)
}

const SETTLE_POLL_MS = 100
const SETTLE_TIMEOUT_MS = 30_000

/** Positions were picked with guessed sizes; once every image has loaded, re-pick them with real sizes */
function settleSpots(added: readonly Enemy[]) {
  if (!added.length) return
  const started = Date.now()
  const timer = setInterval(() => {
    if (Date.now() - started > SETTLE_TIMEOUT_MS) return clearInterval(timer)
    const troop = g().$gameTroop
    const spriteset = battleScene()?._spriteset
    if (!troop || !spriteset) return
    const members = troop.members()
    if (!added.every((e) => members.includes(e))) return clearInterval(timer)
    const shown = members.filter((e) => !e.isHidden() && e.isAlive())
    const sprites = new Map(shown.map((e) => [e, spriteOf(spriteset, e)]))
    if ([...sprites.values()].some((s) => !readySize(s?.bitmap))) return
    clearInterval(timer)
    const keep = shown.filter((e) => !added.includes(e))
    const moving = added.filter((e) => sprites.has(e))
    const spots = pickEnemySpots({
      existing: keep.map((e) => rectOf(e, sprites.get(e) ?? null)),
      sizes: moving.map((e) => readySize(sprites.get(e)?.bitmap) ?? ENEMY_SIZE_GUESS),
      bounds: bounds(),
      fallbackY: medianY(members),
    })
    moving.forEach((e, i) => moveEnemy(e, sprites.get(e) ?? null, spots[i]!))
  }, SETTLE_POLL_MS)
}

/**
 * Right after `BattleManager.setup`: hide visible members beyond `count`, or add copies of them (cycling in
 * order) up to `count`. Hidden (appear-mid-battle) members are left alone.
 */
export function resizeTroop(count: number): void {
  const troop = g().$gameTroop
  const GameEnemy = g().Game_Enemy
  const target = Math.min(MAX_BATTLE_ENEMIES, Math.max(1, Math.floor(count)))
  if (!troop || !GameEnemy || !Number.isFinite(target)) return
  const visible = troop.members().filter((e) => !e.isHidden())
  if (!visible.length || visible.length === target) return
  if (visible.length > target) {
    for (const enemy of visible.slice(target)) enemy.hide?.()
    return
  }
  const templates = visible.map((e) => e.enemyId())
  const extra = Array.from({ length: target - visible.length }, (_, i) => templates[i % templates.length]!)
  const spots = pickEnemySpots({
    existing: visible.map((e) => rectOf(e, null)),
    sizes: extra.map(() => ENEMY_SIZE_GUESS),
    bounds: bounds(),
    fallbackY: medianY(visible),
  })
  const added = extra.map((enemyId, i) => new GameEnemy(enemyId, spots[i]!.x, spots[i]!.y))
  troop._enemies.push(...added)
  troop.makeUniqueNames?.()
  settleSpots(added)
}

/** Some battle plugins keep per-sprite arrays (HP gauges …) built at battle start; one update shows whether they cope */
function probe(spriteset: Spriteset): boolean {
  try {
    spriteset.update?.()
    return true
  } catch {
    return false
  }
}

function battlerNameOf(enemyId: number): string | undefined {
  const row = g().$dataEnemies?.[enemyId] as { battlerName?: unknown } | null | undefined
  return typeof row?.battlerName === 'string' ? row.battlerName : undefined
}

export function addEnemy({ enemyId }: { enemyId: number }): void {
  assertBattleEditable(enemyId)
  const troop = g().$gameTroop!
  const members = troop.members()
  if (members.filter((e) => e.isAlive() && !e.isHidden()).length >= MAX_BATTLE_ENEMIES) throw new Error('场上敌人已达上限')
  const scene = battleScene()!
  const spriteset = scene._spriteset
  const field = spriteset?._battleField
  const sprites = spriteset?._enemySprites
  const { Game_Enemy: GameEnemy, Sprite_Enemy: SpriteEnemy } = g()
  if (!spriteset || !field || !Array.isArray(sprites) || !GameEnemy || !SpriteEnemy || !Array.isArray(troop._enemies)) throw new Error(UNSUPPORTED)

  const shown = members.filter((e) => e.isAlive() && !e.isHidden())
  const image = battlerNameOf(enemyId)
  const twin = image ? members.find((e) => e.battlerName?.() === image) : undefined
  const size = readySize(twin ? spriteOf(spriteset, twin)?.bitmap : null) ?? ENEMY_SIZE_GUESS
  const spot = pickEnemySpot({ existing: shown.map((e) => rectOf(e, spriteOf(spriteset, e))), size, bounds: bounds(), fallbackY: medianY(members) })

  const namesCount = { ...(troop._namesCount ?? {}) }
  let enemy: Enemy | null = null
  let sprite: EnemySprite | null = null
  const rollback = () => {
    if (sprite) {
      const at = sprites.indexOf(sprite)
      if (at >= 0) sprites.splice(at, 1)
      try {
        field.removeChild(sprite)
      } catch {
        /* */
      }
    }
    if (enemy) {
      const at = troop._enemies.indexOf(enemy)
      if (at >= 0) troop._enemies.splice(at, 1)
    }
    if (troop._namesCount) troop._namesCount = namesCount
  }
  try {
    enemy = new GameEnemy(enemyId, spot.x, spot.y)
    enemy.onBattleStart?.(false)
    sprite = new SpriteEnemy(enemy)
    field.addChild(sprite)
    sprites.push(sprite)
    troop._enemies.push(enemy)
    troop.makeUniqueNames?.()
  } catch {
    rollback()
    throw new Error(UNSUPPORTED)
  }
  if (!probe(spriteset)) {
    // Still drawn and updated as a battle field child, just not tracked by the plugin's per-sprite arrays
    sprites.splice(sprites.indexOf(sprite), 1)
    if (!probe(spriteset)) {
      rollback()
      probe(spriteset)
      throw new Error(UNSUPPORTED)
    }
  }
  if (scene._enemyWindow?.active) scene._enemyWindow.refresh?.()
  settleSpots([enemy])
}
