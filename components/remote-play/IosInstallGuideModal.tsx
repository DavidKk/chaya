'use client'

import {
  LuCheck,
  LuShare,
  LuSparkles,
  LuSquarePlus,
  LuX,
} from 'react-icons/lu'

type IosInstallGuideModalProps = {
  open: boolean
  onClose: () => void
  isStandalone?: boolean
}

export function IosInstallGuideModal({
  open,
  onClose,
  isStandalone = false,
}: IosInstallGuideModalProps) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-guide-title"
      style={{
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-xl rounded-2xl border border-white/15 bg-neutral-900/95 px-3.5 pt-2 pb-2.5 sm:px-4 sm:pt-2 sm:pb-3 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
        style={{ maxHeight: 'min(380px, 88vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Centered title, compressed height, clean icon button */}
        <div className="relative flex items-center justify-center py-1.5 px-8 border-b border-white/10 shrink-0">
          <h3 id="ios-guide-title" className="text-xs font-bold text-white text-center leading-none">
            {isStandalone ? '已处于独立全屏模式' : 'iOS Safari 添加到主屏幕指引'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-white active:scale-90 transition-all"
            aria-label="关闭"
          >
            <LuX size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto py-2.5 space-y-2.5">
          {isStandalone ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3 text-xs text-emerald-200 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-emerald-300">
                <LuCheck size={16} className="text-emerald-400 shrink-0" />
                <span>已检测到 Web App 独立运行状态</span>
              </div>
              <p className="text-[11px] leading-relaxed text-emerald-100/80">
                当前串流页面已由 iOS 主屏幕图标启动，系统已自动彻底隐藏 Safari 地址栏与底部工具栏，已获得最大的视窗画面。
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-amber-500/25 bg-amber-950/30 p-2 text-[11px] leading-relaxed text-amber-200/90">
                受 iOS 机制限制，Safari 浏览器内网页无法通过普通按钮隐藏地址栏与工具栏。只需将网页添加到主屏幕，即可去除所有浏览器边框！
              </div>

              {/* Steps */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {/* Step 1 */}
                <div className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
                    <LuShare size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white text-[12px]">
                      1. 点击 Safari「分享」按钮
                    </div>
                    <div className="text-[11px] text-neutral-400 leading-normal mt-0.5">
                      位于 Safari 底部工具栏（竖屏）或顶部栏（横屏）的方框向上箭头图标。
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                    <LuSquarePlus size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white text-[12px]">
                      2. 选择「添加到主屏幕」
                    </div>
                    <div className="text-[11px] text-neutral-400 leading-normal mt-0.5">
                      在弹出的操作列表中向下滑动，找到带有加号的「添加到主屏幕」。
                    </div>
                  </div>
                </div>

                {/* Step 3: Real app icon preview with Chaya Play title */}
                <div className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden bg-neutral-950 border border-white/10 shadow-sm mt-0.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/brand/chaya-app-icon.png"
                      alt="Chaya Play 图标"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white text-[12px] flex items-center gap-1.5">
                      <span>3. 确认名称为「Chaya Play」</span>
                    </div>
                    <div className="text-[11px] text-neutral-400 leading-normal mt-0.5">
                      点击添加后从手机主屏打开，将直接以全屏 App 状态运行。
                    </div>
                  </div>
                </div>
              </div>

              {/* Bonus feature tip */}
              <div className="flex items-center gap-1.5 px-1 text-[11px] text-emerald-400">
                <LuSparkles size={13} className="shrink-0" />
                <span>画面提示：顶部控制栏支持点击比例图标切换「铺满全屏」放大画面。</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
