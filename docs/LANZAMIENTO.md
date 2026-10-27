# Lanzamiento (M8): distribución desde el ERP

> **Decisión:** la app **no se publica en Google Play**. Se descarga como APK desde el propio ERP: **Configuración → App móvil** (enlace firmado de 10 minutos y código QR). Así la empresa controla quién la instala y qué versión circula.

## 1. Cómo llega el APK a los vendedores
```
GitHub Actions (APK / Release firmado) ──► publish-apk.sh ──► VPS (~/erp-apk) ──► ERP: Configuración → App móvil ──► teléfono
```
1. **Compilar:** Actions → *Android APK* (pruebas) o etiqueta `vX.Y.Z` → *Release firmado* (con keystore propio).
2. **Descargar** el APK del artefacto (o del borrador de release).
3. **Publicar en el ERP:** desde el repositorio del ERP: `deploy/publish-apk.sh erp-ventas-prod-1.0.0.apk 1.0.0 "Notas de la versión"`. Sube el archivo, lo activa de forma atómica y conserva la versión anterior.
4. **Instalar:** el vendedor (o el administrador) abre **Configuración → App móvil**, genera el enlace y descarga en el teléfono (o escanea el QR). Android pedirá permitir «instalar apps de orígenes desconocidos» para el navegador.

## 2. Firma: use un keystore propio (hágalo antes del piloto)
Android **solo deja actualizar** una app si la nueva versión está firmada con la **misma clave**. Mientras use el APK de pruebas (firmado con la clave de depuración estándar de React Native, pública), cualquiera podría fabricar un APK que «actualice» la app. Para un piloto serio:

```bash
scripts/generate-keystore.sh        # crea erp-ventas-release.keystore y muestra los secretos a cargar
```
- Guarde el archivo y las contraseñas en un gestor de contraseñas **y en un respaldo fuera de línea**. Si lo pierde, todos los vendedores tendrían que **desinstalar y reinstalar** la app (se perdería lo no enviado).
- Cargue los secretos en GitHub (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- **Respaldo (hecho 2026-10-12):** `erp-ventas-keystore-respaldo.tgz.enc` (keystore + credenciales, AES-256 con frase propia) en el equipo de desarrollo y en el VPS (`~/respaldos-seguros/`). La frase de descifrado se guarda aparte, en el gestor de contraseñas del propietario. Falta una copia fuera de línea (USB).
- **Cambiar de clave después obliga a reinstalar**: por eso conviene hacerlo antes de entregar la app a los vendedores.

## 3. Publicar una versión
1. Suba `version` en `package.json` (p. ej. `1.0.0`).
2. `git tag v1.0.0 && git push origin v1.0.0` → el flujo **Release firmado** ejecuta las pruebas, compila y firma (APK + AAB + `SHA256SUMS.txt`, `versionCode` automático) y deja un **borrador** de release.
3. Descargue el APK y publíquelo con `publish-apk.sh` (paso 1.3).
4. Para **obligar** a actualizar a todos, suba `MOBILE_MIN_APP_VERSION` en el ERP (los pendientes nunca se pierden).

## 3 bis. Actualización automática dentro de la app (desde la 0.2.0)
La app instalada **se entera sola** de las versiones nuevas y las instala con un toque:

```
publish-apk.sh ──► ERP (latest.json: versión, notas, tamaño, SHA-256) ──► app: GET /mobile/app/latest ──► descarga (reanudable) ──► verifica SHA-256 ──► instalador de Android
```
- **Cuándo consulta:** al quedar lista la sesión y al volver a primer plano, como mucho cada 6 h (Más → *Buscar actualización* fuerza la consulta). Con la sesión cerrada o la versión bloqueada por obsoleta se intenta con la sesión guardada; si no hay, se indica descargar desde **Configuración → App móvil**.
- **Opcional:** aparece un aviso en Inicio y una pantalla con las notas; «Más tarde» no vuelve a molestar con esa versión durante 24 h. **Obligatoria** (versión instalada < `MOBILE_MIN_APP_VERSION`): no se puede aplazar; está dentro de la pantalla «Actualización requerida». Los pendientes sin enviar nunca se pierden.
- **Descarga:** archivo en el espacio privado de la app, con barra de progreso; si se corta la señal continúa donde quedó (cabecera `Range`). Se verifica tamaño y **SHA-256** contra lo publicado antes de instalar; si no coincide se descarta.
- **Instalación:** Android **no permite instalar en silencio** (solo con MDM o teléfonos administrados): la persona pulsa «Instalar» y confirma. La **primera vez** Android pide permitir «Instalar apps desconocidas» a *ERP Ventas*; la pantalla trae un botón «Abrir ajustes de instalación».
- **Misma firma y misma variante:** Android solo actualiza si el APK nuevo está firmado con la **misma clave** y tiene el mismo `applicationId`. Use siempre el **Release firmado** con el keystore de la empresa (§2) y publique con el nombre `erp-ventas-prod-X.Y.Z.apk`: la app solo ofrece el archivo de **su** variante (dev/staging/prod son apps distintas).
- **Publicar:** `VERSION_CODE=<n> deploy/publish-apk.sh erp-ventas-prod-X.Y.Z.apk X.Y.Z "Notas"` (el `versionCode` es opcional y solo informativo). Para obligar a todos: subir `MOBILE_MIN_APP_VERSION`.
- **Última instalación manual:** las apps **anteriores a la 0.2.0 no traen este actualizador**. Cada teléfono necesita **una** instalación manual de la 0.2.0 (descargando desde Configuración → App móvil, enlace o QR); desde ahí, todas las versiones siguientes se actualizan solas. La 0.2.0 también incluye crear/editar productos y las Ubicaciones, así que se hace una sola ronda manual.
- **Recomendación:** antes de repartir la 0.2.0, confirme que el APK está firmado con el keystore propio (§2). Cambiar de clave después obliga a desinstalar y reinstalar en cada teléfono (se perdería lo no enviado).

## 4. Lista de verificación de lanzamiento
- [ ] Piloto aprobado (criterios go/no-go de [`PILOTO.md`](PILOTO.md)).
- [ ] Keystore propio generado, respaldado en dos lugares y secretos cargados.
- [ ] Release firmado generado por CI, **instalado y probado en un teléfono real** (huella SHA-256 verificada contra la mostrada en el ERP).
- [ ] APK publicado en el ERP y descarga verificada desde un teléfono (enlace y QR).
- [ ] Actualización automática probada en un teléfono real: instalar la 0.2.0, publicar una 0.2.1 y comprobar el aviso, la descarga, la verificación y el instalador (§3 bis).
- [ ] Servidor de producción actualizado y respaldado; `MOBILE_MIN_APP_VERSION` revisada.
- [ ] SQLCipher: decisión tomada (activar tras validar en teléfono, o dejar apagado).
- [ ] Capacitación hecha ([`SOPORTE.md`](SOPORTE.md)) y canal de soporte definido.
- [ ] Revocación de dispositivos y pantalla de Dispositivos móviles probadas.

## 5. Monitoreo posterior al lanzamiento
- **ERP → Configuración → Dispositivos móviles**: dispositivos activos, versión instalada, última actividad y **cola pendiente** (valores altos = vendedor sin señal o un error repetido).
- Rechazos frecuentes: revisar los motivos en la bitácora del ERP y en la cola del vendedor.
- Errores: pedir el registro (Más → Diagnóstico → Compartir). Cuando se defina un DSN, enchufar Sentry con `setErrorReporter` (ya depura datos personales).
- **Actualizaciones**: publicar la versión nueva con `publish-apk.sh`; desde la 0.2.0 las apps instaladas la descargan e instalan solas (§3 bis).

## 6. Retrospectiva y v1.1
Tras 2–4 semanas en uso: reunión con vendedores y administración, revisar métricas del piloto y priorizar el [backlog](BACKLOG-V1_1.md).
