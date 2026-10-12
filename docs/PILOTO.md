# Plan del piloto (M7)

**Objetivo:** validar la app con vendedores reales antes del lanzamiento general: que sea rápida, que no pierda ni duplique datos y que los vendedores quieran usarla.

## Estado de preparación (2026-10-12)
- ✅ APK 0.1.2 firmado y publicado en el ERP; versión mínima 0.1.0.
- ✅ Instalación y Play Protect documentados ([guía](PRUEBAS-EN-TELEFONO.md)); manual del vendedor y soporte listos.
- ✅ Empresa Infoservi con vendedor de prueba y datos `[PRUEBA]` (se conservan durante el piloto).
- ⏳ Por definir: nombres de los 2–3 vendedores reales, sus teléfonos/modelos y fecha de arranque.
- ⏳ Visto bueno final (go / no-go) del propietario al terminar el piloto.

## Alcance
- **2–3 vendedores** (de preferencia con teléfonos de gama baja, media y alta), **1–2 semanas** de uso real.
- Una empresa de producción (Infoservi, CA) con sus clientes y productos reales (o la de prueba para el ensayo previo).
- Antes del piloto: pasar la lista de [`PRUEBAS-EN-TELEFONO.md`](PRUEBAS-EN-TELEFONO.md) en al menos **3 modelos** (Android 8, 10 y 13+).

## Preparación (administración)
1. Crear a cada vendedor: usuario (rol Vendedor) y vendedor ligado, con descuento máximo y permisos (ver el manual del ERP).
2. Instalar el APK descargándolo desde el ERP (Configuración → App móvil).
3. Capacitación de 30 min con el [manual](MANUAL-VENDEDOR.md): primer ingreso, cotización, pedido, qué hacer sin señal.
4. Dejar anotado a quién avisar si hay un problema.

## Qué se mide (todo sale del ERP y de la app)
| Métrica | Dónde | Meta |
|---|---|---|
| Dispositivos activos y versión | ERP → Configuración → Dispositivos móviles | 100 % de los pilotos activos |
| Última actividad | misma pantalla | sincroniza al menos 1 vez al día de uso |
| **Cola pendiente** por dispositivo | misma pantalla (columna «Cola pendiente») | < 20; picos que bajan al volver la señal |
| Documentos creados en el móvil | ERP → Ventas (vendedor = piloto) | — |
| Rechazados por el servidor | app: Más → Cola; ERP: bitácora | < 5 % y todos comprensibles |
| **Duplicados o pérdidas** | revisión semanal contra lo que reporta el vendedor | **0** |
| Tiempo de arranque / búsqueda | percepción + diagnóstico | arranque < 3 s; búsqueda instantánea |
| Cierres inesperados | reportes del vendedor + registro de diagnóstico | 0 |

## Seguimiento
- **Diario (5 min)**: revisar la pantalla de Dispositivos (¿alguien con la cola alta o sin actividad?).
- **A mitad y al final**: reunión corta con cada vendedor (formulario abajo).
- Cada falla se registra con: versión, qué hacía, hora y el **registro** (Más → Diagnóstico → Compartir registro; no incluye datos personales).

## Formulario de retroalimentación (por vendedor)
1. ¿Cuántas cotizaciones/pedidos tomó con la app? ¿Cuántos sin señal?
2. ¿Hubo algo que perdió, se duplicó o no encontró? (describa)
3. ¿Qué paso le tomó más toques o tiempo de lo esperable?
4. ¿Los mensajes de rechazo se entendieron? ¿Cuál no?
5. ¿Qué le falta para dejar de usar su método anterior (papel, WhatsApp, etc.)?
6. Del 1 al 10, ¿qué tan probable es que la recomiende a otro vendedor?

## Criterios para pasar al lanzamiento (go / no-go)
- **Go**: 0 duplicados/pérdidas; sin cierres inesperados; ≥ 80 % de los documentos del piloto hechos en la app; mensajes de rechazo entendidos; sin hallazgos de seguridad.
- **No-go / ajustar**: cualquier pérdida o duplicación de datos, o fallas repetidas de sincronización. Se corrige, se publica una versión nueva y se repite 1 semana.
