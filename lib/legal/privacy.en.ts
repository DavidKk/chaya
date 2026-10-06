import type { LegalDoc } from './types'

export const privacyEn: LegalDoc = {
  intro: [
    'This Privacy Policy explains how the Chaya open-source software and its related website, plugins and documentation (collectively, the “Tool”) handle data. “Developers” means the authors and contributors of the Tool.',
    'The Tool requires no account. The Developers do not actively request your name, contact details or identification numbers, and do not sell or rent user data. The online site’s hosting provider may process IP addresses and request metadata, as described below.',
  ],
  sections: [
    {
      id: 'scope',
      title: 'Scope',
      items: [
        'This Policy applies to the local edition (desktop app, local service and game plugins) and to the online website deployed by the Developers.',
        'Versions you deploy or modify yourself, or that third parties redistribute, are the responsibility of the respective deployer or distributor and are not covered by this Policy.',
        'Third-party services you choose to use (including translation and AI model services) process data under their own privacy policies.',
      ],
    },
    {
      id: 'local',
      title: 'Local edition',
      items: [
        'Settings, translation caches, logs, backups, game library records and any API keys you enter are stored on your own device and are never transmitted to the Developers.',
        'The local edition contains no telemetry, analytics or crash reporting. Apart from third-party services you enable, the Tool does not send game text, saves or other content to any external party.',
        'Some data, such as translation caches, is stored inside the game folder. Before sharing, uploading or transferring a game folder, check for and remove any data you do not wish to include.',
      ],
    },
    {
      id: 'online',
      title: 'Online edition',
      items: [
        'Game folders: only after you grant access in the browser does the online edition read and write the selected game folder, locally within the browser; file contents are not uploaded. Folder permissions are kept in your browser’s local storage.',
        'Translation: the online edition does not query the Developers’ shared translation library. The game process on your device sends translation requests to your selected translation service; the text does not pass through the Developers’ servers.',
        'Game link: when the online edition connects to a game, the Developers’ service temporarily holds the session description required for the connection (which includes connection candidates such as network addresses) and a link token, and may use the requesting IP address for abuse protection. This information is kept in service memory only to establish the connection and is not persisted. Once connected, game data flows directly between your browser and the game. To discover usable network addresses, the browser contacts a STUN service provided by Cloudflare.',
        'Analytics: the online edition uses Vercel Web Analytics to measure page visits, collecting aggregated information such as page path, referrer, browser and operating system, device type and country or region. The service uses no cookies, and the Developers do not use it to identify individuals.',
        'Server logs: the online edition is hosted on Vercel, which may record access logs such as IP address, request time and request path under its own policies to operate and secure the service.',
      ],
    },
    {
      id: 'storage',
      title: 'Cookies and browser storage',
      items: [
        'The Tool uses a single cookie to remember your interface language and uses no advertising or cross-site tracking cookies.',
        'The Tool uses localStorage, sessionStorage and IndexedDB to keep settings, view state, game library folder permissions and AI assistant configuration. This data exists only in your browser and can be deleted at any time by clearing this site’s data.',
      ],
    },
    {
      id: 'third-party',
      title: 'Third-party services',
      items: [
        'When you enable Google, Bing, cloud AI or other third-party services, the relevant text (and, for the AI assistant, possibly screenshots) is sent directly from your device to that third party, subject to its terms and privacy policy. Whether to enable such services, and what to send, is your decision.',
        'The Tool relies on GitHub for downloads, release information and issue reports; GitHub’s privacy policy applies when you visit GitHub.',
        'Local models (such as Ollama) run on your device and transmit no text externally.',
      ],
    },
    {
      id: 'security',
      title: 'Data security',
      items: [
        'The Developers take reasonable measures to protect data processed by their services but cannot guarantee that any method of transmission or storage is completely secure.',
        'Sensitive information such as API keys is stored on your device or in your browser. Keep your device and browser secure, do not store keys on shared devices and do not provide them to untrusted clients.',
      ],
    },
    {
      id: 'minors',
      title: 'Minors',
      items: [
        'The Tool is not designed for children, and the Developers do not knowingly collect children’s personal information. Minors should use the Tool under the guidance of a guardian and observe local age restrictions on game content.',
      ],
    },
    {
      id: 'rights',
      title: 'Your rights',
      items: [
        'You can manage data on your device and in your browser by deleting local data, clearing this site’s browser data or uninstalling the Tool. The hosting provider retains online site logs under its own policies; for questions, contact the Developers through the project’s GitHub Issues.',
        'Questions about this Policy may be raised with the Developers through the project’s GitHub Issues.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this Policy',
      items: [
        'If data handling changes, the Developers will update this Policy in advance and revise the date at the top. Amendments take effect on the date they are published on this page.',
        'The Chinese version of this Policy prevails; other language versions are for reference only.',
      ],
    },
  ],
}
