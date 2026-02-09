import { z } from 'zod';
export declare const snipeReservationSchema: z.ZodObject<{
    restaurant_id: z.ZodString;
    platform: z.ZodEnum<["resy", "opentable"]>;
    date: z.ZodString;
    party_size: z.ZodNumber;
    preferred_times: z.ZodArray<z.ZodString, "many">;
    release_time: z.ZodString;
}, "strip", z.ZodTypeAny, {
    platform: "resy" | "opentable";
    party_size: number;
    date: string;
    restaurant_id: string;
    preferred_times: string[];
    release_time: string;
}, {
    platform: "resy" | "opentable";
    party_size: number;
    date: string;
    restaurant_id: string;
    preferred_times: string[];
    release_time: string;
}>;
export type SnipeReservationInput = z.infer<typeof snipeReservationSchema>;
export interface SnipeResult {
    success: boolean;
    snipeId: string;
    message: string;
    scheduledFor: string;
}
export declare function snipeReservation(input: SnipeReservationInput): Promise<SnipeResult>;
export declare const listSnipesSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export type ListSnipesInput = z.infer<typeof listSnipesSchema>;
export interface SnipeSummary {
    id: string;
    restaurantId: string;
    platform: 'resy' | 'opentable';
    date: string;
    partySize: number;
    preferredTimes: string[];
    releaseTime: string;
    status: string;
    isScheduled: boolean;
    result?: string;
}
export declare function listScheduledSnipes(_input: ListSnipesInput): Promise<SnipeSummary[]>;
export declare const cancelSnipeSchema: z.ZodObject<{
    snipe_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    snipe_id: string;
}, {
    snipe_id: string;
}>;
export type CancelSnipeInput = z.infer<typeof cancelSnipeSchema>;
export interface CancelSnipeResult {
    success: boolean;
    message: string;
}
export declare function cancelSnipe(input: CancelSnipeInput): Promise<CancelSnipeResult>;
