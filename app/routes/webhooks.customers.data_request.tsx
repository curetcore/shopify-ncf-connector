import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Webhook: customers/data_request
// Se dispara cuando un cliente solicita sus datos personales (GDPR)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Webhook ${topic} recibido para ${shop}`);
  console.log("Customer data request payload:", JSON.stringify(payload, null, 2));

  // En NCF Manager, los datos del cliente están en las facturas/requests
  // Este webhook notifica que debemos proporcionar los datos
  // La respuesta real se envía por email al merchant

  // Por ahora solo logueamos - en producción deberías:
  // 1. Buscar todos los datos del cliente en tu DB
  // 2. Formatearlos
  // 3. Enviarlos al merchant por email o dashboard

  return new Response();
};
