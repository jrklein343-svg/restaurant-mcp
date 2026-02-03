/**
 * Name and address normalization utilities for cross-platform matching
 */

// Common abbreviations and their expansions
const ABBREVIATIONS: Record<string, string> = {
  'st': 'street',
  'ave': 'avenue',
  'blvd': 'boulevard',
  'rd': 'road',
  'dr': 'drive',
  'ln': 'lane',
  'ct': 'court',
  'pl': 'place',
  'sq': 'square',
  'pkwy': 'parkway',
  'hwy': 'highway',
  'apt': 'apartment',
  'ste': 'suite',
  'fl': 'floor',
  'n': 'north',
  's': 'south',
  'e': 'east',
  'w': 'west',
  'ne': 'northeast',
  'nw': 'northwest',
  'se': 'southeast',
  'sw': 'southwest',
  'nyc': 'new york city',
  'la': 'los angeles',
  'sf': 'san francisco',
  'dc': 'washington dc',
};

// Common restaurant name prefixes/suffixes to normalize
const NAME_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Remove common suffixes
  { pattern: /\s+(restaurant|ristorante|bistro|cafe|café|bar|grill|kitchen|house|room)$/i, replacement: '' },
  // Normalize "and" variations
  { pattern: /\s+(&|and)\s+/gi, replacement: ' & ' },
  // Remove possessive
  { pattern: /'s\b/gi, replacement: '' },
  // Normalize "the" at start
  { pattern: /^the\s+/i, replacement: '' },
];

/**
 * Normalize a restaurant name for matching
 */
export function normalizeName(name: string): string {
  let normalized = name.trim().toLowerCase();

  // Apply name patterns
  for (const { pattern, replacement } of NAME_PATTERNS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Remove accents
  normalized = removeAccents(normalized);

  return normalized;
}

/**
 * Normalize an address for matching
 */
export function normalizeAddress(address: string): string {
  let normalized = address.trim().toLowerCase();

  // Expand abbreviations
  const words = normalized.split(/\s+/);
  const expandedWords = words.map(word => {
    // Remove trailing periods
    const clean = word.replace(/\.$/, '');
    return ABBREVIATIONS[clean] || clean;
  });
  normalized = expandedWords.join(' ');

  // Remove apartment/suite numbers (they vary too much)
  normalized = normalized.replace(/\s+(apt|suite|ste|unit|#)\s*\w+/gi, '');

  // Remove zip codes
  normalized = normalized.replace(/\s+\d{5}(-\d{4})?$/, '');

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Remove accents
  normalized = removeAccents(normalized);

  return normalized;
}

/**
 * Normalize a city/neighborhood name
 */
export function normalizeLocation(location: string): string {
  let normalized = location.trim().toLowerCase();

  // Expand common city abbreviations
  const words = normalized.split(/[\s,]+/);
  const expandedWords = words.map(word => ABBREVIATIONS[word] || word);
  normalized = expandedWords.join(' ');

  // Remove state abbreviations at end
  normalized = normalized.replace(/,?\s+[a-z]{2}$/i, '');

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Remove accents
  normalized = removeAccents(normalized);

  return normalized;
}

/**
 * Remove accents/diacritics from a string
 */
export function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extract the core name from a restaurant name
 * E.g., "Carbone NYC" -> "carbone"
 */
export function extractCoreName(name: string): string {
  let core = normalizeName(name);

  // Remove location suffixes (NYC, Downtown, etc.)
  const locationSuffixes = /\s+(nyc|downtown|uptown|midtown|brooklyn|manhattan|chicago|la|sf|miami|boston|philly|dc|atl|houston|dallas|austin|seattle|portland|denver)$/i;
  core = core.replace(locationSuffixes, '');

  // Remove numbers at end (like "2.0" or "II")
  core = core.replace(/\s+(\d+(\.\d+)?|i{1,3}|iv|v|vi{0,3})$/i, '');

  return core.trim();
}

/**
 * Parse a full address into components
 */
export interface AddressComponents {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  neighborhood?: string;
}

export function parseAddress(fullAddress: string): AddressComponents {
  const components: AddressComponents = {};

  // Try to extract zip code
  const zipMatch = fullAddress.match(/\b(\d{5})(-\d{4})?\b/);
  if (zipMatch) {
    components.zip = zipMatch[1];
  }

  // Try to extract state (2-letter abbreviation)
  const stateMatch = fullAddress.match(/,\s*([A-Z]{2})\s*(\d{5})?$/i);
  if (stateMatch) {
    components.state = stateMatch[1].toUpperCase();
  }

  // Split by commas
  const parts = fullAddress.split(',').map(p => p.trim());

  if (parts.length >= 1) {
    components.street = parts[0];
  }

  if (parts.length >= 2) {
    // Could be city or neighborhood
    components.city = parts[1].replace(/\s+[A-Z]{2}\s*\d{5}.*$/, '').trim();
  }

  if (parts.length >= 3) {
    // First part after street might be neighborhood
    components.neighborhood = parts[1];
    components.city = parts[2].replace(/\s+[A-Z]{2}\s*\d{5}.*$/, '').trim();
  }

  return components;
}

/**
 * Create a normalized key for deduplication
 */
export function createDedupeKey(name: string, city: string): string {
  const normName = extractCoreName(name);
  const normCity = normalizeLocation(city);

  return `${normName}|${normCity}`;
}

/**
 * Normalize cuisine type
 */
export function normalizeCuisine(cuisine: string): string {
  return cuisine
    .toLowerCase()
    .trim()
    .replace(/\s+cuisine$/i, '')
    .replace(/\s+food$/i, '')
    .replace(/\s+/g, '-');
}

/**
 * Parse comma-separated cuisines into array
 */
export function parseCuisines(cuisineString: string): string[] {
  if (!cuisineString) return [];

  return cuisineString
    .split(/[,/]/)
    .map(c => normalizeCuisine(c))
    .filter(c => c.length > 0);
}
