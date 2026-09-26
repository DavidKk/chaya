import type { MessageTree } from '@/lib/i18n/messages/types'

export const marketingZh = {
  marketing: {
    introAria: '产品介绍',
    heroLine: '让游戏里的每句话，都读得懂。',
    heroCopy: '专为 RPG Maker 本机打造：抽取补译与实时字幕，金钱道具、变量角色也能改——控制台和局内同一套。',
    downloadMac: 'macOS',
    downloadWin: 'Windows',
    orTryBrowser: '或在浏览器试用',
    openConsole: '打开控制台',
    featuresTitle: '从游戏库到局内全程',
    featuresCopy: '装壳启停、多作绑定、翻译与修改，数据都留在你自己的机器上',
    featureLocal: '本机运行',
    featureLocalDesc: '数据与译文留在本机；装壳、启停、插件一站处理，不经云端',
    featureLibrary: '游戏库',
    featureLibraryDesc: '集中绑定多作：路径、壳源、窗口与插件状态一目了然',
    featureRealtime: '翻译管线',
    featureRealtimeDesc: '抽取 seed、缺词补译、共享库；游玩时可实时或字幕翻译',
    featureIngame: '游戏修改',
    featureIngameDesc: '金钱道具变量、角色技能、运行开关与快捷键；控制台与局内同步',
  },
} as const satisfies Pick<MessageTree, 'marketing'>
