/**
 * Diagnostic Resy client with verbose logging, retries, and multiple search strategies
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from './logger.js';

const COMPONENT = 'ResyDiagnostic';
const BASE_URL = 'https://api.resy.com';
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

// Known venue IDs for testing
export const KNOWN_VENUES: Record<string, { id: number; city: string; name: string }> = {
  'carbone-ny': { id: 1505, city: 'New York', name: 'Carbone' },
  'don-angie-ny': { id: 5765, city: 'New York', name: 'Don Angie' },
  'via-carota-ny': { id: 2567, city: 'New York', name: 'Via Carota' },
  '4-charles-ny': { id: 25973, city: 'New York', name: '4 Charles Prime Rib' },
  'le-coucou-ny': { id: 3013, city: 'New York', name: 'Le Coucou' },
  'lilia-ny': { id: 4824, city: 'New York', name: 'Lilia' },
  'atomix-ny': { id: 6601, city: 'New York', name: 'Atomix' },
  'juliet-culver': { id: 58174, city: 'Culver City', name: 'Juliet' },
  'margot-culver': { id: 81815, city: 'Culver City', name: 'Margot' },
  'bestia-la': { id: 468, city: 'Los Angeles', name: 'Bestia' },
  'republique-la': { id: 1172, city: 'Los Angeles', name: 'République' },
};

// City coordinates for geolocation search
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  'new york': { lat: 40.7128, lng: -74.0060 },
  'ny': { lat: 40.7128, lng: -74.0060 },
  'nyc': { lat: 40.7128, lng: -74.0060 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  'la': { lat: 34.0522, lng: -118.2437 },
  'culver city': { lat: 34.0211, lng: -118.3965 },
  'santa monica': { lat: 34.0195, lng: -118.4912 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'sf': { lat: 37.7749, lng: -122.4194 },
  'chicago': { lat: 41.8781, lng: -87.6298 },
  'miami': { lat: 25.7617, lng: -80.1918 },
  'austin': { lat: 30.2672, lng: -97.7431 },
  'seattle': { lat: 47.6062, lng: -122.3321 },
  'boston': { lat: 42.3601, lng: -71.0589 },
  'denver': { lat: 39.7392, lng: -104.9903 },
  'washington': { lat: 38.9072, lng: -77.0369 },
  'dc': { lat: 38.9072, lng: -77.0369 },
};

export interface SearchResult {
  id: number;
  name: string;
  location: string;
  neighborhood: string;
  cuisine: string;
  priceRange: number;
  rating: number;
  matchMethod: string;
}

export interface DiagnosticResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attempts: AttemptLog[];
  timing: number;
  authStatus: AuthStatus;
}

export interface AttemptLog {
  method: string;
  strategy: string;
  params: Record<string, unknown>;
  status: number | null;
  success: boolean;
  resultCount?: number;
  error?: string;
  timing: number;
}

export interface AuthStatus {
  hasApiKey: boolean;
  hasAuthToken: boolean;
  hasCredentials: boolean;
  tokenValid: boolean;
  lastError?: string;
}

export interface RateLimitInfo {
  remaining: number;
  resetTime: number;
  isLimited: boolean;
}

class ResyDiagnosticClient {
  private client: AxiosInstance;
  private apiKey: string;
  private authToken: string | null = null;
  private email: string | null;
  private password: string | null;
  private rateLimitInfo: RateLimitInfo = { remaining: 100, resetTime: 0, isLimited: false };
  private requestCount = 0;

  constructor() {
    this.apiKey = process.env.RESY_API_KEY || DEFAULT_API_KEY;
    this.email = process.env.RESY_EMAIL || null;
    this.password = process.env.RESY_PASSWORD || null;

    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        this.requestCount++;
        (config as any)._startTime = Date.now();
        logger.logRequest(COMPONENT, config.method?.toUpperCase() || 'GET', config.url || '', config.params);
        return config;
      },
      (error) => {
        logger.error(COMPONENT, 'Request interceptor error', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        const timing = Date.now() - ((response.config as any)._startTime || 0);
        logger.logResponse(COMPONENT, response.status, response.config.url || '', response.data, timing);
        this.updateRateLimitFromHeaders(response.headers);
        return response;
      },
      (error) => {
        const timing = Date.now() - ((error.config as any)?._startTime || 0);
        const status = error.response?.status || 0;
        logger.logResponse(COMPONENT, status, error.config?.url || '', error.response?.data, timing);
        if (error.response?.headers) {
          this.updateRateLimitFromHeaders(error.response.headers);
        }
        return Promise.reject(error);
      }
    );

    logger.info(COMPONENT, 'Client initialized', {
      hasApiKey: !!this.apiKey,
      hasCredentials: !!(this.email && this.password),
      apiKeyPreview: this.apiKey ? this.apiKey.substring(0, 8) + '...' : 'none',
    });
  }

  private updateRateLimitFromHeaders(headers: any): void {
    const remaining = parseInt(headers?.['x-ratelimit-remaining'] || '100', 10);
    const reset = parseInt(headers?.['x-ratelimit-reset'] || '0', 10);
    this.rateLimitInfo = {
      remaining,
      resetTime: reset * 1000,
      isLimited: remaining <= 0,
    };
    if (this.rateLimitInfo.isLimited) {
      logger.warn(COMPONENT, 'Rate limited!', this.rateLimitInfo);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `ResyAPI api_key="${this.apiKey}"`,
    };
    if (this.authToken) {
      headers['x-resy-auth-token'] = this.authToken;
    }
    return headers;
  }

  getAuthStatus(): AuthStatus {
    return {
      hasApiKey: !!this.apiKey,
      hasAuthToken: !!this.authToken,
      hasCredentials: !!(this.email && this.password),
      tokenValid: !!this.authToken,
    };
  }

  getRateLimitInfo(): RateLimitInfo {
    return { ...this.rateLimitInfo };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  async login(): Promise<boolean> {
    logger.info(COMPONENT, 'Attempting login...');

    if (!this.email || !this.password) {
      logger.error(COMPONENT, 'No credentials available for login');
      return false;
    }

    try {
      const response = await this.client.post(
        '/3/auth/password',
        new URLSearchParams({ email: this.email, password: this.password }).toString(),
        { headers: this.getHeaders() }
      );
      this.authToken = response.data.token;
      logger.info(COMPONENT, 'Login successful', {
        userId: response.data.id,
        email: response.data.email?.substring(0, 3) + '***',
      });
      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(COMPONENT, 'Login failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Retry wrapper with exponential backoff
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 1000
  ): Promise<{ success: boolean; data?: T; error?: string; attempts: number }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const data = await fn();
        return { success: true, data, attempts: attempt };
      } catch (error) {
        lastError = error as Error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;

        // Don't retry on auth errors or not found
        if (status === 401 || status === 403 || status === 404) {
          break;
        }

        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          logger.warn(COMPONENT, `Attempt ${attempt} failed, retrying in ${delay}ms...`, {
            status,
            message: axiosError.message,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      attempts: maxRetries,
    };
  }

  /**
   * Multi-strategy search with diagnostic logging
   */
  async diagnosticSearch(
    query: string,
    location: string,
    date: string,
    partySize: number
  ): Promise<DiagnosticResult<SearchResult[]>> {
    const startTime = Date.now();
    const attempts: AttemptLog[] = [];
    const results: SearchResult[] = [];

    logger.info(COMPONENT, '========== DIAGNOSTIC SEARCH START ==========');
    logger.info(COMPONENT, 'Search parameters', { query, location, date, partySize });

    // Strategy 1: Check known venues first
    const knownVenue = this.findKnownVenue(query, location);
    if (knownVenue) {
      logger.info(COMPONENT, 'Found known venue, trying direct lookup', knownVenue);
      const attempt = await this.tryDirectVenueLookup(knownVenue.id, date, partySize);
      attempts.push(attempt);
      if (attempt.success && attempt.resultCount && attempt.resultCount > 0) {
        results.push({
          id: knownVenue.id,
          name: knownVenue.name,
          location: knownVenue.city,
          neighborhood: '',
          cuisine: '',
          priceRange: 0,
          rating: 0,
          matchMethod: 'known_venue',
        });
      }
    }

    // Strategy 2: Exact name search with coordinates
    const coords = this.getCityCoords(location);
    if (coords) {
      logger.info(COMPONENT, 'Trying geolocation search', { location, ...coords });
      const attempt = await this.tryGeoSearch(query, coords.lat, coords.lng, date, partySize);
      attempts.push(attempt);
      if (attempt.success && (attempt as any).results) {
        for (const r of (attempt as any).results) {
          if (!results.find(x => x.id === r.id)) {
            results.push({ ...r, matchMethod: 'geo_search' });
          }
        }
      }
    }

    // Strategy 3: Basic query search (no coords)
    {
      logger.info(COMPONENT, 'Trying basic query search');
      const attempt = await this.tryBasicSearch(query, location, date, partySize);
      attempts.push(attempt);
      if (attempt.success && (attempt as any).results) {
        for (const r of (attempt as any).results) {
          if (!results.find(x => x.id === r.id)) {
            results.push({ ...r, matchMethod: 'basic_search' });
          }
        }
      }
    }

    // Strategy 4: Fuzzy search with variations
    const queryVariations = this.generateQueryVariations(query);
    for (const variation of queryVariations.slice(0, 3)) {
      if (variation !== query) {
        logger.info(COMPONENT, 'Trying query variation', { variation });
        const attempt = await this.tryBasicSearch(variation, location, date, partySize);
        attempt.strategy = `fuzzy:${variation}`;
        attempts.push(attempt);
        if (attempt.success && (attempt as any).results) {
          for (const r of (attempt as any).results) {
            if (!results.find(x => x.id === r.id)) {
              results.push({ ...r, matchMethod: 'fuzzy_search' });
            }
          }
        }
      }
    }

    const timing = Date.now() - startTime;
    logger.info(COMPONENT, '========== DIAGNOSTIC SEARCH END ==========', {
      totalResults: results.length,
      attemptCount: attempts.length,
      timing,
    });

    return {
      success: results.length > 0,
      data: results,
      attempts,
      timing,
      authStatus: this.getAuthStatus(),
    };
  }

  private findKnownVenue(query: string, location: string): { id: number; name: string; city: string } | null {
    const queryLower = query.toLowerCase();
    const locationLower = location.toLowerCase();

    for (const [key, venue] of Object.entries(KNOWN_VENUES)) {
      const nameLower = venue.name.toLowerCase();
      const cityLower = venue.city.toLowerCase();

      if (queryLower.includes(nameLower) || nameLower.includes(queryLower)) {
        if (locationLower.includes(cityLower) || cityLower.includes(locationLower)) {
          return venue;
        }
      }
    }
    return null;
  }

  private getCityCoords(location: string): { lat: number; lng: number } | null {
    const locationLower = location.toLowerCase().trim();
    for (const [city, coords] of Object.entries(CITY_COORDS)) {
      if (locationLower.includes(city) || city.includes(locationLower)) {
        return coords;
      }
    }
    return null;
  }

  private generateQueryVariations(query: string): string[] {
    const variations = [query];
    const lower = query.toLowerCase();

    // Remove common suffixes
    if (lower.endsWith(' restaurant')) {
      variations.push(query.slice(0, -11).trim());
    }

    // Add "restaurant" if not present
    if (!lower.includes('restaurant')) {
      variations.push(query + ' restaurant');
    }

    // Split on common separators
    if (query.includes(' - ')) {
      variations.push(...query.split(' - ').map(s => s.trim()));
    }

    return [...new Set(variations)];
  }

  private async tryDirectVenueLookup(
    venueId: number,
    date: string,
    partySize: number
  ): Promise<AttemptLog> {
    const startTime = Date.now();

    try {
      const response = await this.client.get('/4/find', {
        params: {
          lat: 0,
          long: 0,
          day: date,
          party_size: partySize,
          venue_id: venueId,
        },
        headers: { Authorization: `ResyAPI api_key="${this.apiKey}"` },
      });

      const slots = response.data.results?.venues?.[0]?.slots || [];
      return {
        method: 'GET /4/find',
        strategy: 'direct_venue_lookup',
        params: { venue_id: venueId, date, party_size: partySize },
        status: response.status,
        success: true,
        resultCount: slots.length,
        timing: Date.now() - startTime,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        method: 'GET /4/find',
        strategy: 'direct_venue_lookup',
        params: { venue_id: venueId, date, party_size: partySize },
        status: axiosError.response?.status || null,
        success: false,
        error: axiosError.message,
        timing: Date.now() - startTime,
      };
    }
  }

  private async tryGeoSearch(
    query: string,
    lat: number,
    lng: number,
    date: string,
    partySize: number
  ): Promise<AttemptLog & { results?: SearchResult[] }> {
    const startTime = Date.now();

    try {
      const response = await this.client.get('/4/find', {
        params: {
          lat,
          long: lng,
          day: date,
          party_size: partySize,
          query,
        },
        headers: { Authorization: `ResyAPI api_key="${this.apiKey}"` },
      });

      const hits = response.data.search?.hits || [];
      const results = hits.map((hit: any) => ({
        id: hit.id?.resy || 0,
        name: hit.name || '',
        location: hit.location?.name || '',
        neighborhood: hit.location?.neighborhood || '',
        cuisine: Array.isArray(hit.cuisine) ? hit.cuisine.join(', ') : '',
        priceRange: hit.price_range || 0,
        rating: hit.rating || 0,
      }));

      return {
        method: 'GET /4/find',
        strategy: 'geo_search',
        params: { query, lat, long: lng, date, party_size: partySize },
        status: response.status,
        success: true,
        resultCount: results.length,
        results,
        timing: Date.now() - startTime,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        method: 'GET /4/find',
        strategy: 'geo_search',
        params: { query, lat, long: lng, date, party_size: partySize },
        status: axiosError.response?.status || null,
        success: false,
        error: axiosError.message,
        timing: Date.now() - startTime,
      };
    }
  }

  private async tryBasicSearch(
    query: string,
    location: string,
    date: string,
    partySize: number
  ): Promise<AttemptLog & { results?: SearchResult[] }> {
    const startTime = Date.now();
    const searchQuery = `${query} ${location}`.trim();

    try {
      const response = await this.client.get('/4/find', {
        params: {
          lat: 0,
          long: 0,
          day: date,
          party_size: partySize,
          query: searchQuery,
        },
        headers: { Authorization: `ResyAPI api_key="${this.apiKey}"` },
      });

      const hits = response.data.search?.hits || [];
      const results = hits.map((hit: any) => ({
        id: hit.id?.resy || 0,
        name: hit.name || '',
        location: hit.location?.name || '',
        neighborhood: hit.location?.neighborhood || '',
        cuisine: Array.isArray(hit.cuisine) ? hit.cuisine.join(', ') : '',
        priceRange: hit.price_range || 0,
        rating: hit.rating || 0,
      }));

      return {
        method: 'GET /4/find',
        strategy: 'basic_search',
        params: { query: searchQuery, date, party_size: partySize },
        status: response.status,
        success: true,
        resultCount: results.length,
        results,
        timing: Date.now() - startTime,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        method: 'GET /4/find',
        strategy: 'basic_search',
        params: { query: searchQuery, date, party_size: partySize },
        status: axiosError.response?.status || null,
        success: false,
        error: axiosError.message,
        timing: Date.now() - startTime,
      };
    }
  }

  /**
   * Test suite for known restaurants
   */
  async runDiagnosticTests(): Promise<{
    results: Array<{
      venue: string;
      venueId: number;
      tests: AttemptLog[];
      overallSuccess: boolean;
    }>;
    summary: {
      total: number;
      passed: number;
      failed: number;
      successRate: number;
    };
  }> {
    logger.info(COMPONENT, '========== RUNNING DIAGNOSTIC TESTS ==========');

    const testVenues = [
      { name: 'Juliet', city: 'Culver City', id: 58174 },
      { name: 'Margot', city: 'Culver City', id: 81815 },
      { name: 'Carbone', city: 'New York', id: 1505 },
      { name: 'Bestia', city: 'Los Angeles', id: 468 },
    ];

    const date = new Date().toISOString().split('T')[0];
    const partySize = 2;
    const results: Array<{
      venue: string;
      venueId: number;
      tests: AttemptLog[];
      overallSuccess: boolean;
    }> = [];

    for (const venue of testVenues) {
      logger.info(COMPONENT, `Testing venue: ${venue.name} (${venue.city})`);
      const tests: AttemptLog[] = [];

      // Test 1: Direct venue ID lookup
      const directTest = await this.tryDirectVenueLookup(venue.id, date, partySize);
      directTest.strategy = 'test:direct_id';
      tests.push(directTest);

      // Test 2: Search by name + city
      const searchTest = await this.tryBasicSearch(venue.name, venue.city, date, partySize);
      searchTest.strategy = 'test:name_city';
      tests.push(searchTest);

      // Test 3: Geo search
      const coords = this.getCityCoords(venue.city);
      if (coords) {
        const geoTest = await this.tryGeoSearch(venue.name, coords.lat, coords.lng, date, partySize);
        geoTest.strategy = 'test:geo';
        tests.push(geoTest);
      }

      const overallSuccess = tests.some(t => t.success);
      results.push({
        venue: `${venue.name} (${venue.city})`,
        venueId: venue.id,
        tests,
        overallSuccess,
      });

      // Small delay between venues
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const passed = results.filter(r => r.overallSuccess).length;
    const summary = {
      total: results.length,
      passed,
      failed: results.length - passed,
      successRate: (passed / results.length) * 100,
    };

    logger.info(COMPONENT, '========== DIAGNOSTIC TESTS COMPLETE ==========', summary);

    return { results, summary };
  }

  /**
   * Get availability with detailed logging
   */
  async getAvailabilityWithDiag(
    venueId: number,
    date: string,
    partySize: number
  ): Promise<DiagnosticResult<any[]>> {
    const startTime = Date.now();
    const attempts: AttemptLog[] = [];

    const result = await this.withRetry(async () => {
      const response = await this.client.get('/4/find', {
        params: {
          lat: 0,
          long: 0,
          day: date,
          party_size: partySize,
          venue_id: venueId,
        },
        headers: { Authorization: `ResyAPI api_key="${this.apiKey}"` },
      });

      return response.data.results?.venues?.[0]?.slots || [];
    });

    attempts.push({
      method: 'GET /4/find',
      strategy: 'availability',
      params: { venue_id: venueId, date, party_size: partySize },
      status: result.success ? 200 : null,
      success: result.success,
      resultCount: result.data?.length,
      error: result.error,
      timing: Date.now() - startTime,
    });

    const slots = result.data?.map((slot: any) => ({
      slotId: String(slot.config?.id),
      token: slot.config?.token,
      time: slot.date?.start,
      endTime: slot.date?.end,
      type: slot.config?.type,
    })) || [];

    return {
      success: result.success,
      data: slots,
      attempts,
      timing: Date.now() - startTime,
      authStatus: this.getAuthStatus(),
    };
  }
}

export const resyDiagnostic = new ResyDiagnosticClient();
