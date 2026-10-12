/** 托管中停止按钮的图标：红光沿图标轮廓散开，明暗不均地闪，像萤火虫。挂在图标上，按钮需 `overflow-visible`。 */
export const AUTOPILOT_GLOW_CLASS = 'motion-safe:animate-[chaya-autopilot-firefly_2.8s_ease-in-out_infinite] motion-reduce:[filter:drop-shadow(0_0_3px_var(--fail))]'

const layer = (radius: number, alpha: number) => `drop-shadow(0 0 ${radius}px color-mix(in oklab, var(--fail) ${Math.round(alpha * 100)}%, transparent))`
const glow = (core: number, halo: number, alpha: number) => `${layer(core, alpha)} ${layer(halo, alpha * 0.6)} ${layer(halo * 2, alpha * 0.3)}`

export function AutopilotGlowKeyframes() {
  return (
    <style>{`
      @keyframes chaya-autopilot-firefly {
        0%, 100% { opacity: 0.35; filter: ${glow(0, 0, 0)}; }
        22% { opacity: 1; filter: ${glow(2, 6, 0.95)}; }
        30% { opacity: 0.7; filter: ${glow(1, 4, 0.5)}; }
        40% { opacity: 1; filter: ${glow(3, 8, 1)}; }
        62% { opacity: 0.5; filter: ${glow(1, 3, 0.3)}; }
        78% { opacity: 0.35; filter: ${glow(0, 0, 0)}; }
      }
    `}</style>
  )
}
