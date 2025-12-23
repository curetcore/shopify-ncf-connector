import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Webhook: customers/redact
// Se dispara cuando un cliente solicita eliminar sus datos (GDPR)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Webhook ${topic} recibido para ${shop}`);
  console.log("Customer redact payload:", JSON.stringify(payload, null, 2));

  // En NCF Manager, los datos del cliente están en las facturas
  // Las facturas fiscales tienen requisitos legales de retención
  // Por lo general NO se pueden eliminar (requisito fiscal)

  // Opciones:
  // 1. Anonimizar datos personales manteniendo la factura
  // 2. Documentar que no se puede eliminar por requisitos fiscales

  // Por ahora solo logueamos
  // En producción: implementar lógica de anonimización

  return new Response();
};
