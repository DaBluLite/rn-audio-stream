"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheManager = void 0;
const react_native_1 = require("react-native");
// RNFS & NetInfo are optional peer deps — fallback to no-op mocks for tests/node
let RNFS;
try {
    RNFS = require("react-native-fs");
}
catch {
    RNFS = null;
}
let NetInfo;
try {
    NetInfo = require("@react-native-community/netinfo");
}
catch {
    NetInfo = null;
}
const DEFAULT_CACHE = { maxSizeBytes: 1 * 1024 * 1024 * 1024, maxSizePercentage: 0.1, minFreeSpace: 512 * 1024 * 1024, metadataRetentionDays: 30, eviction: "lru" };
const DEFAULT_PREFETCH = { enabled: true, triggerPercentage: 0.5, prefetchCount: 2, chunkSize: 256 * 1024, maxConcurrentPrefetches: 2, cellularAllowed: false };
class CacheManager {
    constructor(opts = {}) {
        this.meta = new Map();
        this.downloads = new Map(); // jobId
        this._netState = { isConnected: true };
        this.config = { ...DEFAULT_CACHE, ...opts };
        this.prefetch = { ...DEFAULT_PREFETCH, ...opts };
        this.enabled = opts.enabled ?? true;
        this._dir = (RNFS?.CachesDirectoryPath ?? "/tmp") + "/audio-cache";
        // load persisted meta from RNFS if exists (best-effort)
        if (NetInfo?.addEventListener)
            NetInfo.addEventListener((s) => { this._netState = s; });
        else if (NetInfo?.fetch)
            NetInfo.fetch().then((s) => this._netState = s).catch(() => { });
    }
    // ---- helpers ----
    filePath(id) { return `${this._dir}/${id}.cache`; }
    tmpPath(id) { return `${this._dir}/${id}.cache.tmp`; }
    toFileUrl(path) {
        if (react_native_1.Platform.OS === "android")
            return path;
        return path.startsWith("file://") ? path : `file://${path}`;
    }
    async init() {
        if (!RNFS)
            return;
        try {
            await RNFS.mkdir(this._dir);
        }
        catch { }
        // load meta files
        try {
            const files = await RNFS.readDir(this._dir).then((a) => a.map(x => x.path || x.name)).catch(() => []);
            // meta stored alongside? We persist meta via this.meta in memory; on init scan cache files
            for (const p of files) {
                if (p.endsWith(".cache")) {
                    const id = p.split("/").pop().replace(".cache", "").replace(".tmp", "");
                    if (!this.meta.has(id)) {
                        try {
                            const stat = await RNFS.stat(p);
                            this.meta.set(id, { id, isComplete: true, size: Number(stat.size) || 0, lastAccessed: Date.now(), accessCount: 0, filePath: p });
                        }
                        catch { }
                    }
                }
            }
        }
        catch { }
    }
    canPrefetchOnCurrentNetwork() {
        if (!this.prefetch.enabled)
            return false;
        const s = this._netState;
        if (s.isConnected === false)
            return false;
        const isMetered = s.type === "cellular" || s.details?.isConnectionExpensive;
        if (isMetered && !this.prefetch.cellularAllowed)
            return false;
        return true;
    }
    setNetState(s) { this._netState = s; }
    get isOffline() { return this._netState.isConnected === false; }
    async getCachedUrl(id) {
        const m = this.meta.get(id);
        if (!m || !m.isComplete)
            return null;
        // verify file exists and size matches
        if (RNFS) {
            try {
                const exists = await RNFS.exists(m.filePath);
                if (!exists) {
                    this.meta.delete(id);
                    return null;
                }
                const stat = await RNFS.stat(m.filePath);
                if (Number(stat.size) !== m.size && m.size > 0) { /* corrupt */
                    await RNFS.unlink(m.filePath).catch(() => { });
                    this.meta.delete(id);
                    return null;
                }
            }
            catch {
                this.meta.delete(id);
                return null;
            }
        }
        m.lastAccessed = Date.now();
        m.accessCount++;
        return this.toFileUrl(m.filePath);
    }
    // synchronous check (no I/O) for instant setQueue
    getCachedUrlSync(id) {
        const m = this.meta.get(id);
        if (!m || !m.isComplete)
            return null;
        m.lastAccessed = Date.now();
        m.accessCount++;
        return this.toFileUrl(m.filePath);
    }
    async streamAndCacheChunked(id, url) {
        if (!this.enabled || !RNFS || !url || this.meta.get(id)?.isComplete)
            return;
        if (!this.canPrefetchOnCurrentNetwork() && !this.meta.has(id)) { /* allow current track even on cellular? respect cellularAllowed */
            if (!this.prefetch.cellularAllowed && this._netState.type === "cellular")
                return;
        }
        const tmp = this.tmpPath(id);
        const dest = this.filePath(id);
        try {
            await RNFS.mkdir(this._dir);
        }
        catch { }
        return new Promise((resolve) => {
            const job = RNFS.downloadFile({ fromUrl: url, toFile: tmp, background: true, discretionary: true });
            if (job.jobId)
                this.downloads.set(id, job.jobId);
            job.promise.then(async () => {
                try {
                    await RNFS.moveFile(tmp, dest);
                    const stat = await RNFS.stat(dest);
                    this.meta.set(id, { id, isComplete: true, size: Number(stat.size) || 0, lastAccessed: Date.now(), accessCount: 1, filePath: dest });
                    await this.evictIfNeeded();
                }
                catch { }
                this.downloads.delete(id);
                resolve();
            }).catch(() => { this.downloads.delete(id); RNFS.unlink(tmp).catch(() => { }); resolve(); });
        });
    }
    async prefetchIds(ids, urlProvider) {
        if (!this.canPrefetchOnCurrentNetwork())
            return;
        const queue = ids.slice(0, this.prefetch.prefetchCount);
        let concurrent = 0;
        let idx = 0;
        await new Promise(res => {
            const next = () => {
                if (idx >= queue.length && concurrent === 0)
                    return res();
                while (concurrent < this.prefetch.maxConcurrentPrefetches && idx < queue.length) {
                    const id = queue[idx++];
                    concurrent++;
                    this.streamAndCacheChunked(id, urlProvider(id)).finally(() => { concurrent--; next(); });
                }
            };
            next();
        });
    }
    async evictIfNeeded() {
        let total = 0;
        for (const m of this.meta.values())
            total += m.size;
        if (total <= this.config.maxSizeBytes)
            return;
        // LRU
        const sorted = [...this.meta.values()].sort((a, b) => a.lastAccessed - b.lastAccessed);
        for (const m of sorted) {
            if (total <= this.config.maxSizeBytes)
                break;
            try {
                await RNFS.unlink(m.filePath);
            }
            catch { }
            total -= m.size;
            this.meta.delete(m.id);
        }
    }
    async clear() { for (const m of this.meta.values()) {
        try {
            await RNFS.unlink(m.filePath);
        }
        catch { }
    } this.meta.clear(); if (RNFS)
        try {
            await RNFS.unlink(this.tmpPath("*")).catch(() => { });
        }
        catch { } }
    async removeTrack(id) { const m = this.meta.get(id); if (m)
        try {
            await RNFS.unlink(m.filePath);
        }
        catch { } this.meta.delete(id); const j = this.downloads.get(id); if (j)
        try {
            RNFS.stopDownload(j);
        }
        catch { } }
    async getStats() { let size = 0; for (const m of this.meta.values())
        size += m.size; return { size, count: this.meta.size }; }
    async getCacheHealthReport() { const stats = await this.getStats(); const corrupt = []; for (const [id, m] of this.meta) {
        if (RNFS) {
            const e = await RNFS.exists(m.filePath).catch(() => false);
            if (!e)
                corrupt.push(id);
        }
    } return { ...stats, corrupt, isOffline: this.isOffline }; }
    // for tests: inject metadata directly
    _injectMeta(m) { this.meta.set(m.id, m); }
}
exports.CacheManager = CacheManager;
//# sourceMappingURL=cache.js.map