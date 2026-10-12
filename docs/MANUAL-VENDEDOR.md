# Manual del vendedor — ERP Ventas (app Android)

La app le permite **consultar productos y existencias, atender clientes y tomar cotizaciones y pedidos aunque no tenga señal**. Todo lo que haga sin conexión se guarda en el teléfono y se envía solo cuando vuelva la señal.

## 1. Primer ingreso (con internet)
1. Abra **ERP Ventas** e ingrese su **correo y contraseña** (se los da administración).
2. Si tiene varias empresas, elija la suya.
3. Cree un **PIN de 4 a 6 dígitos**. Es solo para este teléfono y no se envía a ningún servidor.
4. Espere la **descarga inicial** (productos, clientes, precios). Puede cancelarla y continuarla después.

A partir de ahí, la app abre con su **PIN o huella**, también sin conexión. Se bloquea sola tras 5 minutos fuera de la app.

## 2. Productos
- Pestaña **Productos**: escriba SKU, nombre, código OEM o el código de barras. «Solo con existencia» oculta lo agotado.
- **Escanear**: apunte la cámara al código de barras.
- Toque un producto para ver **precios por lista, impuesto, equivalentes y existencias por depósito** («sincronizado hace…»).
- **Ver existencia en vivo** consulta el sistema en ese momento (requiere conexión).

## 3. Clientes
- Pestaña **Clientes**: busque por RIF, razón social o teléfono. El detalle muestra crédito disponible y saldo *al corte de la última sincronización*.
- **Nuevo** crea un cliente aunque no tenga señal. Queda **«Pendiente de validación»**: lo puede usar en cotizaciones y pedidos, pero administración debe validarlo antes de facturarle.
- Si el RIF ya existe en el sistema, la app lo vincula al existente (no se duplica).

## 4. Cotizaciones
1. **Documentos → Nueva cotización**. Elija el cliente.
2. **Agregar** productos (buscador o escáner). Toque una línea para cambiar cantidad o descuento.
3. Revise condiciones (contado o crédito) y la vigencia.
4. Los **totales con IVA** se calculan al instante, con su equivalente en bolívares.
5. **Guardar borrador** (puede continuar después) o **Guardar y enviar**.
6. **Compartir PDF** desde el detalle: WhatsApp, correo, etc.

> El **precio** lo fija el sistema según la lista del cliente. El **descuento máximo** depende de su usuario: si lo supera, la app no le deja enviar.

## 5. Pedidos
- **Nuevo pedido**, o en una cotización enviada: **Convertir en pedido**.
- Al enviarse, el pedido se **confirma en el sistema y reserva existencias**.
- Estados que verá: *Sin enviar → Confirmado → Facturado / Anulado*.

## 6. Qué significan los avisos
| Aviso | Qué hacer |
|---|---|
| **Sin enviar** | Está en el teléfono; se envía solo con señal. Puede forzarlo en **Más → Cola de sincronización → Sincronizar ahora**. |
| **Rechazado** | El sistema no lo aceptó. Abra el documento: dice qué corregir (por ejemplo, quitar un producto desactivado). Corrija y reenvíe. |
| **En revisión** | El pedido supera el crédito del cliente: administración debe autorizarlo. Se actualiza solo. |
| **Pendiente de validación** (cliente) | Administración validará sus datos; mientras tanto puede cotizar y pedir. |
| **Sin conexión** | Siga trabajando; todo se enviará después. |

## 7. Más
- **Cola de sincronización**: qué falta enviar y qué se rechazó.
- **Restablecer datos descargados**: vuelve a bajar el catálogo (no borra sus pendientes).
- **Diagnóstico**: para soporte.
- **Cerrar sesión**: sus pendientes se conservan.

## 8. Si algo falla
- **Teléfono perdido o robado**: avise a administración de inmediato; revocan el dispositivo y deja de funcionar.
- **«Actualización requerida»**: instale la nueva versión de la app.
- **Pasaron más de 14 días sin conexión**: conéctese e inicie sesión de nuevo (no pierde nada).
- Más ayuda: [`SOPORTE.md`](SOPORTE.md).
