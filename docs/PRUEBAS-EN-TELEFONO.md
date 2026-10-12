# Probar la app en un teléfono

La app usa módulos nativos (SQLite, SecureStore, cámara…): **no funciona en Expo Go**; hace falta un *development build* o un APK.

## 1. Compilar e instalar (Android)

**Opción A — desde su equipo** (requiere Android SDK y un teléfono con *Depuración USB*):

```bash
pnpm install
# apuntando al ERP de producción (o a un ERP local con API_URL=http://<ip-de-su-pc>:3101)
APP_ENV=prod pnpm exec expo run:android --device
```

**Opción B — APK desde GitHub (la más simple):** Actions → *Android APK* → *Run workflow* (entorno `prod`); descargue el artefacto `erp-ventas-prod-apk`, descomprímalo e instale el `.apk` en el teléfono (permita «instalar apps de orígenes desconocidos»). Va firmado con una clave de pruebas: sirve para pilotos internos, no para Google Play.

Variantes de entorno (`APP_ENV=dev|staging|prod`): instalan apps con nombre e id distintos, así que pueden convivir en el mismo teléfono. `dev` apunta a `10.0.2.2:3101` (emulador → ERP local).

## 2. Preparar datos en el ERP (una sola vez)

En el ERP (web), con el administrador de la empresa:

1. **Administración → Usuarios**: cree el usuario del vendedor con el rol **Vendedor**.
2. **Administración → Vendedores**: cree el vendedor y **ligue ese usuario**; fije *descuento máximo (%)*, si *puede editar precios* y si *puede crear clientes*.
3. Tenga cargados **productos con precio en una lista de precios y existencias**, y al menos un **cliente asignado a ese vendedor**.
4. Tasa de cambio del día (se sincroniza sola del BCV).

## 3. Lista de pruebas de campo

Marque cada punto en un teléfono real (idealmente 3 modelos: gama baja, media y alta; Android 8, 10 y 13+).

**Acceso**
- [ ] Login → (elegir empresa) → «Dispositivo D01 registrado» → crear PIN → descarga inicial con progreso.
- [ ] Cerrar la app a mitad de la descarga y reabrir: continúa donde quedó.
- [ ] Cerrar y abrir la app **en modo avión**: pide PIN y abre con los datos locales.
- [ ] Huella (si el teléfono la tiene); 5 PIN errados → pide iniciar sesión y NO pierde pendientes.
- [ ] 5 min en segundo plano → pide PIN.

**Productos**
- [ ] Buscar por SKU, por nombre con tildes, por OEM y por código de barras; «solo con existencia».
- [ ] **Escanear** un código de barras real con la cámara (y con un lector Bluetooth, si hay).
- [ ] Detalle: precios por lista, impuesto, existencias por depósito y «Ver existencia en vivo».

**Clientes y cola**
- [ ] **Modo avión:** crear 5 clientes y 2 cotizaciones → quitar el modo avión → todo se sincroniza **una sola vez** (revisar en el ERP).
- [ ] Cortar la red a mitad de un envío → reintenta sin duplicar.
- [ ] Cliente nuevo + cotización para ese cliente, ambos sin conexión → llegan en orden.
- [ ] RIF ya existente → se vincula (no se duplica).

**Cotizaciones y pedidos**
- [ ] Crear cotización de ~30 líneas sin conexión; totales con IVA; **compartir PDF** por WhatsApp.
- [ ] Descuento mayor al permitido → bloquea; existencia insuficiente / crédito excedido → solo avisa.
- [ ] Cotización → **Convertir en pedido** → se confirma y reserva existencias en el ERP.
- [ ] Pedido que excede el crédito → «En revisión»; administración lo autoriza en el ERP → la app lo muestra confirmado.
- [ ] Anular el pedido en el ERP → la app muestra «Anulado».
- [ ] Producto desactivado antes de sincronizar → «Rechazado» con instrucción clara; corregir y reenviar.

**Seguridad y robustez**
- [ ] Revocar el dispositivo desde **Configuración → Dispositivos móviles** (ERP) → la app se bloquea y borra lo descargado; la cola se conserva.
- [ ] Subir `MOBILE_MIN_APP_VERSION` en el ERP → «Actualización requerida» sin perder la cola.
- [ ] Cambiar la hora del teléfono (adelantar y atrasar) → la sincronización sigue funcionando.
- [ ] **Más → Restablecer datos descargados** → vuelve a bajar todo; los pendientes siguen ahí.
- [ ] **Más → Diagnóstico**: versión, base, cola y registro (sin datos personales).
- [ ] Forzar el cierre de la app mientras guarda un documento → no queda documento sin operación ni al revés.

**Rendimiento** (gama media-baja: 3 GB RAM, Android 10)
- [ ] Arranque en frío < 3 s · búsqueda con 50 000 productos < 200 ms · guardar una cotización de 30 líneas < 300 ms.

## 4. Cifrado de la base (SQLCipher) — validar antes de producción

```bash
SQLCIPHER=1 APP_ENV=dev pnpm exec expo run:android --device
```

Compruebe que la app abre, que **Más → Diagnóstico** dice «Cifrado de la base: Activo» y que tras reiniciar sigue abriendo. Si falla, déjelo apagado (la base queda protegida por el sandbox de Android, `allowBackup: false` y el bloqueo con PIN).

## 5. Reportar problemas

Adjunte: versión (Más → Diagnóstico), qué hizo, y el **registro** (botón «Compartir registro»; no contiene correos, RIF, teléfonos ni tokens).
