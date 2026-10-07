jest.mock('@/services/runtime/agent-bridge', () => ({ callAgentGame: jest.fn() }))
jest.mock('@/services/game-agent/ollama-client', () => ({ listOllamaModels: jest.fn(), readOllamaModelCapabilities: jest.fn(), streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn(() => '') }))

import { listOllamaModels, readOllamaModelCapabilities, streamOllamaChat } from '@/services/game-agent/ollama-client'
import type { GameAgentProfile } from '@/services/game-agent/settings'
import { findVisionModel, inspectBattleImage } from '@/services/game-agent/visual-observation.server'
import { callAgentGame } from '@/services/runtime/agent-bridge'

const profile = { id: 'local', endpoint: 'http://localhost:11434', keepAlive: '10m' } as GameAgentProfile

beforeEach(() => jest.clearAllMocks())

test('selects an installed vision model when the chosen text model cannot see images', async () => {
  ;(listOllamaModels as jest.Mock).mockResolvedValue([{ name: 'qwen3:4b' }, { name: 'gemma4:vision' }])
  ;(readOllamaModelCapabilities as jest.Mock).mockResolvedValueOnce(['completion', 'tools']).mockResolvedValueOnce(['completion', 'vision'])
  await expect(findVisionModel(profile, 'qwen3:4b', new AbortController().signal)).resolves.toBe('gemma4:vision')
  expect(readOllamaModelCapabilities).toHaveBeenCalledTimes(2)
})

test('sends a fresh game screenshot as an image and returns only a validated key', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', data: 'jpeg-base64', width: 1024, height: 768 })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({
      role: 'assistant',
      content: '{"visibleText":"攻击 / 防御","selectedText":"攻击","options":[{"text":"攻击","x":40,"y":20},{"text":"防御","x":100,"y":20}]}',
    })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"targetText":"攻击"}' })
  const result = await inspectBattleImage(profile, 'gemma4:vision', 'qwen3:4b', 'game-a', '帮我代打', { scene: 'Scene_Battle' }, new AbortController().signal)
  expect(callAgentGame).toHaveBeenCalledWith('game-a', 'game.snap', { maxWidth: 1024 })
  expect((streamOllamaChat as jest.Mock).mock.calls[0][0].messages[1]).toMatchObject({ images: ['jpeg-base64'] })
  expect((streamOllamaChat as jest.Mock).mock.calls[1][0]).toMatchObject({
    model: 'qwen3:4b',
    messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining('攻击 / 防御') })]),
  })
  expect(result).toMatchObject({ visibleText: '攻击 / 防御', selectedText: '攻击', key: 'ok', safe: true, imageFingerprint: expect.any(String) })
})

test('rejects an image decision when the claimed selection is absent from the transcribed menu', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', data: 'jpeg-base64' })
  ;(streamOllamaChat as jest.Mock).mockResolvedValue({
    role: 'assistant',
    content: '{"visibleText":"敌方菜单","selectedText":"技能","options":[{"text":"敌方菜单","x":40,"y":20}]}',
  })
  await expect(inspectBattleImage(profile, 'gemma4:vision', 'qwen3:4b', 'game-a', '帮我代打', {}, new AbortController().signal)).resolves.toMatchObject({ key: null, safe: false })
  expect(streamOllamaChat).toHaveBeenCalledTimes(1)
})

test('stops navigating once the desired image-menu item is selected', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', data: 'jpeg-base64' })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({
        visibleText: '攻击 技能 道具 防御',
        selectedText: '攻击',
        options: [
          { text: '攻击', x: 20, y: 20 },
          { text: '技能', x: 80, y: 20 },
          { text: '道具', x: 20, y: 60 },
          { text: '防御', x: 80, y: 60 },
        ],
      }),
    })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"targetText":"道具"}' })
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({
        visibleText: '攻击 技能 道具 防御',
        selectedText: '道具',
        options: [
          { text: '攻击', x: 20, y: 20 },
          { text: '技能', x: 80, y: 20 },
          { text: '道具', x: 20, y: 60 },
          { text: '防御', x: 80, y: 60 },
        ],
      }),
    })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"targetText":"道具"}' })
  const state = { inventory: { items: [{ name: '药草' }] } }
  await expect(inspectBattleImage(profile, 'gemma4:vision', 'qwen3:4b', 'game-a', '治疗队友', state, new AbortController().signal)).resolves.toMatchObject({
    key: 'down',
    safe: true,
  })
  await expect(inspectBattleImage(profile, 'gemma4:vision', 'qwen3:4b', 'game-a', '治疗队友', state, new AbortController().signal)).resolves.toMatchObject({
    key: 'ok',
    safe: true,
  })
})

test('uses horizontal navigation for a multi-column image menu', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', data: 'jpeg-base64' })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({
        visibleText: '攻击 技能',
        selectedText: '攻击',
        options: [
          { text: '攻击', x: 20, y: 20 },
          { text: '技能', x: 90, y: 20 },
        ],
      }),
    })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"targetText":"技能"}' })
  const state = { battle: { actor: { skills: [{ name: '技能' }] } } }
  await expect(inspectBattleImage(profile, 'gemma4:vision', 'qwen3:4b', 'game-a', '使用技能', state, new AbortController().signal)).resolves.toMatchObject({
    key: 'right',
    safe: true,
  })
})

test('rejects an OCR menu heading or misspelled actor as a combat target', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', data: 'jpeg-base64' })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({
        visibleText: '剑士 木士 木士・选择敌人',
        selectedText: '木士',
        options: [
          { text: '剑士', x: 20, y: 20 },
          { text: '木士', x: 20, y: 60 },
          { text: '木士・选择敌人', x: 20, y: 100 },
        ],
      }),
    })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"targetText":"木士・选择敌人"}' })
  const state = { party: [{ name: '剑士' }, { name: '术士' }] }
  await expect(inspectBattleImage(profile, 'gemma4:vision', 'qwen3:4b', 'game-a', '治疗剑士', state, new AbortController().signal)).resolves.toMatchObject({
    key: null,
    safe: false,
  })
})

test('accepts a custom combat command without requiring a built-in attack keyword', async () => {
  ;(callAgentGame as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', data: 'jpeg-base64' })
  ;(streamOllamaChat as jest.Mock)
    .mockResolvedValueOnce({
      role: 'assistant',
      content:
        '{"visibleText":"神圣攻击 防御 动作 物品","selectedText":"动作","options":[{"text":"神圣攻击","x":20,"y":20},{"text":"防御","x":20,"y":60},{"text":"动作","x":20,"y":100},{"text":"物品","x":20,"y":140}]}',
    })
    .mockResolvedValueOnce({ role: 'assistant', content: '{"targetText":"动作"}' })

  await expect(inspectBattleImage(profile, 'gemma4:vision', 'qwen3:4b', 'game-a', '帮我战斗', {}, new AbortController().signal)).resolves.toMatchObject({
    key: 'ok',
    safe: true,
  })
})
