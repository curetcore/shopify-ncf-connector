# Shopify NCF Connector - Estado de Sesión

## Última Sesión
**Fecha:** 2025-12-27

## Estado Actual

### Dashboard Polaris
- ✅ 4 tabs implementados (Órdenes, NCFs, Empresa, Resumen)
- ✅ 4 stats cards en header
- ✅ Gráfico de uso mensual
- ✅ Formulario de configuración de empresa
- ✅ Historial de NCFs

### Integración con NCF Manager
- ✅ 7 endpoints consumidos correctamente
- ✅ Token sync funcionando
- ⚠️ Órdenes bloqueadas por Protected Customer Data

## Pendiente Crítico

### Reinstalar App en Tienda de Desarrollo
La tienda `curetfy-2.myshopify.com` instaló la app antes de la aprobación de Protected Customer Data.

**Pasos:**
1. Desinstalar en curetfy-2.myshopify.com/admin/settings/apps
2. Reinstalar desde Shopify Partners
3. Probar sincronización de órdenes

## Próxima Sesión

- [ ] Reinstalar app en tienda de desarrollo
- [ ] Verificar que órdenes se sincronicen correctamente
- [ ] Probar flujo completo: orden → crear NCF → ver en historial
