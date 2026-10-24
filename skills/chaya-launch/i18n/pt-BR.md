# Chaya: preparar e iniciar um jogo

## Preparação

1. **local** (App / desenvolvimento): escolher `www`, a pasta de distribuição que o contém ou um pacote macOS `.app` / Windows `Game.exe` na biblioteca. A raiz MV / MZ é detectada. Remover da biblioteca apaga apenas o registro.
2. **cloud**: no Chrome / Microsoft Edge, permitir leitura e escrita da pasta com `www` ou `index.html`.
3. Instalar o ambiente NW.js compartilhado nos detalhes da biblioteca (cerca de 100 MB); jogos com ambiente próprio dispensam isso.
4. Instalar plugins e reiniciar após cada atualização. A inicialização local também os injeta automaticamente.

Se o ambiente macOS não abrir, fechar o jogo, executar no Terminal, seguir a escolha da pasta e abrir `Chaya.app`. Os jogos salvos são preservados e o ambiente antigo recebe backup:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
```

## Plugins e uso

`ChayaLoader` carrega com cache offline; `ChayaLog` registra; `ChayaTrans` traduz; `ChayaBoost` controla velocidade (`on()` / `off()`); `ChayaEdit` edita, teleporta e salva / carrega (`help()`); `ChayaAgent` conecta o controle do jogo.

- **local**: Biblioteca → Iniciar grava a configuração da sessão e abre o jogo; o plugin conecta ao serviço local e o console mostra o estado.
- **cloud**: depois da preparação, abrir `Chaya.app` / `Chaya` ao lado da pasta do jogo. A comunicação usa WebRTC; páginas não iniciam processos.
- Edição (`/cheat`): dinheiro, itens, variáveis, interruptores, personagens, invencibilidade, atravessar paredes, velocidade, teletransporte e salvar / carregar. O atalho do jogo abre o mesmo painel.
- Tradução (`/translate`): extrair seed → completar o jogo com motores ativos e configurações do agendador; é possível pausar. Consultar, pesquisar, editar, excluir ou importar cache. Modos: pré-tradução, tempo real, legendas. Tarefas Cloud usam o jogo conectado; a biblioteca local compartilhada exige local.
- Registros (`/logs`): filtrar por origem e nível. Sair pelo console ou fechar a janela. Pedir consentimento antes de sair pelo usuário, fazer alterações destrutivas, apagar plugins, sobrescrever salvamentos ou carregar.

## Solução de problemas

Instalar o ambiente ausente. Se plugins não funcionarem, reinstalar, reiniciar e verificar `ChayaLoader`. Se estiver offline, conferir `ChayaAgent` e as configurações de conexão, depois atualizar o console. No macOS, usar o comando de reparo acima quando necessário.
