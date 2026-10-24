# Chaya: instalación y modos

Chaya administra juegos RPG Maker, NW.js, complementos, edición, traducción, registros y MCP.

## Elegir modo

- **local**: App (macOS / Windows) o desarrollo local; biblioteca completa, inicio, traducción local y MCP. La App guarda sus datos en la carpeta de aplicaciones del sistema.
- **cloud**: abrir `https://chaya-gray.vercel.app` en Chrome / Microsoft Edge, permitir lectura y escritura de una carpeta con `www` o `index.html` e instalar complementos y entorno NW.js. Iniciar el juego manualmente. La web no inicia procesos ni ofrece modelos locales o la biblioteca compartida del servicio local.
- **plugin**: funciona dentro del juego abierto, sin necesitar la consola. MCP ofrece control, edición, traducción, caché, registros y conocimientos del juego; excluye gestión de biblioteca, inicio, batch y eval. Cloud completa traducciones mediante `chaya_translate_job` del juego conectado.

## Instalar App / desarrollo

Elegir Apple Silicon, Intel Mac o Windows x64 en las descargas de la página inicial. Instalación desde Terminal de macOS:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

O descomprimir y arrastrar `Chaya.app` a Aplicaciones. Si aparece «dañada», ejecutar `xattr -cr /Applications/Chaya.app` o clic derecho → Abrir → Abrir. En Windows, descomprimir y ejecutar `Chaya.exe`. Consola predeterminada de la App: `http://127.0.0.1:3927`.

Desarrollo requiere Node ≥ 22.19 y pnpm 9:

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

Abrir `http://localhost:3000`. `pnpm dev:lan` permite acceso LAN; `pnpm dev:app` incluye Electron. El selector de desarrollo ofrece Local / Cloud; los cambios de código reconstruyen los complementos.

## Acceso y problemas

Sin inicio de sesión. La API local solo acepta solicitudes del mismo origen desde localhost, IP o `CHAYA_PUBLIC_ORIGIN`. Ante 401 con un dominio personalizado, configurar esa variable y reiniciar. El token de cada complemento está limitado a su sesión; reiniciar el juego tras actualizar. Si 3000 / 3927 están ocupados, cerrar otras instancias o configurar `PORT` de la App.

MCP: `http://127.0.0.1:39271/mcp`. Si se cambia el puerto en Integración → MCP del juego, actualizar el cliente. Con local activo, la pasarela reenvía al MCP local. Si Cloud no permite elegir carpeta, usar Chrome / Microsoft Edge de escritorio y conceder acceso; después abrir `Chaya.app` / `Chaya` en el equipo.
