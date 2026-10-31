'use client'

import {
  LuCheck,
  LuMaximize2,
  LuShare,
  LuSmartphone,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/80 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-[94vw] max-w-xl rounded-2xl border border-white/15 bg-neutral-900/95 p-3.5 sm:p-4 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
        style={{ maxHeight: 'min(380px, 88vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-md">
              <LuMaximize2 size={16} />
            </div>
            <div>
              <h3 id="ios-guide-title" className="text-sm font-bold text-white">
                {isStandalone ? '已处于独立全屏模式' : 'iOS Safari 全屏指引'}
              </h3>
              <p className="text-[11px] text-neutral-400">
                {isStandalone ? '当前等同于原生全屏' : '添加到主屏幕解锁 100% 满屏'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
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

                {/* Step 3 */}
                <div className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">
                    <LuSmartphone size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white text-[12px]">
                      3. 从手机桌面打开游戏
                    </div>
                    <div className="text-[11px] text-neutral-400 leading-normal mt-0.5">
                      确认名称为「Chaya 串流」并点击添加，随后在主屏点击图标即可全屏横屏游玩。
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

        {/* Footer */}
        <div className="pt-2 border-t border-white/10 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 items-center justify-center rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-500 active:scale-95 transition-all"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}
