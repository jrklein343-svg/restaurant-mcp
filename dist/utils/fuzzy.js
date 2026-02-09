/**
 * Fuzzy string matching utilities using Levenshtein distance and token matching
 */
/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a, b) {
    if (a.length === 0)
        return b.length;
    if (b.length === 0)
        return a.length;
    const matrix = [];
    // Initialize first row and column
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            }
            else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // substitution
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j] + 1 // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}
/**
 * Tokenize a string for comparison
 * Removes common words and normalizes
 */
export function tokenize(str) {
    const stopWords = new Set(['the', 'a', 'an', 'and', '&', 'of', 'at', 'by']);
    return str
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remove punctuation
        .split(/\s+/)
        .filter(token => token.length > 0 && !stopWords.has(token))
        .sort();
}
/**
 * Calculate Jaccard similarity between two token sets
 */
export function jaccardSimilarity(tokens1, tokens2) {
    if (tokens1.length === 0 && tokens2.length === 0)
        return 1;
    if (tokens1.length === 0 || tokens2.length === 0)
        return 0;
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    let intersection = 0;
    for (const token of set1) {
        if (set2.has(token))
            intersection++;
    }
    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
}
/**
 * Check if one string contains another (as tokens)
 */
export function containsTokens(haystack, needle) {
    if (needle.length === 0)
        return true;
    const haystackSet = new Set(haystack);
    return needle.every(token => haystackSet.has(token));
}
/**
 * Perform fuzzy matching between query and target strings
 * Returns a score from 0-1 (1 being perfect match)
 */
export function fuzzyMatch(query, target) {
    // Normalize for comparison
    const queryNorm = query.trim();
    const targetNorm = target.trim();
    // 1. Exact match
    if (queryNorm === targetNorm) {
        return { score: 1.0, matchType: 'exact' };
    }
    const queryLower = queryNorm.toLowerCase();
    const targetLower = targetNorm.toLowerCase();
    // 2. Case-insensitive exact match
    if (queryLower === targetLower) {
        return { score: 0.95, matchType: 'case-insensitive' };
    }
    // 3. Token-based comparison (handles reordering like "The Grill" vs "Grill, The")
    const queryTokens = tokenize(queryNorm);
    const targetTokens = tokenize(targetNorm);
    const tokenSimilarity = jaccardSimilarity(queryTokens, targetTokens);
    if (tokenSimilarity === 1) {
        return { score: 0.9, matchType: 'token-reorder' };
    }
    // 4. Levenshtein distance for typo tolerance
    const distance = levenshteinDistance(queryLower, targetLower);
    const maxLen = Math.max(queryLower.length, targetLower.length);
    // Allow up to 2 character errors for short strings, more for longer ones
    const maxDistance = Math.max(2, Math.floor(maxLen * 0.2));
    if (distance <= maxDistance) {
        // Score decreases with distance
        const score = 0.85 - (distance * 0.05);
        return {
            score: Math.max(0.7, score),
            matchType: 'fuzzy',
            distance,
        };
    }
    // 5. Contains match (query is contained in target or vice versa)
    if (targetLower.includes(queryLower)) {
        // Score based on how much of target the query covers
        const coverage = queryLower.length / targetLower.length;
        return {
            score: 0.5 + (coverage * 0.2),
            matchType: 'contains',
        };
    }
    if (queryLower.includes(targetLower)) {
        const coverage = targetLower.length / queryLower.length;
        return {
            score: 0.4 + (coverage * 0.2),
            matchType: 'contains',
        };
    }
    // 6. Token contains (all query tokens found in target)
    if (queryTokens.length > 0 && containsTokens(targetTokens, queryTokens)) {
        return {
            score: 0.6,
            matchType: 'contains',
        };
    }
    // 7. Partial token match
    if (tokenSimilarity > 0.5) {
        return {
            score: tokenSimilarity * 0.6,
            matchType: 'fuzzy',
        };
    }
    // No significant match
    return { score: 0, matchType: 'no-match' };
}
/**
 * Find best matches from a list of targets
 */
export function findBestMatches(query, targets, options) {
    const minScore = options?.minScore ?? 0.3;
    const limit = options?.limit ?? 10;
    const matches = targets
        .map((target, index) => ({
        target,
        index,
        result: fuzzyMatch(query, target),
    }))
        .filter(m => m.result.score >= minScore)
        .sort((a, b) => b.result.score - a.result.score)
        .slice(0, limit);
    return matches;
}
/**
 * Check if two restaurant names likely refer to the same restaurant
 */
export function isSameRestaurant(name1, name2, location1, location2) {
    const nameMatch = fuzzyMatch(name1, name2);
    // Strong name match
    if (nameMatch.score >= 0.85) {
        return true;
    }
    // Moderate name match with location match
    if (nameMatch.score >= 0.6 && location1 && location2) {
        const locationMatch = fuzzyMatch(location1, location2);
        if (locationMatch.score >= 0.7) {
            return true;
        }
    }
    return false;
}
