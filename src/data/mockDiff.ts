import type { DiffFile, DiffFileStatus } from "../types/review";

interface ChangeOperation {
  at: number;
  remove: string[];
  add: string[];
}

interface FileSeed {
  id: string;
  path: string;
  oldPath?: string;
  language: string;
  status: DiffFileStatus;
  totalLines: number;
  description: string;
  operations: ChangeOperation[];
}

const operation = (at: number, remove: string[], add: string[]): ChangeOperation => ({ at, remove, add });

function fillerLine(path: string, lineNumber: number): string {
  if (path.endsWith(".md")) {
    const sections = ["## 背景", "### 验收标准", "- 支持失败重试", "- 保留审计日志", "## 回滚方式", "1. 关闭开关", "2. 恢复旧版本"];
    return sections[lineNumber % sections.length] + ` ${lineNumber}`;
  }
  if (path.endsWith(".tsx")) {
    const templates = [
      `const row${lineNumber} = orders[${lineNumber} % orders.length];`,
      `<TableRow key={row${lineNumber}.id} data-testid="order-row-${lineNumber}">`,
      `  <TableCell>{formatCurrency(row${lineNumber}.amount)}</TableCell>`,
      `  <TableCell>{statusLabel(row${lineNumber}.status)}</TableCell>`,
      `</TableRow>`,
      `if (row${lineNumber}.riskScore > 0.8) {`,
      `  setReviewReason(row${lineNumber}.riskReason);`,
      `}`,
    ];
    return templates[lineNumber % templates.length];
  }
  if (path.endsWith(".ts")) {
    const templates = [
      `const normalized${lineNumber} = normalizePayload(payload, ${lineNumber});`,
      `if (!normalized${lineNumber}.orderId) return fail("ORDER_ID_REQUIRED");`,
      `logger.debug("checkout.step", { sequence: ${lineNumber}, traceId });`,
      `const cached${lineNumber} = await cache.get(cacheKey${lineNumber});`,
      `if (cached${lineNumber}) return cached${lineNumber} as CheckoutResult;`,
      `metrics.observe("checkout.duration", performance.now() - startedAt);`,
      `return { accepted: true, sequence: ${lineNumber} };`,
    ];
    return templates[lineNumber % templates.length];
  }
  return `line ${lineNumber}`;
}

export const mockChangeLines: Record<string, number[]> = {};

function buildFile(seed: FileSeed): DiffFile {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const changeLines: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;

  for (const change of [...seed.operations].sort((left, right) => left.at - right.at)) {
    while (oldLine < change.at) {
      const line = fillerLine(seed.path, oldLine);
      oldLines.push(line);
      newLines.push(line);
      oldLine += 1;
      newLine += 1;
    }

    changeLines.push(newLine);
    oldLines.push(...change.remove);
    newLines.push(...change.add);
    oldLine += change.remove.length;
    newLine += change.add.length;
    deletions += change.remove.length;
    additions += change.add.length;
  }

  while (oldLine <= seed.totalLines) {
    const line = fillerLine(seed.path, oldLine);
    oldLines.push(line);
    newLines.push(line);
    oldLine += 1;
  }

  mockChangeLines[seed.id] = changeLines;
  return {
    id: seed.id,
    path: seed.path,
    oldPath: seed.oldPath,
    language: seed.language,
    status: seed.status,
    oldContent: oldLines.join("\n"),
    newContent: newLines.join("\n"),
    additions,
    deletions,
    description: seed.description,
  };
}

const paymentOperations = [
  operation(
    42,
    ["const cacheKey = `checkout:${orderId}`;", "const cached = await cache.get(cacheKey);", "if (cached) return cached;"],
    [
      "const cacheKey = buildCheckoutCacheKey(orderId, channel);",
      "const cacheStartedAt = performance.now();",
      "const cached = await checkoutCache.get(cacheKey);",
      "metrics.observe(\"checkout.cache.lookup\", performance.now() - cacheStartedAt);",
      "if (cached && cached.version >= CACHE_SCHEMA_VERSION) return cached;",
    ],
  ),
  operation(
    87,
    ["if (!payload.items.length) return { accepted: false };", "const total = payload.items.reduce((sum, item) => sum + item.price, 0);"],
    [
      "if (!payload.items.length) return fail(\"EMPTY_ORDER\", traceId);",
      "const total = payload.items.reduce((sum, item) => sum + item.price * item.quantity, 0);",
      "const discount = await promotionService.resolve(payload, total);",
      "const payable = Math.max(0, total - discount.amount);",
    ],
  ),
  operation(
    132,
    ["await audit.log({ orderId, action: \"submit\" });"],
    [
      "await audit.log({",
      "  orderId,",
      "  action: \"submit\",",
      "  traceId,",
      "  amount: payable,",
      "  promotionId: discount.promotionId,",
      "});",
    ],
  ),
  operation(
    176,
    ["if (result.code !== 0) throw new Error(result.message);", "return result.data;"],
    [
      "if (result.code !== 0) {",
      "  metrics.increment(\"checkout.payment.failed\", { code: String(result.code) });",
      "  throw new PaymentRejectedError(result.message, result.code, traceId);",
      "}",
      "checkoutCache.set(cacheKey, result.data, CACHE_TTL_MS);",
      "return result.data;",
    ],
  ),
  operation(
    228,
    ["return retry(() => paymentClient.submit(payload), 2);"],
    [
      "return retry(",
      "  () => paymentClient.submit(payload, { traceId, timeoutMs: PAYMENT_TIMEOUT_MS }),",
      "  { attempts: 3, backoffMs: [80, 180], retryOn: isRetryablePaymentError },",
      ");",
    ],
  ),
  operation(
    312,
    ["const refundState = await refundStore.get(orderId);", "return refundState.status === \"completed\";"],
    [
      "const [refundState, ledgerEntry] = await Promise.all([",
      "  refundStore.get(orderId),",
      "  ledgerService.findByOrder(orderId),",
      "]);",
      "if (ledgerEntry?.settledAt) return true;",
      "return refundState.status === \"completed\";",
    ],
  ),
  operation(
    406,
    ["logger.info(\"refund complete\", { orderId });", "return { success: true };"],
    [
      "logger.info(\"refund complete\", { orderId, traceId, durationMs: Date.now() - startedAt });",
      "await checkoutCache.delete(buildCheckoutCacheKey(orderId, channel));",
      "return { success: true, ledgerId: ledgerEntry?.id };",
    ],
  ),
  operation(
    522,
    ["export function buildCheckoutCacheKey(orderId: string) {", "  return `checkout:${orderId}`;", "}"],
    [
      "export function buildCheckoutCacheKey(orderId: string, channel: PaymentChannel) {",
      "  return `checkout:v${CACHE_SCHEMA_VERSION}:${channel}:${orderId}`;",
      "}",
      "",
      "function isRetryablePaymentError(error: unknown) {",
      "  return error instanceof NetworkError || error instanceof GatewayTimeoutError;",
      "}",
    ],
  ),
  operation(
    658,
    ["const timeout = 5000;"],
    [
      "const PAYMENT_TIMEOUT_MS = 8_000;",
      "const CACHE_TTL_MS = 15 * 60_000;",
      "const CACHE_SCHEMA_VERSION = 3;",
    ],
  ),
  operation(
    744,
    ["return payload;"],
    [
      "return {",
      "  ...payload,",
      "  traceId: payload.traceId ?? createTraceId(),",
      "  submittedAt: payload.submittedAt ?? new Date().toISOString(),",
      "};",
    ],
  ),
];

const orderTableOperations = [
  operation(
    36,
    ["const visibleOrders = orders.slice(page * pageSize, (page + 1) * pageSize);"],
    [
      "const visibleOrders = useMemo(",
      "  () => orders.slice(page * pageSize, (page + 1) * pageSize),",
      "  [orders, page, pageSize],",
      ");",
    ],
  ),
  operation(
    92,
    ["<TableBody>", "  {visibleOrders.map((order) => (", "    <OrderRow key={order.id} order={order} />", "  ))}", "</TableBody>"],
    [
      "<TableBody>",
      "  {visibleOrders.map((order) => (",
      "    <OrderRow",
      "      key={order.id}",
      "      order={order}",
      "      selected={selectedIds.has(order.id)}",
      "      onSelect={onToggleSelection}",
      "      onOpen={onOpenOrder}",
      "    />",
      "  ))}",
      "</TableBody>",
    ],
  ),
  operation(
    152,
    ["<TableCell>{order.amount}</TableCell>", "<TableCell>{order.status}</TableCell>"],
    [
      "<TableCell align=\"right\">{formatCurrency(order.amount, order.currency)}</TableCell>",
      "<TableCell><OrderStatusChip status={order.status} risk={order.riskScore} /></TableCell>",
    ],
  ),
  operation(
    220,
    ["function statusLabel(status: string) {", "  return status;", "}"],
    [
      "function statusLabel(status: OrderStatus) {",
      "  const labels: Record<OrderStatus, string> = {",
      "    pending: \"待支付\",",
      "    paid: \"已支付\",",
      "    refunded: \"已退款\",",
      "    reviewing: \"风控审核\",",
      "  };",
      "  return labels[status];",
      "}",
    ],
  ),
  operation(
    318,
    ["const riskColor = order.riskScore > 0.8 ? \"red\" : \"green\";"],
    [
      "const riskColor = order.riskScore >= 0.8",
      "  ? \"error.main\"",
      "  : order.riskScore >= 0.5",
      "    ? \"warning.main\"",
      "    : \"success.main\";",
    ],
  ),
  operation(
    430,
    ["<Pagination count={10} />"],
    [
      "<Pagination",
      "  count={Math.ceil(total / pageSize)}",
      "  page={page + 1}",
      "  onChange={(_, next) => onPageChange(next - 1)}",
      "  showFirstButton",
      "  showLastButton",
      "/>",
    ],
  ),
  operation(
    548,
    ["export default OrderTable;"],
    [
      "export default memo(OrderTable, (previous, next) =>",
      "  previous.orders === next.orders &&",
      "  previous.selectedIds === next.selectedIds &&",
      "  previous.page === next.page,",
      ");",
    ],
  ),
];

const storeOperations = [
  operation(
    51,
    ["const orders = ref<Order[]>([]);"],
    [
      "const orders = ref<Order[]>([]);",
      "const ordersByRisk = computed(() =>",
      "  orders.value.slice().sort((left, right) => right.riskScore - left.riskScore),",
      ");",
    ],
  ),
  operation(
    114,
    ["async function loadOrders() {", "  orders.value = await api.list();", "}"],
    [
      "async function loadOrders(signal?: AbortSignal) {",
      "  loading.value = true;",
      "  try {",
      "    const { items, total: nextTotal } = await api.list({ signal });",
      "    orders.value = items;",
      "    total.value = nextTotal;",
      "  } finally {",
      "    loading.value = false;",
      "  }",
      "}",
    ],
  ),
  operation(
    208,
    ["orders.value = orders.value.filter((order) => order.id !== id);"],
    [
      "const previous = orders.value;",
      "orders.value = orders.value.filter((order) => order.id !== id);",
      "try {",
      "  await api.archive(id);",
      "} catch (error) {",
      "  orders.value = previous;",
      "  throw error;",
      "}",
    ],
  ),
  operation(
    292,
    ["const selected = orders.value.find((order) => order.id === id);", "return selected;"],
    [
      "return computed(() => orders.value.find((order) => order.id === activeId.value));",
    ],
  ),
  operation(
    386,
    ["notify(\"订单已更新\");"],
    [
      "notify({",
      "  type: \"success\",",
      "  message: \"订单已更新\",",
      "  action: { label: \"撤销\", handler: restorePreviousOrder },",
      "});",
    ],
  ),
  operation(
    482,
    ["const cache = new Map();"],
    [
      "const cache = new Map<string, { value: Order; expiresAt: number }>();",
      "const CACHE_TTL_MS = 30_000;",
    ],
  ),
  operation(
    604,
    ["return orders.value.length;"],
    [
      "return ordersByRisk.value.filter((order) => !order.archivedAt).length;",
    ],
  ),
  operation(
    698,
    ["export function reset() {", "  orders.value = [];", "}"],
    [
      "export function reset() {",
      "  orders.value = [];",
      "  cache.clear();",
      "  selectedIds.value.clear();",
      "}",
    ],
  ),
];

const validatorOperations = [
  operation(
    28,
    ["if (!/^1\\d{10}$/.test(phone)) return false;"],
    [
      "const normalized = phone.replace(/[\\s-]/g, \"\");",
      "if (!/^1[3-9]\\d{9}$/.test(normalized)) return false;",
    ],
  ),
  operation(
    74,
    ["return amount >= 0;"],
    [
      "if (!Number.isFinite(amount)) return false;",
      "if (amount > MAX_CHECKOUT_AMOUNT) return false;",
      "return Math.round(amount * 100) === amount * 100;",
    ],
  ),
  operation(
    146,
    ["const validStatuses = [\"pending\", \"paid\"];"],
    [
      "const validStatuses = [\"pending\", \"paid\", \"refunded\", \"reviewing\"] as const;",
      "type ValidStatus = (typeof validStatuses)[number];",
    ],
  ),
  operation(
    245,
    ["return value.trim().length > 0;"],
    [
      "const cleaned = value.replace(/[\\u200B-\\u200D]/g, \"\").trim();",
      "return cleaned.length > 0 && cleaned.length <= 120;",
    ],
  ),
  operation(
    362,
    ["export const validators = { phone, amount, status };"],
    [
      "export const validators = {",
      "  phone,",
      "  amount,",
      "  status,",
      "  deliveryAddress,",
      "} as const satisfies Record<string, Validator>;",
    ],
  ),
];

const routerOperations = [
  operation(
    22,
    ["const CheckoutPage = () => import(\"../pages/CheckoutPage\");"],
    [
      "const CheckoutPage = lazy(() => import(\"../pages/CheckoutPage\"));",
      "const RefundPage = lazy(() => import(\"../pages/RefundPage\"));",
    ],
  ),
  operation(
    58,
    ["{ path: \"/checkout\", component: CheckoutPage },"],
    [
      "{",
      "  path: \"/checkout\",",
      "  component: CheckoutPage,",
      "  meta: { requiresAuth: true, featureFlag: \"checkout-v3\" },",
      "},",
      "{ path: \"/refund/:orderId\", component: RefundPage, meta: { requiresAuth: true } },",
    ],
  ),
  operation(
    114,
    ["router.beforeEach((to) => Boolean(to.meta.auth));"],
    [
      "router.beforeEach(async (to) => {",
      "  if (!to.meta.requiresAuth) return true;",
      "  const session = await authStore.ensureSession();",
      "  return session ? true : { path: \"/login\", query: { redirect: to.fullPath } };",
      "});",
    ],
  ),
  operation(
    168,
    ["export default router;"],
    [
      "router.onError((error) => {",
      "  telemetry.captureException(error, { route: router.currentRoute.value.fullPath });",
      "});",
      "",
      "export default router;",
    ],
  ),
];

const readmeOperations = [
  operation(
    18,
    ["- 支持创建订单"],
    ["- 支持创建订单、支付失败重试和退款状态追踪", "- 结算结果会按渠道与版本缓存 15 分钟"],
  ),
  operation(
    52,
    ["## 测试", "运行 npm test。"],
    [
      "## 测试",
      "",
      "运行 `corepack pnpm test`。支付回调相关改动同时运行：",
      "",
      "```bash",
      "corepack pnpm test -- payment-refund",
      "```",
      "",
      "## 回滚",
      "",
      "关闭 `checkout-v3` 功能开关，并恢复到上一版本镜像。",
    ],
  ),
  operation(112, ["- 待补充"], ["- 已完成缓存命中率观测", "- 已完成退款账本一致性校验"]),
];

export const mockDiffFiles: DiffFile[] = [
  buildFile({
    id: "payment-service",
    path: "src/services/payment.ts",
    language: "typescript",
    status: "modified",
    totalLines: 840,
    description: "结算缓存、支付重试与退款一致性调整",
    operations: paymentOperations,
  }),
  buildFile({
    id: "order-table",
    path: "src/components/OrderTable.tsx",
    language: "typescript",
    status: "modified",
    totalLines: 640,
    description: "订单表格选择、分页与金额格式优化",
    operations: orderTableOperations,
  }),
  buildFile({
    id: "order-store",
    path: "src/stores/orderStore.ts",
    language: "typescript",
    status: "modified",
    totalLines: 760,
    description: "订单状态、缓存和撤销操作调整",
    operations: storeOperations,
  }),
  buildFile({
    id: "validators",
    path: "src/utils/validators.ts",
    language: "typescript",
    status: "modified",
    totalLines: 420,
    description: "金额和手机号校验规则收紧",
    operations: validatorOperations,
  }),
  buildFile({
    id: "router",
    path: "src/router/index.ts",
    language: "typescript",
    status: "modified",
    totalLines: 220,
    description: "结算与退款路由懒加载、鉴权守卫",
    operations: routerOperations,
  }),
  buildFile({
    id: "readme",
    path: "docs/checkout-runbook.md",
    oldPath: "docs/checkout.md",
    language: "markdown",
    status: "renamed",
    totalLines: 150,
    description: "发布与回滚说明更新",
    operations: readmeOperations,
  }),
];
