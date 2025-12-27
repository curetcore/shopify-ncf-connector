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
  Tabs,
  Modal,
  TextField,
  FormLayout,
  Select,
  InlineGrid,
  SkeletonBodyText,
} from "@shopify/polaris";
import { ExternalIcon, RefreshIcon } from "@shopify/polaris-icons";

// Tipos de NCF
const NCF_TYPES = [
  { label: "Consumidor Final (B02)", value: "B02" },
  { label: "Crédito Fiscal (B01)", value: "B01" },
  { label: "Gubernamental (B15)", value: "B15" },
  { label: "Régimen Especial (B14)", value: "B14" },
];

// Tipos para los datos
interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string | null;
  total: number;
  orderDate: string;
  source: string;
  request?: { id: string; status: string; ncfId: string | null } | null;
}

interface NCFRecord {
  id: string;
  ncfCode: string;
  orderNumber: string;
  customerName: string;
  razonSocial: string;
  rnc: string;
  total: number;
  status: string;
  createdAt: string;
}

interface CompanySettings {
  name: string;
  rnc: string;
  address: string | null;
  phone: string | null;
  email: string | null;
}

interface UsageMonth {
  month: string;
  count: number;
}

// Loader - Obtiene todos los datos para el dashboard
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const accessToken = session.accessToken;

    const ncfManagerUrl = process.env.NCF_MANAGER_URL || "https://ncf.curetcore.com";

    // Sincronizar token con NCF Manager
    fetch(`${ncfManagerUrl}/api/webhooks/shopify/token-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: shopDomain, accessToken }),
    }).catch(() => {});

    // Consultar plan centralizado
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

    // Shop local
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

    // Obtener órdenes
    let orders: Order[] = [];
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

    // Obtener historial de NCFs
    let ncfs: NCFRecord[] = [];
    try {
      const ncfsResponse = await fetch(`${ncfManagerUrl}/api/shopify/ncfs?limit=50`, {
        headers: { "X-Shopify-Shop": shopDomain },
      });
      if (ncfsResponse.ok) {
        const ncfsData = await ncfsResponse.json();
        ncfs = ncfsData.ncfs || [];
      }
    } catch {}

    // Obtener configuración de empresa
    let company: CompanySettings | null = null;
    try {
      const settingsResponse = await fetch(`${ncfManagerUrl}/api/shopify/settings`, {
        headers: { "X-Shopify-Shop": shopDomain },
      });
      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json();
        company = settingsData.company || null;
      }
    } catch {}

    // Obtener estadísticas de uso
    let usageMonths: UsageMonth[] = [];
    try {
      const usageResponse = await fetch(`${ncfManagerUrl}/api/shopify/usage`, {
        headers: { "X-Shopify-Shop": shopDomain },
      });
      if (usageResponse.ok) {
        const usageData = await usageResponse.json();
        usageMonths = usageData.months || [];
      }
    } catch {}

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
      ncfs,
      company,
      usageMonths,
      ncfManagerUrl,
    });
  } catch (err) {
    console.error("Error fatal en loader:", err);
    throw err;
  }
};

// Action - Manejar sincronización, creación de NCF y configuración
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

  if (intent === "saveCompany") {
    const name = formData.get("companyName") as string;
    const rnc = formData.get("companyRnc") as string;
    const address = formData.get("companyAddress") as string;
    const phone = formData.get("companyPhone") as string;
    const email = formData.get("companyEmail") as string;

    try {
      const response = await fetch(`${ncfManagerUrl}/api/shopify/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Shop": shopDomain },
        body: JSON.stringify({ name, rnc, address, phone, email }),
      });
      if (response.ok) {
        return json({ success: true, intent: "saveCompany", message: "Datos de empresa guardados" });
      } else {
        const errorData = await response.json().catch(() => ({}));
        return json({ success: false, intent: "saveCompany", message: errorData.error || "Error al guardar" });
      }
    } catch {
      return json({ success: false, intent: "saveCompany", message: "Error de conexión" });
    }
  }

  return json({ success: false, message: "Acción no reconocida" });
};

export default function Index() {
  const { shop, orders, ordersError, ordersStats, ncfs, company, usageMonths, ncfManagerUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  // Tabs
  const [selectedTab, setSelectedTab] = useState(0);

  // Modal NCF
  const [ncfModalOpen, setNcfModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [ncfType, setNcfType] = useState("B02");
  const [rnc, setRnc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");

  // Formulario empresa
  const [companyName, setCompanyName] = useState(company?.name || "");
  const [companyRnc, setCompanyRnc] = useState(company?.rnc || "");
  const [companyAddress, setCompanyAddress] = useState(company?.address || "");
  const [companyPhone, setCompanyPhone] = useState(company?.phone || "");
  const [companyEmail, setCompanyEmail] = useState(company?.email || "");

  // Cargar datos de empresa cuando cambie
  useEffect(() => {
    if (company) {
      setCompanyName(company.name || "");
      setCompanyRnc(company.rnc || "");
      setCompanyAddress(company.address || "");
      setCompanyPhone(company.phone || "");
      setCompanyEmail(company.email || "");
    }
  }, [company]);

  // Cerrar modal cuando se completa la acción
  useEffect(() => {
    if (actionData?.intent === "createNCF" && actionData?.success) {
      setNcfModalOpen(false);
      setSelectedOrder(null);
      setRnc("");
      setRazonSocial("");
    }
  }, [actionData]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-DO", {
      day: "2-digit", month: "short", year: "numeric",
    });
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(amount);
  };

  const getNCFBadge = (order: Order) => {
    if (!order.request) return <Badge tone="attention">Pendiente</Badge>;
    if (order.request.status === "SENT") return <Badge tone="success">Enviado</Badge>;
    if (order.request.status === "CONFIRMED") return <Badge tone="info">Confirmado</Badge>;
    return <Badge>En proceso</Badge>;
  };

  const handleSync = () => submit({ intent: "sync" }, { method: "post" });

  const openNCFModal = useCallback((order: Order) => {
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

  const handleSaveCompany = () => {
    submit(
      { intent: "saveCompany", companyName, companyRnc, companyAddress, companyPhone, companyEmail },
      { method: "post" }
    );
  };

  const isPro = shop.plan === "pro";
  const isNearLimit = shop.usagePercent >= 80;
  const isAtLimit = shop.invoicesThisMonth >= shop.monthlyLimit;

  // Calcular máximo para el gráfico
  const maxUsage = Math.max(...usageMonths.map(m => m.count), 1);

  // Filas de órdenes
  const orderRows = orders.map((order, index) => (
    <IndexTable.Row id={order.id} key={order.id} position={index}>
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

  // Filas de NCFs
  const ncfRows = ncfs.map((ncf, index) => (
    <IndexTable.Row id={ncf.id} key={ncf.id} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">{ncf.ncfCode}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{ncf.orderNumber}</IndexTable.Cell>
      <IndexTable.Cell>{ncf.razonSocial}</IndexTable.Cell>
      <IndexTable.Cell>{ncf.rnc}</IndexTable.Cell>
      <IndexTable.Cell>{formatPrice(ncf.total)}</IndexTable.Cell>
      <IndexTable.Cell>{formatDate(ncf.createdAt)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  // Tabs
  const tabs = [
    { id: "orders", content: `Órdenes (${ordersStats.total})`, panelID: "orders-panel" },
    { id: "ncfs", content: `NCFs (${ncfs.length})`, panelID: "ncfs-panel" },
    { id: "company", content: "Empresa", panelID: "company-panel" },
    { id: "stats", content: "Resumen", panelID: "stats-panel" },
  ];

  return (
    <Page
      title="NCF Manager"
      primaryAction={
        <Button icon={RefreshIcon} onClick={handleSync} loading={isLoading}>
          Sincronizar
        </Button>
      }
      secondaryActions={[
        { content: "Web App", icon: ExternalIcon, url: ncfManagerUrl, external: true },
      ]}
    >
      <BlockStack gap="400">
        {/* Banners */}
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {!isPro && isAtLimit && (
          <Banner title="Límite alcanzado" tone="critical">
            <p>Has usado {shop.monthlyLimit} comprobantes. Actualiza a Pro para continuar.</p>
          </Banner>
        )}

        {!isPro && isNearLimit && !isAtLimit && (
          <Banner title="Cerca del límite" tone="warning">
            <p>Has usado {shop.invoicesThisMonth} de {shop.monthlyLimit} comprobantes.</p>
          </Banner>
        )}

        {/* Stats rápidas */}
        <InlineGrid columns={4} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Órdenes</Text>
              <Text as="p" variant="headingLg">{ordersStats.total}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Con NCF</Text>
              <Text as="p" variant="headingLg">{ordersStats.withNCF}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Pendientes</Text>
              <Text as="p" variant="headingLg">{ordersStats.pendingNCF}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Este mes</Text>
              <Text as="p" variant="headingLg">{shop.invoicesThisMonth}/{shop.monthlyLimit}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Tabs de contenido */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400">
              {/* Tab: Órdenes */}
              {selectedTab === 0 && (
                ordersError ? (
                  <Banner tone="warning">
                    <p>Haz clic en "Sincronizar" para cargar tus órdenes de Shopify.</p>
                  </Banner>
                ) : orders.length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: "orden", plural: "órdenes" }}
                    itemCount={orders.length}
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
                    {orderRows}
                  </IndexTable>
                ) : (
                  <EmptyState
                    heading="Sin órdenes"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={{ content: "Sincronizar Shopify", onAction: handleSync }}
                  >
                    <p>Sincroniza tus órdenes para comenzar.</p>
                  </EmptyState>
                )
              )}

              {/* Tab: NCFs */}
              {selectedTab === 1 && (
                ncfs.length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: "NCF", plural: "NCFs" }}
                    itemCount={ncfs.length}
                    headings={[
                      { title: "NCF" },
                      { title: "Orden" },
                      { title: "Razón Social" },
                      { title: "RNC" },
                      { title: "Total" },
                      { title: "Fecha" },
                    ]}
                    selectable={false}
                  >
                    {ncfRows}
                  </IndexTable>
                ) : (
                  <EmptyState
                    heading="Sin comprobantes"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Aún no has creado comprobantes fiscales.</p>
                  </EmptyState>
                )
              )}

              {/* Tab: Empresa */}
              {selectedTab === 2 && (
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Datos Fiscales de la Empresa</Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Nombre de la Empresa"
                        value={companyName}
                        onChange={setCompanyName}
                        autoComplete="organization"
                        requiredIndicator
                      />
                      <TextField
                        label="RNC"
                        value={companyRnc}
                        onChange={setCompanyRnc}
                        autoComplete="off"
                        placeholder="000000000"
                        requiredIndicator
                      />
                    </FormLayout.Group>
                    <TextField
                      label="Dirección"
                      value={companyAddress}
                      onChange={setCompanyAddress}
                      autoComplete="street-address"
                    />
                    <FormLayout.Group>
                      <TextField
                        label="Teléfono"
                        value={companyPhone}
                        onChange={setCompanyPhone}
                        autoComplete="tel"
                      />
                      <TextField
                        label="Email"
                        value={companyEmail}
                        onChange={setCompanyEmail}
                        autoComplete="email"
                        type="email"
                      />
                    </FormLayout.Group>
                  </FormLayout>
                  <InlineStack align="end">
                    <Button variant="primary" onClick={handleSaveCompany} loading={isLoading}>
                      Guardar Datos
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}

              {/* Tab: Resumen */}
              {selectedTab === 3 && (
                <BlockStack gap="400">
                  {/* Plan y uso */}
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

                  {/* Gráfico de uso mensual */}
                  {usageMonths.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Uso por mes</Text>
                      <Box paddingBlockStart="200">
                        <InlineStack gap="200" align="start" blockAlign="end">
                          {usageMonths.map((month, i) => (
                            <BlockStack key={i} gap="100" inlineAlign="center">
                              <Box
                                background={month.count > 0 ? "bg-fill-info" : "bg-surface-secondary"}
                                borderRadius="100"
                                minHeight={`${Math.max((month.count / maxUsage) * 100, 10)}px`}
                                minWidth="40px"
                              />
                              <Text as="span" variant="bodySm" tone="subdued">{month.month}</Text>
                              <Text as="span" variant="bodySm" fontWeight="semibold">{month.count}</Text>
                            </BlockStack>
                          ))}
                        </InlineStack>
                      </Box>
                    </BlockStack>
                  )}

                  {/* Upgrade */}
                  {!isPro && shop.canUpgradeHere && (
                    <Box paddingBlockStart="400">
                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">Actualiza a Pro</Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Comprobantes ilimitados, soporte prioritario y más.
                          </Text>
                          <Form method="post" action="/app/billing">
                            <Button variant="primary" fullWidth submit>
                              Actualizar - $9/mes
                            </Button>
                          </Form>
                        </BlockStack>
                      </Card>
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
