import { cn } from '@/lib/utils'

/** Typography for build-time rendered markdown (skills). Tokens only. */
export const markdownBody = cn(
  'min-w-0 text-[13px] leading-[1.7] text-ink',
  '[&_h1]:mt-0 [&_h1]:mb-4 [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-[-0.01em]',
  '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-line [&_h2]:pb-2 [&_h2]:text-base [&_h2]:font-semibold',
  '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold',
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1',
  '[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline',
  '[&_strong]:font-semibold',
  '[&_:not(pre)>code]:rounded-[0.25rem] [&_:not(pre)>code]:bg-inset [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-[0.05rem] [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[12px]',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-[0.35rem] [&_pre]:border [&_pre]:border-line [&_pre]:bg-inset [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-[1.6]',
  '[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[12.5px]',
  '[&_th]:border [&_th]:border-line [&_th]:bg-panel [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:whitespace-nowrap',
  '[&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft'
)
