import type { ResySearchResult, ResyTimeSlot, ResyReservation, ResyLoginResponse, ResyBookResponse, ResyBookDetailsResponse } from './types.js';
export declare class ResyClient {
    private client;
    private apiKey;
    private authToken;
    constructor();
    private ensureCredentials;
    private getHeaders;
    private refreshToken;
    private request;
    login(email: string, password: string): Promise<ResyLoginResponse>;
    search(query: string, location: string, date: string, partySize: number): Promise<ResySearchResult[]>;
    getAvailability(venueId: number, date: string, partySize: number): Promise<ResyTimeSlot[]>;
    getBookingDetails(configId: string, date: string, partySize: number): Promise<ResyBookDetailsResponse>;
    makeReservation(bookToken: string, paymentMethodId?: number): Promise<ResyBookResponse>;
    getReservations(): Promise<ResyReservation[]>;
    cancelReservation(resyToken: string): Promise<void>;
    verifyAuth(): Promise<boolean>;
}
export declare const resyClient: ResyClient;
