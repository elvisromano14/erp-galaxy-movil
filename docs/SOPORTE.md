# Soporte y capacitación — ERP Ventas

## Para quien da soporte
**Primero:** pedir al vendedor **Más → Diagnóstico → Compartir registro** y la versión de la app. El registro no incluye datos personales.

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| «No tiene dispositivo» / no puede registrar su teléfono nuevo | Ya hay un dispositivo activo para su usuario | ERP → Configuración → Dispositivos móviles → **Revocar** el anterior; el nuevo se registra solo |
| La app dice «Dispositivo bloqueado» | Fue revocado | Si fue por error: **Restaurar** en la misma pantalla; el vendedor reintenta (su cola se conservó 7 días) |
| «Actualización requerida» | Versión menor a `MOBILE_MIN_APP_VERSION` | Instalar la versión nueva; no pierde su cola |
| Un pedido quedó «En revisión» | Excede el crédito del cliente | Autorizar en el ERP (confirmar con «sobre el límite de crédito») o pedir abono; la app lo refleja al sincronizar |
| Un documento «Rechazado» | Regla del servidor (producto inactivo, descuento, sin precio…) | Leer el motivo en la app (explica qué corregir); si es un dato del ERP (precio, producto), corregirlo allí |
| Un cliente nuevo no se puede facturar | Está «Pendiente de validación» | ERP → Administración → Clientes → validar |
| Cola pendiente alta en la pantalla de Dispositivos | Sin señal prolongada o error repetido | Llamar al vendedor; revisar «Cola de sincronización» en su app |
| «Pasaron más de 14 días sin sincronizar» | Política de seguridad | Conectarse e iniciar sesión; no se pierde nada |
| Cotizaciones/pedidos duplicados | **No debería ocurrir** (envío idempotente) | Reportar de inmediato con la hora y el registro |

**Teléfono perdido o robado:** revocar el dispositivo (ERP → Dispositivos móviles) y restablecer la contraseña del usuario si corresponde.

## Capacitación del vendedor (30 min)
1. (5 min) Para qué sirve y qué hace sin señal. Primer ingreso y PIN.
2. (10 min) Buscar un producto, escanear, ver precios y existencias.
3. (10 min) Crear un cliente, hacer una cotización, compartir el PDF, convertirla en pedido.
4. (5 min) Qué significan «Sin enviar», «Rechazado» y «En revisión»; a quién llamar.

Material: [`MANUAL-VENDEDOR.md`](MANUAL-VENDEDOR.md). Práctica: que cada vendedor haga una cotización completa **en modo avión** durante la sesión.

## Actualizaciones
- App nueva: se publica (Play o APK) y se sube `MOBILE_MIN_APP_VERSION` solo cuando haya que **obligar** a actualizar.
- Cambios de datos en el ERP (precios, productos) llegan con la siguiente sincronización.
