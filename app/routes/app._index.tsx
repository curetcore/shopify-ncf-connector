import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  DataTable,
  EmptyState,
  Box,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { ExternalIcon, RefreshIcon } from "@shopify/polaris-icons";

// Loader - Obtiene datos para el dashboard
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const accessToken = session.accessToken;

  const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";

  // Sincronizar token con NCF Manager (en background)
  fetch(`${ncfManagerUrl}/api/webhooks/shopify/token-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      shop: shopDomain,
      accessToken,
    }),
  }).catch((err) => {
    console.error("Error sincronizando token con NCF Manager:", err);
  });

  // Consultar plan centralizado desde NCF Manager
  // Esto permite que si pagó en web (Stripe), se refleje aquí
  let centralPlan = {
    plan: "free" as string,
    monthlyLimit: 10,
    invoicesThisMonth: 0,
    billingSource: null as string | null,
    canUpgradeHere: true,
    message: null as string | null,
  };

  try {
    const planResponse = await fetch(`${ncfManagerUrl}/api/shop/plan`, {
      headers: {
        "X-Shopify-Shop": shopDomain,
      },
    });
    if (planResponse.ok) {
      centralPlan = await planResponse.json();
    }
  } catch (err) {
    console.error("Error consultando plan desde NCF Manager:", err);
  }

  // Obtener o crear Shop en la DB
  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    // Obtener info de la tienda desde Shopify
    const response = await admin.graphql(`
      query {
        shop {
          name
          email
        }
      }
    `);
    const data = await response.json();
    const shopName = data.data?.shop?.name || shopDomain;
    const shopEmail = data.data?.shop?.email || null;

    shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopName,
        email: shopEmail,
        isActive: true,
        installedAt: new Date(),
      },
    });
  }

  // Obtener órdenes recientes desde Shopify
  const ordersResponse = await admin.graphql(`
    query {
      orders(first: 10, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              displayName
              email
            }
          }
        }
      }
    }
  `);
  const ordersData = await ordersResponse.json();
  const orders = ordersData.data?.orders?.edges?.map((edge: { node: {
    id: string;
    name: string;
    createdAt: string;
    displayFinancialStatus: string;
    displayFulfillmentStatus: string;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    customer: { displayName: string; email: string } | null;
  }}) => edge.node) || [];

  // Usar datos del plan centralizado (NCF Manager es la fuente de verdad)
  const usagePercent = centralPlan.monthlyLimit > 0
    ? Math.round((centralPlan.invoicesThisMonth / centralPlan.monthlyLimit) * 100)
    : 0;

  return json({
    shop: {
      domain: shopDomain,
      name: shop.shopName || shopDomain,
      // Usar plan desde NCF Manager (refleja pagos de web/Stripe/Apple)
      plan: centralPlan.plan,
      invoicesThisMonth: centralPlan.invoicesThisMonth,
      monthlyLimit: centralPlan.monthlyLimit,
      usagePercent,
      // Info de billing para mostrar mensajes apropiados
      billingSource: centralPlan.billingSource,
      canUpgradeHere: centralPlan.canUpgradeHere,
      billingMessage: centralPlan.message,
    },
    orders,
    ncfManagerUrl,
  });
};

// Action - Manejar sincronización
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    // Llamar al endpoint de sincronización de NCF Manager
    const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";

    try {
      const response = await fetch(`${ncfManagerUrl}/api/orders/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop": shopDomain,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return json({ success: true, message: data.message || "Sincronización completada" });
      } else {
        return json({ success: false, message: "Error al sincronizar" });
      }
    } catch {
      return json({ success: false, message: "Error de conexión con NCF Manager" });
    }
  }

  return json({ success: false, message: "Acción no reconocida" });
};

export default function Index() {
  const { shop, orders, ncfManagerUrl } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSyncing = navigation.state === "submitting";

  // Formatear fecha
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-DO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Formatear precio
  const formatPrice = (amount: string, currency: string) => {
    return new Intl.NumberFormat("es-DO", {
      style: "currency",
      currency,
    }).format(parseFloat(amount));
  };

  // Preparar filas para DataTable
  const tableRows = orders.map((order: {
    name: string;
    createdAt: string;
    customer: { displayName: string } | null;
    displayFinancialStatus: string;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  }) => [
    order.name,
    formatDate(order.createdAt),
    order.customer?.displayName || "Sin cliente",
    order.displayFinancialStatus,
    formatPrice(order.totalPriceSet.shopMoney.amount, order.totalPriceSet.shopMoney.currencyCode),
  ]);

  const handleSync = () => {
    submit({ intent: "sync" }, { method: "post" });
  };

  const isPro = shop.plan === "pro";
  const isNearLimit = shop.usagePercent >= 80;
  const isAtLimit = shop.invoicesThisMonth >= shop.monthlyLimit;
  // Info de billing centralizado
  const billingSource = shop.billingSource;
  const canUpgradeHere = shop.canUpgradeHere;
  const billingMessage = shop.billingMessage;
  // Si ya es Pro pero pagó en otra plataforma
  const paidElsewhere = isPro && billingSource && billingSource !== "shopify";

  return (
    <Page title="NCF Manager">
      <BlockStack gap="500">
        {/* Banner de límite */}
        {!isPro && isNearLimit && !isAtLimit && (
          <Banner
            title="Cerca del límite mensual"
            tone="warning"
          >
            <p>
              Has usado {shop.invoicesThisMonth} de {shop.monthlyLimit} comprobantes este mes.
              Actualiza a Pro para comprobantes ilimitados.
            </p>
          </Banner>
        )}

        {!isPro && isAtLimit && (
          <Banner
            title="Límite mensual alcanzado"
            tone="critical"
          >
            <p>
              Has alcanzado el límite de {shop.monthlyLimit} comprobantes mensuales.
              Actualiza a Pro ($9/mes) para continuar generando comprobantes.
            </p>
          </Banner>
        )}

        <Layout>
          {/* Columna principal */}
          <Layout.Section>
            {/* Stats Cards */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Resumen
                  </Text>
                  <Badge tone={isPro ? "success" : "info"}>
                    {isPro ? "Pro" : "Gratis"}
                  </Badge>
                </InlineStack>

                <Divider />

                <InlineStack gap="800" align="start" blockAlign="start">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Comprobantes este mes
                    </Text>
                    <Text as="p" variant="headingXl">
                      {shop.invoicesThisMonth}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      de {shop.monthlyLimit} {isPro ? "(ilimitado)" : ""}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Órdenes recientes
                    </Text>
                    <Text as="p" variant="headingXl">
                      {orders.length}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      últimas 10
                    </Text>
                  </BlockStack>
                </InlineStack>

                {!isPro && (
                  <Box>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          Uso mensual
                        </Text>
                        <Text as="span" variant="bodySm">
                          {shop.usagePercent}%
                        </Text>
                      </InlineStack>
                      <ProgressBar
                        progress={shop.usagePercent}
                        tone={isNearLimit ? "critical" : "primary"}
                        size="small"
                      />
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>

            {/* Órdenes recientes */}
            <Box paddingBlockStart="500">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Órdenes Recientes
                    </Text>
                    <Button
                      onClick={handleSync}
                      loading={isSyncing}
                      icon={RefreshIcon}
                      size="slim"
                    >
                      Sincronizar
                    </Button>
                  </InlineStack>

                  {orders.length > 0 ? (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "numeric"]}
                      headings={["Orden", "Fecha", "Cliente", "Estado", "Total"]}
                      rows={tableRows}
                    />
                  ) : (
                    <EmptyState
                      heading="Sin órdenes"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>Las órdenes de tu tienda aparecerán aquí.</p>
                    </EmptyState>
                  )}
                </BlockStack>
              </Card>
            </Box>
          </Layout.Section>

          {/* Sidebar */}
          <Layout.Section variant="oneThird">
            {/* Acciones rápidas */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Acciones
                </Text>

                <BlockStack gap="300">
                  <Button
                    url={ncfManagerUrl}
                    external
                    icon={ExternalIcon}
                    fullWidth
                  >
                    Abrir NCF Manager
                  </Button>

                  <Button
                    url={`${ncfManagerUrl}/ordenes/nueva`}
                    external
                    variant="plain"
                    fullWidth
                  >
                    Crear orden manual
                  </Button>

                  <Button
                    url={`${ncfManagerUrl}/solicitudes`}
                    external
                    variant="plain"
                    fullWidth
                  >
                    Ver solicitudes
                  </Button>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Upgrade card - solo si no es Pro o si puede hacer upgrade aquí */}
            {!isPro && canUpgradeHere && (
              <Box paddingBlockStart="500">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      Actualiza a Pro
                    </Text>

                    <Text as="p" variant="bodyMd" tone="subdued">
                      Obtén comprobantes ilimitados por solo $9/mes.
                    </Text>

                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm">
                        ✓ Comprobantes ilimitados
                      </Text>
                      <Text as="p" variant="bodySm">
                        ✓ Sincronización automática
                      </Text>
                      <Text as="p" variant="bodySm">
                        ✓ Soporte prioritario
                      </Text>
                    </BlockStack>

                    <Form method="post" action="/app/billing">
                      <Button variant="primary" fullWidth submit>
                        Actualizar a Pro - $9/mes
                      </Button>
                    </Form>
                  </BlockStack>
                </Card>
              </Box>
            )}

            {/* Mensaje si ya tiene Pro de otra plataforma */}
            {paidElsewhere && (
              <Box paddingBlockStart="500">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" align="start">
                      <Badge tone="success">Pro</Badge>
                      <Text as="h2" variant="headingMd">
                        Plan Activo
                      </Text>
                    </InlineStack>

                    <Text as="p" variant="bodyMd" tone="subdued">
                      {billingMessage || `Tu suscripción Pro está activa via ${billingSource === "stripe" ? "la web" : "App Store"}.`}
                    </Text>

                    <Text as="p" variant="bodySm" tone="subdued">
                      Puedes gestionar tu suscripción desde {billingSource === "stripe" ? "NCF Manager web" : "la App Store"}.
                    </Text>
                  </BlockStack>
                </Card>
              </Box>
            )}

            {/* Info de tienda */}
            <Box paddingBlockStart="500">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Tu tienda
                  </Text>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Nombre
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {shop.name}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Dominio
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {shop.domain}
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </Box>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
