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

## Instalar el APK y Google Play Protect

La app no está en Play Store: se descarga desde el ERP (**Configuración → App móvil**) y se instala a mano. Android y Play Protect avisan porque el origen es desconocido; es normal. El APK va firmado con el keystore propio y el ERP muestra su SHA-256 para verificarlo.

**1. Permitir instalar desde el navegador (una vez)**
Al abrir el APK descargado, Android pide permiso: toque **Configuración** y active **Permitir desde esta fuente** para el navegador que usó (Chrome, Samsung Internet…). Vuelva atrás y toque **Instalar**.

**2. Si Play Protect lo bloquea («App bloqueada por Play Protect» / «Analizar app»)**
- Toque **Más detalles** → **Instalar de todos modos**. Si solo aparece **Entendido**, use el paso siguiente.
- Abra **Play Store** → su foto de perfil → **Play Protect** → engranaje ⚙ → desactive **Analizar aplicaciones con Play Protect**. Instale la app y **vuelva a activarlo**.
- En algunos equipos el engranaje está en *Ajustes → Seguridad y privacidad → Seguridad de aplicaciones/Play Protect*.
- En Xiaomi/Redmi también puede pedir desactivar la **Verificación MIUI** (Ajustes → Contraseñas y seguridad → Privacidad → Servicios del sistema).

**3. Actualizar**
Descargue la versión nueva e instálela **encima** de la actual: los datos y los pendientes de envío se conservan (misma firma). Si Android dice «App no instalada», la firma no coincide: no desinstale sin antes sincronizar (se pierden los pendientes) y avise a soporte.

**4. Comprobar que es el APK correcto (soporte)**
`sha256sum erp-ventas-prod-X.Y.Z.apk` debe coincidir con el valor de Configuración → App móvil.

## Actualizaciones
- App nueva: se publica (Play o APK) y se sube `MOBILE_MIN_APP_VERSION` solo cuando haya que **obligar** a actualizar.
- Cambios de datos en el ERP (precios, productos) llegan con la siguiente sincronización.
