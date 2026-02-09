/**
 * Resy platform client implementing PlatformClient interface
 */
import { BasePlatformClient } from './base.js';
import type { PlatformName, Restaurant, RestaurantDetails, TimeSlot, ReservationParams, ReservationResult, SearchQuery } from '../types/restaurant.js';
interface ResyLoginResponse {
    id: number;
    token: string;
    first_name: string;
    last_name: string;
    email: string;
}
export declare class ResyPlatformClient extends BasePlatformClient {
    readonly name: PlatformName;
    private client;
    private apiKey;
    private authToken;
    constructor();
    private ensureCredentials;
    private getHeaders;
    private refreshToken;
    private request;
    search(query: SearchQuery): Promise<Restaurant[]>;
    private getLocationSlug;
    private getCityCoordinates;
    getDetails(id: string | number): Promise<RestaurantDetails | null>;
    getAvailability(id: string | number, date: string, partySize: number): Promise<TimeSlot[]>;
    makeReservation(params: ReservationParams): Promise<ReservationResult>;
    isAvailable(): Promise<boolean>;
    isAuthenticated(): Promise<boolean>;
    login(email: string, password: string): Promise<ResyLoginResponse>;
    getReservations(): Promise<Array<{
        reservationId: string;
        venue: {
            name: string;
            location: string;
        };
        date: string;
        time: string;
        partySize: number;
        status: string;
    }>>;
    cancelReservation(resyToken: string): Promise<void>;
    private mapToRestaurant;
    private mapToTimeSlot;
}
export declare const resyClient: ResyPlatformClient;
export {};
