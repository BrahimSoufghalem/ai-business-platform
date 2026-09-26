/** API DTOs — mirror apps/api service views. Do not rename fields; they are the backend contract. */

export type MembershipRole = 'owner' | 'manager' | 'agent';

export interface TenantSummary {
  id: string;
  name: string;
  role: MembershipRole;
  status: string;
  membershipCreatedAt: string;
}

export interface AuditEventSummary {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
}

export type ProductLifecycleStatus = 'draft' | 'active' | 'archived';

export interface VariantView {
  id: string;
  sku: string;
  name: string | null;
  attributes: Record<string, unknown>;
  priceOverride: string | null;
  status: 'active' | 'archived';
}

export interface MediaView {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number | null;
  altText: string | null;
  sortOrder: number;
  status: 'pending' | 'ready' | 'failed';
}

export interface ProductView {
  id: string;
  productTypeId: string;
  code: string;
  name: string;
  description: string | null;
  basePrice: string;
  currency: string;
  status: ProductLifecycleStatus;
  customAttributes: Record<string, unknown>;
  productTypeSchemaVersion: number;
  version: number;
  variants: VariantView[];
  media: MediaView[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AttributeDataType = 'text' | 'number' | 'boolean' | 'select' | 'multi_select';

export interface AttributeDefinition {
  key: string;
  label: string;
  dataType: AttributeDataType;
  required: boolean;
  searchable: boolean;
  variantAxis: boolean;
  options: string[];
  position: number;
}

export interface ProductTypeView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  templateKey: string | null;
  schemaVersion: number;
  status: 'active' | 'archived';
  attributes: AttributeDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductTypeTemplateView {
  key: string;
  name: string;
  attributes: Omit<AttributeDefinition, 'position'>[];
}

export interface InventoryLocationView {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface InventoryBalanceView {
  locationId: string;
  locationCode: string;
  locationName: string;
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productCode: string;
  productName: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  lowStock: boolean;
  updatedAt: string;
}

export type InventoryMovementType =
  'receive' | 'adjust' | 'reserve' | 'release' | 'sell' | 'return';

export interface InventoryMovementView {
  id: string;
  locationId: string;
  variantId: string;
  reservationId: string | null;
  type: InventoryMovementType;
  quantity: number;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  actorId: string;
  correlationId: string;
  createdAt: string;
}

export interface StockReservationView {
  id: string;
  locationId: string;
  variantId: string;
  sku: string;
  quantity: number;
  status: 'active' | 'released' | 'committed' | 'expired';
  referenceType: string;
  referenceId: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DraftOrderStatus = 'draft' | 'submitted' | 'confirmed' | 'cancelled' | 'expired';
export type OrderStatus = 'new' | 'confirmed' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderItemView {
  id: string;
  productId: string;
  variantId: string;
  locationId: string;
  reservationId: string;
  productName: string;
  productCode: string;
  variantName: string | null;
  sku: string;
  variantAttributes: Record<string, unknown>;
  quantity: number;
  listPrice: string;
  unitPrice: string;
  lineTotal: string;
  currency: string;
  pricingDecisionId: string | null;
}

export interface OrderTransitionView {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorId: string;
  reason: string | null;
  createdAt: string;
}

export interface OrderView {
  id: string;
  sourceDraftOrderId: string;
  customerId: string | null;
  number: string;
  status: OrderStatus;
  version: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  shippingAddress: Record<string, unknown>;
  notes: string | null;
  customFields: Record<string, unknown>;
  currency: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  total: string;
  items: OrderItemView[];
  transitions: OrderTransitionView[];
  confirmedAt: string | null;
  preparingAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CustomerContactType = 'phone' | 'email' | 'instagram' | 'whatsapp' | 'messenger';

export interface CustomerContactView {
  id: string;
  type: CustomerContactType;
  maskedValue: string;
  label: string | null;
  isPrimary: boolean;
}

export interface CustomerAddressView {
  id: string;
  label: string | null;
  recipientName: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  isDefault: boolean;
}

export interface CustomerSummaryView {
  id: string;
  name: string;
  status: 'active' | 'archived';
  version: number;
  contacts: CustomerContactView[];
  conversationCount: number;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerView extends CustomerSummaryView {
  metadata: Record<string, unknown>;
  addresses: CustomerAddressView[];
  notes: { id: string; body: string; authorId: string; createdAt: string }[];
  conversations: {
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    lastMessageAt: string | null;
    createdAt: string;
  }[];
  orders: {
    id: string;
    number: string;
    status: string;
    total: string;
    currency: string;
    createdAt: string;
  }[];
}

export type ConversationStatus = 'bot' | 'needs_human' | 'human' | 'closed';
export type ConversationChannel = 'internal' | 'instagram' | 'whatsapp' | 'web' | 'email';
export type HandoffReason =
  | 'explicit_customer_request'
  | 'low_confidence'
  | 'safety_risk'
  | 'tool_failure'
  | 'pricing_policy'
  | 'order_exception'
  | 'unsupported_request'
  | 'manual';

export interface Handoff {
  id: string;
  reason: HandoffReason;
  status: 'pending' | 'active' | 'resolved';
  summary: {
    intent: string;
    customerRequest: string;
    product: { id: string; name: string } | null;
    collectedData: {
      draftOrderId: string | null;
      draftStatus: string | null;
      hasCustomerPhone: boolean;
      hasShippingAddress: boolean;
      itemCount: number;
      orderId: string | null;
      orderNumber: string | null;
    };
  };
  currentWaitSeconds: number;
  firstResponseSeconds: number | null;
  resolutionSeconds: number | null;
}

export interface HandoffMetrics {
  pending: number;
  active: number;
  resolved: number;
  averageFirstResponseSeconds: number | null;
  averageResolutionSeconds: number | null;
}

export interface ConversationSummary {
  id: string;
  customer: { id: string; name: string; contactHint: string | null };
  channel: string;
  status: ConversationStatus;
  assignedToUserId: string | null;
  assignedToMe: boolean;
  activeHandoff: Handoff | null;
  subject: string | null;
  version: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

export interface Message {
  id: string;
  direction: 'inbound' | 'outbound' | 'internal';
  senderType: 'customer' | 'agent' | 'bot' | 'system';
  content: string;
  createdAt: string;
}

export interface Conversation extends ConversationSummary {
  productId: string | null;
  draftOrderId: string | null;
  orderId: string | null;
  messages: Message[];
  handoffs: Handoff[];
}

export interface InstagramConnectionView {
  id: string;
  accountId: string;
  accountIdSuffix: string;
  tokenFingerprint: string;
  status: 'active' | 'disabled' | 'reauthorization_required';
  connectedAt: string;
  lastValidatedAt: string | null;
  updatedAt: string;
}

export type AgentLanguage = 'ar' | 'fr' | 'en';
export type AgentTone = 'professional' | 'friendly' | 'concise' | 'warm';

export interface AgentSettingsVersionView {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  language: AgentLanguage;
  tone: AgentTone;
  handoffNotes: string;
  changeNote: string | null;
  createdBy: string;
  publishedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface AgentSettingsHistoryView {
  latestVersion: number;
  draft: AgentSettingsVersionView | null;
  published: AgentSettingsVersionView | null;
  history: AgentSettingsVersionView[];
}

export interface PricingPolicy {
  currency: string;
  negotiable: boolean;
  minimumPrice:
    { type: 'fixed'; amount: string } | { type: 'percentage_of_list'; percentage: number };
  maxDiscountPercent: number;
  escalation: {
    belowMinimum: 'counter' | 'handoff' | 'reject';
    whenNotNegotiable: 'handoff' | 'reject';
    maxCounterOffers: number;
  };
}

export interface BusinessRuleVersionView {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  policy: PricingPolicy;
  changeNote: string | null;
  createdBy: string;
  publishedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface BusinessRuleSetView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  draft: BusinessRuleVersionView | null;
  published: BusinessRuleVersionView | null;
  history: BusinessRuleVersionView[];
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeKind = 'faq' | 'article' | 'policy';

export interface KnowledgeVersionView {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  title: string;
  question: string | null;
  content: string;
  changeNote: string | null;
  createdBy: string;
  publishedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface KnowledgeEntryView {
  id: string;
  slug: string;
  kind: KnowledgeKind;
  version: number;
  draft: KnowledgeVersionView | null;
  published: KnowledgeVersionView | null;
  history: KnowledgeVersionView[];
  createdAt: string;
  updatedAt: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface OperationsAlert {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  data?: Record<string, string | number | null>;
  entityId: string;
  correlationId: string | null;
  occurredAt: string;
}

export interface OperationsDashboard {
  range: string;
  generatedAt: string;
  timezone: string;
  orders: {
    total: number;
    active: number;
    delivered: number;
    cancelled: number;
    byStatus: { status: string; count: number }[];
  };
  salesByCurrency: { currency: string; amount: string; orderCount: number }[];
  stock: { alertCount: number; outOfStockCount: number };
  handoffs: HandoffMetrics;
  ai: {
    runCount: number;
    handoffCount: number;
    handoffRate: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    estimatedCostUsd: string;
    failedToolCalls: number;
  };
  daily: { date: string; orders: number; handoffs: number; aiRuns: number }[];
  alerts: OperationsAlert[];
}
