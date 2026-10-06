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
    translate: '译文的公开使用可能需要作品权利人许可；请核对作品条款。本工具不分发游戏或译文。使用云端引擎时，文本将传输至相应服务提供者。',
    edit: '修改功能仅作用于本地游戏与存档，可能导致运行异常或存档损坏，请事先备份；用于联网、排行等场景可能违反作品或平台规则。',
    agent: 'AI 助手将读取游戏状态并代为执行操作，相关内容将传输至用户配置的模型服务；AI 生成的结果可能有误，开发者不承担责任。',
    integration: '经授权接入的外部 AI 客户端可读取并操作游戏，请仅连接可信任的客户端；由此产生的后果由用户自行承担。',
    library: '安装插件将向游戏目录写入文件，请事先备份，并核对作品条款及相关权利。',
    marketing: 'Chaya 为开源免费的技术工具，不提供游戏或译文，与 RPG Maker 及各作品权利人无关联。使用风险详见',
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
      'Public use of translations may require the rights holder’s permission; check the work’s terms. The Tool does not distribute games or translations. Cloud engines transmit text to their providers.',
    edit: 'Editing features act only on the local game and saves and may cause malfunctions or corrupt saves; back up beforehand. Use in online play or leaderboards may breach work or platform rules.',
    agent:
      'The AI assistant reads game state and performs actions on your behalf; related content is transmitted to the model service you configured. AI output may be erroneous, and the developers accept no responsibility for it.',
    integration: 'Authorized external AI clients can read and control the game. Connect only trusted clients; you bear all resulting consequences.',
    library: 'Installing the plugin writes files into the game folder; back up beforehand and check the work’s terms and applicable rights.',
    marketing:
      'Chaya is a free, open-source technical tool. It provides no games or translations and is not affiliated with RPG Maker or any rights holder. For usage risks, see the',
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
      '訳文の公開には権利者の許諾が必要な場合があります。作品の規約をご確認ください。本ツールはゲームや訳文を配布しません。クラウドエンジン利用時はテキストが各事業者へ送信されます。',
    edit: '改造機能はローカルのゲームとセーブにのみ作用し、動作不良やセーブ破損の原因となる場合があります。事前にバックアップしてください。オンラインやランキングでの利用は規約違反となる可能性があります。',
    agent:
      'AI アシスタントはゲームの状態を読み取り代わりに操作を実行し、関連内容は利用者が設定したモデルサービスへ送信されます。AI の生成結果には誤りが含まれる可能性があり、開発者は責任を負いません。',
    integration: '許可された外部 AI クライアントはゲームを読み取り・操作できます。信頼できるクライアントのみを接続してください。その結果は利用者が負担します。',
    library: 'プラグインの導入はゲームフォルダにファイルを書き込みます。事前にバックアップし、作品の規約と権利をご確認ください。',
    marketing: 'Chaya は無償のオープンソース技術ツールであり、ゲームや訳文を提供せず、RPG Maker および各権利者とは無関係です。利用上のリスクについては次をご覧ください：',
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
      '번역문 공개에는 권리자의 허락이 필요할 수 있으므로 작품 약관을 확인하십시오. 본 도구는 게임이나 번역문을 배포하지 않습니다. 클라우드 엔진 사용 시 텍스트가 해당 업체로 전송됩니다.',
    edit: '수정 기능은 로컬 게임과 세이브에만 적용되며 오작동이나 세이브 손상을 일으킬 수 있으니 미리 백업하십시오. 온라인이나 랭킹에서 사용하면 규정에 위반될 수 있습니다.',
    agent:
      'AI 도우미는 게임 상태를 읽고 대신 조작을 수행하며, 관련 내용은 사용자가 설정한 모델 서비스로 전송됩니다. AI 생성 결과에는 오류가 있을 수 있으며 개발자는 책임지지 않습니다.',
    integration: '허가된 외부 AI 클라이언트는 게임을 읽고 조작할 수 있습니다. 신뢰하는 클라이언트만 연결하십시오. 그 결과는 사용자가 부담합니다.',
    library: '플러그인 설치 시 게임 폴더에 파일이 기록되니 미리 백업하고 작품 약관과 관련 권리를 확인하십시오.',
    marketing: 'Chaya는 무료 오픈소스 기술 도구로서 게임이나 번역문을 제공하지 않으며 RPG Maker 및 각 권리자와 무관합니다. 사용상의 위험은 다음을 참조하십시오:',
  },
} as const satisfies LegalPart
