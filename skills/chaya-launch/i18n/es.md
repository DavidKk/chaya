# Chaya: preparar e iniciar un juego

## Preparación

1. **local** (App / desarrollo): en Biblioteca elegir `www`, la carpeta de distribución que lo contiene o un paquete con macOS `.app` / Windows `Game.exe`. Detecta la raíz MV / MZ. Quitar de la biblioteca solo elimina el registro.
2. **cloud**: permitir lectura y escritura de la carpeta con `www` o `index.html` en Chrome / Microsoft Edge.
3. Instalar el entorno NW.js compartido desde los detalles (unos 100 MB); no hace falta si el juego ya incluye uno.
4. Instalar complementos y reiniciar tras cada actualización. El inicio local también los inyecta automáticamente.

Si el entorno macOS no abre, cerrar el juego, ejecutar en Terminal, elegir carpeta según las instrucciones y abrir `Chaya.app`. Se conservan las partidas y se respalda el entorno anterior:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
```

## Complementos y uso

`ChayaLoader` carga con caché sin conexión; `ChayaLog` registra; `ChayaTrans` traduce; `ChayaBoost` ajusta velocidad (`on()` / `off()`); `ChayaEdit` edita, teletransporta y guarda / carga (`help()`); `ChayaAgent` conecta el control.

- **local**: Biblioteca → Iniciar escribe la configuración de sesión y abre el juego; el complemento conecta con el servicio local y la consola muestra su estado.
- **cloud**: abrir `Chaya.app` / `Chaya` junto a la carpeta tras prepararlo. Se comunica por WebRTC; la web no inicia procesos.
- Edición (`/cheat`): dinero, objetos, variables, interruptores, personajes, invulnerabilidad, atravesar paredes, velocidad, teletransporte y guardar / cargar. El atajo del juego abre el mismo panel.
- Traducción (`/translate`): extraer seed → completar el juego con motores activos y configuración del planificador; se puede pausar. Consultar, buscar, editar, borrar o importar caché. Modos: pretraducción, tiempo real, subtítulos. Los trabajos Cloud usan el juego conectado; la biblioteca compartida local requiere local.
- Registros (`/logs`): filtrar por origen y nivel. Salir desde la consola o cerrar la ventana. Pedir permiso antes de salir por el usuario, hacer cambios destructivos, borrar complementos, sobrescribir partidas o cargar.

## Solución de problemas

Instalar el entorno si falta. Si los complementos no actúan, reinstalar, reiniciar y revisar `ChayaLoader`. Si aparece desconectado, comprobar `ChayaAgent` y su configuración, luego actualizar la consola. En macOS usar el comando de reparación anterior si es necesario.
