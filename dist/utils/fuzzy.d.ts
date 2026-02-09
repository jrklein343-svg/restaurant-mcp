/**
 * Fuzzy string matching utilities using Levenshtein distance and token matching
 */
/**
 * Calculate Levenshtein distance between two strings
 */
export declare function levenshteinDistance(a: string, b: string): number;
/**
 * Tokenize a string for comparison
 * Removes common words and normalizes
 */
export declare function tokenize(str: string): string[];
/**
 * Calculate Jaccard similarity between two token sets
 */
export declare function jaccardSimilarity(tokens1: string[], tokens2: string[]): number;
/**
 * Check if one string contains another (as tokens)
 */
export declare function containsTokens(haystack: string[], needle: string[]): boolean;
export interface FuzzyMatchResult {
    score: number;
    matchType: 'exact' | 'case-insensitive' | 'token-reorder' | 'fuzzy' | 'contains' | 'no-match';
    distance?: number;
}
/**
 * Perform fuzzy matching between query and target strings
 * Returns a score from 0-1 (1 being perfect match)
 */
export declare function fuzzyMatch(query: string, target: string): FuzzyMatchResult;
/**
 * Find best matches from a list of targets
 */
export declare function findBestMatches(query: string, targets: string[], options?: {
    minScore?: number;
    limit?: number;
}): Array<{
    target: string;
    index: number;
    result: FuzzyMatchResult;
}>;
/**
 * Check if two restaurant names likely refer to the same restaurant
 */
export declare function isSameRestaurant(name1: string, name2: string, location1?: string, location2?: string): boolean;
