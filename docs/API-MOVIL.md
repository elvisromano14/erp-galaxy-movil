# Contrato de la API móvil (ERP ↔ app)

Todas las rutas cuelgan de `/api/v1`. Respuestas correctas: `{ "data": … }`. Errores: `{ "statusCode", "error", "message", "details" }`.
El contrato completo (OpenAPI) y sus tipos están vendorizados en `src/vendor/erp/` (se actualizan con `pnpm contracts:sync`; ver `erp-contract.json` para el commit del ERP fijado).

## Cabeceras

| Cabecera | Cuándo | Para qué |
|---|---|---|
| `Authorization: Bearer <accessToken>` | casi siempre | sesión (access 15 min; el refresh token vive en `expo-secure-store`) |
| `X-App-Version: 1.0.0` | siempre | versión de la app; por debajo de la mínima → `426 UPGRADE_REQUIRED` |
| `X-Device-Id: <uuid>` | `sync/*` | dispositivo registrado; revocado → `403 DEVICE_REVOKED` |

## Acceso y dispositivo

| Paso | Llamada | Notas |
|---|---|---|
| Versiones / mantenimiento | `GET /app/config` (público) | `minAppVersion`, `latestAppVersion`, `schemaVersion`, `maintenance` |
| Login | `POST /auth/login` | devuelve `accessToken`, **`refreshToken` en el cuerpo**, `companies`, `requiresCompanySelection` |
| Empresa | `POST /auth/select-company` `{ companyId }` | nuevos tokens (los anteriores se revocan) |
| Renovar | `POST /auth/refresh` `{ refreshToken }` | rotativo; reutilizar uno viejo revoca la familia |
| Dispositivo | `POST /devices/register` `{ deviceKey, name, platform, appVersion }` | idempotente por `deviceKey`; un dispositivo activo por usuario (`409 DEVICE_LIMIT_REACHED`); el usuario debe estar ligado a un vendedor (`SELLER_REQUIRED`) |

Permisos: `mobile:sync:use` (rol Vendedor) y, para administración, `mobile:devices:read|update`.

## `GET /sync/pull`

Parámetros: `entity`, `cursor?`, `limit` (≤ 2000, por omisión 1000), `overlapSeconds?` (solo en la **primera página** de cada sincronización: relee los últimos N segundos).
Respuesta: `{ entity, items, nextCursor, hasMore, fullRefresh, serverTime }`.

Orden recomendado de descarga: `app_settings → taxes → exchange_rates → price_lists → warehouses → customers → products → product_prices → stock_snapshots → my_documents`.

| Entidad | Alcance | Paginación |
|---|---|---|
| `app_settings` | empresa, vendedor y políticas (`maxDiscountPct`, `allowPriceEdit`, `allowCustomerCreate`, `defaultWarehouseId`, `pricePolicy: SERVER_LIST`) | completa (`fullRefresh`) |
| `taxes`, `price_lists`, `warehouses`, `exchange_rates` (120 días) | empresa | completa |
| `customers` | del vendedor (o por zona); con instantáneas `balanceSnapshot`/`overdueSnapshot` en Bs | cursor `(updated_at, id)`; `deletedAt` = lápida |
| `products` | catálogo con `refs[]` (OEM/equivalentes) y `barcodes[]` | cursor; `deletedAt` = lápida |
| `product_prices` | solo lectura, sin costos; el precio vigente es el de mayor `validFrom ≤ hoy` | cursor `(created_at, id)` |
| `stock_snapshots` | existencia y reservado por depósito | cursor |
| `my_documents` | documentos del vendedor de los últimos 60 días (cotizaciones, presupuestos, pedidos, facturas) con líneas y estado | cursor |

El cursor es opaco (`<timestamptz con microsegundos>|<id>`); se guarda **junto con el lote** en la misma transacción SQLite.

## `POST /sync/push`

Cuerpo: `{ operations: [{ clientOpId, clientSeq, entity, action, entityId, data }] }` (hasta 50; se procesan por `clientSeq`).
`entity ∈ customer | sales_quote | sales_order`, `action ∈ create | update`; `entityId` es el UUID local de la entidad.

Resultado por operación: `{ clientOpId, status, errorCode?, message?, serverId?, serverNumber?, serverStatus?, linked? }`

| `status` | Significado | Acción en la app |
|---|---|---|
| `APPLIED` | aplicada | `outbox → DONE`; guardar `serverId`/`serverNumber` |
| `DUPLICATE` | ya estaba aplicada (mismo `clientOpId`) | igual que `APPLIED` |
| `REJECTED` | rechazo definitivo (`errorCode` + `message`) | documento `REJECTED`; el vendedor corrige y reenvía como operación nueva |
| `NEEDS_REVIEW` | creada pero requiere decisión (p. ej. `CREDIT_LIMIT_EXCEEDED`: el pedido queda en borrador) | documento «En revisión» |
| `BLOCKED` | depende de una operación rechazada (p. ej. cliente cuyo alta falló) | dejar `PENDING` hasta resolver la dependencia |
| `RETRY` | error temporal del servidor | dejar `PENDING` con *backoff* |

Reglas del servidor:
- **Idempotencia**: el resultado se guarda por `clientOpId`; reenviar devuelve lo mismo, sin duplicar.
- **Ids locales**: una operación puede referenciar por id local un cliente creado antes (mismo lote o anterior); el servidor mantiene la correspondencia `entityId → serverId`.
- **Políticas**: descuento por línea ≤ `maxDiscountPct` (`DISCOUNT_NOT_ALLOWED`); el `unitPrice` enviado solo se respeta si `allowPriceEdit`; si no, el servidor toma la lista de precios vigente.
- **Cliente nuevo**: queda `PENDING` (usable en cotizaciones y pedidos, **no facturable** hasta validar). Si el RIF ya existe, se vincula (`linked: true`).
- **Cotización**: `create` con `send: true` la crea y la envía (número definitivo `COT-V-…`).
- **Pedido**: `create` crea y **confirma** (reserva existencias); con `sourceQuoteId` acepta y convierte la cotización de origen.
- Una operación fallida no afecta a las demás del lote (cada una corre en su propio `SAVEPOINT`).

## Errores que la app trata de forma especial

| Código | HTTP | Acción |
|---|---|---|
| `UPGRADE_REQUIRED` | 426 | pedir actualizar; **conservar la cola** |
| `DEVICE_REVOKED` | 403 | bloquear la app, borrar la réplica y conservar la cola cifrada un plazo |
| `DEVICE_UNKNOWN` / `DEVICE_REQUIRED` | 403 / 400 | volver a registrar el dispositivo |
| `SELLER_REQUIRED` | 422 | avisar: administración debe ligar el usuario a un vendedor |
| 401 | | renovar con el refresh token (single-flight); si falla, pedir login (la cola se conserva) |
