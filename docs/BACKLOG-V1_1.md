# Backlog tras la v1.0

Candidatos para versiones siguientes (del plan §2.2 y de lo aprendido). Priorizar con los resultados del piloto.

**Alta probabilidad**
- Impresión térmica Bluetooth de cotizaciones/pedidos (decisión #12 del plan: v1.0 solo PDF).
- Cobros y recibos desde el móvil (con IGTF y retenciones).
- Facturas y notas de crédito/débito en consulta (estado y PDF).
- Notificaciones push: pedido confirmado/rechazado/en revisión, cliente validado.
- Reportes del vendedor (ventas del mes, meta, comisión).

**Media**
- Geolocalización y rutas de visita; fotos adjuntas (comprobantes, mercancía).
- Multi-empresa simultánea; tablets / dos teléfonos por vendedor.
- Anulación de cotizaciones desde la app.
- Actualizaciones OTA (`expo-updates`) si compensan la complejidad.
- Sentry/monitoreo de errores con DSN propio.
- Pruebas E2E automatizadas con Maestro en dispositivos reales (CI).
- Validar y activar SQLCipher por omisión (si el piloto lo aprueba).
- iOS.

**Mejoras de plataforma (ERP)**
- Copia externa de respaldos, 2FA de administradores, dominio propio, despliegue automático (ya documentado).
- Módulo de descarga de la app en Configuración del ERP (en stand by hasta tener el APK probado).
