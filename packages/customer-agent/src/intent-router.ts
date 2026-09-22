import type { AiIntent } from '@ai-business/ai-gateway';
import type { CustomerAgentIntentDecision } from './contracts.js';
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
  const normalizedDigits = value.replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const match = normalizedDigits.match(/(?:عدد|كميه|quantity|qty|x)\s*[:x-]?\s*(\d{1,3})/iu);
  if (!match?.[1]) return 1;
  const amount = Number(match[1]);
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= 100 ? amount : 1;
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
