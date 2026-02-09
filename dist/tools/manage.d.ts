import { z } from 'zod';
export declare const listReservationsSchema: z.ZodObject<{
    platform: z.ZodDefault<z.ZodEnum<["resy", "opentable", "all"]>>;
}, "strip", z.ZodTypeAny, {
    platform: "resy" | "opentable" | "all";
}, {
    platform?: "resy" | "opentable" | "all" | undefined;
}>;
export type ListReservationsInput = z.infer<typeof listReservationsSchema>;
export interface Reservation {
    platform: 'resy' | 'opentable';
    reservationId: string;
    restaurantName: string;
    location: string;
    date: string;
    time: string;
    partySize: number;
    status: string;
}
export declare function listReservations(input: ListReservationsInput): Promise<Reservation[]>;
export declare const cancelReservationSchema: z.ZodObject<{
    reservation_id: z.ZodString;
    platform: z.ZodEnum<["resy", "opentable"]>;
}, "strip", z.ZodTypeAny, {
    platform: "resy" | "opentable";
    reservation_id: string;
}, {
    platform: "resy" | "opentable";
    reservation_id: string;
}>;
export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;
export interface CancelResult {
    success: boolean;
    message: string;
}
export declare function cancelReservation(input: CancelReservationInput): Promise<CancelResult>;
