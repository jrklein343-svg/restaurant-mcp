import { z } from 'zod';
export declare const searchRestaurantsSchema: z.ZodObject<{
    query: z.ZodString;
    location: z.ZodString;
    cuisine: z.ZodOptional<z.ZodString>;
    platform: z.ZodDefault<z.ZodEnum<["resy", "opentable", "both"]>>;
    date: z.ZodOptional<z.ZodString>;
    party_size: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    platform: "resy" | "opentable" | "both";
    party_size: number;
    query: string;
    location: string;
    date?: string | undefined;
    cuisine?: string | undefined;
}, {
    query: string;
    location: string;
    platform?: "resy" | "opentable" | "both" | undefined;
    party_size?: number | undefined;
    date?: string | undefined;
    cuisine?: string | undefined;
}>;
export type SearchRestaurantsInput = z.infer<typeof searchRestaurantsSchema>;
export interface SearchResult {
    platform: 'resy' | 'opentable';
    id: string;
    name: string;
    location: string;
    cuisine: string;
    priceRange: number;
    rating: number;
    imageUrl?: string;
}
export declare function searchRestaurants(input: SearchRestaurantsInput): Promise<SearchResult[]>;
