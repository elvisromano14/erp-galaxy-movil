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

## 4. Lista de verificación de lanzamiento
- [ ] Piloto aprobado (criterios go/no-go de [`PILOTO.md`](PILOTO.md)).
- [ ] Keystore propio generado, respaldado en dos lugares y secretos cargados.
- [ ] Release firmado generado por CI, **instalado y probado en un teléfono real** (huella SHA-256 verificada contra la mostrada en el ERP).
- [ ] APK publicado en el ERP y descarga verificada desde un teléfono (enlace y QR).
- [ ] Servidor de producción actualizado y respaldado; `MOBILE_MIN_APP_VERSION` revisada.
- [ ] SQLCipher: decisión tomada (activar tras validar en teléfono, o dejar apagado).
- [ ] Capacitación hecha ([`SOPORTE.md`](SOPORTE.md)) y canal de soporte definido.
- [ ] Revocación de dispositivos y pantalla de Dispositivos móviles probadas.

## 5. Monitoreo posterior al lanzamiento
- **ERP → Configuración → Dispositivos móviles**: dispositivos activos, versión instalada, última actividad y **cola pendiente** (valores altos = vendedor sin señal o un error repetido).
- Rechazos frecuentes: revisar los motivos en la bitácora del ERP y en la cola del vendedor.
- Errores: pedir el registro (Más → Diagnóstico → Compartir). Cuando se defina un DSN, enchufar Sentry con `setErrorReporter` (ya depura datos personales).
- **Actualizaciones**: publicar la versión nueva con `publish-apk.sh`; los vendedores la descargan del mismo lugar.

## 6. Retrospectiva y v1.1
Tras 2–4 semanas en uso: reunión con vendedores y administración, revisar métricas del piloto y priorizar el [backlog](BACKLOG-V1_1.md).
