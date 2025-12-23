import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Esta es la página principal después del OAuth
// Guarda el shop en la DB y redirige al merchant a NCF Manager
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const shopDomain = session.shop;

  // Obtener información de la tienda desde Shopify
  let shopName = shopDomain;
  let shopEmail = null;

  try {
    const response = await admin.graphql(`
      query {
        shop {
          name
          email
        }
      }
    `);
    const data = await response.json();
    shopName = data.data?.shop?.name || shopDomain;
    shopEmail = data.data?.shop?.email || null;
  } catch (error) {
    console.error("Error obteniendo datos de la tienda:", error);
  }

  // Guardar/actualizar el shop en nuestra DB
  await prisma.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      shopName,
      email: shopEmail,
      isActive: true,
      installedAt: new Date(),
    },
    update: {
      shopName,
      email: shopEmail,
      isActive: true,
      uninstalledAt: null, // Reactivar si se reinstala
    },
  });

  console.log(`Shop conectado: ${shopDomain} (${shopName})`);

  // Redirigir a NCF Manager
  const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";

  return redirect(`${ncfManagerUrl}/auth/shopify?shop=${encodeURIComponent(shopDomain)}`);
};

// Página de loading mientras redirige
export default function Index() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      backgroundColor: '#f6f6f7',
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        textAlign: 'center',
      }}>
        <h1 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem', color: '#202223' }}>
          NCF Manager
        </h1>
        <p style={{ margin: 0, color: '#6d7175' }}>
          Conectando con tu cuenta...
        </p>
      </div>
    </div>
  );
}
