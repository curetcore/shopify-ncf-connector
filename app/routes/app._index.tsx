import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Form, useActionData } from "@remix-run/react";
import { useEffect, useCallback, useState } from "react";
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
  EmptyState,
  Box,
  ProgressBar,
  Divider,
  IndexTable,
  useIndexResourceState,
  Tabs,
  Modal,
  TextField,
  FormLayout,
  Select,
  Spinner,
} from "@shopify/polaris";
import { ExternalIcon, RefreshIcon, PlusIcon } from "@shopify/polaris-icons";

// Tipos de NCF
const NCF_TYPES = [
  { label: "Consumidor Final (B02)", value: "B02" },
  { label: "Crédito Fiscal (B01)", value: "B01" },
  { label: "Gubernamental (B15)", value: "B15" },
  { label: "Régimen Especial (B14)", value: "B14" },
];

// Loader - Obtiene datos para el dashboard
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const accessToken = session.accessToken;

    const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";

    // Sincronizar token con NCF Manager (en background)
    fetch(`${ncfManagerUrl}/api/webhooks/shopify/token-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: shopDomain, accessToken }),
    }).catch(() => {});

    // Consultar plan centralizado desde NCF Manager
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
        headers: { "X-Shopify-Shop": shopDomain },
      });
      if (planResponse.ok) {
        centralPlan = await planResponse.json();
      }
    } catch {}

    // Obtener o crear Shop en la DB local
    let shop = await prisma.shop.findUnique({ where: { shopDomain } });

    if (!shop) {
      try {
        const response = await admin.graphql(`query { shop { name email } }`);
        const data = await response.json();
        shop = await prisma.shop.create({
          data: {
            shopDomain,
            shopName: data.data?.shop?.name || shopDomain,
            email: data.data?.shop?.email || null,
            isActive: true,
            installedAt: new Date(),
          },
        });
      } catch {
        shop = await prisma.shop.create({
          data: { shopDomain, shopName: shopDomain, isActive: true, installedAt: new Date() },
        });
      }
    }

    // Obtener órdenes desde NCF Manager
    let orders: Array<{
      id: string;
      orderNumber: string;
      customerName: string;
      customerEmail: string | null;
      total: number;
      orderDate: string;
      source: string;
      request?: { id: string; status: string; ncfId: string | null } | null;
    }> = [];
    let ordersError = false;
    let ordersStats = { total: 0, withNCF: 0, pendingNCF: 0 };

    try {
      const ordersResponse = await fetch(`${ncfManagerUrl}/api/shopify/orders?limit=50`, {
        headers: { "X-Shopify-Shop": shopDomain },
      });
      if (ordersResponse.ok) {
        const ordersData = await ordersResponse.json();
        orders = ordersData.orders || [];
        ordersStats = ordersData.stats || ordersStats;
      } else {
        ordersError = true;
      }
    } catch {
      ordersError = true;
    }

    const usagePercent = centralPlan.monthlyLimit > 0
      ? Math.round((centralPlan.invoicesThisMonth / centralPlan.monthlyLimit) * 100)
      : 0;

    return json({
      shop: {
        domain: shopDomain,
        name: shop.shopName || shopDomain,
        plan: centralPlan.plan,
        invoicesThisMonth: centralPlan.invoicesThisMonth,
        monthlyLimit: centralPlan.monthlyLimit,
        usagePercent,
        billingSource: centralPlan.billingSource,
        canUpgradeHere: centralPlan.canUpgradeHere,
        billingMessage: centralPlan.message,
      },
      orders,
      ordersError,
      ordersStats,
      ncfManagerUrl,
    });
  } catch (err) {
    console.error("Error fatal en loader:", err);
    throw err;
  }
};

// Action - Manejar sincronización y creación de NCF
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";

  if (intent === "sync") {
    try {
      const response = await fetch(`${ncfManagerUrl}/api/shopify/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Shop": shopDomain },
      });
      if (response.ok) {
        const data = await response.json();
        return json({ success: true, intent: "sync", message: data.message || "Sincronización completada" });
      } else {
        const errorData = await response.json().catch(() => ({}));
        return json({ success: false, intent: "sync", message: errorData.error || "Error al sincronizar" });
      }
    } catch {
      return json({ success: false, intent: "sync", message: "Error de conexión" });
    }
  }

  if (intent === "createNCF") {
    const orderId = formData.get("orderId") as string;
    const ncfType = formData.get("ncfType") as string;
    const rnc = formData.get("rnc") as string;
    const razonSocial = formData.get("razonSocial") as string;

    try {
      const response = await fetch(`${ncfManagerUrl}/api/shopify/ncf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Shop": shopDomain },
        body: JSON.stringify({ orderId, ncfType, rnc, razonSocial }),
      });
      if (response.ok) {
        return json({ success: true, intent: "createNCF", message: "NCF creado exitosamente" });
      } else {
        const errorData = await response.json().catch(() => ({}));
        return json({ success: false, intent: "createNCF", message: errorData.error || "Error al crear NCF" });
      }
    } catch {
      return json({ success: false, intent: "createNCF", message: "Error de conexión" });
    }
  }

  return json({ success: false, message: "Acción no reconocida" });
};

export default function Index() {
  const { shop, orders, ordersError, ordersStats, ncfManagerUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  // Estado para tabs
  const [selectedTab, setSelectedTab] = useState(0);

  // Estado para modal de NCF
  const [ncfModalOpen, setNcfModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<typeof orders[0] | null>(null);
  const [ncfType, setNcfType] = useState("B02");
  const [rnc, setRnc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");

  // Cerrar modal cuando se completa la acción
  useEffect(() => {
    if (actionData?.intent === "createNCF" && actionData?.success) {
      setNcfModalOpen(false);
      setSelectedOrder(null);
      setRnc("");
      setRazonSocial("");
    }
  }, [actionData]);

  // IndexTable para órdenes
  const resourceName = { singular: "orden", plural: "órdenes" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(orders);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-DO", {
      day: "2-digit", month: "short", year: "numeric",
    });
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(amount);
  };

  const getNCFBadge = (order: typeof orders[0]) => {
    if (!order.request) return <Badge tone="attention">Pendiente</Badge>;
    if (order.request.status === "SENT") return <Badge tone="success">Enviado</Badge>;
    if (order.request.status === "CONFIRMED") return <Badge tone="info">Confirmado</Badge>;
    return <Badge>En proceso</Badge>;
  };

  const handleSync = () => submit({ intent: "sync" }, { method: "post" });

  const openNCFModal = useCallback((order: typeof orders[0]) => {
    setSelectedOrder(order);
    setRazonSocial(order.customerName || "");
    setNcfModalOpen(true);
  }, []);

  const handleCreateNCF = () => {
    if (!selectedOrder) return;
    submit(
      { intent: "createNCF", orderId: selectedOrder.id, ncfType, rnc, razonSocial },
      { method: "post" }
    );
  };

  const isPro = shop.plan === "pro";
  const isNearLimit = shop.usagePercent >= 80;
  const isAtLimit = shop.invoicesThisMonth >= shop.monthlyLimit;

  // Filas de la tabla de órdenes
  const rowMarkup = orders.map((order, index) => (
    <IndexTable.Row id={order.id} key={order.id} position={index} selected={selectedResources.includes(order.id)}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">{order.orderNumber}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(order.orderDate)}</IndexTable.Cell>
      <IndexTable.Cell>{order.customerName || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{formatPrice(order.total)}</IndexTable.Cell>
      <IndexTable.Cell>{getNCFBadge(order)}</IndexTable.Cell>
      <IndexTable.Cell>
        {!order.request ? (
          <Button size="slim" onClick={() => openNCFModal(order)}>Crear NCF</Button>
        ) : (
          <Button size="slim" variant="plain" url={`${ncfManagerUrl}/solicitudes/${order.request.id}`} external>
            Ver
          </Button>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  // Tabs de navegación
  const tabs = [
    { id: "orders", content: "Órdenes", panelID: "orders-panel" },
    { id: "stats", content: "Resumen", panelID: "stats-panel" },
  ];

  return (
    <Page
      title="NCF Manager"
      primaryAction={
        <Button icon={RefreshIcon} onClick={handleSync} loading={isLoading}>
          Sincronizar Shopify
        </Button>
      }
      secondaryActions={[
        { content: "Abrir Web App", icon: ExternalIcon, url: ncfManagerUrl, external: true },
      ]}
    >
      <BlockStack gap="400">
        {/* Banners de estado */}
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {!isPro && isAtLimit && (
          <Banner title="Límite alcanzado" tone="critical">
            <p>Has alcanzado el límite de {shop.monthlyLimit} comprobantes. Actualiza a Pro para continuar.</p>
          </Banner>
        )}

        {!isPro && isNearLimit && !isAtLimit && (
          <Banner title="Cerca del límite" tone="warning">
            <p>Has usado {shop.invoicesThisMonth} de {shop.monthlyLimit} comprobantes este mes.</p>
          </Banner>
        )}

        {/* Stats rápidas */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Órdenes</Text>
                <Text as="p" variant="headingLg">{ordersStats.total}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Con NCF</Text>
                <Text as="p" variant="headingLg">{ordersStats.withNCF}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Pendientes</Text>
                <Text as="p" variant="headingLg">{ordersStats.pendingNCF}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Tabs de contenido */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400">
              {selectedTab === 0 && (
                // Tab de Órdenes
                ordersError ? (
                  <Banner tone="warning">
                    <p>Haz clic en "Sincronizar Shopify" para cargar tus órdenes.</p>
                  </Banner>
                ) : orders.length > 0 ? (
                  <IndexTable
                    resourceName={resourceName}
                    itemCount={orders.length}
                    selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: "Orden" },
                      { title: "Fecha" },
                      { title: "Cliente" },
                      { title: "Total" },
                      { title: "NCF" },
                      { title: "Acción" },
                    ]}
                    selectable={false}
                  >
                    {rowMarkup}
                  </IndexTable>
                ) : (
                  <EmptyState
                    heading="Sin órdenes"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={{ content: "Sincronizar Shopify", onAction: handleSync }}
                  >
                    <p>Sincroniza tus órdenes de Shopify para comenzar.</p>
                  </EmptyState>
                )
              )}

              {selectedTab === 1 && (
                // Tab de Resumen
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">Plan: {isPro ? "Pro" : "Gratis"}</Text>
                    <Badge tone={isPro ? "success" : "info"}>{isPro ? "Pro" : "Free"}</Badge>
                  </InlineStack>
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      Comprobantes usados: <strong>{shop.invoicesThisMonth}</strong> de {shop.monthlyLimit}
                    </Text>
                    {!isPro && (
                      <ProgressBar progress={shop.usagePercent} tone={isNearLimit ? "critical" : "primary"} />
                    )}
                  </BlockStack>
                  {!isPro && shop.canUpgradeHere && (
                    <Box paddingBlockStart="400">
                      <Form method="post" action="/app/billing">
                        <Button variant="primary" fullWidth submit>
                          Actualizar a Pro - $9/mes
                        </Button>
                      </Form>
                    </Box>
                  )}
                </BlockStack>
              )}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>

      {/* Modal para crear NCF */}
      <Modal
        open={ncfModalOpen}
        onClose={() => setNcfModalOpen(false)}
        title={`Crear NCF - ${selectedOrder?.orderNumber || ""}`}
        primaryAction={{
          content: "Crear NCF",
          onAction: handleCreateNCF,
          loading: isLoading,
          disabled: !razonSocial,
        }}
        secondaryActions={[{ content: "Cancelar", onAction: () => setNcfModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Tipo de Comprobante"
              options={NCF_TYPES}
              value={ncfType}
              onChange={setNcfType}
            />
            <TextField
              label="RNC/Cédula"
              value={rnc}
              onChange={setRnc}
              placeholder="Opcional para B02"
              autoComplete="off"
            />
            <TextField
              label="Razón Social / Nombre"
              value={razonSocial}
              onChange={setRazonSocial}
              autoComplete="off"
              requiredIndicator
            />
            {selectedOrder && (
              <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">Total: {formatPrice(selectedOrder.total)}</Text>
                  <Text as="p" variant="bodySm">Cliente: {selectedOrder.customerName}</Text>
                </BlockStack>
              </Box>
            )}
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
