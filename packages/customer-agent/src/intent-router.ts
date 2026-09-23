import type { AiIntent } from '@ai-business/ai-gateway';
import type { CustomerAgentIntentDecision } from './contracts.js';
import {
  extractRequestedQuantity,
  extractRequestedPrice,
  isExplicitOrderConfirmation,
  isOrderCancellation,
  isOrderChangeRequest,
  isOrderPurchaseRequest,
} from './order-intent.js';
import { assessCustomerInput } from './safety.js';

const arabicDiacritics = /[\u064B-\u065F\u0670]/gu;
const punctuation = /[^\p{L}\p{N}\s_-]+/gu;

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(arabicDiacritics, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .toLocaleLowerCase('ar')
    .replace(punctuation, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasAny(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(normalize(phrase)));
}

const greetingPhrases = [
  'السلام عليكم',
  'سلام',
  'مرحبا',
  'اهلا',
  'صباح الخير',
  'مساء الخير',
  'bonjour',
  'bonsoir',
  'salut',
  'hello',
  'hi',
] as const;

const handoffPhrases = [
  'اريد موظف',
  'التحدث مع موظف',
  'نحب موظف',
  'كلمني مع موظف',
  'انسان حقيقي',
  'خدمة الزبائن',
  'conseiller',
  'service client',
  'human agent',
  'real person',
] as const;

const pricePhrases = [
  'سعر',
  'الثمن',
  'ثمن',
  'بكم',
  'شحال',
  'قداه',
  'prix',
  'combien',
  'price',
  'cost',
] as const;

const availabilityPhrases = [
  'متوفر',
  'متاح',
  'موجود',
  'كاين',
  'المخزون',
  'مخزون',
  'disponible',
  'disponibilite',
  'stock',
  'available',
] as const;

const faqPhrases = [
  'الشحن',
  'التوصيل',
  'الارجاع',
  'الاسترجاع',
  'الضمان',
  'الدفع',
  'اوقات العمل',
  'livraison',
  'retour',
  'remboursement',
  'garantie',
  'paiement',
  'shipping',
  'delivery',
  'return policy',
  'refund',
  'warranty',
  'payment',
] as const;

const comparisonPhrases = [
  'قارن',
  'الفرق بين',
  'افضل',
  'احسن',
  'compare',
  'difference',
  'différence',
  'meilleur',
  'better',
] as const;

const negotiationPhrases = [
  'خصم',
  'تخفيض',
  'ارخص',
  'نقصلي',
  'آخر سعر',
  'remise',
  'reduction',
  'moins cher',
  'discount',
  'cheaper',
] as const;

const queryStopWords = new Set(
  [
    ...pricePhrases,
    ...availabilityPhrases,
    'اريد',
    'نحب',
    'حاب',
    'اشتري',
    'شراء',
    'نشري',
    'نطلب',
    'اطلب',
    'acheter',
    'commander',
    'buy',
    'order',
    'هل',
    'هو',
    'هي',
    'هذا',
    'هذه',
    'عندكم',
    'عندك',
    'من فضلك',
    'لو سمحت',
    'svp',
    'please',
    'est ce que',
    'what is',
    'the',
  ].flatMap((phrase) => normalize(phrase).split(' ')),
);

function extractQuery(value: string): string {
  const tokens = normalize(value)
    .split(' ')
    .filter((token) => token.length > 1 && !queryStopWords.has(token) && !/^\d+$/u.test(token));
  return tokens.join(' ').slice(0, 200);
}

function requestedQuantity(value: string): number {
  return extractRequestedQuantity(value) ?? 1;
}

function decision(
  intent: AiIntent,
  route: CustomerAgentIntentDecision['route'],
  reason: CustomerAgentIntentDecision['reason'],
  message: string,
): CustomerAgentIntentDecision {
  return {
    intent,
    route,
    reason,
    query: extractQuery(message),
    requestedQuantity: requestedQuantity(message),
  };
}

export function routeCustomerIntent(message: string): CustomerAgentIntentDecision {
  const normalized = normalize(message);
  if (!assessCustomerInput(message).safe) {
    return decision('handoff', 'handoff', 'unsafe_input', message);
  }
  if (hasAny(normalized, handoffPhrases)) {
    return decision('handoff', 'handoff', 'explicit_handoff', message);
  }
  if (isExplicitOrderConfirmation(message)) {
    return decision('order_confirmation', 'direct_query', 'order_confirm', message);
  }
  if (isOrderCancellation(message)) {
    return decision('order_draft', 'direct_query', 'order_cancel', message);
  }
  if (isOrderPurchaseRequest(message) || extractRequestedPrice(message) !== null) {
    return decision('order_draft', 'direct_query', 'order_create', message);
  }
  if (isOrderChangeRequest(message)) {
    return decision('order_draft', 'direct_query', 'order_update', message);
  }
  if (normalized.length <= 40 && hasAny(normalized, greetingPhrases)) {
    return decision('faq', 'static', 'greeting', message);
  }
  if (hasAny(normalized, negotiationPhrases)) {
    return decision('pricing', 'strong_model', 'complex_negotiation', message);
  }
  if (hasAny(normalized, comparisonPhrases)) {
    return decision('product_discovery', 'strong_model', 'complex_comparison', message);
  }
  if (hasAny(normalized, pricePhrases)) {
    return decision('pricing', 'direct_query', 'direct_price', message);
  }
  if (hasAny(normalized, availabilityPhrases)) {
    return decision('product_discovery', 'direct_query', 'direct_availability', message);
  }
  if (hasAny(normalized, faqPhrases)) {
    return decision('faq', 'direct_query', 'direct_faq', message);
  }
  return decision('product_discovery', 'fast_model', 'product_discovery', message);
}
