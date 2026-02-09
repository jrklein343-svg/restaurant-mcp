import { z } from 'zod';
export declare const checkAvailabilitySchema: z.ZodObject<{
    restaurant_id: z.ZodString;
    platform: z.ZodEnum<["resy", "opentable"]>;
    date: z.ZodString;
    party_size: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    platform: "resy" | "opentable";
    party_size: number;
    date: string;
    restaurant_id: string;
}, {
    platform: "resy" | "opentable";
    party_size: number;
    date: string;
    restaurant_id: string;
}>;
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;
export interface TimeSlot {
    slotId: string;
    time: string;
    endTime?: string;
    type?: string;
    cancellationFee?: number;
    depositFee?: number;
    bookingUrl?: string;
}
export interface AvailabilityResult {
    restaurantId: string;
    platform: 'resy' | 'opentable';
    date: string;
    partySize: number;
    slots: TimeSlot[];
}
export declare function checkAvailability(input: CheckAvailabilityInput): Promise<AvailabilityResult>;
