import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Webhook ${topic} recibido para ${shop}`);

  // Marcar el shop como inactivo
  try {
    await db.shop.update({
      where: { shopDomain: shop },
      data: {
        isActive: false,
        uninstalledAt: new Date(),
      },
    });
    console.log(`Shop ${shop} marcado como inactivo`);
  } catch (error) {
    // El shop podría no existir si nunca completó la instalación
    console.log(`No se encontró shop ${shop} para actualizar`);
  }

  // Eliminar sesiones
  if (session) {
    await db.session.deleteMany({ where: { shop } });
    console.log(`Sesiones eliminadas para ${shop}`);
  }

  return new Response();
};
