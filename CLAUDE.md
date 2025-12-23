# Shopify NCF Connector - Documentación del Proyecto

## Descripción General

Conector OAuth para integrar tiendas Shopify con NCF Manager. Esta app minimalista:
1. Autentica tiendas Shopify via OAuth
2. Guarda el access token y datos de la tienda
3. Redirige al merchant a NCF Manager

## Stack Tecnológico

| Tecnología | Versión | Uso |
|------------|---------|-----|
| Remix | 2.x | Framework |
| Prisma | 6.x | ORM |
| PostgreSQL | - | Base de datos |
| @shopify/shopify-app-remix | 4.x | OAuth y sesiones |

## Estructura de Carpetas

```
shopify-ncf-connector/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx          # Página principal (redirige a NCF Manager)
│   │   ├── app.tsx                 # Layout
│   │   ├── auth.$.tsx              # OAuth callback
│   │   ├── webhooks.*.tsx          # Webhooks de Shopify
│   │   └── _index/                 # Landing page
│   ├── shopify.server.ts           # Config de Shopify
│   └── db.server.ts                # Cliente Prisma
├── prisma/
│   └── schema.prisma               # Modelos de datos
├── shopify.app.toml                # Configuración de la app
├── Dockerfile                      # Deploy
└── .env                            # Variables de entorno
```

## Modelos de Base de Datos

### Session (requerido por Shopify)
- Almacena tokens de acceso
- Gestionado automáticamente por @shopify/shopify-app-session-storage-prisma

### Shop
- Registro de tiendas que han instalado la app
- Tracking de billing y uso

## Flujo de Instalación

```
1. Merchant encuentra app en Shopify App Store
2. Click "Instalar" → Shopify redirige a /auth
3. OAuth completa → Token guardado en Session
4. Redirige a /app → Guarda Shop en DB
5. Redirige a NCF Manager con ?shop=dominio
```

## Webhooks

| Topic | Archivo | Descripción |
|-------|---------|-------------|
| app/uninstalled | webhooks.app.uninstalled.tsx | Marca shop como inactivo |
| customers/data_request | webhooks.customers.data_request.tsx | GDPR: solicitud de datos |
| customers/redact | webhooks.customers.redact.tsx | GDPR: eliminar datos cliente |
| shop/redact | webhooks.shop.redact.tsx | GDPR: eliminar datos tienda |

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
npx prisma migrate dev  # Crear migración
npx prisma studio     # UI de base de datos
```

## Deploy

El deploy es automático via Easypanel al hacer push a main.

**Dominio**: ncf-connector.curetcore.com

## Notas

- La app NO es embebida (embedded = false)
- Toda la funcionalidad de NCF está en NCF Manager, no aquí
- Esta app solo maneja OAuth y sincronización
