import { type SnipeConfig } from './store.js';
export declare function executeSnipe(config: SnipeConfig): Promise<void>;
export declare function scheduleSnipe(config: SnipeConfig): NodeJS.Timeout;
