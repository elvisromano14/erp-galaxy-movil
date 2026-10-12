# Política de privacidad — ERP Ventas (app móvil)

> **Datos del titular completos (12/10/2026).** Conviene que una persona con conocimientos legales lo revise antes de publicarlo. No es obligatorio por una tienda (la app no está en Play), pero conviene entregarlo a los vendedores y a los clientes.

**Responsable:** Elvis Romano · RIF V-19860197-3 · Contacto: elvis.romano14@gmail.com
**Última actualización:** 12/10/2026

## 1. Qué es la app
ERP Ventas es una aplicación para **vendedores de empresas clientes** del sistema ERP. No es una app para el público general: solo funciona con una cuenta creada por la administración de cada empresa.

## 2. Datos que trata
| Dato | Para qué | Dónde se guarda |
|---|---|---|
| Correo, nombre y contraseña del usuario | Iniciar sesión | Servidor del ERP (contraseña cifrada con Argon2). El token de sesión, en el almacén seguro del teléfono |
| Datos comerciales de la empresa: productos, precios, existencias, clientes (RIF, razón social, teléfono, dirección), cotizaciones y pedidos | Operar la venta | Servidor del ERP y copia local en el almacenamiento privado de la app en el teléfono (no accesible por otras apps; cifrado opcional de la base, ver decisión #46) |
| Identificador y nombre del dispositivo, versión de la app, última actividad, tamaño de la cola | Seguridad (revocar un teléfono perdido) y soporte | Servidor del ERP |
| Cámara | **Solo** para leer códigos de barras; las imágenes no se guardan ni se envían | No se almacena |
| Huella/PIN | Desbloquear la app en el teléfono; **no se envían** al servidor | Solo en el teléfono |

La app **no usa publicidad, no vende datos y no incluye rastreadores de terceros**. Los registros de diagnóstico se depuran (no incluyen correos, RIF, teléfonos ni tokens).

## 3. Con quién se comparten
Solo con el servidor de la empresa a la que usted pertenece. Los datos de una empresa **no se mezclan** con los de otra.

## 4. Seguridad
Conexión cifrada (HTTPS); token en el almacén seguro de Android; bloqueo por PIN/huella; la administración puede **revocar** un teléfono (se borran los datos descargados); la app impide copias de seguridad de Android (`allowBackup: false`); límite de intentos de PIN.

## 5. Conservación y eliminación
Los datos comerciales los conserva la empresa según sus obligaciones fiscales y contables. En el teléfono: al **cerrar sesión** se conservan los pendientes de envío; al **revocar** el dispositivo o tras 7 días de revocación se borran todos los datos locales. Para eliminar su cuenta o datos personales, contacte a su administrador o a elvis.romano14@gmail.com.

## 6. Sus derechos
Acceso, rectificación y eliminación de sus datos personales a través de la administración de su empresa o del contacto indicado.

## 7. Cambios
Se avisará en la app y en esta página. Fecha de la última versión arriba.
