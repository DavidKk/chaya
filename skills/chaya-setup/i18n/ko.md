# Chaya: 설치와 실행 방식

Chaya는 RPG Maker 게임, NW.js 셸, 플러그인, 편집, 번역, 로그와 MCP를 관리합니다.

## 실행 방식 선택

- **local**: App(macOS / Windows) 또는 로컬 개발. 전체 라이브러리, 실행, 로컬 번역과 MCP를 제공합니다. App 데이터는 시스템 앱 폴더에 저장됩니다.
- **cloud**: Chrome / Microsoft Edge에서 `https://chaya-gray.vercel.app`을 열고 `www` 또는 `index.html`이 있는 폴더를 허용하여 플러그인과 셸을 설치합니다. 게임은 직접 실행합니다. 브라우저는 프로세스 실행, 로컬 모델, 로컬 서비스의 공유 번역 라이브러리를 제공하지 않습니다.
- **plugin**: 열린 게임 안에서 작동하며 콘솔 없이도 사용할 수 있습니다. MCP는 게임 조작, 편집, 번역, 캐시, 로그와 게임 스킬을 제공하지만 라이브러리 관리, 실행, batch, eval은 제외합니다. Cloud 보완 번역은 연결된 게임의 `chaya_translate_job`을 사용합니다.

## App / 개발 환경 설치

홈 다운로드에서 Apple Silicon, Intel Mac 또는 Windows x64를 선택합니다. macOS 터미널 설치:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

수동 설치는 압축을 풀고 `Chaya.app`을 응용 프로그램으로 옮깁니다. 손상 경고가 나오면 `xattr -cr /Applications/Chaya.app`을 실행하거나 우클릭 → 열기 → 열기를 선택합니다. Windows는 압축 해제 후 `Chaya.exe`를 실행합니다. App 콘솔 기본 주소는 `http://127.0.0.1:3927`입니다.

개발에는 Node ≥ 22.19, pnpm 9가 필요합니다:

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

`http://localhost:3000`을 엽니다. `pnpm dev:lan`은 LAN 접속, `pnpm dev:app`은 Electron을 포함합니다. 개발 전환기는 Local / Cloud이며 소스가 바뀌면 플러그인을 다시 빌드합니다.

## 접근과 문제 해결

로그인은 없습니다. 로컬 API는 localhost, IP 또는 `CHAYA_PUBLIC_ORIGIN`의 동일 출처 요청만 허용합니다. 사용자 도메인에서 401이면 이 변수를 설정하고 다시 시작합니다. 플러그인 시작 token은 해당 세션 전용이며 업데이트 후 게임을 다시 시작합니다. 3000 / 3927이 사용 중이면 다른 인스턴스를 종료하거나 App의 `PORT`를 설정합니다.

MCP 기본 주소는 `http://127.0.0.1:39271/mcp`입니다. 게임 내 통합 → MCP에서 포트를 바꾸면 클라이언트도 갱신합니다. 로컬 실행 중에는 게이트웨이가 로컬 MCP로 전달합니다. Cloud 폴더 선택은 데스크톱 Chrome / Microsoft Edge와 권한이 필요합니다. 준비 후 컴퓨터에서 `Chaya.app` / `Chaya`를 직접 엽니다.
