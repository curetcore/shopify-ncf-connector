import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Esta es la página principal después del OAuth
// Guarda el shop en la DB y redirige al merchant a NCF Manager
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("=== NCF Connector: Iniciando loader ===");

  try {
    const { session, admin } = await authenticate.admin(request);
    console.log("Autenticación exitosa para:", session.shop);

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
      console.log("Datos de tienda obtenidos:", { shopName, shopEmail });
    } catch (error) {
      console.error("Error obteniendo datos de la tienda:", error);
    }

    // Guardar/actualizar el shop en nuestra DB
    try {
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
          uninstalledAt: null,
        },
      });
      console.log(`Shop guardado en DB: ${shopDomain}`);
    } catch (dbError) {
      console.error("Error guardando shop en DB:", dbError);
      // Continuar aunque falle la DB - lo importante es redirigir
    }

    // Redirigir a NCF Manager
    const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";
    const redirectUrl = `${ncfManagerUrl}/api/auth/shopify?shop=${encodeURIComponent(shopDomain)}`;

    console.log("Redirigiendo a:", redirectUrl);

    return redirect(redirectUrl);
  } catch (error) {
    console.error("Error en loader:", error);
    // Devolver error para mostrarlo en la página
    return json({
      error: true,
      message: error instanceof Error ? error.message : "Error desconocido",
      ncfUrl: process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com"
    });
  }
};

// Página de loading o error
export default function Index() {
  const data = useLoaderData<typeof loader>();

  // Si hay error, mostrarlo
  if (data && 'error' in data && data.error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#fef2f2',
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '2rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center',
          maxWidth: '400px',
        }}>
          <h1 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem', color: '#dc2626' }}>
            Error de Conexión
          </h1>
          <p style={{ margin: '0 0 1rem 0', color: '#6d7175' }}>
            {data.message}
          </p>
          <a
            href={data.ncfUrl}
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              backgroundColor: '#2563eb',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '6px',
              fontWeight: 500,
            }}
          >
            Ir a NCF Manager
          </a>
        </div>
      </div>
    );
  }

  // Loading normal
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
