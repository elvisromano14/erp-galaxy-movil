# Mini ERP – App Móvil Android de Vendedores
## Plan de implementación (React Native + Expo + SQLite)

> **Anexo del documento v2.** Cubre solo la app móvil de vendedores: **login, productos, clientes, cotizaciones, pedidos de venta y consulta de stock**, con operación **offline-first**.
> **Backend:** el definido en la guía v2 (NestJS + PostgreSQL 18). La app solo habla con la API REST (`/api/v1`).

---

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Alcance funcional](#2-alcance-funcional)
3. [Stack y versiones](#3-stack-y-versiones)
4. [Arquitectura de la app](#4-arquitectura-de-la-app)
5. [Integración con el monorepo](#5-integración-con-el-monorepo)
6. [Modelo de datos local (SQLite)](#6-modelo-de-datos-local-sqlite)
7. [Motor de sincronización](#7-motor-de-sincronización)
8. [Contratos de API requeridos al backend](#8-contratos-de-api-requeridos-al-backend)
9. [Pantallas y flujos](#9-pantallas-y-flujos)
10. [Reglas de negocio en el móvil](#10-reglas-de-negocio-en-el-móvil)
11. [Seguridad](#11-seguridad)
12. [Build, distribución y entornos](#12-build-distribución-y-entornos)
13. [Calidad, rendimiento y observabilidad](#13-calidad-rendimiento-y-observabilidad)
14. [Plan por sprints (M0–M8)](#14-plan-por-sprints-m0m8)
15. [Cronograma y dependencias con el backend](#15-cronograma-y-dependencias-con-el-backend)
16. [Riesgos](#16-riesgos)
17. [Decisiones pendientes](#17-decisiones-pendientes)
- [Anexo A – Estructura de carpetas](#anexo-a--estructura-de-carpetas)
- [Anexo B – Fragmentos de código base](#anexo-b--fragmentos-de-código-base)
- [Anexo C – Definición de "terminado"](#anexo-c--definición-de-terminado)
- [Anexo D – Checklist de lanzamiento](#anexo-d--checklist-de-lanzamiento)

---

## 1. Resumen ejecutivo

| Aspecto | Decisión |
|---|---|
| Plataforma | **Android** (Android 8.0 / API 26 o superior) |
| Framework | **React Native + Expo (TypeScript estricto)**, *development builds* (no Expo Go) |
| Datos locales | **`expo-sqlite`** + **Drizzle ORM**, búsqueda con **FTS5** |
| Patrón | **Offline-first**: la UI lee y escribe siempre en SQLite; la red solo sincroniza |
| Sincronización | `GET /sync/pull` (cursor incremental) y `POST /sync/push` (cola *outbox* idempotente) del backend v2 |
| Lógica compartida | `packages/domain` (totales, impuestos, moneda) y `packages/contracts` (Zod) reutilizados tal cual |
| Distribución | APK firmado / Google Play (prueba interna o cerrada); compilación en GitHub Actions o EAS |
| Duración estimada | **~16 semanas** (8 sprints de 2 semanas) con 1–2 desarrolladores móviles, en paralelo con el backend |

**Principio rector:** el vendedor **nunca espera a la red**. Toda acción se confirma localmente al instante; la sincronización ocurre después y su resultado se muestra claramente.

---

## 2. Alcance funcional

### 2.1 Incluido (versión 1.0)

| Módulo | Funciones | ¿Offline? |
|---|---|---|
| **Acceso** | Login (primer acceso en línea), selección de empresa, registro de dispositivo, bloqueo por PIN/huella, cierre de sesión | Login: en línea · Desbloqueo: offline |
| **Productos** | Buscar por SKU, nombre, OEM/equivalente, código de barras (cámara); detalle con precios (según lista del vendedor), impuesto, referencias, existencia | ✅ |
| **Stock** | Existencia por depósito (instantánea sincronizada) + **consulta en vivo** cuando hay conexión | ✅ / en vivo en línea |
| **Clientes** | Lista y búsqueda, detalle (RIF, contacto, lista de precios, crédito, saldo y vencido *indicativos*), **crear y editar** clientes | ✅ |
| **Cotizaciones** | Crear, editar borrador, duplicar, compartir PDF, **convertir a pedido** | ✅ |
| **Pedidos de venta** | Crear, editar antes de sincronizar, ver estado (sincronizado, rechazado, en revisión, facturado…) | ✅ |
| **Sincronización** | Estado visible, sincronización manual, cola pendiente, bandeja de rechazos | — |
| **Ajustes** | Datos del dispositivo, versión, restablecer réplica, cambiar empresa | ✅ |

### 2.2 Fuera de alcance v1.0 (candidatos a futuras versiones)

Facturas y notas de crédito/débito · cobros y recibos · devoluciones · compras · traslados e inventario físico · reportes · mapa/geolocalización y rutas de visita · fotos adjuntas · impresión térmica Bluetooth · notificaciones push · modo multi-empresa simultáneo · iOS.

### 2.3 Roles y permisos

La app es para el rol **VENDEDOR** (y opcionalmente SUPERVISOR en solo lectura). Los permisos se descargan con la sesión y se aplican en la UI **y** en el servidor (el servidor siempre manda).

| Permiso | Efecto en la app |
|---|---|
| `sales:quotes:create` / `sales:orders:create` | Mostrar botones de creación |
| `customers:create` / `customers:update` | Alta y edición de clientes |
| `pricing:edit-price` (por definir) | Permite cambiar precio de línea |
| `pricing:max-discount` (valor) | Límite de descuento permitido |
| `stock:view-live` | Consulta de stock en vivo |

### 2.4 Historias de usuario principales

| ID | Historia |
|---|---|
| HU-01 | Como vendedor quiero iniciar sesión en mi teléfono y que se descargue mi catálogo, para trabajar sin señal |
| HU-02 | Como vendedor quiero buscar un repuesto por código OEM o escaneando el código de barras, para encontrarlo en segundos |
| HU-03 | Como vendedor quiero ver cuánto stock hay por depósito y cuándo se actualizó, para prometer entregas realistas |
| HU-04 | Como vendedor quiero registrar un cliente nuevo desde el mostrador del cliente, aunque no tenga conexión |
| HU-05 | Como vendedor quiero crear una cotización, enviarla en PDF por WhatsApp y convertirla en pedido si el cliente acepta |
| HU-06 | Como vendedor quiero tomar un pedido sin conexión y que se envíe solo cuando recupere la señal |
| HU-07 | Como vendedor quiero ver qué pedidos ya llegaron al sistema y cuáles tienen problemas, para corregirlos |
| HU-08 | Como administrador quiero revocar un teléfono perdido para que no pueda acceder a datos |

---

## 3. Stack y versiones

> Verificar las versiones exactas vigentes al iniciar el proyecto (Sprint M0) y fijarlas en el `package.json`.

| Capa | Tecnología | Notas |
|---|---|---|
| Framework | **Expo SDK vigente** + React Native (Nueva Arquitectura por defecto) + Hermes | *Development builds* con `expo-dev-client` |
| Navegación | **Expo Router** | Rutas por archivos |
| Datos locales | **`expo-sqlite`** + **Drizzle ORM** (`drizzle-orm/expo-sqlite`, `drizzle-kit`) | `useLiveQuery` para listas reactivas |
| Búsqueda | **FTS5** de SQLite (verificar disponibilidad en la PoC de M0; alternativa: columna `search_text` normalizada + índice) | |
| Estado UI | **Zustand** (sesión, sync, filtros) | La fuente de datos es SQLite, no un caché en memoria |
| Formularios | **React Hook Form + Zod** (`@hookform/resolvers`) | Esquemas de `packages/contracts` |
| Listas | **`@shopify/flash-list`** | Catálogo de decenas de miles de filas |
| UI | **React Native Paper** (Material 3) o **NativeWind** | Elegir uno en M0 y no mezclar |
| Red | `fetch` con un cliente propio (`ApiClient`) + `@react-native-community/netinfo` | Reintentos y renovación de token |
| Seguridad | `expo-secure-store`, `expo-local-authentication` | Tokens, bloqueo biométrico |
| Cámara / código de barras | `expo-camera` (escáner) | Lectores Bluetooth/Zebra funcionan como teclado |
| PDF / compartir | `expo-print`, `expo-sharing` | PDF de cotización/pedido |
| Segundo plano | `expo-background-task` (WorkManager) | Complementario; no garantizado |
| Cálculo | `decimal.js` + `packages/domain` | Nunca `number` para dinero |
| IDs | `uuid` (v7) + `react-native-get-random-values` | IDs generados en el dispositivo |
| Errores | **Sentry** (`sentry-expo` / `@sentry/react-native`) | Opcional |
| Pruebas | Jest, React Native Testing Library, **Maestro** (E2E), `better-sqlite3` para pruebas de repositorios en Node | |
| CI/CD | GitHub Actions (+ EAS Build opcional) | |

---

## 4. Arquitectura de la app

```
┌────────────────────────── apps/mobile ─────────────────────────────┐
│                                                                     │
│  UI (Expo Router + componentes)                                     │
│    │  hooks: useProducts, useCustomers, useDocuments, useSyncState  │
│    ▼                                                                │
│  Servicios de aplicación                                            │
│    · AuthService  · DocumentService  · CustomerService  · StockSvc  │
│    │                         │ usa                                  │
│    │                         ▼                                      │
│    │                packages/domain  (totales, impuestos, moneda)   │
│    ▼                                                                │
│  Repositorios (Drizzle)  ──►  SQLite (réplica + docs + outbox)      │
│    ▲                                                                │
│    │ aplica cambios                                                 │
│  SyncEngine  ◄──►  ApiClient (HTTPS, JWT, reintentos)  ◄──►  API    │
│    ▲                                                                │
│    │ disparadores: abrir app · volver red · manual · background     │
└─────────────────────────────────────────────────────────────────────┘
```

### Reglas de arquitectura

1. **La UI jamás llama a la API directamente** (salvo *login* y *stock en vivo*); lee de SQLite y escribe vía servicios.
2. **Toda escritura de negocio** = transacción SQLite que modifica el documento **y** agrega una fila al *outbox*. Nunca una sin la otra.
3. **La réplica es de solo lectura** para el usuario; solo el *pull* la modifica.
4. **El servidor es autoritativo**: stock, numeración definitiva, precios finales y totales finales.
5. **Cálculos** únicamente con `packages/domain`.
6. **El pull no pisa** filas que tengan operaciones pendientes en el *outbox*.

---

## 5. Integración con el monorepo

```
mini-erp/
├── apps/
│   ├── api/
│   ├── web/
│   └── mobile/            ← NUEVO (Expo)
└── packages/
    ├── contracts/         ← Zod + tipos (compartido con mobile)
    ├── domain/            ← lógica pura (compartido con mobile)
    └── config/
```

**Condiciones para compartir paquetes con Hermes:**

- `packages/domain` y `packages/contracts` **sin dependencias de Node** (`fs`, `crypto` de Node, `Buffer`…) ni de DOM.
- Salida en **ESM/CJS estándar**, sin *top-level await*; evitar `Intl` avanzado (Hermes tiene soporte parcial: formatear números con utilidades propias o `Intl.NumberFormat` probado en dispositivo).
- Probar los paquetes en el dispositivo desde M0 con un caso real (`calcDocumentTotals`).

**Monorepo + pnpm + Metro:**

- Las versiones recientes de Expo detectan monorepos automáticamente; con pnpm, si Metro no resuelve dependencias, usar `node-linker=hoisted` en `.npmrc` o la configuración recomendada por la documentación vigente de Expo.
- Declarar los paquetes internos como dependencias `workspace:*` en `apps/mobile/package.json`.

---

## 6. Modelo de datos local (SQLite)

### 6.1 Principios

- Es una **réplica parcial y desnormalizada** de PostgreSQL, no una copia del esquema.
- Dinero y cantidades como **`TEXT`** (decimales exactos) operados con `decimal.js`. **No usar `REAL`.**
- Booleanos `INTEGER 0/1`; fechas `TEXT` ISO-8601 UTC.
- Todas las tablas replicadas tienen `version INTEGER` (para `upsertIfNewer`).
- `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`
- Migraciones versionadas con **drizzle-kit** (`useMigrations`) y `PRAGMA user_version`.

### 6.2 Tablas

#### A. Réplica (la escribe solo el *pull*)

| Tabla | Contenido clave |
|---|---|
| `products` | `id, sku, name, category_name, unit_code, tax_id, tracking_mode, is_active, version` |
| `product_refs` | `product_id, kind (OEM/ALT/BARCODE), code` |
| `product_prices` | `product_id, price_list_id, currency, price` (solo las listas que usa el vendedor) |
| `stock_snapshots` | `product_id, warehouse_id, quantity, reserved, as_of` |
| `warehouses` | `id, code, name` |
| `customers` | `id, rif, name, phone, email, address, price_list_id, credit_limit, credit_days, balance_snapshot, overdue_snapshot, seller_id, version` |
| `taxes` | `id, code, name, rate, kind, valid_from, valid_to` |
| `exchange_rates` | `currency, rate, date` |
| `price_lists` | `id, name, currency` |
| `app_settings` | Política por empresa/vendedor: `allow_price_edit, max_discount_pct, price_policy, allow_customer_create…` |
| `products_fts`, `customers_fts` | Tablas virtuales FTS5 (texto normalizado sin tildes) |

#### B. Documentos (escribe el usuario y también el *pull* para estados)

| Tabla | Contenido clave |
|---|---|
| `sales_documents` | `id (UUIDv7), doc_type (QUOTE/ORDER), customer_id, local_number, server_number, currency, exchange_rate, rate_date, payment_condition, credit_days, warehouse_id, notes, valid_until, source_document_id, subtotal, tax_total, total, local_status, server_status, sync_error, created_at_device, updated_at, version` |
| `sales_document_lines` | `id, document_id, product_id, sku, description, quantity, unit_price, discount_pct, tax_id, tax_rate, line_total` |

**Estados locales (`local_status`):**

```
DRAFT ──guardar──▶ PENDING_SYNC ──push OK──▶ SYNCED
                        │
                        ├──rechazo──▶ REJECTED   (el vendedor corrige y reenvía)
                        └──revisión─▶ NEEDS_REVIEW (administración decide)
```

`server_status` refleja el estado en el servidor (`CONFIRMED`, `PARTIALLY_INVOICED`, `INVOICED`, `CANCELLED`, `EXPIRED`…), actualizado por el *pull*.

#### C. Sincronización y sesión

| Tabla | Contenido clave |
|---|---|
| `outbox` | `client_op_id (PK, UUIDv7), client_seq, entity, action, entity_id, payload_json, status (PENDING/SENDING/DONE/REJECTED/REVIEW), attempts, next_attempt_at, last_error, created_at` |
| `sync_meta` | Pares clave/valor: cursores por entidad, `device_id`, `device_code`, `local_seq`, `schema_version`, `last_full_sync`, `company_id` |
| `sync_log` | Últimas N sincronizaciones (para diagnóstico) |

### 6.3 Esquema SQL de referencia (extracto)

```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY, sku TEXT NOT NULL, name TEXT NOT NULL,
  category_name TEXT, unit_code TEXT, tax_id TEXT,
  tracking_mode TEXT NOT NULL DEFAULT 'NONE',
  is_active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL
);
CREATE INDEX idx_products_sku ON products(sku);

CREATE VIRTUAL TABLE products_fts USING fts5(
  sku, name, refs, barcodes, content='', tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE outbox (
  client_op_id TEXT PRIMARY KEY, client_seq INTEGER NOT NULL UNIQUE,
  entity TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
  last_error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_outbox_status_seq ON outbox(status, client_seq);
```

### 6.4 Volumen y rendimiento esperados

| Dato | Estimado | Observación |
|---|---|---|
| Productos | 20 000 – 60 000 | ~10–25 MB en SQLite incluyendo FTS |
| Clientes del vendedor | 200 – 3 000 | Filtrados por vendedor/zona |
| Descarga inicial (gzip) | ~3–10 MB | Caddy comprime; paginado de 1 000–2 000 filas |
| Búsqueda | < 200 ms | FTS5 + límite de 50 resultados |

---

## 7. Motor de sincronización

### 7.1 Disparadores

1. Al **abrir la app** / volver a primer plano (si hay sesión desbloqueada).
2. Al detectar **recuperación de red** (`netinfo`).
3. Tras **guardar** un documento/cliente (con *debounce* de 2 s).
4. **Botón manual** (*"Sincronizar ahora"*).
5. **Tarea en segundo plano** cada ≥15 min (`expo-background-task`) — complementaria, no se confía en ella.

Un **mutex** garantiza una sola sincronización a la vez.

### 7.2 Ciclo de sincronización

```
1. ¿Hay red y sesión válida?  (renovar token si expiró; si falla → pausa)
2. PUSH:  enviar outbox PENDING en orden de client_seq (lotes de 20)
          · aplicar resultado por operación (APPLIED / DUPLICATE / REJECTED / NEEDS_REVIEW)
3. PULL:  por entidad, en este orden:
          app_settings → taxes → exchange_rates → price_lists → warehouses
          → customers → products (+refs, +prices) → stock_snapshots → my_documents
4. Actualizar sync_meta (cursores, last_sync) y notificar a la UI
```

> Se hace **push antes que pull** para que los números definitivos y estados lleguen en el mismo ciclo.

### 7.3 Push

- Cada operación: `{ clientOpId, clientSeq, entity, action, data }` con `entity ∈ { customer, sales_quote, sales_order }`.
- Respuesta por operación:

| Estado | Acción en la app |
|---|---|
| `APPLIED` | `outbox → DONE`; documento `SYNCED`; guardar `server_number`, `serverId` |
| `DUPLICATE` | Igual que `APPLIED` |
| `REJECTED` | `outbox → REJECTED`; documento `REJECTED` con `errorCode` y mensaje para el vendedor |
| `NEEDS_REVIEW` | Documento `NEEDS_REVIEW`; mostrar "En revisión" |
| Error de red / 5xx | Permanece `PENDING`; *backoff* exponencial (5 s, 15 s, 1 min, 5 min… máx. 30 min) con *jitter* |
| 401 | Renovar token; si falla, pausar y pedir login (la cola **se conserva**) |
| 403 `DEVICE_REVOKED` | Bloquear app (ver sección 11) |
| 426 `UPGRADE_REQUIRED` | Pedir actualizar la app; la cola se conserva |

- **Coalescencia:** si el vendedor edita un documento aún `PENDING` (sin enviar), se **reemplaza el payload** de la operación pendiente en lugar de crear otra.
- **Orden:** una operación `REJECTED` no bloquea las siguientes que no dependan de ella (p. ej. un pedido que referencia un cliente rechazado queda `PENDING` hasta resolver el cliente; se marca dependencia por `entity_id`).

### 7.4 Pull

- `GET /sync/pull?cursor=…&entities=…` con **solape de 60 s** y comparación por `version`.
- Cada lote se aplica en **una transacción SQLite** junto con el nuevo cursor.
- `op: "delete"` → se elimina la fila local (para productos/clientes con documentos locales, se marca inactiva en lugar de borrar).
- **No sobrescribir** documentos con operaciones pendientes en `outbox`.
- `my_documents`: documentos del vendedor de los últimos 60 días (estado, número, facturación) para reflejar lo ocurrido en el servidor o creado desde la web.
- **Bootstrap** (primera vez): cursor vacío, progreso por entidad en pantalla, reanudable si se interrumpe.
- **Restablecer réplica:** borra tablas replicadas y repite el *bootstrap*; **nunca borra el outbox**.

### 7.5 Numeración provisional

`OFF-{device_code}-{seq}` (ej. `OFF-D07-000123`): `device_code` lo entrega el servidor al registrar el dispositivo y `seq` es un contador en `sync_meta` incrementado **dentro de la misma transacción** que crea el documento. El número definitivo (`PED-004512`) llega en la respuesta del push.

### 7.6 Reloj del dispositivo

Se guarda `created_at_device` con zona horaria. El servidor usa su propia hora para efectos fiscales y registra la diferencia (*clock skew*) como metadato. La fecha comercial del documento la asigna el servidor al confirmar.

---

## 8. Contratos de API requeridos al backend

La app solo consume contratos del v2. Lo siguiente es lo **necesario o adicional para móvil**; debe definirse en OpenAPI (`packages/contracts`) **antes** de empezar M2.

| # | Contrato | Descripción | Sprint backend v2 |
|---|---|---|---|
| B1 | `POST /auth/login` (modo dispositivo) | Devuelve `accessToken` **y `refreshToken` en el cuerpo** (no cookie), lista de empresas, permisos | S0 |
| B2 | `POST /auth/select-company`, `POST /auth/refresh`, `POST /auth/logout` | Refresh rotativo en cuerpo (30 días en dispositivo registrado) | S0 |
| B3 | `POST /devices/register` | Registra dispositivo (`name, platform, appVersion`) → `deviceId`, `deviceCode` | S5 |
| B4 | `GET /sync/pull` | Entidades: `app_settings, taxes, exchange_rates, price_lists, warehouses, customers, products, stock_snapshots, my_documents`. **Filtrado por vendedor** (clientes, listas de precios y documentos propios) | S5 |
| B5 | `POST /sync/push` | Entidades: `customer`, `sales_quote`, `sales_order`; acciones `create`/`update`; idempotente por `clientOpId`; `sales_order.create` **crea y confirma** en la misma transacción | S5 |
| B6 | `GET /inventory/stock?productId=…` | Stock en vivo por depósito (permiso `stock:view-live`) | S3 |
| B7 | `GET /app/config` | `minAppVersion`, `latestAppVersion`, `schemaVersion`, mensajes de mantenimiento | S5 |
| B8 | Errores estándar | `DEVICE_REVOKED` (403), `UPGRADE_REQUIRED` (426), `INSUFFICIENT_STOCK`, `PRICE_CHANGED`, `PRODUCT_INACTIVE`, `CUSTOMER_DUPLICATE_RIF` | S5 |
| B9 | Compresión `gzip`/`br` | Habilitada en Caddy (`encode zstd gzip`) | S0 |

**Mock-first:** para no depender del backend, en M0 se publica el contrato OpenAPI de `sync/*` y se levanta un **servidor simulado** (Prism o MSW + Node) con datos de ejemplo. La app avanza contra el mock y se integra con el backend real cuando S5 esté listo.

---

## 9. Pantallas y flujos

### 9.1 Mapa de navegación

```
Arranque
 ├─ ¿Sin sesión?           → Login → [Seleccionar empresa] → Registro de dispositivo → Bootstrap (progreso)
 ├─ ¿Sesión + bloqueada?   → Desbloqueo (PIN / huella)
 └─ ¿Todo listo?           → Tabs
        ┌─────────┬────────────┬───────────┬──────────────┬───────┐
        │ Inicio  │ Productos  │ Clientes  │ Documentos   │ Más   │
        └─────────┴────────────┴───────────┴──────────────┴───────┘
```

### 9.2 Detalle por pantalla

| Pantalla | Contenido / comportamiento |
|---|---|
| **Login** | RIF/usuario y contraseña, mostrar versión y entorno; mensaje claro si no hay red |
| **Selector de empresa** | Solo si el usuario tiene varias; empresa elegida queda fija en el dispositivo (cambiar = restablecer réplica) |
| **Bootstrap** | Barra de progreso por entidad (*"Productos 12 000 / 40 000"*), reanudable, tamaño aproximado |
| **Desbloqueo** | PIN de 4–6 dígitos y/o huella; bloqueo tras N minutos en segundo plano |
| **Inicio** | Estado de sincronización (última vez, pendientes), atajos "Nuevo pedido" / "Nueva cotización", tasa BCV vigente y fecha, alertas (rechazados, versión) |
| **Productos – lista** | Buscador (SKU/nombre/OEM), botón escáner, resultados con precio y stock total, filtros por instancia |
| **Producto – detalle** | Precios por lista, impuesto, equivalentes/OEM, stock por depósito con "actualizado hace…", botón **"Ver stock en vivo"** (solo con red), botón "Agregar a documento" |
| **Clientes – lista** | Buscador (RIF/nombre), etiqueta de crédito, indicador de pendiente de sincronizar |
| **Cliente – detalle** | Datos, crédito (límite, saldo, vencido *al corte de última sincronización*), atajos a nueva cotización/pedido, historial reciente de documentos |
| **Cliente – formulario** | RIF con validación (`J-12345678-9`), razón social, teléfono, dirección, lista de precios; al guardar queda **pendiente de validación** |
| **Documentos – lista** | Pestañas **Pedidos / Cotizaciones**, filtros por estado, insignias de sincronización |
| **Editor de documento** | Cliente → líneas → condiciones → totales (ver 9.3) |
| **Detalle de documento** | Líneas, totales, estado local y de servidor, línea de tiempo, **compartir PDF**, convertir (cotización → pedido), duplicar |
| **Sincronización** | Cola pendiente, últimos resultados, errores por documento, "Sincronizar ahora", "Restablecer réplica" |
| **Más / Ajustes** | Perfil, empresa, dispositivo (código), versión, bloqueo, cerrar sesión (advierte si hay pendientes) |

### 9.3 Editor de documentos (pantalla clave)

```
┌─────────────────────────────────────────┐
│ Nueva cotización            OFF-D07-0124│
│ Cliente: [ Repuestos El Sol, C.A.  ▾ ]  │  ← crédito disponible: $ 1 250
├─────────────────────────────────────────┤
│ Líneas                         [📷][＋] │
│  1. Pastilla freno XYZ  x 4  $ 12,50    │
│     desc 5 %             Bs 1 736,24    │
│  2. Filtro aceite ABC   x 10 $  3,20    │
├─────────────────────────────────────────┤
│ Condición: Crédito 15 días  · Depósito: Principal │
│ Tasa BCV: 36,52 (09/10/2026)            │
├─────────────────────────────────────────┤
│ Subtotal $ 79,50 · IVA 16 % $ 12,72     │
│ TOTAL $ 92,22        ≈ Bs 3 367,87      │
│ [ Guardar borrador ]   [ Guardar y enviar ] │
└─────────────────────────────────────────┘
```

**Comportamiento:**

- Agregar productos por buscador, **escáner** o desde el detalle del producto; sumar cantidad si ya existe la línea.
- Totales **en vivo** con `calcDocumentTotals()` de `packages/domain`.
- Validaciones locales (ver sección 10) con avisos **no bloqueantes** (stock, crédito) y errores **bloqueantes** (sin cliente, sin líneas, cantidad ≤ 0, descuento fuera de límite).
- *Guardar y enviar* = confirmar localmente (`PENDING_SYNC`) + encolar + disparar sincronización.
- Borradores se **autoguardan** al salir o al enviar la app a segundo plano.

### 9.4 Conversión cotización → pedido

1. Desde la cotización: *"Convertir en pedido"* → abre el editor con las líneas copiadas y `source_document_id`.
2. El vendedor puede ajustar cantidades; guarda como un **pedido nuevo** (la cotización queda con la marca "convertida" localmente y el servidor la cierra al sincronizar).
3. Si la cotización venció (`valid_until`), se avisa y se **revalidan precios** con la lista vigente.

---

## 10. Reglas de negocio en el móvil

| Regla | Comportamiento |
|---|---|
| **Moneda y tasa** | Precios en USD (u otra) convertidos a Bs con la **última tasa BCV sincronizada**; el documento guarda `exchange_rate` y `rate_date`. Si la tasa tiene más de N días, se advierte |
| **Impuestos** | IVA por línea según el producto (alícuota sincronizada con vigencia). IGTF **no aplica** en pedidos/cotizaciones (se calcula en pagos) |
| **Precio** | Por defecto, el de la lista de precios del cliente; **editable solo si** `allow_price_edit`; descuento limitado por `max_discount_pct` |
| **Política de precio al sincronizar** | Configurable en servidor: *respetar precio pactado* (por defecto) o *revalidar* (`NEEDS_REVIEW` si cambió) |
| **Stock** | Indicativo; si la cantidad supera la existencia sincronizada se **advierte sin bloquear** (el servidor acepta con advertencia, según v2) |
| **Crédito** | Si el total de una venta a crédito supera `crédito disponible` (límite − saldo, snapshot) se advierte; el servidor valida |
| **Cliente nuevo** | Se crea localmente `PENDING_SYNC`; puede usarse de inmediato en documentos. Si el RIF ya existe en el servidor, **se vincula** al existente y la app actualiza referencias locales |
| **Producto desactivado** | Si llega `PRODUCT_INACTIVE` en el push, el documento queda `REJECTED` con el motivo |
| **Productos con lotes/seriales** | v1.0 no gestiona asignación en móvil; si la empresa los usa, la asignación la resuelve el servidor (FEFO/automática) |
| **Edición** | `DRAFT` y `PENDING_SYNC`: editable. `SYNCED`: solo lectura (los cambios se hacen desde la oficina) |
| **Anulación** | Fuera de alcance v1.0: se solicita a administración |
| **Numeración** | Provisional `OFF-…`; definitiva asignada por el servidor |
| **Totales** | Si el servidor recalcula y difiere, gana el servidor; la app lo muestra tras el *pull* |

---

## 11. Seguridad

| Medida | Detalle |
|---|---|
| **Tokens** | Access (15 min) en memoria; refresh token en **`expo-secure-store`** (Keystore de Android). Rotación al renovar |
| **Bloqueo local** | PIN y/o biometría (`expo-local-authentication`); bloqueo tras N min en segundo plano; el PIN no se envía al servidor |
| **Cifrado de la base** | **SQLCipher** con `expo-sqlite` si la versión de Expo lo soporta (verificar en PoC de M0); clave aleatoria generada al primer arranque y guardada en SecureStore |
| **Respaldos de Android** | `allowBackup: false` para impedir extracción por ADB/copias en la nube |
| **Capturas de pantalla** | Opcional: `FLAG_SECURE` en pantallas con datos sensibles (costos nunca se descargan) |
| **Mínimo de datos** | Sin costos, márgenes ni datos de otros vendedores; clientes solo los asignados |
| **Revocación** | El servidor devuelve `DEVICE_REVOKED`: la app se bloquea de inmediato y **borra la réplica**. El *outbox* pendiente se conserva cifrado un plazo configurable (p. ej. 7 días) para que administración pueda rehabilitar el dispositivo o recuperar los datos |
| **Inactividad** | Si pasan más de N días sin sincronizar (p. ej. 14), la app exige conexión y login antes de continuar |
| **Transporte** | Solo HTTPS (Caddy/Let's Encrypt). *Certificate pinning* **no** recomendado por la rotación de certificados |
| **Logs** | Sin datos personales ni tokens en logs/Sentry; filtrar antes de enviar |
| **Cierre de sesión** | Si hay operaciones pendientes, advertir y ofrecer sincronizar primero |
| **Dependencias** | `pnpm audit` en CI; actualizaciones periódicas del SDK de Expo |

---

## 12. Build, distribución y entornos

### 12.1 Entornos (variantes de la app)

| Entorno | `applicationId` | Nombre | API |
|---|---|---|---|
| `dev` | `com.tuempresa.erpventas.dev` | ERP Ventas (dev) | Mock / local por Tailscale |
| `staging` | `com.tuempresa.erpventas.staging` | ERP Ventas (stg) | `https://staging.erp.tuempresa.com` |
| `prod` | `com.tuempresa.erpventas` | ERP Ventas | `https://erp.tuempresa.com` |

Se configuran con `app.config.ts` y la variable `APP_ENV`; permiten instalar las tres versiones en un mismo teléfono.

### 12.2 Compilación

- **Opción A (recomendada):** GitHub Actions → `expo prebuild` → Gradle `assembleRelease` / `bundleRelease` (AAB) → artefactos firmados con *keystore* guardado como secreto cifrado.
- **Opción B:** EAS Build (verificar límites del plan vigente).
- El **keystore** de firma se respalda fuera del repositorio (perderlo impide actualizar la app en Google Play si no se usa *Play App Signing*; recomendado activarlo).

### 12.3 Distribución

| Fase | Canal |
|---|---|
| Desarrollo / QA | APK directo o EAS *internal distribution* |
| Piloto | **Google Play – prueba interna** (hasta 100 testers) o APK firmado compartido |
| Producción | **Google Play – prueba cerrada / producción** (cuenta de desarrollador con costo único) o APK corporativo con actualización manual |

### 12.4 Actualizaciones

- **Binario nuevo:** vía Play o APK. `GET /app/config` devuelve `minAppVersion`; si la versión instalada es menor, la app muestra "Actualización requerida" y **no sincroniza**, pero **conserva la cola**.
- **Solo JavaScript (OTA):** `expo-updates` opcional; si se usa, aplicar solo con la app sin operaciones en curso y respetando `runtimeVersion`. Evaluar si compensa frente a la complejidad (con Play interna suele bastar).
- **Esquema SQLite:** cada versión incluye migraciones; si fallan, se reconstruye la réplica y se **protege el outbox**.

---

## 13. Calidad, rendimiento y observabilidad

### 13.1 Objetivos de rendimiento (dispositivo de gama media-baja: 3 GB RAM, Android 10)

| Métrica | Objetivo |
|---|---|
| Arranque en frío hasta pantalla útil | < 3 s |
| Búsqueda en 50 000 productos | < 200 ms |
| Apertura de lista de 3 000 clientes | < 500 ms |
| Scroll de listas | 60 fps (FlashList) |
| Guardar documento de 30 líneas | < 300 ms |
| Bootstrap de 40 000 productos | < 3 min en 4G |
| Consumo de batería en segundo plano | Mínimo (sin servicios persistentes) |

### 13.2 Pruebas

| Nivel | Herramienta | Foco |
|---|---|---|
| Unitarias | Jest | `packages/domain`, utilidades, *backoff*, normalización de búsqueda |
| Repositorios | Jest + `better-sqlite3` en memoria | Esquema Drizzle, `upsertIfNewer`, transacciones documento+outbox |
| Motor de sync | Jest + servidor simulado (MSW) | Reintentos, DUPLICATE, REJECTED, cortes a mitad de lote, 401/403/426 |
| Componentes | React Native Testing Library | Editor de documentos, buscador |
| **E2E** | **Maestro** | Flujos con y sin red (modo avión) |
| Dispositivos reales | Matriz manual | Al menos 3 modelos (gama baja, media, alta) y Android 8/10/13+ |
| Integración | Contra staging real | Desde M5 |

**Flujos E2E obligatorios:**

1. Login → selección de empresa → bootstrap → búsqueda de un producto.
2. **Modo avión:** crear 5 pedidos y 2 cotizaciones → reconectar → todos sincronizados exactamente una vez.
3. Corte de red a mitad del push → reintento → sin duplicados ni pérdidas.
4. Cliente nuevo offline + pedido para ese cliente → ambos se sincronizan en orden correcto.
5. Pedido con producto inactivo → queda `REJECTED` con motivo comprensible.
6. Dispositivo revocado desde administración → la app se bloquea.
7. Cotización → conversión a pedido → sincronización.
8. App cerrada a la fuerza durante un guardado → no hay documento sin outbox ni viceversa.

### 13.3 Observabilidad

- **Sentry** (errores y *breadcrumbs* de sincronización, sin datos personales).
- Pantalla interna **"Diagnóstico"** (oculta): versión, esquema, tamaño de la BD, cursores, últimas sincronizaciones, exportar log.
- Métricas de servidor por dispositivo (`last_seen_at`, versión de app, tamaño de cola reportado en cada push).

---

## 14. Plan por sprints (M0–M8)

*Sprints de 2 semanas. Estimación para 1–2 desarrolladores móviles con apoyo puntual del backend. Es una estimación inicial que debe ajustarse tras M0.*

### M0 – Fundación y pruebas de concepto (2 sem)

**Objetivo:** proyecto compilando, PoC técnicos resueltos, contrato `sync` publicado.

- [ ] Crear `apps/mobile` (Expo + TypeScript estricto + Expo Router + *dev client*)
- [ ] Integrar en el monorepo (`workspace:*`, Metro, `.npmrc` si hace falta)
- [ ] `packages/domain` y `packages/contracts` ejecutándose en el dispositivo (caso `calcDocumentTotals`)
- [ ] **PoC técnicos:** FTS5 con 50 000 productos sintéticos; SQLCipher; `useLiveQuery`; UUIDv7 en Hermes; rendimiento de FlashList
- [ ] Drizzle + migraciones + esquema base (tablas de sección 6)
- [ ] Tema, componentes base (Paper/NativeWind), navegación y *layout* de tabs
- [ ] `ApiClient` (JWT, interceptores, errores estándar) y `app.config.ts` por entorno
- [ ] **Contrato OpenAPI de `auth`, `devices`, `sync`, `inventory/stock`, `app/config`** + servidor simulado
- [ ] CI: lint, typecheck, pruebas y **APK de depuración** como artefacto
- [ ] Sentry opcional

**Criterios de aceptación:** APK instalable en un dispositivo real mostrando totales calculados con `packages/domain`; informe de PoC con decisiones (FTS5/SQLCipher OK o alternativa).

### M1 – Acceso, dispositivo y bootstrap (2 sem)

**Objetivo:** el vendedor inicia sesión y descarga su catálogo.

- [x] Pantalla de login y manejo de errores (sin red, credenciales, usuario inactivo)
- [x] Selección de empresa; `select-company`
- [x] Registro de dispositivo (`devices/register`) → `deviceId`, `deviceCode`
- [x] Almacenamiento seguro de tokens; renovación automática; cierre de sesión
- [x] PIN + biometría; bloqueo por inactividad
- [x] **Bootstrap** con progreso, reanudable y cancelable
- [x] `GET /app/config` (versión mínima, bloqueo por versión)
- [x] Esquema de **permisos** en cliente (`usePermission`)
- [x] Pruebas: sesión vencida, reinicio de la app durante el bootstrap

**Estado: implementado y verificado** (pruebas unitarias con SQLite real e integración contra el ERP real; pendiente probar en teléfono físico).

**Aceptación:** tras login, en un teléfono limpio el catálogo completo queda local en < 3 min; al reiniciar sin red, la app abre con PIN y muestra datos.

### M2 – Productos, stock y pull incremental (2 sem)

**Objetivo:** consulta de catálogo y existencias, totalmente offline.

- [x] Repositorio y pull incremental de `products`, `product_refs`, `product_prices`, `price_lists`, `taxes`, `exchange_rates`, `warehouses`, `stock_snapshots`
- [x] Búsqueda FTS5 (SKU/nombre/OEM/barcode) con normalización de tildes
- [x] Lista de productos (FlashList) + filtros por instancia
- [x] **Escáner de código de barras** (`expo-camera`) y soporte de lector tipo teclado
- [x] Detalle de producto: precios por lista, impuesto, equivalentes, stock por depósito con antigüedad
- [x] **Stock en vivo** (`GET /inventory/stock`) con manejo de error/sin red
- [x] Indicador de sincronización y "Sincronizar ahora"
- [x] Pruebas de rendimiento con 50 000 productos

**Estado: implementado y verificado** (SQLite real con 50 000 productos: búsqueda en 4–8 ms; integración contra el ERP real; pendiente probar cámara/escáner en teléfono físico). Notas: la búsqueda usa `search_text` + `LIKE` (decisión #23) y el filtro «por instancia» se sustituye por «solo con existencia».

**Aceptación:** búsqueda < 200 ms con 50 000 productos; un cambio de precio hecho en la web aparece en el teléfono tras un pull.

### M3 – Clientes y motor de push (2 sem)

**Objetivo:** primer flujo de escritura offline completo y robusto.

- [ ] Pull de `customers` (filtrado por vendedor) + búsqueda FTS
- [ ] Lista y detalle de cliente (crédito, saldo, vencido indicativos)
- [ ] **Alta y edición de cliente** con validación de RIF (`contracts`)
- [ ] **Outbox** genérico: tabla, repositorio, transacción documento+outbox, coalescencia
- [ ] **SyncEngine**: mutex, push en lotes, *backoff* con *jitter*, manejo de 401/403/426, aplicación de resultados
- [ ] Vinculación de cliente duplicado por RIF (reemplazo de referencias locales)
- [ ] Pantalla de **Sincronización** (cola, errores)
- [ ] Pruebas del motor con servidor simulado (cortes, duplicados, rechazos)

**Aceptación:** crear 10 clientes en modo avión → reconectar → aparecen 10 veces exactas en el servidor; reintentar el push no duplica.

### M4 – Cotizaciones (2 sem)

**Objetivo:** editor de documentos y cotizaciones completas.

- [ ] **`DocumentEditor`**: cliente, líneas, condiciones, totales en vivo (`packages/domain`)
- [ ] Agregar líneas desde buscador, escáner y detalle de producto
- [ ] Políticas de `app_settings` (edición de precio, descuento máximo)
- [ ] Validaciones bloqueantes y avisos (stock, crédito, tasa antigua)
- [ ] Numeración provisional `OFF-…`
- [ ] Autoguardado de borradores; estados locales
- [ ] Listado de cotizaciones, detalle, duplicar
- [ ] **PDF compartible** (`expo-print` + `expo-sharing`) con datos de la empresa
- [ ] Push de `sales_quote` y reflejo de número definitivo

**Aceptación:** una cotización de 30 líneas se crea sin red, se comparte en PDF y, al sincronizar, muestra su número definitivo.

### M5 – Pedidos de venta (2 sem)

**Objetivo:** flujo comercial completo.

- [ ] Pedido desde cero y **conversión cotización → pedido** (`source_document_id`)
- [ ] Push de `sales_order` (crear y confirmar en servidor)
- [ ] Manejo de `REJECTED` / `NEEDS_REVIEW` con mensajes comprensibles y acción "corregir y reenviar"
- [ ] Pull de `my_documents` (estado servidor: confirmado, facturado, anulado…)
- [ ] Línea de tiempo del documento y detalle de estado
- [ ] Revalidación de precios de cotizaciones vencidas
- [ ] Integración contra **staging real** (backend S5)
- [ ] Pruebas E2E Maestro de los flujos 2–5 de la sección 13.2

**Aceptación:** 20 pedidos creados sin conexión se sincronizan una vez; los rechazados muestran el motivo; el estado "facturado" aparece cuando administración factura en la web.

### M6 – Endurecimiento offline y seguridad (2 sem)

**Objetivo:** robustez de campo.

- [ ] Tarea en segundo plano (`expo-background-task`) y recuperación al abrir
- [ ] **Cifrado SQLCipher** activo (si la PoC lo validó) y `allowBackup: false`
- [ ] Revocación de dispositivo: bloqueo, borrado de réplica y retención de outbox
- [ ] Política de inactividad (N días sin sincronizar)
- [ ] Migraciones de SQLite probadas (actualización de versión con datos reales y outbox pendiente)
- [ ] `minAppVersion` / actualización requerida sin pérdida de cola
- [ ] "Restablecer réplica" sin tocar el outbox
- [ ] Pantalla **Diagnóstico** + Sentry con filtrado de datos personales
- [ ] Pruebas de caos: cierre forzado, batería baja, red intermitente, cambio de hora del dispositivo

**Aceptación:** matriz de fallos superada sin pérdida ni duplicación de datos.

### M7 – QA, rendimiento y piloto (2 sem)

- [ ] Matriz de dispositivos (gama baja/media/alta; Android 8/10/13+)
- [ ] Optimización (arranque, memoria, tamaño del APK, FlashList, índices)
- [ ] Accesibilidad básica (tamaños de fuente, contraste, objetivos táctiles) y textos en español (es-VE)
- [ ] **Piloto con 2–3 vendedores** durante 1–2 semanas; recopilar métricas y feedback
- [ ] Corrección de defectos priorizados; ajuste de UX (atajos, menos toques)
- [ ] Manual breve de usuario (PDF/video corto)

### M8 – Lanzamiento (2 sem)

- [ ] Configuración de **Play Console** (prueba cerrada/producción), *Play App Signing*, ficha, política de privacidad
- [ ] Pipeline de *release* firmado y versionado (`versionCode` automático)
- [ ] Capacitación a vendedores y guía de soporte (cómo revisar rechazados, qué hacer sin señal)
- [ ] Monitoreo post-lanzamiento (Sentry, dispositivos activos, colas largas)
- [ ] Plan de soporte y de actualizaciones; retrospectiva y backlog v1.1

---

## 15. Cronograma y dependencias con el backend

```
Semana:        1  3  5  7  9  11 13 15
Backend v2:    S0 S1 S2 S3 S4 S5 S6 S7 ...
Móvil:         M0 M1 M2 M3 M4 M5 M6 M7 M8
               │  │  │     │  │
               │  │  │     │  └─ M5 integra con staging real (necesita S5)
               │  │  │     └──── M4 sobre mock; usa push de cotizaciones
               │  │  └────────── M2/M3 pueden usar mock de sync
               │  └───────────── M1 requiere auth (S0) y devices (puede mockearse)
               └──────────────── M0 publica el contrato OpenAPI y el mock
```

| Dependencia | Necesaria para | Mitigación |
|---|---|---|
| Auth con refresh en cuerpo (B1–B2) | M1 | Backend S0; mock en M0 |
| Catálogos con datos de prueba | M2 | Semillas (seed) realistas de 40 000+ productos |
| `sync/pull` y `push` reales (B4–B5) | M3–M5 | **Mock-first**; integración real en M5 |
| Stock en vivo (B6) | M2 | Backend S3; mock |
| Política de impuestos y tasa BCV | M4 | Backend S1 |

**Ruta crítica:** el backend S5 (`sync` + dispositivos) y el contrato OpenAPI de M0. Si S5 se retrasa, M5 se retrasa, no M0–M4.

**Duración total:** ~16 semanas (M0–M8) en paralelo con el backend; con 1 solo desarrollador móvil, considerar ~20 semanas.

---

## 16. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | FTS5 o SQLCipher no disponibles en la versión de Expo | Medio | PoC en M0; alternativa: búsqueda con `search_text` indexado y cifrado a nivel de campos sensibles |
| 2 | Retraso del backend `sync` (S5) | Alto | Mock-first con contrato OpenAPI desde M0 |
| 3 | Políticas de ahorro de batería de fabricantes (Xiaomi, Huawei…) matan tareas en segundo plano | Medio | No depender del segundo plano; sincronizar al abrir y al volver la red; guía de ajustes para vendedores |
| 4 | Reloj del dispositivo incorrecto | Bajo | El servidor asigna fechas fiscales; se registra *clock skew* |
| 5 | Pérdida o robo del teléfono | Alto | PIN/biometría, cifrado, revocación remota, datos mínimos, expiración por inactividad |
| 6 | Catálogo muy grande afecta memoria/arranque | Medio | Paginar, FTS, FlashList, índices, pruebas con 50 000+ filas desde M0 |
| 7 | Versiones antiguas de la app con payloads viejos | Medio | `schemaVersion`, compatibilidad N−1 en servidor, `minAppVersion` |
| 8 | Diferencias de cálculo móvil/servidor | Medio | `packages/domain` único + pruebas con casos dorados comunes a ambos |
| 9 | Aprobación/requisitos de Google Play | Bajo | Empezar con prueba interna o APK corporativo; preparar política de privacidad |
| 10 | Actualización del SDK de Expo/React Native rompe dependencias | Medio | Fijar versiones, actualizar por ventanas planificadas, CI con *build* en cada PR |
| 11 | Cobertura de red deficiente → colas largas | Medio | Lotes pequeños, compresión, reintentos con *backoff*, indicador de pendientes visible |
| 12 | Hermes y `Intl` con formatos regionales | Bajo | Formateadores propios probados en dispositivo |

---

## 17. Decisiones pendientes

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| 1 | ¿Los vendedores pueden **editar precios** y aplicar **descuentos**? ¿Hasta qué %? | No / limitado / libre | Descuento limitado por `max_discount_pct`; precio fijo por defecto |
| 2 | Política de precios al sincronizar | Respetar pactado / revalidar | Respetar pactado, con aviso si difiere > X % |
| 3 | ¿Cliente nuevo requiere **aprobación** antes de poder facturarle? | Sí / No | Sí en el servidor (estado "pendiente de validación"), usable en pedidos |
| 4 | ¿El vendedor ve **todos** los clientes o solo los asignados? | Todos / asignados / por zona | Asignados o por zona |
| 5 | ¿Se muestra el **saldo y vencido** del cliente? | Sí / No | Sí, como instantánea con fecha |
| 6 | ¿Un pedido sincronizado **reserva stock**? | Sí / No | Definir en backend (v2 lo contempla configurable) |
| 7 | Distribución | Play (interna/cerrada) / APK directo | Play interna para piloto |
| 8 | Biblioteca de UI | Paper (Material) / NativeWind | Paper por rapidez en Android |
| 9 | Actualizaciones OTA (`expo-updates`) | Sí / No | No en v1.0 (simplicidad) |
| 10 | Uso en tablets / vendedores con 2 teléfonos | Sí / No | Un dispositivo activo por vendedor (configurable) |
| 11 | Idioma | Solo es-VE | Solo es-VE |
| 12 | Impresión | PDF compartible / térmica Bluetooth | PDF compartible en v1.0 |

---

## Anexo A – Estructura de carpetas

```
apps/mobile/
├── app/                              # Expo Router
│   ├── _layout.tsx                   # providers, guardas de sesión/bloqueo
│   ├── (auth)/ login.tsx · company.tsx · bootstrap.tsx · unlock.tsx
│   └── (app)/
│       ├── _layout.tsx               # tabs
│       ├── index.tsx                 # Inicio
│       ├── products/ index.tsx · [id].tsx · scan.tsx
│       ├── customers/ index.tsx · [id].tsx · form.tsx
│       ├── documents/ index.tsx · [id].tsx · editor.tsx
│       └── more/ index.tsx · sync.tsx · diagnostics.tsx
├── src/
│   ├── core/
│   │   ├── api/                      # ApiClient, interceptores, errores
│   │   ├── auth/                     # AuthService, session store, lock
│   │   ├── config/                   # env, constantes
│   │   └── utils/                    # decimal, fechas, normalización de texto
│   ├── db/
│   │   ├── client.ts                 # apertura, PRAGMAs, cifrado
│   │   ├── schema/                   # tablas Drizzle
│   │   ├── migrations/               # generadas por drizzle-kit
│   │   └── repositories/             # products, customers, documents, outbox, meta
│   ├── sync/
│   │   ├── engine.ts                 # mutex, ciclo push→pull
│   │   ├── push.ts · pull.ts · backoff.ts
│   │   ├── handlers/                 # por entidad: aplicar cambios / construir payload
│   │   └── triggers.ts               # netinfo, AppState, background-task
│   ├── features/
│   │   ├── products/ customers/ documents/ stock/
│   │   │   ├── components/ · hooks/ · services/
│   ├── ui/                           # componentes base y tema
│   └── i18n/ es-VE.ts
├── assets/ · app.config.ts · drizzle.config.ts · metro.config.js
├── __tests__/ · .maestro/ (flujos E2E)
└── package.json
```

---

## Anexo B – Fragmentos de código base

### B.1 `app.config.ts` (variantes por entorno)

```ts
import type { ExpoConfig } from 'expo/config';

const env = process.env.APP_ENV ?? 'dev';
const suffix = env === 'prod' ? '' : `.${env}`;

export default (): ExpoConfig => ({
  name: env === 'prod' ? 'ERP Ventas' : `ERP Ventas (${env})`,
  slug: 'erp-ventas',
  scheme: 'erpventas',
  version: '1.0.0',
  orientation: 'portrait',
  android: {
    package: `com.tuempresa.erpventas${suffix}`,
    allowBackup: false,
    permissions: ['CAMERA'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-local-authentication',
    ['expo-sqlite', { useSQLCipher: true }], // validar soporte en la PoC de M0
    'expo-camera',
  ],
  extra: { apiUrl: process.env.API_URL, appEnv: env },
});
```

### B.2 Esquema Drizzle (extracto)

```ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  categoryName: text('category_name'),
  taxId: text('tax_id'),
  trackingMode: text('tracking_mode').notNull().default('NONE'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  version: integer('version').notNull(),
}, (t) => [index('idx_products_sku').on(t.sku)]);

export const outbox = sqliteTable('outbox', {
  clientOpId: text('client_op_id').primaryKey(),
  clientSeq: integer('client_seq').notNull().unique(),
  entity: text('entity').notNull(),          // customer | sales_quote | sales_order
  action: text('action').notNull(),          // create | update
  entityId: text('entity_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: text('next_attempt_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
});
```

### B.3 Guardar un pedido: documento + outbox en una sola transacción

```ts
import 'react-native-get-random-values';
import { v7 as uuidv7 } from 'uuid';
import { calcDocumentTotals } from '@erp/domain';

export async function saveOrder(draft: OrderDraft) {
  const totals = calcDocumentTotals(draft.lines, {
    taxes: await taxRepo.activeTaxes(),
    exchangeRate: draft.exchangeRate,
  });

  const id = draft.id ?? uuidv7();

  await db.transaction(async (tx) => {
    const localNumber = draft.localNumber ?? (await nextLocalNumber(tx)); // OFF-D07-000124
    await documentRepo.upsert(tx, { ...draft, id, localNumber, ...totals, localStatus: 'PENDING_SYNC' });
    await outboxRepo.enqueueOrCoalesce(tx, {
      clientOpId: uuidv7(),
      entity: 'sales_order',
      action: draft.id ? 'update' : 'create',
      entityId: id,
      payload: toSyncPayload(id, draft, totals), // validado con Zod de packages/contracts
    });
  });

  syncEngine.requestSync({ debounceMs: 2000 });
}
```

### B.4 Ciclo del motor de sincronización (simplificado)

```ts
export class SyncEngine {
  private running = false;

  async run() {
    if (this.running) return;           // mutex
    this.running = true;
    try {
      if (!(await net.isOnline()) || !(await auth.ensureValidSession())) return;
      await this.pushAll();             // 1) enviar cola
      await this.pullAll();             // 2) traer cambios
      await meta.set('last_sync', new Date().toISOString());
    } catch (e) {
      handleSyncError(e);               // 403 DEVICE_REVOKED / 426 UPGRADE_REQUIRED / red
    } finally {
      this.running = false;
      events.emit('sync:finished');
    }
  }

  private async pushAll() {
    while (true) {
      const batch = await outboxRepo.nextBatch(20);        // PENDING con next_attempt_at <= ahora
      if (batch.length === 0) break;
      const res = await api.post('/sync/push', { schemaVersion: SCHEMA_VERSION, ops: batch.map(toOp) });
      await applyPushResults(res.results);                 // transacción por resultado
      if (res.results.some(r => isRetryable(r))) break;    // backoff aplicado por operación
    }
  }
}
```

### B.5 `.npmrc` (si Metro no resuelve con pnpm)

```
node-linker=hoisted
```

---

## Anexo C – Definición de "terminado"

Una funcionalidad móvil está terminada cuando:

- [ ] Funciona **sin conexión** de principio a fin (o su limitación está documentada y visible en la UI)
- [ ] Escribe en SQLite **y** en el outbox en una sola transacción (si genera datos)
- [ ] Los cálculos usan exclusivamente `packages/domain`
- [ ] Contratos validados con Zod de `packages/contracts`
- [ ] Estados de carga, vacío, error y sin conexión diseñados
- [ ] Probada en un dispositivo real de gama baja
- [ ] Pruebas unitarias y, si es un flujo crítico, E2E Maestro
- [ ] Permisos y políticas de `app_settings` respetados
- [ ] Sin datos sensibles en logs
- [ ] Migración de SQLite incluida y probada (si cambia el esquema)

## Anexo D – Checklist de lanzamiento

- [ ] Backend en producción con `sync`, dispositivos, revocación y `app/config`
- [ ] Dominio con HTTPS válido
- [ ] Versión firmada con *keystore* respaldado (Play App Signing activo)
- [ ] `minAppVersion` configurado en el servidor
- [ ] Sentry operativo y alertas definidas
- [ ] Piloto completado y defectos críticos cerrados
- [ ] Manual y capacitación entregados
- [ ] Procedimiento de pérdida/robo de teléfono documentado (revocar dispositivo)
- [ ] Plan de soporte (quién atiende rechazados y conflictos de sincronización)
- [ ] Copia de seguridad del servidor verificada antes del *go-live*

---

*Fin del documento.*
