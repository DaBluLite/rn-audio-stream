export interface CacheConfig {
    maxSizeBytes: number;
    maxSizePercentage: number;
    minFreeSpace: number;
    metadataRetentionDays: number;
    eviction: "lru";
}
export interface PrefetchConfig {
    enabled: boolean;
    triggerPercentage: number;
    prefetchCount: number;
    chunkSize: number;
    maxConcurrentPrefetches: number;
    cellularAllowed: boolean;
}
export interface CacheMetadata {
    id: string;
    isComplete: boolean;
    size: number;
    lastAccessed: number;
    accessCount: number;
    filePath: string;
}
export declare class CacheManager {
    config: CacheConfig;
    prefetch: PrefetchConfig;
    enabled: boolean;
    private meta;
    private downloads;
    private _netState;
    private _dir;
    constructor(opts?: Partial<CacheConfig & PrefetchConfig & {
        enabled: boolean;
    }>);
    private filePath;
    private tmpPath;
    private toFileUrl;
    init(): Promise<void>;
    canPrefetchOnCurrentNetwork(): boolean;
    setNetState(s: any): void;
    get isOffline(): boolean;
    getCachedUrl(id: string): Promise<string | null>;
    getCachedUrlSync(id: string): string | null;
    streamAndCacheChunked(id: string, url: string): Promise<void>;
    prefetchIds(ids: string[], urlProvider: (id: string) => string): Promise<void>;
    evictIfNeeded(): Promise<void>;
    clear(): Promise<void>;
    removeTrack(id: string): Promise<void>;
    getStats(): Promise<{
        size: number;
        count: number;
    }>;
    getCacheHealthReport(): Promise<{
        corrupt: string[];
        isOffline: boolean;
        size: number;
        count: number;
    }>;
    _injectMeta(m: CacheMetadata): void;
}
//# sourceMappingURL=cache.d.ts.map