import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Webhook: orders/create
// Se ejecuta cuando se crea una nueva orden en Shopify
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} recibido de ${shop}`);

  // Enviar la orden a NCF Manager para sincronización
  const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";

  try {
    const response = await fetch(`${ncfManagerUrl}/api/webhooks/shopify/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop": shop,
        "X-Shopify-Topic": topic,
      },
      body: JSON.stringify({
        action: "create",
        order: payload,
        shop,
      }),
    });

    if (!response.ok) {
      console.error(`[Webhook] Error enviando a NCF Manager: ${response.status}`);
    } else {
      console.log(`[Webhook] Orden ${payload.name} enviada a NCF Manager`);
    }
  } catch (error) {
    console.error("[Webhook] Error de conexión con NCF Manager:", error);
  }

  return new Response(null, { status: 200 });
};
