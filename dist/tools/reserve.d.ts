import { z } from 'zod';
export declare const makeReservationSchema: z.ZodObject<{
    restaurant_id: z.ZodString;
    platform: z.ZodEnum<["resy", "opentable"]>;
    slot_id: z.ZodString;
    party_size: z.ZodNumber;
    date: z.ZodString;
}, "strip", z.ZodTypeAny, {
    platform: "resy" | "opentable";
    party_size: number;
    date: string;
    restaurant_id: string;
    slot_id: string;
}, {
    platform: "resy" | "opentable";
    party_size: number;
    date: string;
    restaurant_id: string;
    slot_id: string;
}>;
export type MakeReservationInput = z.infer<typeof makeReservationSchema>;
export interface ReservationResult {
    success: boolean;
    platform: 'resy' | 'opentable';
    reservationId?: string;
    confirmationDetails?: string;
    bookingUrl?: string;
    error?: string;
}
export declare function makeReservation(input: MakeReservationInput): Promise<ReservationResult>;
