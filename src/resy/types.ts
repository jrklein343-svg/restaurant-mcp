export interface ResyVenue {
  id: {
    resy: number;
  };
  name: string;
  location: {
    name: string;
    neighborhood: string;
    time_zone: string;
  };
  cuisine: string;
  price_range: number;
  rating: number;
  images: string[];
  url_slug: string;
}

export interface ResySlot {
  config: {
    id: number;
    type: string;
    token: string;
  };
  date: {
    start: string;
    end: string;
  };
  payment?: {
    cancellation_fee?: number;
    deposit_fee?: number;
  };
}

export interface ResyAvailability {
  results: {
    venues: Array<{
      venue: ResyVenue;
      slots: ResySlot[];
    }>;
  };
}

export interface ResySearchResult {
  id: number;
  name: string;
  location: string;
  neighborhood: string;
  cuisine: string;
  priceRange: number;
  rating: number;
  imageUrl?: string;
}

export interface ResyTimeSlot {
  slotId: string;
  token: string;
  time: string;
  endTime: string;
  type: string;
  cancellationFee?: number;
  depositFee?: number;
}

export interface ResyBookingDetails {
  bookToken: string;
  venueId: number;
  configId: number;
  date: string;
  partySize: number;
}

export interface ResyReservation {
  reservationId: string;
  venue: {
    name: string;
    location: string;
  };
  date: string;
  time: string;
  partySize: number;
  status: string;
}

export interface ResyLoginResponse {
  id: number;
  token: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface ResyBookResponse {
  resy_token: string;
  reservation_id: number;
}

export interface ResyBookDetailsResponse {
  book_token: {
    value: string;
    date_expires: string;
  };
  user: {
    payment_methods: Array<{
      id: number;
      is_default: boolean;
    }>;
  };
}
