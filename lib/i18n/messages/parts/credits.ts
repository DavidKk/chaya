import type { MessageTree } from '@/lib/i18n/messages/types'

type CreditsPart = Pick<MessageTree, 'credits'>

export const creditsZh = {
  credits: {
    title: '致谢',
    toolsTitle: '主要开源工具',
    toolsDesc: 'Chaya 构建于以下开源项目与素材之上，各项目依其各自的许可证使用；标注作者的素材依许可要求署名。',
    groupPlatform: '运行时与框架',
    groupUi: '界面',
    groupText: '文本、翻译与数据',
    groupAi: 'AI 与接入',
    groupBuild: '构建与测试',
    groupAssets: '图标与字体',
    thanksTitle: '感谢名单',
    thanksContributors: '所有为 Chaya 提交代码、文档、翻译与问题反馈的贡献者。',
    thanksMaintainers: '上述开源项目的作者与维护者，以及为其付出时间的社区成员。',
    thanksCreators: '允许并支持玩家自行翻译与游玩的 RPG Maker 作品创作者。',
    thanksCommunity: '在 RPG Maker 社区中分享插件、工具与经验的开发者。',
    thanksPlayers: '试用 Chaya 并提出建议的每一位玩家。',
    contributorsLink: '查看 GitHub 贡献者',
  },
} as const satisfies CreditsPart

export const creditsEn = {
  credits: {
    title: 'Credits',
    toolsTitle: 'Major open-source tools',
    toolsDesc:
      'Chaya is built on the following open-source projects and assets, each used under its own license; assets with a listed author are attributed as their licenses require.',
    groupPlatform: 'Runtime and frameworks',
    groupUi: 'Interface',
    groupText: 'Text, translation and data',
    groupAi: 'AI and integrations',
    groupBuild: 'Build and testing',
    groupAssets: 'Icons and fonts',
    thanksTitle: 'Thanks',
    thanksContributors: 'Everyone who has contributed code, documentation, translations or issue reports to Chaya.',
    thanksMaintainers: 'The authors and maintainers of the projects above, and the community members who give them their time.',
    thanksCreators: 'RPG Maker creators who allow and support players translating and playing their works.',
    thanksCommunity: 'Developers who share plugins, tools and knowledge in the RPG Maker community.',
    thanksPlayers: 'Every player who has tried Chaya and shared feedback.',
    contributorsLink: 'View contributors on GitHub',
  },
} as const satisfies CreditsPart

export const creditsJa = {
  credits: {
    title: 'クレジット',
    toolsTitle: '主なオープンソースツール',
    toolsDesc:
      'Chaya は以下のオープンソースプロジェクトと素材の上に構築されており、各プロジェクトはそれぞれのライセンスに従って利用しています。作者を記載した素材は、ライセンスの定めに従いクレジットを表示しています。',
    groupPlatform: 'ランタイムとフレームワーク',
    groupUi: 'インターフェース',
    groupText: 'テキスト・翻訳・データ',
    groupAi: 'AI と連携',
    groupBuild: 'ビルドとテスト',
    groupAssets: 'アイコンとフォント',
    thanksTitle: '謝辞',
    thanksContributors: 'Chaya にコード、ドキュメント、翻訳、不具合報告を寄せてくださったすべての貢献者の皆さま。',
    thanksMaintainers: '上記オープンソースプロジェクトの作者・メンテナー、ならびにそのために時間を割いてくださるコミュニティの皆さま。',
    thanksCreators: 'プレイヤーによる翻訳とプレイを認め、支えてくださる RPG Maker 作品の制作者の皆さま。',
    thanksCommunity: 'RPG Maker コミュニティでプラグイン、ツール、知見を共有してくださる開発者の皆さま。',
    thanksPlayers: 'Chaya を試し、ご意見をお寄せくださったすべてのプレイヤーの皆さま。',
    contributorsLink: 'GitHub の貢献者を見る',
  },
} as const satisfies CreditsPart

export const creditsKo = {
  credits: {
    title: '크레딧',
    toolsTitle: '주요 오픈소스 도구',
    toolsDesc:
      'Chaya는 다음 오픈소스 프로젝트와 소재를 기반으로 만들어졌으며, 각 프로젝트는 해당 라이선스에 따라 사용됩니다. 저작자가 표기된 소재는 라이선스 요건에 따라 저작자를 표시합니다.',
    groupPlatform: '런타임 및 프레임워크',
    groupUi: '인터페이스',
    groupText: '텍스트·번역·데이터',
    groupAi: 'AI 및 연동',
    groupBuild: '빌드 및 테스트',
    groupAssets: '아이콘 및 글꼴',
    thanksTitle: '감사의 말',
    thanksContributors: 'Chaya에 코드, 문서, 번역, 문제 신고를 보내 주신 모든 기여자분들.',
    thanksMaintainers: '위 오픈소스 프로젝트의 저작자와 메인테이너, 그리고 이를 위해 시간을 내어 주신 커뮤니티 구성원분들.',
    thanksCreators: '플레이어의 번역과 플레이를 허용하고 지지해 주시는 RPG Maker 작품 제작자분들.',
    thanksCommunity: 'RPG Maker 커뮤니티에서 플러그인, 도구, 노하우를 공유해 주시는 개발자분들.',
    thanksPlayers: 'Chaya를 사용해 보고 의견을 보내 주신 모든 플레이어분들.',
    contributorsLink: 'GitHub 기여자 보기',
  },
} as const satisfies CreditsPart
