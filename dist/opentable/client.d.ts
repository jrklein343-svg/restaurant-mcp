import type { OpenTableSearchResult, OpenTableSlot } from './types.js';
export declare class OpenTableClient {
    private client;
    constructor();
    search(query: string, location: string, _cuisine?: string): Promise<OpenTableSearchResult[]>;
    getAvailability(restaurantId: number, date: string, partySize: number): Promise<OpenTableSlot[]>;
    private buildBookingUrl;
    getBookingUrl(restaurantId: number, date: string, time: string, partySize: number): Promise<string>;
}
export declare const openTableClient: OpenTableClient;
