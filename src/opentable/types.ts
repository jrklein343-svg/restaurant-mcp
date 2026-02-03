export interface OpenTableRestaurant {
  rid: number;
  name: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
  price_range: number;
  cuisine: string;
  photos: string[];
  rating: number;
  reviews_count: number;
}

export interface OpenTableSearchResponse {
  total_entries: number;
  per_page: number;
  current_page: number;
  restaurants: OpenTableRestaurant[];
}

export interface OpenTableTimeSlot {
  time: string;
  available: boolean;
  booking_url: string;
}

export interface OpenTableAvailability {
  restaurant_id: number;
  date: string;
  party_size: number;
  times: OpenTableTimeSlot[];
}

export interface OpenTableSearchResult {
  id: number;
  name: string;
  address: string;
  city: string;
  cuisine: string;
  priceRange: number;
  rating: number;
  reviewsCount: number;
  imageUrl?: string;
}

export interface OpenTableSlot {
  slotId: string;
  time: string;
  bookingUrl: string;
}
