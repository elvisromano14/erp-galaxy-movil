# erp-galaxy-movil

App móvil **Android** de vendedores del [Mini ERP](https://github.com/elvisromano14/erp-galaxy) (multiempresa, Venezuela): consulta de productos y existencias, clientes, **cotizaciones y pedidos de venta**, con operación **offline-first** (la UI trabaja siempre contra SQLite; la red solo sincroniza).

> **Estado: M6 – la app está completa para el piloto.** Acceso con PIN/huella, descarga inicial, catálogo, clientes, **cotizaciones y pedidos** (con conversión cotización → pedido, reserva de existencias, revisión por crédito y estados de la oficina), sincronización idempotente con cola de envío y, ahora, el **endurecimiento offline**: tarea en segundo plano, bloqueo tras 14 días sin sincronizar, retención de 7 días tras una revocación, restablecer datos sin perder pendientes, diagnóstico, registro sin datos personales, protección contra relojes desfasados y cifrado opcional de la base (SQLCipher). Verificado con 126 pruebas (incluida una de caos con red intermitente) y contra la API real del ERP. **Siguiente: probar en un teléfono** ([guía](docs/PRUEBAS-EN-TELEFONO.md)) y el piloto (M7).
>
> **En stand by:** enlace de descarga de la app dentro de Configuración del ERP (se hará cuando haya un APK de release firmado).

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/PLAN-MOVIL.md`](docs/PLAN-MOVIL.md) | Plan completo: alcance, arquitectura, modelo local, motor de sincronización, seguridad, sprints M0–M8, riesgos |
| [`docs/ANALISIS-ERP-VS-PLAN.md`](docs/ANALISIS-ERP-VS-PLAN.md) | Qué ya existía en el ERP, qué se construyó y las decisiones tomadas |
| [`docs/API-MOVIL.md`](docs/API-MOVIL.md) | **Contrato** con el ERP: cabeceras, `sync/pull`, `sync/push`, estados y errores |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Decisiones de arquitectura (por qué así) |
| [`docs/PRUEBAS-EN-TELEFONO.md`](docs/PRUEBAS-EN-TELEFONO.md) | Cómo compilar la app, instalarla en un teléfono y la lista de pruebas de campo |
| [`docs/MANUAL-VENDEDOR.md`](docs/MANUAL-VENDEDOR.md) · [`SOPORTE.md`](docs/SOPORTE.md) | Manual de uso para vendedores, soporte y capacitación |
| [`docs/PILOTO.md`](docs/PILOTO.md) | Plan del piloto: métricas, seguimiento y criterios go/no-go (M7) |
| [`docs/LANZAMIENTO.md`](docs/LANZAMIENTO.md) · [`POLITICA-DE-PRIVACIDAD.md`](docs/POLITICA-DE-PRIVACIDAD.md) | Release firmado, Google Play y política de privacidad (M8) |
| [`docs/BACKLOG-V1_1.md`](docs/BACKLOG-V1_1.md) | Candidatos para la v1.1 |

## Arquitectura (resumen)

```
UI (Expo Router) → servicios → repositorios (Drizzle) → SQLite (réplica + documentos + outbox)
                                                ▲
                      SyncEngine ◄──► ApiClient ◄──► API del ERP (/api/v1)
```

- **Offline-first**: toda escritura = transacción SQLite que modifica el documento **y** agrega una operación al *outbox*. El servidor es autoritativo (stock, números definitivos, precios, totales).
- **Push** idempotente por `clientOpId` (reenviar nunca duplica) y **pull** incremental por cursor con lápidas.
- **Dominio compartido**: `src/vendor/erp-domain` es el mismo código que calcula totales, IVA y valida RIF en el servidor.
- **Seguridad**: refresh token en el Keystore (`expo-secure-store`), access token solo en memoria, dispositivo registrado y revocable, `allowBackup: false`.

```
src/
├── app/            pantallas (Expo Router): acceso, productos, clientes, documentos (editor, detalle), sincronización, escáner
├── core/           api (ApiClient, errores, contrato), auth (PIN, huella, permisos), session (máquina de estados), config
├── db/             client SQLite, esquema Drizzle, migraciones, repositorios (productos, clientes, outbox), meta y restablecer réplica
├── sync/           motor (push + pull), manejadores de resultados, pull incremental, almacén SQLite, descarga inicial, backoff, disparadores, tarea en segundo plano
├── features/       documentos (totales, precios, validaciones, PDF, línea de tiempo), productos, diagnóstico
├── ui/             componentes base
└── vendor/         OpenAPI/tipos y dominio del ERP (generado: no editar)
```

## Desarrollo

Requisitos: Node ≥ 24 y pnpm 12. Para ejecutar en un teléfono/emulador Android se necesita un *development build* (no Expo Go), porque se usan módulos nativos (`expo-sqlite`, `expo-secure-store`…).

```bash
pnpm install
pnpm check            # lint + tipos + pruebas
pnpm test             # pruebas unitarias (Jest, SQLite real con better-sqlite3)
pnpm test:int         # integración contra la API REAL del ERP (ver abajo)
pnpm start            # servidor de desarrollo (Expo)
```

Entornos (`APP_ENV=dev|staging|prod`, ver `app.config.ts`): instalan variantes distintas en el mismo teléfono. `dev` apunta al emulador (`10.0.2.2:3101`, la API local del ERP); `API_URL` permite sobrescribirlo.

### Contrato con el ERP

El OpenAPI, los tipos y el dominio del ERP se **vendorizan** (copia versionada) y se fijan a un commit en [`erp-contract.json`](erp-contract.json):

```bash
pnpm contracts:sync -- --erp ../Web/mini-erp   # copia desde un checkout del ERP y actualiza el pin
pnpm contracts:check -- --erp <ruta>           # falla si lo vendorizado difiere
```

El CI clona el ERP en el commit fijado y ejecuta la comprobación, de modo que la app nunca queda desfasada sin que se note.

### Integración contra el ERP real

`pnpm test:int` crea una empresa de prueba, un vendedor y un catálogo en un ERP local y recorre el flujo completo de la app (login, dispositivo, PIN, descarga inicial, sincronización, revocación). Requiere el ERP corriendo (p. ej. `scripts/dev.sh up` del repositorio del ERP) y, como inicia sesión varias veces, conviene subir el límite de intentos de la API local (`THROTTLE_LOGIN_PER_MIN=1000`):

```bash
ERP_E2E_URL=http://127.0.0.1:3101 ERP_E2E_SUPER_EMAIL=superadmin@erp.local ERP_E2E_SUPER_PASSWORD='Admin12345!' pnpm test:int
```

### Cifrado de la base (opcional)

`SQLCIPHER=1` al compilar activa SQLCipher: la clave es aleatoria, se genera en el primer arranque y vive solo en el Keystore. **Valídelo en un teléfono real antes de usarlo en producción** (ver la guía de pruebas); por omisión está apagado.

### Base local

Esquema en `src/db/schema/`; migraciones con `pnpm db:generate` (drizzle-kit) y aplicadas al arrancar (`useMigrations`).

## Licencia

Sin licencia por ahora (todos los derechos reservados) hasta que el propietario defina una.
