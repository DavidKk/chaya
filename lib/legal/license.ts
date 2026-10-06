import type { Locale } from '@/lib/i18n/locales'

import type { LegalDoc } from './types'

/** 须与仓库根目录 LICENSE 逐字一致（测试校验） */
export const MIT_LICENSE_TEXT = `MIT License

Copyright (c) 2026 DavidJones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const licenseZh: LegalDoc = {
  intro: [
    'Chaya 是开源项目，源代码公开托管于 GitHub，并依 MIT 许可证发布。任何人均可免费获取、使用、修改及再分发本工具，开发者不就本工具收取任何费用。',
    '本页说明本工具的开源许可及其适用范围。MIT 许可证以英文原文为准，本页的中文说明仅供理解参考。',
  ],
  sections: [
    {
      id: 'mit',
      title: 'MIT 许可证',
      items: [
        '依 MIT 许可证，任何获得本软件副本的人均可免费、不受限制地处理本软件，包括使用、复制、修改、合并、发布、分发、再许可及销售本软件副本的权利。',
        '前述权利的唯一条件是：在本软件的所有副本或主要部分中，保留下方的版权声明及许可声明。',
        '本软件按「现状」提供，不附带任何明示或默示的担保；作者或版权持有人在任何情况下均不对因本软件或其使用而产生的任何索赔、损害或其他责任负责。',
      ],
      verbatim: MIT_LICENSE_TEXT,
    },
    {
      id: 'scope',
      title: '许可范围',
      items: [
        'MIT 许可证仅适用于本项目的源代码及文档。',
        '该许可不授予用户对任何游戏、游戏素材、RPG Maker 及其商标，或任何第三方服务的权利。使用本工具处理的游戏内容，其权利仍归原权利人所有。',
      ],
    },
    {
      id: 'third-party',
      title: '第三方开源组件',
      items: [
        '本工具使用的第三方开源组件（包括 NW.js、React、Next.js 等）依其各自的许可证发布，相关许可证随各组件一并提供。',
        '用户再分发本工具或其中的第三方组件时，应同时遵守相应组件的许可证。',
        '本工具使用的主要第三方组件、图标与字体，及其许可证与作者署名，列于「致谢」。',
      ],
    },
    {
      id: 'contribution',
      title: '贡献',
      items: ['向本项目提交的代码、文档等贡献，除贡献者另有明确声明外，视为贡献者同意依 MIT 许可证授权。'],
    },
    {
      id: 'relation',
      title: '与其他条款的关系',
      items: [
        '《免责声明》与《隐私政策》是对本工具使用行为及数据处理方式的说明，不限制 MIT 许可证授予的权利。',
        '第三方对本工具进行修改或再分发的版本，不属于开发者提供的版本，开发者不对其承担任何责任。',
      ],
    },
  ],
}

const licenseEn: LegalDoc = {
  intro: [
    'Chaya is an open-source project. Its source code is publicly hosted on GitHub and released under the MIT License. Anyone may obtain, use, modify and redistribute the Tool free of charge; the Developers charge no fee for it.',
    'This page describes the open-source license of the Tool and its scope. The English text of the MIT License is authoritative.',
  ],
  sections: [
    {
      id: 'mit',
      title: 'MIT License',
      items: [
        'Under the MIT License, anyone who obtains a copy of the Software may deal in it free of charge and without restriction, including the rights to use, copy, modify, merge, publish, distribute, sublicense and sell copies.',
        'The only condition is that the copyright notice and permission notice below be included in all copies or substantial portions of the Software.',
        'The Software is provided “as is”, without warranty of any kind, and in no event shall the authors or copyright holders be liable for any claim, damages or other liability arising from the Software or its use.',
      ],
      verbatim: MIT_LICENSE_TEXT,
    },
    {
      id: 'scope',
      title: 'Scope of the license',
      items: [
        'The MIT License applies only to the source code and documentation of this project.',
        'It grants no rights in any game, game asset, RPG Maker or its trademarks, or any third-party service. Rights in game content processed with the Tool remain with the original rights holders.',
      ],
    },
    {
      id: 'third-party',
      title: 'Third-party open-source components',
      items: [
        'Third-party open-source components used by the Tool (including NW.js, React and Next.js) are released under their own licenses, which are provided with each component.',
        'When redistributing the Tool or any of its third-party components, you must also comply with the licenses of those components.',
        'The major third-party components, icons and fonts used by the Tool, with their licenses and author attributions, are listed under Credits.',
      ],
    },
    {
      id: 'contribution',
      title: 'Contributions',
      items: [
        'Unless the contributor expressly states otherwise, any code, documentation or other contribution submitted to this project is deemed licensed under the MIT License.',
      ],
    },
    {
      id: 'relation',
      title: 'Relationship with other terms',
      items: [
        'The Disclaimer and the Privacy Policy describe the use of the Tool and how data is handled; they do not restrict the rights granted by the MIT License.',
        'Versions modified or redistributed by third parties are not versions provided by the Developers, and the Developers accept no responsibility for them.',
      ],
    },
  ],
}

const licenseJa: LegalDoc = {
  intro: [
    'Chaya はオープンソースプロジェクトであり、ソースコードは GitHub 上で公開され、MIT ライセンスの下で提供されています。何人も本ツールを無償で入手、利用、改変および再配布することができ、開発者が本ツールについて料金を請求することはありません。',
    '本ページでは、本ツールのオープンソースライセンスとその適用範囲について説明します。MIT ライセンスは英語の原文を正本とし、本ページの日本語の説明は理解のための参考です。',
  ],
  sections: [
    {
      id: 'mit',
      title: 'MIT ライセンス',
      items: [
        'MIT ライセンスに基づき、本ソフトウェアの複製を取得した者は誰でも、本ソフトウェアを無償かつ無制限に扱うことができます。これには、使用、複製、改変、結合、掲載、頒布、サブライセンスおよび販売する権利が含まれます。',
        '上記の権利の唯一の条件は、本ソフトウェアのすべての複製または重要な部分に、下記の著作権表示および許諾表示を記載することです。',
        '本ソフトウェアは「現状のまま」提供され、明示または黙示を問わずいかなる保証も伴わず、作者または著作権者は、本ソフトウェアまたはその使用に起因するいかなる請求、損害その他の責任も負いません。',
      ],
      verbatim: MIT_LICENSE_TEXT,
    },
    {
      id: 'scope',
      title: 'ライセンスの範囲',
      items: [
        'MIT ライセンスは、本プロジェクトのソースコードおよびドキュメントにのみ適用されます。',
        '同ライセンスは、いかなるゲーム、ゲーム素材、RPG Maker およびその商標、または第三者サービスについても権利を付与するものではありません。本ツールで処理したゲームコンテンツの権利は、引き続き原権利者に帰属します。',
      ],
    },
    {
      id: 'third-party',
      title: '第三者のオープンソースコンポーネント',
      items: [
        '本ツールが使用する第三者のオープンソースコンポーネント（NW.js、React、Next.js 等）は、それぞれのライセンスの下で提供されており、当該ライセンスは各コンポーネントとともに提供されます。',
        '本ツールまたはその第三者コンポーネントを再配布する場合は、当該コンポーネントのライセンスもあわせて遵守するものとします。',
        '本ツールが使用する主な第三者コンポーネント、アイコンおよびフォントとそのライセンス・作者表示は「クレジット」に記載しています。',
      ],
    },
    {
      id: 'contribution',
      title: '貢献',
      items: ['本プロジェクトに提出されたコード、ドキュメントその他の貢献は、貢献者が別途明示しない限り、MIT ライセンスの下で許諾されたものとみなします。'],
    },
    {
      id: 'relation',
      title: '他の条項との関係',
      items: [
        '「免責事項」および「プライバシーポリシー」は、本ツールの利用およびデータの取扱いについて説明するものであり、MIT ライセンスが付与する権利を制限するものではありません。',
        '第三者が改変または再配布した版は開発者が提供する版ではなく、開発者はこれについて一切の責任を負いません。',
      ],
    },
  ],
}

const licenseKo: LegalDoc = {
  intro: [
    'Chaya는 오픈소스 프로젝트로, 소스 코드는 GitHub에 공개되어 있으며 MIT 라이선스에 따라 배포됩니다. 누구나 본 도구를 무료로 취득·사용·수정·재배포할 수 있으며, 개발자는 본 도구에 대해 어떠한 비용도 청구하지 않습니다.',
    '본 페이지는 본 도구의 오픈소스 라이선스와 그 적용 범위를 설명합니다. MIT 라이선스는 영어 원문을 기준으로 하며, 본 페이지의 한국어 설명은 이해를 돕기 위한 참고용입니다.',
  ],
  sections: [
    {
      id: 'mit',
      title: 'MIT 라이선스',
      items: [
        'MIT 라이선스에 따라 본 소프트웨어의 사본을 취득한 사람은 누구나 본 소프트웨어를 무료로 제한 없이 다룰 수 있으며, 여기에는 사용, 복제, 수정, 병합, 게시, 배포, 재라이선스 및 사본 판매의 권리가 포함됩니다.',
        '위 권리의 유일한 조건은 본 소프트웨어의 모든 사본 또는 주요 부분에 아래의 저작권 고지 및 허가 고지를 포함하는 것입니다.',
        '본 소프트웨어는 「있는 그대로」 제공되며 명시적이든 묵시적이든 어떠한 보증도 수반하지 않고, 저작자 또는 저작권자는 본 소프트웨어 또는 그 사용으로 인해 발생하는 어떠한 청구, 손해 또는 기타 책임도 지지 않습니다.',
      ],
      verbatim: MIT_LICENSE_TEXT,
    },
    {
      id: 'scope',
      title: '라이선스의 범위',
      items: [
        'MIT 라이선스는 본 프로젝트의 소스 코드 및 문서에만 적용됩니다.',
        '해당 라이선스는 어떠한 게임, 게임 소재, RPG Maker 및 그 상표 또는 제3자 서비스에 대한 권리도 부여하지 않습니다. 본 도구로 처리한 게임 콘텐츠의 권리는 계속해서 원 권리자에게 있습니다.',
      ],
    },
    {
      id: 'third-party',
      title: '제3자 오픈소스 구성 요소',
      items: [
        '본 도구가 사용하는 제3자 오픈소스 구성 요소(NW.js, React, Next.js 등)는 각각의 라이선스에 따라 배포되며, 해당 라이선스는 각 구성 요소와 함께 제공됩니다.',
        '본 도구 또는 그 제3자 구성 요소를 재배포하는 경우 해당 구성 요소의 라이선스도 함께 준수해야 합니다.',
        '본 도구가 사용하는 주요 제3자 구성 요소, 아이콘 및 글꼴과 그 라이선스·저작자 표시는 「크레딧」에 기재되어 있습니다.',
      ],
    },
    {
      id: 'contribution',
      title: '기여',
      items: ['본 프로젝트에 제출된 코드, 문서 등의 기여는 기여자가 별도로 명시하지 않는 한 MIT 라이선스에 따라 허락된 것으로 간주합니다.'],
    },
    {
      id: 'relation',
      title: '다른 조항과의 관계',
      items: [
        '「면책 고지」와 「개인정보 처리방침」은 본 도구의 사용 및 데이터 처리 방식을 설명하는 것으로, MIT 라이선스가 부여하는 권리를 제한하지 않습니다.',
        '제3자가 수정 또는 재배포한 버전은 개발자가 제공하는 버전이 아니며, 개발자는 이에 대해 어떠한 책임도 지지 않습니다.',
      ],
    },
  ],
}

export const LICENSE_DOC: Record<Locale, LegalDoc> = { zh: licenseZh, en: licenseEn, ja: licenseJa, ko: licenseKo }
