# erp-galaxy-movil

App móvil **Android** de vendedores del [Mini ERP](https://github.com/elvisromano14/erp-galaxy) (multiempresa, Venezuela): consulta de productos y existencias, clientes, **cotizaciones y pedidos de venta**, con operación **offline-first** (la UI trabaja siempre contra SQLite; la red solo sincroniza).

> **Estado: M1 – acceso, dispositivo y descarga inicial.** Login → empresa → registro de dispositivo → PIN/huella → descarga inicial reanudable del catálogo a SQLite → sincronización incremental, con bloqueo por inactividad, dispositivo revocado y versión mínima. Verificado también contra la API real del ERP. Las pantallas de negocio (productos, clientes, cotizaciones, pedidos) llegan en M2+ (ver [plan](docs/PLAN-MOVIL.md#14-plan-por-sprints-m0m8)).

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/PLAN-MOVIL.md`](docs/PLAN-MOVIL.md) | Plan completo: alcance, arquitectura, modelo local, motor de sincronización, seguridad, sprints M0–M8, riesgos |
| [`docs/ANALISIS-ERP-VS-PLAN.md`](docs/ANALISIS-ERP-VS-PLAN.md) | Qué ya existía en el ERP, qué se construyó y las decisiones tomadas |
| [`docs/API-MOVIL.md`](docs/API-MOVIL.md) | **Contrato** con el ERP: cabeceras, `sync/pull`, `sync/push`, estados y errores |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Decisiones de arquitectura (por qué así) |

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
├── app/            pantallas (Expo Router): login, empresa, PIN, desbloqueo, descarga, bloqueo, inicio
├── core/           api (ApiClient, errores, contrato), auth (PIN, huella, permisos), session (máquina de estados), config
├── db/             client SQLite, esquema Drizzle, migraciones, meta y restablecer réplica
├── sync/           pull incremental, almacén SQLite de las páginas, descarga inicial, backoff (push y motor en M3)
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

### Base local

Esquema en `src/db/schema/`; migraciones con `pnpm db:generate` (drizzle-kit) y aplicadas al arrancar (`useMigrations`).

## Licencia

Sin licencia por ahora (todos los derechos reservados) hasta que el propietario defina una.
