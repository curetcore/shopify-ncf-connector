import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Webhook: shop/redact
// Se dispara 48 horas después de que una tienda desinstala la app
// Debes eliminar TODOS los datos de esa tienda
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Webhook ${topic} recibido para ${shop}`);
  console.log("Shop redact payload:", JSON.stringify(payload, null, 2));

  // Eliminar todos los datos de la tienda
  try {
    // Eliminar el registro del shop
    await db.shop.delete({
      where: { shopDomain: shop },
    });
    console.log(`Datos de ${shop} eliminados completamente`);
  } catch (error) {
    console.log(`No se encontraron datos para eliminar de ${shop}`);
  }

  // Nota: Las sesiones ya fueron eliminadas en app/uninstalled
  // Si tienes más tablas relacionadas con el shop, elimínalas aquí

  return new Response();
};
