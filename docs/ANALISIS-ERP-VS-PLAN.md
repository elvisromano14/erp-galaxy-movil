# Análisis: ERP actual vs. plan móvil (`PLAN-MOVIL.md`)

> **Actualización 2026-10-11:** las piezas de backend B3–B8 de la sección 3 ya están implementadas y desplegadas en el ERP (migración 0017, 148 pruebas e2e). El contrato final está en [`API-MOVIL.md`](API-MOVIL.md). Este documento se conserva como registro del análisis y de las decisiones.

> Fecha: 2026-10-11. ERP revisado: repo `erp-galaxy` (commit `f18c3bf`), en producción en el VPS.
> Objetivo: decidir **cómo** se construye la app móvil. El proyecto móvil vive en su propio repositorio (`erp-galaxy-movil`).

## 1. Conclusión corta

El plan es sólido y **encaja con el ERP**, pero asume un backend (`sync/*`, dispositivos, `app/config`) que hoy **no existe**: el modo offline se retiró del ERP a propósito. Lo que sí existe cubre ~70 % de lo que la app necesita (autenticación, catálogos, clientes, cotizaciones, pedidos, stock, idempotencia, PDF, aislamiento por empresa). Faltan **4 piezas de backend** (≈ 2–3 semanas) y después la app se puede construir contra la **API real**, sin servidor simulado.

## 2. Qué ya existe y se reutiliza tal cual

| Necesidad del plan | Estado en el ERP |
|---|---|
| Login con refresh token **en el cuerpo** (B1–B2) | ✅ `POST /auth/login`, `/auth/select-company`, `/auth/refresh` (rotativo), `/auth/logout` devuelven/aceptan `refreshToken` en JSON. La cookie solo la pone el BFF de la web |
| Idempotencia por `clientOpId` | ✅ Hay `Idempotency-Key` en cualquier POST (misma clave + mismo cuerpo → misma respuesta; cuerpo distinto → 409). Sirve de base para `sync/push` |
| Vendedor ↔ usuario | ✅ `sellers.userId`; clientes con `sellerId`, `priceListId`, `creditLimit`, `creditDays`, `version` |
| Catálogo versionado | ✅ `products.version/updatedAt/deletedAt`, `customers.version`, `taxes`/`price_lists`/`warehouses` con `updatedAt/deletedAt` |
| Flujo comercial | ✅ cotización → `send` / `accept` → `convert-to-order` → `orders/:id/confirm`; numeración definitiva asignada por el servidor; reserva de stock configurable |
| Stock en vivo (B6) | ✅ `GET /inventory/stock` y `/products/:id/stock` (permiso `inventory:stock:read`) |
| Permisos por rol (VENDEDOR) | ✅ plantillas de roles por empresa |
| Cálculo compartido | ✅ `@erp/domain` (decimal.js, TypeScript puro) y `@erp/contracts` (Zod) |
| Cliente tipado | ✅ `@erp/api-client` generado desde OpenAPI (203 rutas) |
| PDF de cotización/pedido | ✅ en el servidor (la app puede descargarlo o generarlo local con `expo-print`) |
| Seguridad multiempresa | ✅ RLS por `company_id`; la app solo ve su empresa |

## 3. Qué falta (backend) y qué diferencias hay con el plan

| # | Pieza | Detalle | Esfuerzo |
|---|---|---|---|
| **B3** | **Dispositivos** | Tabla `devices` (nombre, plataforma, versión, `deviceCode`, `lastSeenAt`, `revokedAt`), `POST /devices/register`, revocación desde la web (Configuración → Dispositivos) y respuesta `403 DEVICE_REVOKED` | ~3 días |
| **B4** | **`GET /sync/pull`** | Cursor incremental por entidad con *tombstones*. Hoy: `products`/`customers` tienen `version`; `taxes`, `price_lists`, `warehouses` tienen `updatedAt`+`deletedAt`; **`product_prices` y `exchange_rates` no tienen `updatedAt`** (se usará `createdAt`/`date`); `product_refs` y `stock_snapshots` se derivan. Filtro por vendedor (`sellers.userId`) para clientes, listas y `my_documents` | ~1 semana |
| **B5** | **`POST /sync/push`** | Lotes de operaciones `{clientOpId, clientSeq, entity, action, data}` sobre `customer`, `sales_quote`, `sales_order`; reutiliza los servicios existentes dentro de una transacción; resultado por operación `APPLIED/DUPLICATE/REJECTED/NEEDS_REVIEW`. `sales_order.create` = crear + confirmar. Los IDs los genera el servidor (el plan los genera en el dispositivo: se resuelve con la tabla de `clientOpId → serverId`) | ~1 semana |
| **B7–B8** | `GET /app/config` y errores estándar | `minAppVersion`, `schemaVersion`, mantenimiento; códigos `UPGRADE_REQUIRED`, `PRICE_CHANGED`, `PRODUCT_INACTIVE`, `CUSTOMER_DUPLICATE_RIF` (hoy el RIF duplicado responde 409 genérico: debe poder **vincularse** al cliente existente) | ~2 días |
| — | Estado «pendiente de validación» del cliente nuevo | No existe. Decisión #3 del plan: usable en pedidos pero no facturable hasta que administración lo valide | ~2 días + pantalla web |
| — | Políticas del vendedor (`allow_price_edit`, `max_discount_pct`, `allow_customer_create`) | Hoy los permisos son por rol, no valores. Se agregan como parámetros del rol/vendedor | ~2 días |
| — | Filtrado por vendedor/zona en la API normal | `/customers` hoy lista todos los de la empresa; `sync/pull` lo aplicará, y conviene también en el listado | incluido en B4 |

**Diferencias de criterio a corregir en el plan**

1. **Monorepo (§5):** el plan pone `apps/mobile` dentro del monorepo del ERP. La decisión actual es que el móvil viva **aquí, separado**. Hay que decidir cómo consume `@erp/domain`, `@erp/contracts` y `@erp/api-client` (ver §4, decisión 2).
2. **Mock-first (§8):** como el backend lo controlamos nosotros, conviene **construir primero B3–B8 en el ERP** (ya con el contrato OpenAPI real) y no mantener un servidor simulado (Prism/MSW). Se ahorra M0 de «contrato + mock» y se evita divergencia.
3. **IDs en el dispositivo:** el ERP genera UUIDv7 en la base de datos; el móvil usará `clientOpId` (UUIDv7) como clave de idempotencia y recibirá el `serverId` en la respuesta. No cambia el modelo del ERP.
4. **Numeración:** coincide: el servidor ya asigna el número al enviar/confirmar; la app mostrará `OFF-…` mientras tanto.
5. **Alcance fiscal:** v1.0 móvil no emite facturas, así que **impresora fiscal y retenciones no afectan a la app** (solo ven IVA 16 % por línea; el IGTF se calcula en cobros, no en pedidos).

## 4. Decisiones a tomar

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| 1 | Orden de trabajo | (a) backend primero, luego app · (b) en paralelo con mock | **(a)**: 2–3 semanas de backend en el ERP y la app nace contra la API real (M0 más corto) |
| 2 | Cómo consume la app los paquetes compartidos | (a) publicarlos como paquetes privados (GitHub Packages) desde Actions · (b) enlaces locales `link:` entre carpetas · (c) copiar `api-client` generado | **(b) mientras se desarrolla** y **(a) al llegar al piloto** (versionado y reproducible en CI) |
| 3 | Tecnología | React Native + Expo (el plan) · Flutter · nativa Kotlin | **Mantener React Native + Expo**: comparte TypeScript con `domain/contracts/api-client` |
| 4 | Dispositivo único por vendedor | Sí / No | **Sí** (configurable), con revocación remota |
| 5 | Cliente nuevo desde el móvil | Usable en pedidos y pendiente de validación / requiere aprobación previa | **Usable y pendiente de validación** (no facturable hasta validar) |
| 6 | Precios y descuentos del vendedor | Fijo / descuento limitado / libre | **Descuento limitado** por `max_discount_pct`; precio fijo |
| 7 | Cifrado SQLite (SQLCipher) | Sí / validar en PoC | **Validar en la PoC de M0**; si no está disponible, cifrar solo campos sensibles |
| 8 | Distribución | Play (prueba interna) / APK directo | **APK firmado** para el piloto; Play al estabilizar |
| 9 | Quitar del alcance inicial | Maestro E2E completo, OTA, Sentry | **Sentry y E2E en M6–M7**; sin OTA en v1.0 |

## 5. Plan resultante (propuesta)

| Fase | Contenido | Duración |
|---|---|---|
| **A. Backend móvil** (en el ERP) | B3 dispositivos, B4 pull, B5 push, B7–B8 config y errores, cliente pendiente de validación, políticas del vendedor, pantalla web de dispositivos, pruebas e2e de sync (cortes, duplicados, rechazos), `api-client` regenerado | 2–3 sem |
| **B. App móvil M0–M8** (en esta carpeta) | Los sprints del plan; M0 sin mock (usa la API real) | ~14–16 sem (1–2 desarrolladores) |

Ruta crítica: **B4/B5** (sync). Todo lo demás de la app (productos, clientes, escáner, PDF) avanza sin depender de ellos.

## 6. Reglas fiscales confirmadas por el negocio (2026-10-11) y estado en el ERP

| Regla | En el ERP hoy |
|---|---|
| IVA general 16 % | ✅ `IVA_GENERAL` 16 % (hay también reducida 8 % y adicional 15 % de referencia) |
| IGTF 3 % en pagos en divisas **en efectivo** | ⚠️ 3 % ✅; se aplica por instrumento (`appliesIgtf`): hoy **Efectivo USD y Zelle** lo tienen activo. Si solo aplica a efectivo, hay que desactivarlo en Zelle (es configurable por empresa) |
| Retención de IVA según cliente: contribuyente especial 75 % o 100 % | ⚠️ El % existe por cliente/proveedor (`retentionIvaPct`) pero **empieza en 0** y es manual. Falta: al marcar «contribuyente especial» proponer **75 %** (y permitir **100 %**) |
| Retención de ISLR 4 % | ⚠️ Se pide el % en cada comprobante (por concepto). Falta: **4 % como valor por omisión** (editable) |
| Facturar en **impresora fiscal o impresora normal**, configurable | ❌ No existe. Hoy: numeración/control **internos** y PDF «sin validez fiscal». Propuesta en `docs` del ERP: ajuste de empresa «Modo de impresión de facturas» (Normal / Impresora fiscal); en modo fiscal la factura se confirma capturando el **número y serial que devuelve la máquina fiscal** (y el cierre Z asociado) en lugar de la numeración interna; en modo normal se emite el PDF con la numeración autorizada por la imprenta digital cuando se defina. Requiere saber **marca/modelo** de la impresora |

Ninguna de estas reglas cambia el alcance de la app móvil v1.0.
