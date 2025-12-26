import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Callback después de que el usuario acepta/rechaza la suscripción
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Obtener el charge_id de los parámetros
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");

  if (!chargeId) {
    // Usuario canceló - redirigir al dashboard
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        shopifyChargeStatus: "cancelled",
      },
    });
    return redirect("/app");
  }

  // Verificar el estado de la suscripción
  const response = await admin.graphql(`
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  const subscriptions = data.data?.currentAppInstallation?.activeSubscriptions || [];

  // Buscar la suscripción activa
  const activeSubscription = subscriptions.find(
    (sub: { status: string }) => sub.status === "ACTIVE"
  );

  if (activeSubscription) {
    // Actualizar la tienda a plan Pro
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        plan: "pro",
        monthlyLimit: 999999, // Ilimitado
        shopifyChargeId: activeSubscription.id,
        shopifyChargeStatus: "active",
      },
    });

    // Sincronizar con NCF Manager
    const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";
    try {
      await fetch(`${ncfManagerUrl}/api/webhooks/shopify/billing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop": shopDomain,
        },
        body: JSON.stringify({
          action: "upgrade",
          plan: "pro",
          shopifyChargeId: activeSubscription.id,
        }),
      });
    } catch {
      console.error("Error sincronizando billing con NCF Manager");
    }

    console.log(`[Billing] ${shopDomain} actualizado a Pro`);
  } else {
    // No hay suscripción activa - el usuario probablemente rechazó
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        shopifyChargeStatus: "declined",
      },
    });
  }

  // Redirigir al dashboard
  return redirect("/app");
};
