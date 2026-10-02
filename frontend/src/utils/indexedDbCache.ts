/**
 * IndexedDB cache utility for offline persistence.
 * Stores last successful API responses with timestamps.
 */

const DB_NAME = "vesting-stream-cache";
const DB_VERSION = 1;
const STORE_NAME = "api-cache";

interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
}

/**
 * Initialize the IndexedDB database
 */
function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

/**
 * Set a cached value in IndexedDB with current timestamp
 */
export async function setCacheEntry<T>(key: string, data: T): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const entry: CacheEntry<T> = {
        key,
        data,
        timestamp: Date.now(),
      };
      const request = store.put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to set cache entry:", error);
    // Fail silently to avoid breaking offline functionality
  }
}

/**
 * Get a cached value from IndexedDB with its timestamp
 */
export async function getCacheEntry<T>(key: string): Promise<{ data: T; timestamp: number } | null> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result as CacheEntry<T> | undefined;
        if (result) {
          resolve({ data: result.data, timestamp: result.timestamp });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to get cache entry:", error);
    return null;
  }
}

/**
 * Clear a specific cache entry
 */
export async function clearCacheEntry(key: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to clear cache entry:", error);
  }
}

/**
 * Clear all cached entries
 */
export async function clearAllCache(): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to clear cache:", error);
  }
}
