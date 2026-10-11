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
