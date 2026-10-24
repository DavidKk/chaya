.PHONY: help dev dev-app dev-loopback start build build-app dist-mac dist-win test typecheck lint format ok check

help:
	@echo "Chaya CLI recipes:"
	@echo "  make dev          - Start local dev server (LAN :3000)"
	@echo "  make dev-app      - Start desktop App dev environment (Next + Electron)"
	@echo "  make dev-loopback - Start loopback dev server (127.0.0.1:3000)"
	@echo "  make start        - Start production local server (:3927)"
	@echo "  make build        - Full build (native + plugins + Next.js)"
	@echo "  make build-app    - Package desktop standalone version"
	@echo "  make test         - Run unit tests"
	@echo "  make typecheck    - TypeScript type check"
	@echo "  make check        - Pre-commit check (format:check + lint:check + typecheck)"
	@echo "  make ok           - Full verification and build (format + lint + typecheck + test + build)"

dev:
	pnpm dev

dev-app:
	pnpm dev:app

dev-loopback:
	pnpm dev:loopback

start:
	pnpm start

build:
	pnpm build

build-app:
	pnpm build:app

dist-mac:
	pnpm dist:mac

dist-win:
	pnpm dist:win

test:
	pnpm test

typecheck:
	pnpm typecheck

lint:
	pnpm lint:check

format:
	pnpm format

check:
	pnpm format:check && pnpm lint:check && pnpm typecheck

ok:
	pnpm ok
