import type { MessageTree } from '@/lib/i18n/messages/types'

type AboutPart = Pick<MessageTree, 'about'>

export const aboutZh = {
  about: {
    sections: '关于分区',
    intro: '介绍',
    tagline: 'RPG Maker MV / MZ 本地工具箱',
    description: 'Chaya 是开源免费的技术工具，提供游戏内修改、实时翻译与 AI 助手，所有操作仅作用于你本机的游戏与存档。',
    version: '版本 {version}',
    openSource: '开源 · MIT',
    license: 'Chaya 是依 MIT 许可证发布的开源项目，源代码公开托管于 GitHub，可免费使用、修改及再分发。',
    usageTitle: '使用方式',
    usagePanel: '在游戏中按 ` 键（反引号）打开或关闭本面板，可在「修改 → 快捷键」中更改。',
    usageEdit: '「修改」：调整金钱、物品、变量、角色等数值，可锁定或一键执行；修改前请备份存档。',
    usageTranslate: '「翻译」：选择翻译引擎后，对白与界面文字将按设置显示译文。',
    usageAgent: '「集成」：通过 MCP 让外部 AI 客户端操作游戏；按 Ctrl / ⌘ + Shift + A 打开 Chaya 助手。',
    usageConsole: '游戏库、插件安装与批量翻译等功能请在 Chaya 控制台中使用。',
    linksTitle: '链接',
    github: 'GitHub 仓库',
    site: '官网与下载',
    issues: '问题反馈',
  },
} as const satisfies AboutPart

export const aboutEn = {
  about: {
    sections: 'About sections',
    intro: 'Introduction',
    tagline: 'Local toolkit for RPG Maker MV / MZ',
    description:
      'Chaya is a free, open-source technical tool offering in-game editing, live translation and an AI assistant. Everything acts only on the games and saves on your own machine.',
    version: 'Version {version}',
    openSource: 'Open source · MIT',
    license:
      'Chaya is an open-source project released under the MIT License. Its source code is hosted publicly on GitHub and may be used, modified and redistributed free of charge.',
    usageTitle: 'How to use',
    usagePanel: 'Press the ` (backtick) key in game to open or close this panel; change it under Edit → Hotkeys.',
    usageEdit: 'Edit: adjust gold, items, variables, actors and more, lock values or run actions; back up your saves first.',
    usageTranslate: 'Translate: pick a translation engine and dialogue and UI text will be shown translated.',
    usageAgent: 'Integrations: let external AI clients control the game via MCP; press Ctrl / ⌘ + Shift + A to open the Chaya assistant.',
    usageConsole: 'Use the Chaya console for the game library, plugin installation and batch translation.',
    linksTitle: 'Links',
    github: 'GitHub repository',
    site: 'Website & downloads',
    issues: 'Report an issue',
  },
} as const satisfies AboutPart

export const aboutJa = {
  about: {
    sections: '概要セクション',
    intro: '紹介',
    tagline: 'RPG Maker MV / MZ 向けローカルツールキット',
    description:
      'Chaya は無償のオープンソース技術ツールで、ゲーム内改造・リアルタイム翻訳・AI アシスタントを提供します。すべての操作はお使いの端末上のゲームとセーブにのみ作用します。',
    version: 'バージョン {version}',
    openSource: 'オープンソース · MIT',
    license: 'Chaya は MIT ライセンスの下で公開されているオープンソースプロジェクトです。ソースコードは GitHub 上で公開されており、無償で利用・改変・再配布できます。',
    usageTitle: '使い方',
    usagePanel: 'ゲーム中に `（バッククォート）キーでこのパネルを開閉します。「編集 → ホットキー」で変更できます。',
    usageEdit: '「編集」：所持金・アイテム・変数・アクターなどを調整し、値の固定や一括実行ができます。事前にセーブをバックアップしてください。',
    usageTranslate: '「翻訳」：翻訳エンジンを選ぶと、会話や UI の文字が設定に従って訳文で表示されます。',
    usageAgent: '「連携」：MCP で外部 AI クライアントからゲームを操作できます。Ctrl / ⌘ + Shift + A で Chaya アシスタントを開きます。',
    usageConsole: 'ゲームライブラリ・プラグイン導入・一括翻訳は Chaya コンソールで利用してください。',
    linksTitle: 'リンク',
    github: 'GitHub リポジトリ',
    site: '公式サイトとダウンロード',
    issues: '不具合の報告',
  },
} as const satisfies AboutPart

export const aboutKo = {
  about: {
    sections: '정보 섹션',
    intro: '소개',
    tagline: 'RPG Maker MV / MZ 로컬 툴킷',
    description: 'Chaya는 무료 오픈소스 기술 도구로, 게임 내 수정·실시간 번역·AI 도우미를 제공합니다. 모든 작업은 사용자 기기의 게임과 세이브에만 적용됩니다.',
    version: '버전 {version}',
    openSource: '오픈소스 · MIT',
    license: 'Chaya는 MIT 라이선스로 배포되는 오픈소스 프로젝트이며, 소스 코드는 GitHub에 공개되어 있어 무료로 사용·수정·재배포할 수 있습니다.',
    usageTitle: '사용 방법',
    usagePanel: '게임 중 `(백틱) 키로 이 패널을 열고 닫습니다. 「수정 → 핫키」에서 변경할 수 있습니다.',
    usageEdit: '「수정」: 소지금·아이템·변수·캐릭터 등을 조정하고 값을 고정하거나 바로 실행할 수 있습니다. 먼저 세이브를 백업하십시오.',
    usageTranslate: '「번역」: 번역 엔진을 선택하면 대사와 UI 문구가 설정에 따라 번역되어 표시됩니다.',
    usageAgent: '「연동」: MCP로 외부 AI 클라이언트가 게임을 조작할 수 있습니다. Ctrl / ⌘ + Shift + A로 Chaya 도우미를 엽니다.',
    usageConsole: '게임 라이브러리·플러그인 설치·일괄 번역은 Chaya 콘솔에서 사용하십시오.',
    linksTitle: '링크',
    github: 'GitHub 저장소',
    site: '공식 사이트 및 다운로드',
    issues: '문제 신고',
  },
} as const satisfies AboutPart
