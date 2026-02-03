import axios, { AxiosInstance, AxiosError } from 'axios';

const BASE_URL = 'https://api.resy.com';

// Default API key (public, used by Resy web app)
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

interface ResyLoginResponse {
  id: number;
  token: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface ResySlot {
  config: { id: number; type: string; token: string };
  date: { start: string; end: string };
  payment?: { cancellation_fee?: number; deposit_fee?: number };
}

interface ResyBookDetailsResponse {
  book_token: { value: string; date_expires: string };
  user: { payment_methods: Array<{ id: number; is_default: boolean }> };
}

interface ResyBookResponse {
  resy_token: string;
  reservation_id: number;
}

export class ResyClient {
  private client: AxiosInstance;
  private apiKey: string;
  private authToken: string | null = null;
  private email: string | null = null;
  private password: string | null = null;

  constructor() {
    this.apiKey = process.env.RESY_API_KEY || DEFAULT_API_KEY;
    this.email = process.env.RESY_EMAIL || null;
    this.password = process.env.RESY_PASSWORD || null;

    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
    });
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

  async login(): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error('RESY_EMAIL and RESY_PASSWORD environment variables required');
    }

    const response = await this.client.post<ResyLoginResponse>(
      '/3/auth/password',
      new URLSearchParams({ email: this.email, password: this.password }).toString(),
      { headers: this.getHeaders() }
    );

    this.authToken = response.data.token;
    console.log(`[Resy] Logged in as ${response.data.first_name} ${response.data.last_name}`);
  }

  async ensureAuth(): Promise<void> {
    if (!this.authToken) {
      await this.login();
    }
  }

  private async request<T>(
    method: 'get' | 'post',
    url: string,
    data?: Record<string, string | number>,
    retry = true
  ): Promise<T> {
    await this.ensureAuth();

    try {
      const config = { headers: this.getHeaders() };

      let response;
      if (method === 'get') {
        response = await this.client.get<T>(url, { ...config, params: data });
      } else {
        const body = data ? new URLSearchParams(data as Record<string, string>).toString() : '';
        response = await this.client.post<T>(url, body, config);
      }

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401 && retry) {
        console.log('[Resy] Token expired, refreshing...');
        await this.login();
        return this.request<T>(method, url, data, false);
      }
      throw error;
    }
  }

  async getAvailability(venueId: number, date: string, partySize: number): Promise<ResySlot[]> {
    interface FindResponse {
      results: {
        venues: Array<{ slots: ResySlot[] }>;
      };
    }

    const data = await this.request<FindResponse>('get', '/4/find', {
      lat: 0,
      long: 0,
      day: date,
      party_size: partySize,
      venue_id: venueId,
    });

    return data.results?.venues?.[0]?.slots || [];
  }

  async getBookingDetails(configId: string, date: string, partySize: number): Promise<ResyBookDetailsResponse> {
    return this.request<ResyBookDetailsResponse>('get', '/3/details', {
      config_id: configId,
      day: date,
      party_size: partySize,
    });
  }

  async makeReservation(bookToken: string, paymentMethodId?: number): Promise<ResyBookResponse> {
    const data: Record<string, string> = { book_token: bookToken };
    if (paymentMethodId) {
      data.struct_payment_method = JSON.stringify({ id: paymentMethodId });
    }
    return this.request<ResyBookResponse>('post', '/3/book', data);
  }
}

export const resyClient = new ResyClient();
