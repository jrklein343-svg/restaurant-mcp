export interface SnipeConfig {
    id: string;
    restaurantId: string;
    platform: 'resy' | 'opentable';
    date: string;
    partySize: number;
    preferredTimes: string[];
    releaseTime: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
    createdAt: string;
    result?: string;
}
export declare function createSnipe(config: Omit<SnipeConfig, 'id' | 'createdAt' | 'status'>): Promise<SnipeConfig>;
export declare function getSnipe(id: string): Promise<SnipeConfig | null>;
export declare function listSnipes(status?: SnipeConfig['status']): Promise<SnipeConfig[]>;
export declare function updateSnipeStatus(id: string, status: SnipeConfig['status'], result?: string): Promise<void>;
export declare function deleteSnipe(id: string): Promise<boolean>;
export declare function getPendingSnipes(): Promise<SnipeConfig[]>;
export declare function closeDb(): Promise<void>;
