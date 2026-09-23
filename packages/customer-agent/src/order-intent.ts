import type { CustomerShippingAddress } from './contracts.js';

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/gu, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function normalized(value: string): string {
  return normalizeDigits(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/\s+/gu, ' ')
    .trim();
}

const confirmationPatterns: readonly RegExp[] = [
  /^(?:نعم\s+)?(?:اكد|اؤكد|اوافق)\s+(?:على\s+)?الطلب[.!؟\s]*$/u,
  /^(?:نعم\s+)?موافق\s+على\s+(?:تاكيد\s+)?الطلب[.!؟\s]*$/u,
  /^(?:je\s+)?confirme\s+(?:la\s+)?commande[.!\s]*$/iu,
  /^(?:yes[,\s]+)?confirm\s+(?:the\s+)?order[.!\s]*$/iu,
];

const cancellationPatterns: readonly RegExp[] = [
  /(?:الغي|الغاء|الغيلي)\s+الطلب/u,
  /غيرت\s+رايي/u,
  /annul(?:er|e|ez)\s+(?:la\s+)?commande/iu,
  /cancel\s+(?:the\s+)?order/iu,
];

const purchasePatterns: readonly RegExp[] = [
  /(?:اريد|نحب|حاب)\s+(?:ان\s+)?(?:اشتري|شراء|نشري|نطلب)/u,
  /(?:اطلب|اشتري)\s+(?:هذا|هذه|المنتج)?/u,
  /(?:je\s+veux|j['’ ]aimerais)\s+(?:acheter|commander)/iu,
  /(?:i\s+want|i['’ ]d\s+like)\s+to\s+(?:buy|order)/iu,
];

const changePatterns: readonly RegExp[] = [
  /(?:غير|بدل|عدل)\s+(?:لي\s+)?(?:الكميه|العدد|المقاس|اللون|الطلب)/u,
  /(?:اريد|نحب)\s+\d{1,3}\s+(?:حبات|قطع|وحدات)?/u,
  /(?:رقم\s+الهاتف|الهاتف|العنوان|عنواني|المدينه|البلديه|الولايه)\s*[:=]/u,
  /(?:modifier|changer)\s+(?:la\s+)?(?:quantit[eé]|commande|taille|couleur)/iu,
  /(?:t[eé]l[eé]phone|adresse|ville)\s*[:=]/iu,
  /change\s+(?:the\s+)?(?:quantity|order|size|color)/iu,
  /(?:phone|address|city)\s*[:=]/iu,
];

export function isExplicitOrderConfirmation(value: string): boolean {
  const safe = normalized(value);
  return confirmationPatterns.some((pattern) => pattern.test(safe));
}

export function isOrderCancellation(value: string): boolean {
  const safe = normalized(value);
  return cancellationPatterns.some((pattern) => pattern.test(safe));
}

export function isOrderPurchaseRequest(value: string): boolean {
  const safe = normalized(value);
  return purchasePatterns.some((pattern) => pattern.test(safe));
}

export function isOrderChangeRequest(value: string): boolean {
  const safe = normalized(value);
  return changePatterns.some((pattern) => pattern.test(safe));
}

export function extractRequestedQuantity(value: string): number | null {
  const safe = normalizeDigits(value);
  const match =
    safe.match(/(?:عدد|كميه|كمية|quantity|qty|x)\s*[:x-]?\s*(\d{1,3})/iu) ??
    safe.match(/(\d{1,3})\s*(?:حبات|حبه|حبة|قطع|قطعه|قطعة|وحدات|وحده|وحدة|pcs?|pieces?|items?)/iu);
  if (!match?.[1]) return null;
  const amount = Number(match[1]);
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= 100 ? amount : null;
}

export function requestsVariantChange(value: string): boolean {
  return /(?:المقاس|اللون|الحجم|taille|couleur|size|color|variant)/iu.test(normalized(value));
}

export function extractRequestedPrice(value: string): string | null {
  const safe = normalizeDigits(value).replace(/\s+/gu, ' ');
  const currencyMatch = safe.match(
    /(\d{1,12}(?:[.,]\d{1,2})?)\s*(?:دج|دينار|DZD|DA|EUR|USD|€|\$)/iu,
  );
  const negotiationMatch = safe.match(
    /(?:ب|بسعر|نخلص|ندفع|اقبل|اوافق\s+على|offre|offer|accept(?:e|er)?|at)\s*[:=]?\s*(\d{1,12}(?:[.,]\d{1,2})?)/iu,
  );
  const raw = currencyMatch?.[1] ?? negotiationMatch?.[1];
  if (!raw) return null;
  const normalizedAmount = raw.replace(',', '.');
  return /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u.test(normalizedAmount) ? normalizedAmount : null;
}

export function extractCustomerPhone(value: string): string | null {
  const match = normalizeDigits(value).match(/(?:\+?\d[\d -]{6,19}\d)/u);
  if (!match) return null;
  const phone = match[0].replace(/[ -]/gu, '');
  const digits = phone.replace(/\D/gu, '');
  return digits.length >= 8 && digits.length <= 15 ? phone : null;
}

export function isAmbiguousOrderAffirmation(value: string): boolean {
  return /^(?:نعم|موافق|تمام|oui|d['’ ]accord|yes|ok|okay)[.!؟\s]*$/iu.test(normalized(value));
}

function capture(value: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const captured = match?.[1]?.trim();
    if (captured) return captured;
  }
  return null;
}

export function extractShippingAddress(value: string): CustomerShippingAddress | null {
  const line1 = capture(value, [
    /(?:العنوان|عنواني)\s*[:=]\s*([^،,\n]{2,180})/iu,
    /(?:adresse|address)\s*[:=]\s*([^,\n]{2,180})/iu,
  ]);
  const city = capture(value, [
    /(?:المدينه|المدينة|البلديه|البلدية|الولايه|الولاية)\s*[:=]\s*([^،,\n]{2,100})/iu,
    /(?:ville|city)\s*[:=]\s*([^,\n]{2,100})/iu,
  ]);
  if (!line1 || !city) return null;
  return {
    line1,
    line2: null,
    city,
    region: null,
    postalCode: null,
    countryCode: 'DZ',
  };
}
