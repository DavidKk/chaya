# Chaya: instalação e modos

Chaya gerencia jogos RPG Maker, NW.js, plugins, edição, tradução, registros e MCP.

## Escolher o modo

- **local**: App (macOS / Windows) ou desenvolvimento local; biblioteca completa, inicialização, tradução local e MCP. Os dados do App ficam na pasta de aplicativos do sistema.
- **cloud**: abrir `https://chaya-gray.vercel.app` no Chrome / Microsoft Edge, permitir leitura e escrita de uma pasta com `www` ou `index.html` e instalar plugins e ambiente NW.js. Iniciar o jogo manualmente. A página não inicia processos nem fornece modelos locais ou a biblioteca compartilhada do serviço local.
- **plugin**: funciona dentro do jogo aberto, mesmo sem console. MCP oferece controle, edição, tradução, cache, registros e conhecimentos do jogo; não inclui gestão da biblioteca, inicialização, batch ou eval. Cloud completa traduções com `chaya_translate_job` do jogo conectado.

## Instalar App / desenvolvimento

Escolher Apple Silicon, Intel Mac ou Windows x64 nos downloads da página inicial. Instalação no Terminal do macOS:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

Ou descompactar e arrastar `Chaya.app` para Aplicativos. Se aparecer “danificado”, executar `xattr -cr /Applications/Chaya.app` ou botão direito → Abrir → Abrir. No Windows, descompactar e executar `Chaya.exe`. Console padrão do App: `http://127.0.0.1:3927`.

Desenvolvimento exige Node ≥ 22.19 e pnpm 9:

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

Abrir `http://localhost:3000`. `pnpm dev:lan` permite acesso pela LAN; `pnpm dev:app` inclui Electron. O seletor de desenvolvimento oferece Local / Cloud; alterações no código recompilam os plugins.

## Acesso e problemas

Sem login. A API local aceita apenas solicitações da mesma origem de localhost, IP ou `CHAYA_PUBLIC_ORIGIN`. Em caso de 401 com domínio personalizado, definir essa variável e reiniciar. O token do plugin é limitado à própria sessão; reiniciar o jogo após atualizações. Se 3000 / 3927 estiverem ocupadas, fechar outras instâncias ou definir `PORT` do App.

MCP: `http://127.0.0.1:39271/mcp`. Ao alterar a porta em Integração → MCP no jogo, atualizar o cliente. Com local ativo, o gateway encaminha para o MCP local. Se Cloud não permitir escolher uma pasta, usar Chrome / Microsoft Edge para desktop e conceder acesso; depois abrir `Chaya.app` / `Chaya` no computador.
