# Shopify NCF Connector - Documentación del Proyecto

## Descripción General

App embebida de Shopify para gestión de comprobantes fiscales (NCF). Incluye:
1. Dashboard completo dentro de Shopify Admin
2. Visualización de órdenes recientes
3. Sincronización de token con NCF Manager
4. Billing integrado via Shopify Billing API ($9/mes)

## Stack Tecnológico

| Tecnología | Versión | Uso |
|------------|---------|-----|
| Remix | 2.x | Framework |
| Prisma | 6.x | ORM |
| PostgreSQL | - | Base de datos |
| @shopify/shopify-app-remix | 4.x | OAuth y sesiones |
| @shopify/polaris | 12.x | UI components |
| @shopify/polaris-icons | - | Iconos |
| @shopify/app-bridge-react | 4.x | Comunicación con Shopify |

## Estructura de Carpetas

```
shopify-ncf-connector/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx          # Dashboard principal con Polaris
│   │   ├── app.tsx                 # Layout con AppProvider
│   │   ├── app.billing.tsx         # Crear suscripción Pro
│   │   ├── app.billing.callback.tsx # Callback de billing
│   │   ├── auth.$.tsx              # OAuth callback
│   │   ├── webhooks.*.tsx          # Webhooks de Shopify
│   │   └── _index/                 # Landing page
│   ├── shopify.server.ts           # Config de Shopify (isEmbeddedApp: true)
│   └── db.server.ts                # Cliente Prisma
├── prisma/
│   └── schema.prisma               # Modelos de datos
├── shopify.app.toml                # Configuración (embedded = true)
├── Dockerfile                      # Deploy
└── .env                            # Variables de entorno
```

## Dashboard (app._index.tsx)

Dashboard completo con 4 tabs y stats en tiempo real:

### Stats Cards (Header)
- **Órdenes**: Total de órdenes sincronizadas
- **Con NCF**: Órdenes con comprobante asignado
- **Pendientes**: Órdenes sin comprobante
- **Este mes**: Uso vs límite mensual

### Tab 1: Órdenes
- Tabla con órdenes de Shopify (IndexTable)
- Columnas: Orden, Fecha, Cliente, Total, NCF, Acción
- Botón "Crear NCF" abre modal con formulario
- Badge de estado (Pendiente, En proceso, Enviado, Confirmado)

### Tab 2: NCFs (Historial)
- Historial de comprobantes creados
- Columnas: NCF, Orden, Razón Social, RNC, Total, Fecha
- Consume endpoint `/api/shopify/ncfs` de NCF Manager

### Tab 3: Empresa (Configuración)
- Formulario de datos fiscales
- Campos: Nombre, RNC, Dirección, Teléfono, Email
- Guarda en NCF Manager via `/api/shopify/settings`

### Tab 4: Resumen
- Plan actual (Free/Pro) con badge
- ProgressBar de uso mensual
- Gráfico de barras de uso por mes (últimos 6 meses)
- Card de upgrade a Pro ($9/mes)

## Modelos de Base de Datos

### Session (requerido por Shopify)
- Almacena tokens de acceso
- Gestionado automáticamente por @shopify/shopify-app-session-storage-prisma

### Shop
- Registro de tiendas que han instalado la app
- Tracking de billing y uso
- Campos: plan, monthlyLimit, invoicesThisMonth, shopifyChargeId

## Flujo de Instalación

```
1. Merchant instala desde Shopify App Store
2. OAuth completa → Token guardado en Session
3. Dashboard se muestra embebido en Shopify Admin
4. Token sincronizado con NCF Manager
5. Merchant puede usar la app o ir a NCF Manager completo
```

## Shopify Billing

| Archivo | Descripción |
|---------|-------------|
| app.billing.tsx | Crea suscripción recurrente ($9/mes) |
| app.billing.callback.tsx | Maneja respuesta de aceptar/rechazar |

Flujo:
1. Click "Actualizar a Pro" → POST /app/billing
2. Shopify muestra pantalla de confirmación
3. Callback a /app/billing/callback
4. Si acepta → Plan actualizado a Pro, límite = ilimitado

## Webhooks

| Topic | Archivo | Descripción |
|-------|---------|-------------|
| app/uninstalled | webhooks.app.uninstalled.tsx | Marca shop como inactivo |
| orders/create | webhooks.orders.create.tsx | (Pendiente aprobación) |
| orders/updated | webhooks.orders.updated.tsx | (Pendiente aprobación) |

**Nota**: Los webhooks de órdenes requieren aprobación de "Protected Customer Data" por Shopify.

## Variables de Entorno

```env
SHOPIFY_API_KEY=           # Client ID de Shopify Partners
SHOPIFY_API_SECRET=        # Client Secret
SHOPIFY_APP_URL=           # URL de la app (https://ncf-connector.curetcore.com)
DATABASE_URL=              # PostgreSQL connection string
SCOPES=                    # read_orders,read_customers,read_products
NCF_MANAGER_URL=           # URL de NCF Manager (https://ncf.curetcore.com)
```

## Comandos de Desarrollo

```bash
npm run dev           # Desarrollo con Shopify CLI
npm run build         # Build de producción
npm run start         # Arrancar producción
npm run deploy        # Deploy configuración a Shopify
npx prisma migrate dev  # Crear migración
npx prisma studio     # UI de base de datos
```

## Deploy

El deploy es automático via Easypanel al hacer push a main.

**Dominio**: ncf-connector.curetcore.com

Para actualizar la configuración de la app en Shopify:
```bash
shopify app deploy --force
```

## Sincronización con NCF Manager

El token de Shopify se sincroniza automáticamente cuando el merchant accede al dashboard.

### Endpoints Consumidos

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/api/webhooks/shopify/token-sync` | POST | Sincronizar token de acceso |
| `/api/shop/plan` | GET | Obtener plan y límites |
| `/api/shopify/orders` | GET/POST | Listar/Sincronizar órdenes |
| `/api/shopify/ncf` | POST | Crear comprobante NCF |
| `/api/shopify/ncfs` | GET | Historial de comprobantes |
| `/api/shopify/settings` | GET/POST | Configuración de empresa |
| `/api/shopify/usage` | GET | Estadísticas de uso mensual |

Todos los endpoints usan header `X-Shopify-Shop` para identificar la tienda.

## Notas

- La app ES embebida (embedded = true)
- Dashboard completo dentro de Shopify Admin
- Billing via Shopify, no Stripe
- Links externos abren NCF Manager para funcionalidades avanzadas
