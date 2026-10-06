export type LegalSection = {
  id: string
  title: string
  items: readonly string[]
  /** 需原样展示的文本（如许可证原文），按等宽块渲染 */
  verbatim?: string
}

export type LegalDoc = { intro: readonly string[]; sections: readonly LegalSection[] }
