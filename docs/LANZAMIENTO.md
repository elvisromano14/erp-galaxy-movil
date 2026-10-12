# Lanzamiento (M8): release firmado y distribución

## 1. Dos tipos de APK
| | **APK de pruebas** (`Android APK`) | **Release firmado** (`Release firmado`) |
|---|---|---|
| Cuándo | Probar en teléfonos, pilotos internos | Lanzamiento general / Google Play |
| Firma | Clave de depuración (generada por `expo prebuild`) | **Keystore propio** (guardado como secreto) |
| Salida | APK | APK + AAB + `SHA256SUMS.txt` (borrador de release) |
| Dispara | Manual (Actions → *Android APK*) | Etiqueta `vX.Y.Z` o manual |

> Una app de Google Play **debe seguir firmada con la misma clave siempre**. Por eso el keystore se genera una vez, se respalda **fuera** del repositorio y se activa *Play App Signing*.

## 2. Generar el keystore (una sola vez, en su equipo)
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore erp-ventas-release.keystore -alias erpventas \
  -keyalg RSA -keysize 2048 -validity 10000
```
- Guarde el archivo y las dos contraseñas en un gestor de contraseñas **y en un respaldo fuera de línea**. Perderlo impide actualizar la app si no se usa *Play App Signing*.
- Cargue los secretos en GitHub (Settings → Secrets and variables → Actions):
  - `ANDROID_KEYSTORE_BASE64` → `base64 -w0 erp-ventas-release.keystore`
  - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`erpventas`), `ANDROID_KEY_PASSWORD`

## 3. Publicar una versión
1. Actualice `version` en `package.json` (p. ej. `1.0.0`) y la fecha del [backlog](BACKLOG-V1_1.md) si corresponde.
2. `git tag v1.0.0 && git push origin v1.0.0`.
3. El flujo **Release firmado** ejecuta las pruebas, compila y firma, y deja `erp-ventas-prod-1.0.0.apk/.aab` más `SHA256SUMS.txt` como artefacto y **borrador** de release en GitHub.
4. El `versionCode` es automático (número de ejecución del flujo) y siempre crece.
5. Revise el borrador y publíquelo (o suba el AAB a Play).

## 4. Google Play Console
1. **Cuenta de desarrollador** (pago único) y **crear la app** «ERP Ventas» (idioma español).
2. **Play App Signing**: activar (recomendado). Suba el primer AAB firmado; Google conserva la clave de distribución.
3. **Ficha de la tienda**: nombre, descripción corta y completa, capturas (teléfono), ícono, categoría *Negocios*.
4. **Política de privacidad**: URL pública con el texto de [`POLITICA-DE-PRIVACIDAD.md`](POLITICA-DE-PRIVACIDAD.md) (publicarla, por ejemplo, en GitHub Pages o en la web de la empresa).
5. **Seguridad de los datos** (formulario): datos de cuenta (correo, nombre), datos comerciales; cifrado en tránsito; se puede solicitar la eliminación; **no** se comparten con terceros ni hay publicidad.
6. **Clasificación de contenido** y **público objetivo** (solo adultos / uso empresarial).
7. **Prueba interna** (hasta 100 testers): subir el AAB, agregar los correos de los vendedores del piloto. Pasar luego a **prueba cerrada** y por último a **producción**.
8. Si la app es de uso exclusivo de clientes, considerar la distribución **privada** (Managed Google Play) o seguir con APK directo.

## 5. Lista de verificación de lanzamiento
- [ ] Piloto aprobado (criterios go/no-go de [`PILOTO.md`](PILOTO.md)).
- [ ] Servidor de producción actualizado y respaldado; `MOBILE_MIN_APP_VERSION` revisada.
- [ ] Keystore respaldado en dos lugares; secretos cargados.
- [ ] Release firmado generado por CI, instalado y probado en al menos un teléfono real; huellas SHA-256 verificadas.
- [ ] Política de privacidad publicada y enlazada; ficha de Play completa.
- [ ] SQLCipher: decisión tomada (activar tras validar en teléfono, o dejar apagado).
- [ ] Capacitación hecha ([`SOPORTE.md`](SOPORTE.md)); canal de soporte definido.
- [ ] Revocación de dispositivos y pantalla de Dispositivos móviles probadas.
- [ ] Enlace de descarga publicado en el ERP (Configuración) cuando el APK esté probado.

## 6. Monitoreo posterior al lanzamiento
- **ERP → Configuración → Dispositivos móviles**: dispositivos activos, versión instalada, última actividad y **cola pendiente** (valores altos = vendedor sin señal o un error repetido).
- Rechazos frecuentes: revisar los motivos en la bitácora del ERP y en la cola del vendedor.
- Errores: pedir el registro (Más → Diagnóstico → Compartir). Cuando se defina un DSN, enchufar Sentry con `setErrorReporter` (ya depura datos personales).
- **Actualizaciones**: publicar la versión nueva; subir `MOBILE_MIN_APP_VERSION` solo para forzarla (los pendientes nunca se pierden).

## 7. Retrospectiva y v1.1
Tras 2–4 semanas en uso: reunión con vendedores y administración, revisar métricas del piloto y priorizar el [backlog](BACKLOG-V1_1.md).
