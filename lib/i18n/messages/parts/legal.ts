import type { MessageTree } from '@/lib/i18n/messages/types'

type LegalPart = Pick<MessageTree, 'legal'>

export const legalZh = {
  legal: {
    title: '免责声明',
    privacy: '隐私政策',
    license: '开源许可',
    docs: '条款与政策',
    updated: '更新于 {date}',
    back: '返回',
    link: '免责声明',
    noticeAria: '使用须知',
    translate:
      '译文仅供个人使用。本工具不提供任何分发服务，用户自行分发译文或数据文件所产生的责任由用户承担；作品权利人明确禁止翻译或修改的，不得使用。使用云端引擎时，文本将传输至相应服务提供者。',
    edit: '修改功能仅作用于本地游戏与存档，可能导致运行异常或存档损坏，请事先备份；不得用于联网、排行或作品条款禁止的场景，由此产生的后果由用户承担。',
    agent: 'AI 助手将读取游戏状态并代为执行操作，相关内容将传输至用户配置的模型服务；AI 生成的结果可能有误，开发者不承担责任。',
    integration: '经授权接入的外部 AI 客户端可读取并操作游戏，请仅连接可信任的客户端；由此产生的后果由用户自行承担。',
    library: '安装插件将向游戏目录写入文件，请事先备份；仅限用于用户合法取得、且作品条款未禁止修改的游戏。',
    marketing: 'Chaya 为开源免费的技术工具，不提供任何游戏、译文或分发服务，与 RPG Maker 及各作品权利人无关联。使用本工具即视为同意',
  },
} as const satisfies LegalPart

export const legalEn = {
  legal: {
    title: 'Disclaimer',
    privacy: 'Privacy Policy',
    license: 'Open-source License',
    docs: 'Terms and policies',
    updated: 'Updated {date}',
    back: 'Back',
    link: 'Disclaimer',
    noticeAria: 'Usage notice',
    translate:
      'Translations are for personal use only. The Tool provides no distribution service; you are solely responsible for any distribution of translations or data files. Do not use it on works whose rights holders expressly prohibit translation or modification. Cloud engines transmit text to their providers.',
    edit: 'Editing features act only on the local game and saves and may cause malfunctions or corrupt saves; back up beforehand. Do not use them online, on leaderboards or where the work’s terms prohibit it. You bear all resulting consequences.',
    agent:
      'The AI assistant reads game state and performs actions on your behalf; related content is transmitted to the model service you configured. AI output may be erroneous, and the developers accept no responsibility for it.',
    integration: 'Authorized external AI clients can read and control the game. Connect only trusted clients; you bear all resulting consequences.',
    library: 'Installing the plugin writes files into the game folder; back up beforehand. Use only with games you lawfully obtained whose terms do not prohibit modification.',
    marketing:
      'Chaya is a free, open-source technical tool. It provides no games, translations or distribution services and is not affiliated with RPG Maker or any rights holder. Use of the Tool constitutes acceptance of the',
  },
} as const satisfies LegalPart

export const legalJa = {
  legal: {
    title: '免責事項',
    privacy: 'プライバシーポリシー',
    license: 'オープンソースライセンス',
    docs: '規約とポリシー',
    updated: '{date} 更新',
    back: '戻る',
    link: '免責事項',
    noticeAria: 'ご利用上の注意',
    translate:
      '訳文は個人での利用に限ります。本ツールは配布サービスを一切提供せず、訳文またはデータファイルを配布した場合の責任は利用者が負います。権利者が翻訳・改変を明示的に禁止している作品には使用できません。クラウドエンジン利用時はテキストが各事業者へ送信されます。',
    edit: '改造機能はローカルのゲームとセーブにのみ作用し、動作不良やセーブ破損の原因となる場合があります。事前にバックアップしてください。オンライン・ランキング・規約で禁止された場面では使用できず、その結果は利用者が負担します。',
    agent:
      'AI アシスタントはゲームの状態を読み取り代わりに操作を実行し、関連内容は利用者が設定したモデルサービスへ送信されます。AI の生成結果には誤りが含まれる可能性があり、開発者は責任を負いません。',
    integration: '許可された外部 AI クライアントはゲームを読み取り・操作できます。信頼できるクライアントのみを接続してください。その結果は利用者が負担します。',
    library: 'プラグインの導入はゲームフォルダにファイルを書き込みます。事前にバックアップしてください。適法に取得し、規約で改変が禁止されていない作品に限り使用できます。',
    marketing:
      'Chaya は無償のオープンソース技術ツールであり、ゲーム・訳文・配布サービスを一切提供せず、RPG Maker および各権利者とは無関係です。本ツールの利用をもって次に同意したものとみなします：',
  },
} as const satisfies LegalPart

export const legalKo = {
  legal: {
    title: '면책 고지',
    privacy: '개인정보 처리방침',
    license: '오픈소스 라이선스',
    docs: '약관 및 정책',
    updated: '{date} 업데이트',
    back: '돌아가기',
    link: '면책 고지',
    noticeAria: '이용 안내',
    translate:
      '번역문은 개인 용도로만 사용할 수 있습니다. 본 도구는 어떠한 배포 서비스도 제공하지 않으며, 번역문 또는 데이터 파일 배포에 따른 책임은 사용자에게 있습니다. 권리자가 번역·수정을 명시적으로 금지한 작품에는 사용할 수 없습니다. 클라우드 엔진 사용 시 텍스트가 해당 업체로 전송됩니다.',
    edit: '수정 기능은 로컬 게임과 세이브에만 적용되며 오작동이나 세이브 손상을 일으킬 수 있으니 미리 백업하십시오. 온라인·랭킹·작품 약관이 금지하는 상황에서는 사용할 수 없으며, 그 결과는 사용자가 부담합니다.',
    agent:
      'AI 도우미는 게임 상태를 읽고 대신 조작을 수행하며, 관련 내용은 사용자가 설정한 모델 서비스로 전송됩니다. AI 생성 결과에는 오류가 있을 수 있으며 개발자는 책임지지 않습니다.',
    integration: '허가된 외부 AI 클라이언트는 게임을 읽고 조작할 수 있습니다. 신뢰하는 클라이언트만 연결하십시오. 그 결과는 사용자가 부담합니다.',
    library: '플러그인 설치 시 게임 폴더에 파일이 기록되니 미리 백업하십시오. 적법하게 취득하고 약관이 수정을 금지하지 않는 게임에만 사용할 수 있습니다.',
    marketing:
      'Chaya는 무료 오픈소스 기술 도구로서 게임·번역문·배포 서비스를 일절 제공하지 않으며 RPG Maker 및 각 권리자와 무관합니다. 본 도구를 사용하면 다음에 동의한 것으로 간주됩니다:',
  },
} as const satisfies LegalPart
