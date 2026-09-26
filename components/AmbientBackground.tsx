/** 简单自驱动氛围背景，无指针交互 */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes ambient-orb-a {
          from { transform: translate3d(0, 0, 0) scale(1); opacity: 0.42; }
          to { transform: translate3d(18%, 14%, 0) scale(1.14); opacity: 0.78; }
        }
        @keyframes ambient-orb-b {
          from { transform: translate3d(0, 0, 0) scale(1); opacity: 0.3; }
          to { transform: translate3d(-16%, -12%, 0) scale(1.18); opacity: 0.62; }
        }
        @keyframes ambient-orb-c {
          from { transform: translate3d(0, 0, 0) scale(0.92); opacity: 0.22; }
          to { transform: translate3d(10%, -16%, 0) scale(1.2); opacity: 0.48; }
        }
        @keyframes ambient-breathe {
          from { opacity: 0.85; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ambient-orb, .ambient-rim { animation: none !important; }
        }
      `}</style>
      <span
        className="ambient-orb absolute rounded-full blur-[72px] will-change-[transform,opacity]"
        style={{
          width: 'min(58vw, 32rem)',
          height: 'min(58vw, 32rem)',
          left: '-12%',
          top: '4%',
          background: 'radial-gradient(circle, color-mix(in oklab, var(--accent) 48%, transparent) 0%, transparent 70%)',
          opacity: 0.68,
          animation: 'ambient-orb-a 16s ease-in-out infinite alternate',
        }}
      />
      <span
        className="ambient-orb absolute rounded-full blur-[72px] will-change-[transform,opacity]"
        style={{
          width: 'min(50vw, 28rem)',
          height: 'min(50vw, 28rem)',
          right: '-10%',
          bottom: '0%',
          background: 'radial-gradient(circle, color-mix(in oklab, var(--ok) 32%, transparent) 0%, transparent 72%)',
          opacity: 0.5,
          animation: 'ambient-orb-b 22s ease-in-out infinite alternate',
        }}
      />
      <span
        className="ambient-orb absolute rounded-full blur-[72px] will-change-[transform,opacity]"
        style={{
          width: 'min(36vw, 20rem)',
          height: 'min(36vw, 20rem)',
          left: '38%',
          top: '42%',
          background: 'radial-gradient(circle, color-mix(in oklab, var(--info) 28%, transparent) 0%, transparent 70%)',
          opacity: 0.42,
          animation: 'ambient-orb-c 26s ease-in-out infinite alternate',
        }}
      />
      <span
        className="ambient-rim absolute inset-0"
        style={{
          boxShadow: 'inset 0 0 120px rgb(0 0 0 / 0.55)',
          background: 'radial-gradient(ellipse 90% 70% at 50% 45%, transparent 40%, color-mix(in oklab, var(--paper) 55%, transparent) 100%)',
          animation: 'ambient-breathe 12s ease-in-out infinite alternate',
        }}
      />
    </div>
  )
}
