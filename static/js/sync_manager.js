/**
 * SevaSetu SyncManager
 * Handles offline action queuing and background syncing for poor connectivity areas.
 */

class SyncManager {
    constructor() {
        this.dbName = 'sevasetu_sync';
        this.storeName = 'pending_actions';
        this.db = null;
        this.isSyncing = false;
        
        this.initDB();
        this.initListeners();
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log('[SyncManager] DB Initialized');
                this.processQueue();
                resolve();
            };
            request.onerror = (e) => reject(e);
        });
    }

    initListeners() {
        window.addEventListener('online', () => {
            console.log('[SyncManager] Back online, processing queue...');
            this.processQueue();
        });
    }

    /**
     * Queues an action to be performed when online.
     */
    async queueAction(url, options = {}) {
        if (navigator.onLine) {
            try {
                const res = await fetch(url, options);
                if (res.ok) return res;
            } catch (err) {
                console.warn('[SyncManager] Fetch failed despite being online, queuing...', err);
            }
        }

        // Offline or fetch failed - queue it
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const action = {
                url,
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body || null,
                timestamp: Date.now()
            };
            
            const request = store.add(action);
            request.onsuccess = () => {
                if (window.showToast) {
                    window.showToast("Offline: Update queued and will sync when network returns.", "warning");
                }
                resolve({ queued: true });
            };
            request.onerror = (e) => reject(e);
        });
    }

    async processQueue() {
        if (this.isSyncing || !navigator.onLine || !this.db) return;
        this.isSyncing = true;

        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        request.onsuccess = async (e) => {
            const actions = e.target.result;
            if (actions.length === 0) {
                this.isSyncing = false;
                return;
            }

            console.log(`[SyncManager] Syncing ${actions.length} pending actions...`);
            
            for (const action of actions) {
                try {
                    const res = await fetch(action.url, {
                        method: action.method,
                        headers: action.headers,
                        body: action.body
                    });
                    
                    if (res.ok) {
                        // Success! Remove from queue
                        const delTrans = this.db.transaction([this.storeName], 'readwrite');
                        delTrans.objectStore(this.storeName).delete(action.id);
                    }
                } catch (err) {
                    console.error('[SyncManager] Sync failed for action:', action.id, err);
                    // Keep in queue for next time
                }
            }
            
            if (window.showToast) {
                window.showToast("All pending updates synced successfully!", "success");
            }
            this.isSyncing = false;
        };
    }
}

// Global instance
window.syncManager = new SyncManager();
