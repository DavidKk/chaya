'use client'

import { Menu } from '@base-ui/react/menu'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IoAdd, IoArrowBack, IoChevronDown, IoChevronForward, IoClose, IoRefreshOutline, IoTrashOutline } from 'react-icons/io5'
import { LuChevronsDownUp, LuFileCode, LuFilePlus, LuFileText, LuFolder, LuFolderOpen, LuFolderPlus } from 'react-icons/lu'
import { TbPencilCog } from 'react-icons/tb'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { panelHead } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, EmptyState, Modal, ScrollArea, TextInput, Tooltip } from '@/components/sk'
import { PlainTextEditor } from '@/components/sk/PlainTextEditor'
import { type AiRole, defaultRoleWorkspaceFileContent, loadAiRoles, saveAiRole } from '@/lib/game-agent/roles'
import { cn } from '@/lib/utils'

export type RoleWorkspaceViewProps = {
  roleId: string
  onBack?: () => void
}

const FILE_META: Record<string, { title: string; desc: string }> = {
  'AGENTS.md': { title: 'Agent 行为指令', desc: '核心系统提示词、行为准则与响应规范' },
  'DREAMS.md': { title: '愿景与潜意识', desc: '旅伴内心的长期追求、未解执念与探索动力' },
  'IDENTITY.md': { title: '身份与人设', desc: '口吻习惯、人设立场与第一人称叙述视角' },
  'MEMORY.md': { title: '长期记忆总览', desc: '心智记忆总览、与玩家共同历险的索引' },
  'SOUL.md': { title: '灵魂与价值观', desc: '性格底色、道德倾向与对冒险伙伴的真实态度' },
  'USER.md': { title: '玩家画像', desc: '记录对当前玩家的观察、喜好与称呼方式' },
  'README.md': { title: '角色空间概览', desc: '旅伴上下文配置与当前运行环境说明' },
  memory: { title: '角色记忆库', desc: '存储旅伴的探索记录、世界观认知与关键回忆' },
  'memory/adventures.md': { title: '历险记录', desc: '阶段性地城探索记录与路线心得' },
  'memory/lore.md': { title: '世界回忆', desc: '旅伴心中的世界背景与深刻回忆' },
  skills: { title: '伴侣技能库', desc: '存储旅伴在游戏中的心智技能与交互策略' },
  'skills/chest_alert.md': { title: '宝箱感知', desc: '感知到周边未开启宝箱时触发提示' },
  'skills/danger_care.md': { title: '危机看护', desc: '全队生命值处于低谷时提醒并救急' },
  'skills/banter.md': { title: '闲聊互动', desc: '待机休闲时自然生成对话并记录到台词池' },
}

type ContextMenuTarget = { type: 'file'; path: string } | { type: 'folder'; path: string } | { type: 'empty' }

type ModalAction = { type: 'new-file'; folderPath: string } | { type: 'new-folder'; folderPath: string } | { type: 'rename'; path: string; isFolder: boolean }

export function RoleWorkspaceView({ roleId, onBack }: RoleWorkspaceViewProps) {
  const locale = useLocaleCode()
  const isZh = locale.startsWith('zh')
  const notify = useNotification()
  const confirm = useConfirm()

  const [roles, setRoles] = useState<AiRole[]>(() => loadAiRoles())
  const role = roles.find((r) => r.id === roleId)

  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, string>>(() => role?.workspaceFiles || {})
  const [activeFilePath, setActiveFilePath] = useState<string>('IDENTITY.md')
  const [openTabs, setOpenTabs] = useState<string[]>(['IDENTITY.md'])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(['memory', 'skills']))
  const [customFolders, setCustomFolders] = useState<Set<string>>(() => new Set())
  const [treeWidth, setTreeWidth] = useState(250)
  const isDraggingRef = useRef(false)
  const [isMac, setIsMac] = useState(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null)

  // Modal state for new file / folder / rename
  const [activeModal, setActiveModal] = useState<ModalAction | null>(null)
  const [modalInput, setModalInput] = useState('')
  const [modalError, setModalError] = useState('')

  useEffect(() => {
    setIsMac(typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent))
  }, [])

  useEffect(() => {
    let active = true
    if (typeof fetch === 'function') {
      fetch(`/api/game-agent/roles?id=${encodeURIComponent(roleId)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { role?: { files?: Record<string, string> } } | null) => {
          const files = data?.role?.files
          if (!active || !files) return
          if (Object.keys(files).length > 0) {
            setWorkspaceFiles((prev) => ({ ...prev, ...files }))
          }
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [roleId])

  // Save handler
  const handleSave = useCallback(() => {
    if (!role) return
    saveAiRole({
      ...role,
      workspaceFiles,
    })
    setRoles(loadAiRoles())
    notify.success(isZh ? '角色空间文件已保存' : 'Character space saved')
  }, [role, workspaceFiles, isZh, notify])

  // Keyboard shortcut listener (Cmd+S / Ctrl+S)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  // Open file in tab
  const handleOpenFile = useCallback((path: string) => {
    setActiveFilePath(path)
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }, [])

  // Close tab
  const handleCloseTab = useCallback(
    (path: string) => {
      setOpenTabs((prev) => {
        const next = prev.filter((p) => p !== path)
        if (activeFilePath === path) {
          const nextActive = next[next.length - 1] || 'IDENTITY.md'
          setActiveFilePath(nextActive)
          if (!next.includes(nextActive)) {
            return [...next, nextActive]
          }
        }
        return next.length > 0 ? next : ['IDENTITY.md']
      })
    },
    [activeFilePath]
  )

  const toggleFolder = useCallback((folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }, [])

  const toggleExpandAll = useCallback(() => {
    setExpandedFolders((prev) => {
      if (prev.size > 0) return new Set()
      const all = new Set(['memory', 'skills', ...Array.from(customFolders)])
      return all
    })
  }, [customFolders])

  const handleRefresh = useCallback(() => {
    const freshRoles = loadAiRoles()
    setRoles(freshRoles)
    const freshRole = freshRoles.find((r) => r.id === roleId)
    if (freshRole) {
      setWorkspaceFiles(freshRole.workspaceFiles || {})
    }
    notify.info(isZh ? '已刷新文件树' : 'Refreshed file tree')
  }, [roleId, isZh, notify])

  const handleContentChange = useCallback(
    (content: string) => {
      setWorkspaceFiles((prev) => ({ ...prev, [activeFilePath]: content }))
    },
    [activeFilePath]
  )

  // Draggable splitter handler
  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      const startX = e.clientX
      const startWidth = treeWidth

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!isDraggingRef.current) return
        const delta = moveEvent.clientX - startX
        const next = Math.max(180, Math.min(480, startWidth + delta))
        setTreeWidth(next)
      }

      const onPointerUp = () => {
        isDraggingRef.current = false
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    },
    [treeWidth]
  )

  // Delete file or folder
  const handleDeletePath = useCallback(
    async (targetPath: string, isFolder: boolean) => {
      const ok = await confirm({
        title: isFolder ? (isZh ? '删除文件夹' : 'Delete Folder') : isZh ? '删除文件' : 'Delete File',
        description: isFolder
          ? isZh
            ? `确定要删除文件夹「${targetPath}」及其内部所有文件吗？`
            : `Delete folder "${targetPath}" and all files within?`
          : isZh
            ? `确定要删除文件「${targetPath}」吗？`
            : `Delete file "${targetPath}"?`,
        confirmLabel: isZh ? '删除' : 'Delete',
        confirmVariant: 'fail',
      })
      if (!ok) return

      setWorkspaceFiles((prev) => {
        const next = { ...prev }
        if (isFolder) {
          const prefix = `${targetPath}/`
          for (const k of Object.keys(next)) {
            if (k.startsWith(prefix) || k === targetPath) delete next[k]
          }
        } else {
          delete next[targetPath]
        }
        return next
      })

      if (isFolder) {
        setCustomFolders((prev) => {
          const next = new Set(prev)
          next.delete(targetPath)
          return next
        })
        setExpandedFolders((prev) => {
          const next = new Set(prev)
          next.delete(targetPath)
          return next
        })
        setOpenTabs((prev) => prev.filter((p) => !p.startsWith(`${targetPath}/`)))
        if (activeFilePath.startsWith(`${targetPath}/`)) {
          setActiveFilePath('IDENTITY.md')
        }
      } else {
        handleCloseTab(targetPath)
      }
      notify.info(isZh ? `已删除 ${targetPath}` : `Deleted ${targetPath}`)
    },
    [confirm, isZh, notify, activeFilePath, handleCloseTab]
  )

  // Modal submit handler
  const handleModalSubmit = useCallback(() => {
    if (!activeModal) return
    const raw = modalInput.trim()
    if (!raw) {
      setModalError(isZh ? '请输入名称' : 'Please enter a name')
      return
    }

    if (activeModal.type === 'new-file') {
      const sanitized = raw.includes('.') ? raw : `${raw}.md`
      const fullPath = activeModal.folderPath ? `${activeModal.folderPath}/${sanitized}` : sanitized
      if (workspaceFiles[fullPath] !== undefined) {
        setModalError(isZh ? '该文件已存在' : 'File already exists')
        return
      }
      setWorkspaceFiles((prev) => ({
        ...prev,
        [fullPath]: `# ${sanitized}\n\n`,
      }))
      if (activeModal.folderPath) {
        setExpandedFolders((prev) => new Set([...prev, activeModal.folderPath]))
      }
      handleOpenFile(fullPath)
      notify.success(isZh ? `已创建文件 ${fullPath}` : `Created ${fullPath}`)
    } else if (activeModal.type === 'new-folder') {
      const folderName = raw.replace(/[/\\]+/g, '-').trim()
      const fullFolder = activeModal.folderPath ? `${activeModal.folderPath}/${folderName}` : folderName
      setCustomFolders((prev) => new Set([...prev, fullFolder]))
      setExpandedFolders((prev) => new Set([...prev, fullFolder]))
      if (activeModal.folderPath) {
        setExpandedFolders((prev) => new Set([...prev, activeModal.folderPath]))
      }
      notify.success(isZh ? `已创建文件夹 ${fullFolder}` : `Created folder ${fullFolder}`)
    } else if (activeModal.type === 'rename') {
      const { path: oldPath, isFolder } = activeModal
      if (isFolder) {
        const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
        const newFolder = parent ? `${parent}/${raw}` : raw
        if (newFolder === oldPath) {
          setActiveModal(null)
          return
        }
        setWorkspaceFiles((prev) => {
          const next: Record<string, string> = {}
          const oldPrefix = `${oldPath}/`
          const newPrefix = `${newFolder}/`
          for (const [k, v] of Object.entries(prev)) {
            if (k.startsWith(oldPrefix)) {
              next[newPrefix + k.slice(oldPrefix.length)] = v
            } else {
              next[k] = v
            }
          }
          return next
        })
        setCustomFolders((prev) => {
          const next = new Set(prev)
          next.delete(oldPath)
          next.add(newFolder)
          return next
        })
        setExpandedFolders((prev) => {
          const next = new Set(prev)
          if (next.has(oldPath)) {
            next.delete(oldPath)
            next.add(newFolder)
          }
          return next
        })
        setOpenTabs((prev) => prev.map((t) => (t.startsWith(`${oldPath}/`) ? `${newFolder}/${t.slice(oldPath.length + 1)}` : t)))
        if (activeFilePath.startsWith(`${oldPath}/`)) {
          setActiveFilePath(`${newFolder}/${activeFilePath.slice(oldPath.length + 1)}`)
        }
        notify.success(isZh ? `已重命名为 ${newFolder}` : `Renamed to ${newFolder}`)
      } else {
        const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
        const sanitized = raw.includes('.') ? raw : `${raw}.md`
        const newPath = parent ? `${parent}/${sanitized}` : sanitized
        if (newPath === oldPath) {
          setActiveModal(null)
          return
        }
        if (workspaceFiles[newPath] !== undefined) {
          setModalError(isZh ? '该文件已存在' : 'File already exists')
          return
        }
        const oldContent = workspaceFiles[oldPath] ?? (role ? defaultRoleWorkspaceFileContent(oldPath, role) : '')
        setWorkspaceFiles((prev) => {
          const next = { ...prev }
          delete next[oldPath]
          next[newPath] = oldContent
          return next
        })
        setOpenTabs((prev) => prev.map((t) => (t === oldPath ? newPath : t)))
        if (activeFilePath === oldPath) setActiveFilePath(newPath)
        notify.success(isZh ? `已重命名为 ${newPath}` : `Renamed to ${newPath}`)
      }
    }

    setActiveModal(null)
    setModalInput('')
    setModalError('')
  }, [activeModal, modalInput, isZh, workspaceFiles, role, handleOpenFile, notify, activeFilePath])

  if (!role) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
        <div className={panelHead}>
          <Button variant="ghost" size="icon" onClick={onBack}>
            <IoArrowBack size={17} />
          </Button>
          <h2 className="m-0 text-sm font-semibold text-ink">{isZh ? '旅伴未找到' : 'Companion Not Found'}</h2>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState title={isZh ? '找不到该旅伴' : 'Companion not found'} message={isZh ? '请返回旅伴列表重新选择。' : 'Please go back and select a companion.'}>
            <Button className="mt-3" onClick={onBack}>
              {isZh ? '返回' : 'Back'}
            </Button>
          </EmptyState>
        </div>
      </div>
    )
  }

  const currentContent = workspaceFiles[activeFilePath] ?? defaultRoleWorkspaceFileContent(activeFilePath, role)

  // Collect all known folders and files
  const allFolders = new Set(['memory', 'skills', ...Array.from(customFolders)])
  for (const p of Object.keys(workspaceFiles)) {
    if (p.includes('/')) {
      const folder = p.slice(0, p.lastIndexOf('/'))
      allFolders.add(folder)
    }
  }

  // Folders sorted alphabetically
  const sortedFolderList = Array.from(allFolders).sort((a, b) => a.localeCompare(b))

  // Default root files
  const defaultRootFiles = ['AGENTS.md', 'DREAMS.md', 'IDENTITY.md', 'MEMORY.md', 'SOUL.md', 'USER.md', 'README.md']
  const customRootFiles = Object.keys(workspaceFiles).filter((p) => !p.includes('/') && !defaultRootFiles.includes(p))
  const allRootFiles = [...defaultRootFiles, ...customRootFiles].sort((a, b) => a.localeCompare(b))

  // Helper to get folder files sorted
  const getFolderFiles = (folder: string) => {
    const defaultInFolder =
      folder === 'memory' ? ['memory/adventures.md', 'memory/lore.md'] : folder === 'skills' ? ['skills/banter.md', 'skills/chest_alert.md', 'skills/danger_care.md'] : []
    const customInFolder = Object.keys(workspaceFiles).filter((p) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes('/') && !defaultInFolder.includes(p))
    return [...defaultInFolder, ...customInFolder].sort((a, b) => {
      const nameA = a.split('/').pop() || a
      const nameB = b.split('/').pop() || b
      return nameA.localeCompare(nameB)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      {/* 头部：左侧返回按钮 + 旅伴名称与角色空间说明，移除左上角多余图标，右侧移除保存按钮 */}
      <div className={cn(panelHead, 'justify-between')}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label={isZh ? '返回旅伴详情' : 'Back to companion'} tooltip={isZh ? '返回' : 'Back'} onClick={onBack}>
            <IoArrowBack size={17} />
          </Button>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="m-0 text-sm font-semibold text-ink">
                {role.name} · {isZh ? '角色空间' : 'Character Space'}
              </h2>
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft select-none">
                {isMac ? '⌘S' : 'Ctrl+S'} {isZh ? '保存' : 'Save'}
              </span>
            </div>
            <p className="m-0 text-xs text-ink-soft">
              {isZh ? '存储旅伴心智能力的记忆 (memory)、技能 (skills) 与行为规范等文件' : 'Companion mental capability files (memory, skills, persona)'}
            </p>
          </div>
        </div>
      </div>

      {/* 铺满全屏的双栏结构：左侧树级文件栏，右侧编辑器，单一分割线，无双重边框 */}
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* 左侧树级文件栏（宽度可拖拽） */}
        <aside
          style={{ width: `${treeWidth}px` }}
          className="flex min-h-0 shrink-0 flex-col border-r border-line bg-panel select-none"
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'empty' } })
          }}
        >
          <div className="flex h-9 items-center justify-between border-b border-line px-3 text-xs text-ink-soft">
            <div className="flex items-center gap-1.5 font-semibold text-ink">
              <LuFolder size={14} className="text-accent" />
              <span>{isZh ? '角色空间目录' : 'Files'}</span>
            </div>

            {/* 工具栏：正正方方无边框按钮 */}
            <div className="flex items-center gap-0.5">
              <Menu.Root>
                <Menu.Trigger
                  aria-label={isZh ? '新建' : 'New'}
                  className="size-6 flex items-center justify-center rounded-[0.2rem] text-ink-soft hover:text-ink hover:bg-white/10 cursor-pointer border-0 outline-none"
                >
                  <IoAdd size={15} />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[80]">
                    <Menu.Popup className="min-w-32 rounded-md border border-line bg-panel p-1 shadow-xl outline-none text-xs">
                      <Menu.Item
                        className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-ink outline-none hover:bg-white/10"
                        onClick={() => {
                          setModalInput('')
                          setModalError('')
                          setActiveModal({ type: 'new-file', folderPath: '' })
                        }}
                      >
                        <LuFilePlus size={13} className="text-accent" />
                        <span>{isZh ? '新建文件' : 'New File'}</span>
                      </Menu.Item>
                      <Menu.Item
                        className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-ink outline-none hover:bg-white/10"
                        onClick={() => {
                          setModalInput('')
                          setModalError('')
                          setActiveModal({ type: 'new-folder', folderPath: '' })
                        }}
                      >
                        <LuFolderPlus size={13} className="text-accent" />
                        <span>{isZh ? '新建文件夹' : 'New Folder'}</span>
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>

              <Tooltip content={isZh ? '刷新目录' : 'Refresh'}>
                <button
                  type="button"
                  onClick={handleRefresh}
                  aria-label={isZh ? '刷新' : 'Refresh'}
                  className="size-6 flex items-center justify-center rounded-[0.2rem] text-ink-soft hover:text-ink hover:bg-white/10 cursor-pointer border-0 outline-none"
                >
                  <IoRefreshOutline size={14} />
                </button>
              </Tooltip>

              <Tooltip content={isZh ? '折叠/展开全部' : 'Toggle Expand'}>
                <button
                  type="button"
                  onClick={toggleExpandAll}
                  aria-label={isZh ? '折叠/展开全部' : 'Toggle Expand'}
                  className="size-6 flex items-center justify-center rounded-[0.2rem] text-ink-soft hover:text-ink hover:bg-white/10 cursor-pointer border-0 outline-none"
                >
                  <LuChevronsDownUp size={13} />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* 树级列表：全局自定义滚动条，文件夹放前，按文件名排序 */}
          <ScrollArea className="min-h-0 flex-1" scrollClassName="p-1.5 flex flex-col gap-0.5">
            {/* 1. 文件夹列表（文件夹在前，按字母排序） */}
            {sortedFolderList.map((folder) => {
              const isExpanded = expandedFolders.has(folder)
              const folderName = folder.split('/').pop() || folder
              const folderMeta = FILE_META[folder]
              const folderDesc = folderMeta ? `${folderMeta.title} · ${folderMeta.desc}` : folderName
              const folderFiles = getFolderFiles(folder)

              return (
                <div key={folder} className="flex flex-col">
                  <Tooltip content={folderDesc}>
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'folder', path: folder } })
                      }}
                      className="flex w-full cursor-pointer items-center gap-1.5 rounded-[0.25rem] px-2 py-1.5 text-left text-xs font-medium text-ink transition-colors hover:bg-white/5"
                    >
                      {isExpanded ? <IoChevronDown size={12} className="text-ink-soft shrink-0" /> : <IoChevronForward size={12} className="text-ink-soft shrink-0" />}
                      {isExpanded ? <LuFolderOpen size={14} className="text-amber-400 shrink-0" /> : <LuFolder size={14} className="text-amber-400 shrink-0" />}
                      <span className="font-mono font-semibold truncate">{folderName}</span>
                    </button>
                  </Tooltip>

                  {isExpanded ? (
                    <div className="flex flex-col pl-4 border-l border-line/40 ml-3 my-0.5 gap-0.5">
                      {folderFiles.length === 0 ? (
                        <span className="px-2 py-1 text-[11px] text-ink-soft/60 italic">{isZh ? '(空目录)' : '(empty)'}</span>
                      ) : (
                        folderFiles.map((filePath) => {
                          const fileName = filePath.split('/').pop() || filePath
                          const active = activeFilePath === filePath
                          const isModified = Boolean(workspaceFiles[filePath])
                          const meta = FILE_META[filePath]
                          const desc = meta ? `${meta.title} · ${meta.desc}` : fileName

                          return (
                            <Tooltip key={filePath} content={desc}>
                              <div
                                onClick={() => handleOpenFile(filePath)}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'file', path: filePath } })
                                }}
                                className={cn(
                                  'group flex cursor-pointer items-center justify-between rounded-[0.25rem] px-2 py-1 text-xs transition-colors',
                                  active ? 'bg-accent/15 text-accent font-medium' : 'text-ink-soft hover:bg-white/5 hover:text-ink'
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <LuFileText size={13} className="shrink-0" />
                                  <span className="font-mono truncate">{fileName}</span>
                                  {isModified ? <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" title="已修改" /> : null}
                                </div>
                              </div>
                            </Tooltip>
                          )
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}

            {/* 2. 根目录文件（文件夹后，按字母排序） */}
            {allRootFiles.map((filePath) => {
              const active = activeFilePath === filePath
              const isModified = Boolean(workspaceFiles[filePath])
              const meta = FILE_META[filePath]
              const desc = meta ? `${meta.title} · ${meta.desc}` : filePath

              return (
                <Tooltip key={filePath} content={desc}>
                  <div
                    onClick={() => handleOpenFile(filePath)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'file', path: filePath } })
                    }}
                    className={cn(
                      'group flex cursor-pointer items-center justify-between rounded-[0.25rem] px-2 py-1.5 text-xs transition-colors',
                      active ? 'bg-accent/15 text-accent font-medium' : 'text-ink-soft hover:bg-white/5 hover:text-ink'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <LuFileCode size={13} className="shrink-0" />
                      <span className="font-mono font-medium truncate">{filePath}</span>
                      {isModified ? <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" title="已修改" /> : null}
                    </div>
                  </div>
                </Tooltip>
              )
            })}
          </ScrollArea>
        </aside>

        {/* 可拖拽的分隔条 */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={handleSplitterPointerDown}
          className="group relative -ml-px w-2 shrink-0 cursor-col-resize select-none z-10 flex items-center justify-center transition-colors hover:bg-accent/20 active:bg-accent/40"
        >
          <div className="h-6 w-0.5 rounded-full bg-line group-hover:bg-accent group-active:bg-accent transition-colors" />
        </div>

        {/* 右侧编辑器区域（整体无多余内边距，顶部使用 TABS 记录已打开文件） */}
        <section className="flex min-h-0 flex-1 flex-col bg-paper-2 overflow-hidden">
          {/* 顶部 Tabs 栏 */}
          <div className="flex h-9 w-full items-center border-b border-line bg-panel/75 px-1 overflow-x-auto select-none no-scrollbar">
            {openTabs.map((tabPath) => {
              const active = activeFilePath === tabPath
              const fileName = tabPath.split('/').pop() || tabPath
              const isModified = Boolean(workspaceFiles[tabPath])

              return (
                <div
                  key={tabPath}
                  onClick={() => setActiveFilePath(tabPath)}
                  className={cn(
                    'group flex h-7 items-center gap-1.5 rounded-t-[0.25rem] px-2.5 text-xs font-mono transition-colors cursor-pointer border-r border-line/40',
                    active ? 'bg-paper text-ink font-semibold border-b-2 border-b-accent' : 'text-ink-soft hover:bg-white/5 hover:text-ink'
                  )}
                >
                  <LuFileText size={12} className={active ? 'text-accent' : 'text-ink-soft'} />
                  <span className="truncate max-w-36">{fileName}</span>
                  {isModified ? <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" /> : null}
                  <button
                    type="button"
                    aria-label={`Close ${fileName}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseTab(tabPath)
                    }}
                    className="rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-white/10 text-ink-soft hover:text-ink"
                  >
                    <IoClose size={12} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* 编辑器主体：无内边距，充满区域 */}
          <div className="flex min-h-0 flex-1 flex-col p-0 overflow-hidden">
            <PlainTextEditor
              value={currentContent}
              onChange={handleContentChange}
              language="markdown"
              minLines={15}
              fill
              className="size-full rounded-none border-0"
              aria-label={`Character Space ${activeFilePath}`}
            />
          </div>
        </section>
      </div>

      {/* 右键上下文菜单 */}
      {contextMenu ? (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          <div
            className="fixed z-[100] min-w-36 rounded-md border border-line bg-panel p-1 shadow-2xl text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.target.type === 'file' ? (
              <>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-white/10"
                  onClick={() => {
                    const target = contextMenu.target as { type: 'file'; path: string }
                    setContextMenu(null)
                    setModalInput(target.path.split('/').pop() || target.path)
                    setModalError('')
                    setActiveModal({ type: 'rename', path: target.path, isFolder: false })
                  }}
                >
                  <TbPencilCog size={13} className="text-ink-soft" />
                  <span>{isZh ? '重命名' : 'Rename'}</span>
                </button>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-rose-400 hover:bg-rose-500/10"
                  onClick={() => {
                    const target = contextMenu.target as { type: 'file'; path: string }
                    setContextMenu(null)
                    void handleDeletePath(target.path, false)
                  }}
                >
                  <IoTrashOutline size={13} />
                  <span>{isZh ? '删除' : 'Delete'}</span>
                </button>
              </>
            ) : null}

            {contextMenu.target.type === 'folder' ? (
              <>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-white/10"
                  onClick={() => {
                    const target = contextMenu.target as { type: 'folder'; path: string }
                    setContextMenu(null)
                    setModalInput('')
                    setModalError('')
                    setActiveModal({ type: 'new-file', folderPath: target.path })
                  }}
                >
                  <LuFilePlus size={13} className="text-accent" />
                  <span>{isZh ? '新建文件' : 'New File'}</span>
                </button>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-white/10"
                  onClick={() => {
                    const target = contextMenu.target as { type: 'folder'; path: string }
                    setContextMenu(null)
                    setModalInput('')
                    setModalError('')
                    setActiveModal({ type: 'new-folder', folderPath: target.path })
                  }}
                >
                  <LuFolderPlus size={13} className="text-accent" />
                  <span>{isZh ? '新建文件夹' : 'New Folder'}</span>
                </button>
                <div className="my-1 border-t border-line/60" />
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-white/10"
                  onClick={() => {
                    const target = contextMenu.target as { type: 'folder'; path: string }
                    setContextMenu(null)
                    setModalInput(target.path.split('/').pop() || target.path)
                    setModalError('')
                    setActiveModal({ type: 'rename', path: target.path, isFolder: true })
                  }}
                >
                  <TbPencilCog size={13} className="text-ink-soft" />
                  <span>{isZh ? '重命名' : 'Rename'}</span>
                </button>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-rose-400 hover:bg-rose-500/10"
                  onClick={() => {
                    const target = contextMenu.target as { type: 'folder'; path: string }
                    setContextMenu(null)
                    void handleDeletePath(target.path, true)
                  }}
                >
                  <IoTrashOutline size={13} />
                  <span>{isZh ? '删除' : 'Delete'}</span>
                </button>
              </>
            ) : null}

            {contextMenu.target.type === 'empty' ? (
              <>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-white/10"
                  onClick={() => {
                    setContextMenu(null)
                    setModalInput('')
                    setModalError('')
                    setActiveModal({ type: 'new-file', folderPath: '' })
                  }}
                >
                  <LuFilePlus size={13} className="text-accent" />
                  <span>{isZh ? '新建文件' : 'New File'}</span>
                </button>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-white/10"
                  onClick={() => {
                    setContextMenu(null)
                    setModalInput('')
                    setModalError('')
                    setActiveModal({ type: 'new-folder', folderPath: '' })
                  }}
                >
                  <LuFolderPlus size={13} className="text-accent" />
                  <span>{isZh ? '新建文件夹' : 'New Folder'}</span>
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {/* 新建/重命名 弹窗 */}
      {activeModal ? (
        <Modal
          open
          title={
            activeModal.type === 'new-file'
              ? isZh
                ? '新建文件'
                : 'New File'
              : activeModal.type === 'new-folder'
                ? isZh
                  ? '新建文件夹'
                  : 'New Folder'
                : isZh
                  ? '重命名'
                  : 'Rename'
          }
          onClose={() => setActiveModal(null)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setActiveModal(null)}>
                {isZh ? '取消' : 'Cancel'}
              </Button>
              <Button variant="accent" size="md" onClick={handleModalSubmit}>
                {isZh ? '确定' : 'Confirm'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3 p-1">
            {modalError ? <div className="rounded bg-rose-500/15 p-2 text-xs text-rose-400">{modalError}</div> : null}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-soft">
                {activeModal.type === 'new-file'
                  ? isZh
                    ? '文件名（如 custom_notes.md）'
                    : 'File name'
                  : activeModal.type === 'new-folder'
                    ? isZh
                      ? '文件夹名称'
                      : 'Folder name'
                    : isZh
                      ? '新名称'
                      : 'New name'}
              </span>
              <TextInput
                autoFocus
                className="w-full text-xs font-mono"
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleModalSubmit()
                }}
                placeholder={activeModal.type === 'new-folder' ? 'folder-name' : 'filename.md'}
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
export default RoleWorkspaceView
