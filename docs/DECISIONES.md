# Decisiones de arquitectura

Registro breve de lo decidido y por qué (formato ADR resumido). Las decisiones abiertas del plan están en [`PLAN-MOVIL.md` §17](PLAN-MOVIL.md#17-decisiones-pendientes).

| # | Decisión | Motivo |
|---|---|---|
| 1 | **Repositorio propio** (`erp-galaxy-movil`), separado del ERP | El móvil se versiona, compila y publica distinto (APK/Play); el ERP sigue siendo la fuente del contrato |
| 2 | **React Native + Expo (SDK 57), TypeScript estricto**, *development builds* | Comparte TypeScript (dominio, tipos) con el ERP; módulos nativos (SQLite, SecureStore, cámara) requieren build propio |
| 3 | **Backend primero**: `sync/*`, dispositivos y `app/config` se implementaron en el ERP (migración 0017) antes que la app | Se controlan ambos lados; la app nace contra la API real, sin servidor simulado |
| 4 | **Contrato vendorizado y fijado** (`src/vendor/` + `erp-contract.json`), verificado en CI contra el commit del ERP | Reproducible sin publicar paquetes; el desfase se detecta. A futuro: publicar `@erp/*` como paquetes privados |
| 5 | **Pull por entidad** (`GET /sync/pull?entity=…`) con cursor `(timestamp con µs, id)` y lápidas | Simple y robusto; evita perder filas con marcas de tiempo iguales; catálogos pequeños se envían completos |
| 6 | **Push idempotente por `clientOpId`**, una operación por `SAVEPOINT` | Reintentos seguros; una operación mala no frena el lote |
| 7 | **El servidor fija el precio** salvo que el vendedor tenga `allowPriceEdit`; descuento máximo por vendedor | Política del plan (#1/#2): precio de lista por defecto, descuento limitado |
| 8 | **Cliente creado en el móvil = «pendiente de validación»**: usable en cotizaciones/pedidos, no facturable | Plan #3: la validación de datos fiscales queda en administración |
| 9 | **Un dispositivo activo por usuario** con revocación desde la web | Plan #10: pérdida/robo del teléfono |
| 10 | **Dinero como TEXT + decimal.js**; nunca `number` ni `REAL` | Exactitud fiscal; mismos resultados que el servidor |
| 11 | **Drizzle ORM + expo-sqlite**; migraciones SQL importadas como texto (Metro + `babel-plugin-inline-import`) | Esquema tipado y versionado |
| 12 | **pnpm con `node-linker=hoisted`** | Metro necesita un `node_modules` plano |
| 13 | **Sin UI kit en M0** (componentes nativos); elegir Paper/NativeWind al inicio de M1 | Plan #8; se decide con las pantallas de negocio a la vista |
| 14 | **Sin licencia** de momento | El propietario debe elegirla |
| 15 | **La navegación la gobierna el estado de la sesión** (`SessionService`: arranque → login → empresa → PIN → descarga → listo / bloqueado) | Una sola fuente de verdad, probada sin UI; las pantallas solo reflejan el estado |
| 16 | **PIN de 4–6 dígitos** con sal y resumen estirado en SecureStore; 5 intentos fallidos → se exige login (la cola se conserva) | El PIN nunca viaja al servidor; la huella es opcional |
| 17 | **Sin red al arrancar no bloquea**: abre con PIN y trabaja con los datos locales; la versión obsoleta y el dispositivo revocado sí bloquean | Principio rector: el vendedor nunca espera a la red |
| 18 | **Cerrar sesión no borra datos ni la cola**; cambiar de empresa en el mismo teléfono exige no tener pendientes de la anterior y limpia la réplica | Evita perder trabajo y mezclar empresas |
| 19 | **Dispositivo revocado**: se borra la réplica y se conserva el outbox | Administración puede rehabilitar el equipo o recuperar lo pendiente |
| 20 | **Páginas de pull atómicas**: datos + cursor en una transacción SQLite; lápidas de clientes/productos = inactivo, no borrado | Reanudable sin huecos; los documentos locales no quedan huérfanos |
| 21 | **Pruebas con SQLite real** (better-sqlite3 + las migraciones reales) y **de integración contra la API real del ERP** | Detecta divergencias de contrato que un simulador no ve |
| 22 | **Existencia en vivo por un endpoint propio sin costos** (`GET /sync/stock/:productId`); el `/products/:id/stock` del ERP incluye el costo promedio y no se usa desde el móvil | Plan §11: los costos nunca se descargan al teléfono |
| 23 | **Búsqueda con `search_text` normalizado + `LIKE`** (palabras en AND) en lugar de FTS5; SKU exacto y código de barras con índice | Medido con 50 000 productos: 4–8 ms en Node (objetivo 200 ms en un gama media-baja); evita depender de FTS5 en Expo. Se revisa si el dispositivo real no cumple |
| 24 | **Precio vigente por lista = mayor `validFrom ≤ hoy` (hora de Caracas)**; los precios se muestran sin impuesto con la nota del IVA | Mismo criterio que el servidor; el IVA se calcula en el documento |
| 25 | **Monedas como entidad de la sincronización** (código, símbolo, decimales) | Mostrar `$` / `Bs` correctamente sin suponer la moneda |
