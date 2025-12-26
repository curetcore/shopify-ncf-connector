import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Plan de suscripción
const PRO_PLAN = {
  name: "NCF Manager Pro",
  amount: 9.0,
  currencyCode: "USD",
  interval: "EVERY_30_DAYS" as const,
  trialDays: 0,
};

// Action - Crear suscripción
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Crear la suscripción recurrente
  const response = await admin.graphql(`
    mutation CreateSubscription($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        lineItems: $lineItems
        test: $test
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      name: PRO_PLAN.name,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing/callback`,
      test: process.env.NODE_ENV !== "production", // Test mode en desarrollo
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: PRO_PLAN.amount,
                currencyCode: PRO_PLAN.currencyCode,
              },
              interval: PRO_PLAN.interval,
            },
          },
        },
      ],
    },
  });

  const data = await response.json();

  if (data.data?.appSubscriptionCreate?.userErrors?.length > 0) {
    console.error("Billing errors:", data.data.appSubscriptionCreate.userErrors);
    return json({
      success: false,
      errors: data.data.appSubscriptionCreate.userErrors,
    });
  }

  const confirmationUrl = data.data?.appSubscriptionCreate?.confirmationUrl;
  const subscriptionId = data.data?.appSubscriptionCreate?.appSubscription?.id;

  if (confirmationUrl) {
    // Guardar el ID de la suscripción pendiente
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        shopifyChargeId: subscriptionId,
        shopifyChargeStatus: "pending",
      },
    });

    // Redirigir al usuario a la página de confirmación de Shopify
    return redirect(confirmationUrl);
  }

  return json({ success: false, message: "No se pudo crear la suscripción" });
};

// Loader - Verificar estado de suscripción
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Obtener suscripciones activas
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
                  interval
                }
              }
            }
          }
          currentPeriodEnd
        }
      }
    }
  `);

  const data = await response.json();
  const subscriptions = data.data?.currentAppInstallation?.activeSubscriptions || [];

  // Verificar si tiene suscripción activa
  const activeSubscription = subscriptions.find(
    (sub: { status: string }) => sub.status === "ACTIVE"
  );

  if (activeSubscription) {
    // Actualizar la DB con el estado de la suscripción
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        plan: "pro",
        monthlyLimit: 999999, // Ilimitado
        shopifyChargeId: activeSubscription.id,
        shopifyChargeStatus: "active",
      },
    });
  }

  return json({
    hasActiveSubscription: !!activeSubscription,
    subscription: activeSubscription,
  });
};
