# erp-galaxy-movil

App móvil **Android** de vendedores del [Mini ERP](https://github.com/elvisromano14/erp-galaxy) (multiempresa, Venezuela): consulta de productos y existencias, clientes, **cotizaciones y pedidos de venta**, con operación **offline-first** (la UI trabaja siempre contra SQLite; la red solo sincroniza).

> **Estado: M0 – fundación.** El proyecto compila y empaqueta (Expo SDK 57, Hermes), tiene cliente de API con renovación de sesión, registro de dispositivo, motor de pull incremental, esquema local (Drizzle/SQLite), el dominio del ERP compartido y CI. Las pantallas de negocio llegan por sprints (ver [plan](docs/PLAN-MOVIL.md#14-plan-por-sprints-m0m8)).

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
├── app/            rutas (Expo Router)
├── core/           api (ApiClient, errores, contrato), auth, config
├── db/             client SQLite, esquema Drizzle y migraciones
├── sync/           backoff, pull (push y motor en M3)
└── vendor/         OpenAPI/tipos y dominio del ERP (generado: no editar)
```

## Desarrollo

Requisitos: Node ≥ 24 y pnpm 12. Para ejecutar en un teléfono/emulador Android se necesita un *development build* (no Expo Go), porque se usan módulos nativos (`expo-sqlite`, `expo-secure-store`…).

```bash
pnpm install
pnpm check            # lint + tipos + pruebas
pnpm test             # pruebas unitarias (Jest)
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

### Base local

Esquema en `src/db/schema/`; migraciones con `pnpm db:generate` (drizzle-kit) y aplicadas al arrancar (`useMigrations`).

## Licencia

Sin licencia por ahora (todos los derechos reservados) hasta que el propietario defina una.
