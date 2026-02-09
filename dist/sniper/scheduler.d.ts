import { type SnipeConfig } from './store.js';
export declare function startScheduler(): Promise<void>;
export declare function scheduleSnipeJob(config: SnipeConfig): void;
export declare function cancelSnipeJob(snipeId: string): boolean;
export declare function isSnipeScheduled(snipeId: string): boolean;
export declare function getScheduledSnipeIds(): string[];
export declare function getSnipeStatus(snipeId: string): Promise<SnipeConfig | null>;
export declare function stopScheduler(): void;
