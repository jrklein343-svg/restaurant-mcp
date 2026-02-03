import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://www.opentable.com/restref/api';
const BOOKING_BASE = 'https://www.opentable.com/booking/experiences-availability';

export interface OpenTableSlot {
  time: string;
  bookingUrl: string;
}

export class OpenTableClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
  }

  private buildBookingUrl(restaurantId: number, date: string, time: string, partySize: number): string {
    const params = new URLSearchParams({
      rid: String(restaurantId),
      datetime: `${date}T${time}`,
      covers: String(partySize),
    });
    return `${BOOKING_BASE}?${params.toString()}`;
  }

  async getAvailability(restaurantId: number, date: string, partySize: number): Promise<OpenTableSlot[]> {
    interface AvailabilityResponse {
      availability: {
        [date: string]: Array<{ time: string; available: boolean }>;
      };
    }

    try {
      const response = await this.client.get<AvailabilityResponse>('/availability', {
        params: {
          rid: restaurantId,
          datetime: `${date}T19:00`,
          party_size: partySize,
        },
      });

      const daySlots = response.data.availability?.[date] || [];

      return daySlots
        .filter((slot) => slot.available)
        .map((slot) => ({
          time: slot.time,
          bookingUrl: this.buildBookingUrl(restaurantId, date, slot.time, partySize),
        }));
    } catch {
      return [];
    }
  }
}

export const openTableClient = new OpenTableClient();
