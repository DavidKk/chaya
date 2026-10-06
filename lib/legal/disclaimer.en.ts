import type { DisclaimerDoc } from './disclaimer'

export const disclaimerEn: DisclaimerDoc = {
  intro: [
    'This Disclaimer applies to the Chaya open-source software and its related website, plugins and documentation (collectively, the “Tool”). “Developers” means the authors and contributors of the Tool. The Tool is provided free of charge by the Developers as open source and offers only technical features such as translation, editing and AI assistance.',
    'Please read this Disclaimer before use to understand risks concerning rights in works, third-party services and data security. It adds no software-use restrictions beyond the Tool’s MIT License.',
  ],
  sections: [
    {
      id: 'nature',
      title: 'Nature of the Tool',
      items: [
        'The Tool is a neutral technical tool. Except for third-party services you choose to use, its features run on your own device against games you select. The Developers do not provide, host, sell or distribute any game, game asset, translation or derivative thereof.',
        'The Tool is not affiliated with, authorized, approved or endorsed by Gotcha Gotcha Games, KADOKAWA Corporation, or any game author or publisher.',
        '“RPG Maker”, “RPGツクール” and related names and marks are trademarks of their respective owners and are used solely in a nominative manner to describe compatibility.',
      ],
    },
    {
      id: 'terms',
      title: 'Lawful use and the terms of each work',
      items: [
        'Processing game content obtained unlawfully may infringe rights; comply with the laws of your jurisdiction.',
        'Before processing game content, review the work’s documentation and license terms and the rules of its distribution platform (including DLsite and Steam). Where the rights holder expressly prohibits translation, modification, analysis or other secondary use, those actions may infringe rights or breach terms; confirm whether you have permission or a right under applicable law.',
        'You are solely responsible for confirming that your use is authorized by the rights holder or otherwise permitted by applicable law. You bear all consequences of any breach of a work’s terms or of applicable law.',
      ],
    },
    {
      id: 'translation',
      title: 'Translation and imported data',
      items: [
        'The Tool can be used for personal study and understanding of game content. Other uses of translations may require the rights holder’s permission under the work’s terms or applicable law.',
        'Machine and AI translations may contain errors or inaccuracies and do not represent the original author’s intent. The Developers make no warranty as to the accuracy, completeness or fitness of any translation.',
        'The Tool allows you to import translation data you have obtained yourself. The Developers neither provide nor review any such data. You shall ensure it comes from a lawful source with any necessary authorization, and you bear all consequences of importing it.',
      ],
    },
    {
      id: 'distribution',
      title: 'No distribution services',
      items: [
        'The Developers do not host, distribute or share games, game assets, translations, translation patches, translation caches or modified games. Download links may provide this project’s own installers and third-party runtimes such as NW.js.',
        'Game files, translation caches and saves are stored locally. For transfers to third-party services you choose and the online site’s connection metadata, see the Privacy Policy.',
        'The Tool stores translation caches, plugins and other files in the game folder and in its local data folder. Before providing game files to anyone, you shall make sure they do not contain such files.',
        'Publishing, sharing or selling translations or modified game content may require the rights holder’s permission. Check the work’s terms and applicable law before displaying such content in streams, videos or screenshots.',
        'Any distribution or public display you carry out is your own independent act and is unrelated to the Developers. You alone bear all resulting liability for infringement, legal disputes and any other consequences.',
      ],
    },
    {
      id: 'third-party',
      title: 'Third-party services',
      items: [
        'When you choose to use third-party services such as Google, Bing or cloud AI, the game text to be processed (and, for AI assistant features, possibly screenshots) is transmitted to that provider and is governed by its terms of service, usage policies and privacy policy. The provider may store or use the content it receives in accordance with its policies.',
        'You are responsible for ensuring that the content you transmit complies with the third party’s usage policies. The Developers are not responsible for the availability, data handling or consequences of any third-party service.',
        'You manage and bear your own API keys, usage quotas and related costs. Local models (such as Ollama) run on your device and do not transmit text externally.',
      ],
    },
    {
      id: 'content',
      title: 'Game content',
      items: [
        'The Tool does not review the content of the games you select and is not responsible for its legality. Where a game contains adult or otherwise restricted content, you shall comply with the age-restriction and content laws of your jurisdiction.',
      ],
    },
    {
      id: 'edit',
      title: 'Editing, speed-up and save data',
      items: [
        'Features such as value editing, speed-up, teleport, and event and save editing operate only on the game process and save files on your local device.',
        'These features may cause malfunctions, corrupt saves or loss of progress. You shall make your own backups before use and bear any loss arising from their use.',
        'Using these features in online play, multiplayer, leaderboards, achievement systems or other contexts affecting third parties may breach work or platform rules and lead to account penalties.',
      ],
    },
    {
      id: 'protection',
      title: 'Technical protection measures',
      items: [
        'The Tool does not provide, and will not add, any feature for circumventing technical protection measures, such as decrypting protected assets, cracking encrypted saves, bypassing activation or digital rights management (DRM), or unlocking paid content.',
        'Circumventing technical protection measures may carry legal and contractual risks; check the applicable rules.',
      ],
    },
    {
      id: 'install',
      title: 'Writing to the game folder',
      items: [
        'Installing the plugin or unified shell writes or replaces files in the game folder, which may conflict with a work’s terms or anti-tamper mechanisms. You are responsible for confirming that doing so is lawful and appropriate.',
        'The plugin may be uninstalled at any time. You shall back up the game folder before modifying it.',
      ],
    },
    {
      id: 'software',
      title: 'Third-party software',
      items: [
        'Third-party software that the Tool obtains or provides to run games, such as NW.js, and the open-source components the Tool depends on are governed by their respective licenses, and all rights therein belong to their owners.',
      ],
    },
    {
      id: 'agent',
      title: 'AI assistant and external connections',
      items: [
        'The built-in AI assistant, and any external AI client you authorize to connect via MCP / WebMCP, can read game state and the screen and perform actions on your behalf. You shall connect only clients you trust.',
        'AI-generated content and actions may be erroneous or differ from expectations. The Developers accept no responsibility for their results.',
      ],
    },
    {
      id: 'security',
      title: 'Security',
      items: [
        'The Developers do not warrant that the Tool is free of defects or security vulnerabilities. If you expose the Tool’s services to a local network or the internet, enable debugging features (including arbitrary script execution) or connect external clients, you do so at your own risk.',
      ],
    },
    {
      id: 'privacy',
      title: 'Data and privacy',
      items: [
        'Translation caches, settings, logs, backups and other data produced by the desktop version are stored on your local device. The Developers do not upload your game files to the Developers’ servers.',
        'The online version reads and writes the game folder you select only after your authorization, locally within your browser, and does not upload file contents. It does not query the Developers’ shared translation library; the game process on your device sends translation requests to your selected service without passing text through the Developers’ servers.',
        'The Developers will update this Disclaimer in advance of any change to these data practices.',
        'For a complete description of data handling, see the Privacy Policy.',
      ],
    },
    {
      id: 'warranty',
      title: 'Disclaimer of warranties and limitation of liability',
      items: [
        'The Tool is provided “as is”, without warranty of any kind, express or implied, including as to availability, accuracy, compatibility, security or fitness for a particular purpose.',
        'To the maximum extent permitted by applicable law, the Developers shall not be liable for any direct, indirect, incidental, special or consequential loss arising from the use of or inability to use the Tool, including but not limited to corrupted saves, data loss, account penalties and third-party claims.',
      ],
    },
    {
      id: 'indemnity',
      title: 'User responsibility and indemnification',
      items: [
        'You are solely and fully legally responsible for the manner in which you use the Tool, the works you use it on, and all resulting consequences.',
        'Unauthorized distribution of translations or modified content may lead to third-party claims; responsibility is determined by the work’s terms and applicable law.',
      ],
    },
    {
      id: 'license',
      title: 'Relationship to the open-source license',
      items: [
        'The Tool’s source code is released under the MIT License. This Disclaimer describes risks concerning rights in works and use of the Tool; it adds no software-use conditions and does not restrict rights granted by the MIT License.',
        'Versions of the Tool modified or redistributed by third parties are not versions provided by the Developers, and the Developers accept no responsibility for them.',
        'For the open-source license of the Tool and its scope, see the Open-source License page.',
      ],
    },
    {
      id: 'rights',
      title: 'Notices from rights holders',
      items: [
        'A rights holder who believes that any feature of the Tool infringes its lawful rights may contact the Developers through the project’s GitHub Issues. The Developers will take reasonable measures upon verification.',
      ],
    },
    {
      id: 'misc',
      title: 'Miscellaneous',
      items: [
        'If any provision of this Disclaimer is held invalid or unenforceable, the remaining provisions remain in full force and effect.',
        'The Chinese version of this Disclaimer prevails; versions in other languages are provided for reference only.',
        'The Developers may update this Disclaimer as needed and note the update date on this page. Updates do not change the rights granted by the MIT License.',
      ],
    },
  ],
}
