import { Candle } from '@/types/trading';
import { SavedHistoricalDataset } from '@/types/historicalData';

const DATASETS_INDEX_KEY = 'tradelab_saved_datasets_v1';
const DB_NAME = 'TradeLab_Historical_v1';
const STORE_NAME = 'historical_datasets';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getIDBDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn('[DatasetStorage] IndexedDB open error, falling back to in-memory/localStorage');
        resolve(null);
      };
    } catch (err) {
      console.warn('[DatasetStorage] IndexedDB initialization failed:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

// In-memory cache fallback
const inMemoryDatasets = new Map<string, SavedHistoricalDataset>();

/**
 * Retrieve metadata list of all saved datasets
 */
export async function getSavedDatasetsList(): Promise<SavedHistoricalDataset[]> {
  if (typeof window === 'undefined') {
    return Array.from(inMemoryDatasets.values());
  }

  try {
    const raw = localStorage.getItem(DATASETS_INDEX_KEY);
    if (!raw) return [];
    const list: SavedHistoricalDataset[] = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('[DatasetStorage] Error reading datasets index:', err);
    return [];
  }
}

/**
 * Save dataset metadata index to localStorage
 */
function updateSavedDatasetsIndex(datasets: SavedHistoricalDataset[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Strip candle payload from index to keep localStorage tiny and fast
    const indexData = datasets.map((ds) => {
      const { candles, ...metaOnly } = ds;
      return metaOnly;
    });
    localStorage.setItem(DATASETS_INDEX_KEY, JSON.stringify(indexData));
  } catch (err) {
    console.warn('[DatasetStorage] Error saving datasets index:', err);
  }
}

/**
 * Retrieve full dataset including candles from IndexedDB
 */
export async function getSavedDatasetById(id: string): Promise<SavedHistoricalDataset | null> {
  if (inMemoryDatasets.has(id)) {
    return inMemoryDatasets.get(id)!;
  }

  try {
    const db = await getIDBDatabase();
    if (!db) {
      // Check localStorage fallback
      const list = await getSavedDatasetsList();
      return list.find((d) => d.id === id) || null;
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        if (req.result) {
          inMemoryDatasets.set(id, req.result);
          resolve(req.result);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[DatasetStorage] Error retrieving dataset by ID:', err);
    return null;
  }
}

/**
 * Save or update a full dataset in IndexedDB and localStorage index
 */
export async function saveHistoricalDataset(dataset: SavedHistoricalDataset): Promise<void> {
  inMemoryDatasets.set(dataset.id, dataset);

  // 1. Update localStorage metadata index
  const currentList = await getSavedDatasetsList();
  const existingIdx = currentList.findIndex((d) => d.id === dataset.id);
  const updatedList = [...currentList];

  const metaOnly: SavedHistoricalDataset = {
    ...dataset,
    candles: undefined,
  };

  if (existingIdx >= 0) {
    updatedList[existingIdx] = metaOnly;
  } else {
    updatedList.unshift(metaOnly);
  }
  updateSavedDatasetsIndex(updatedList);

  // 2. Save full dataset with candles to IndexedDB
  try {
    const db = await getIDBDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(dataset);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[DatasetStorage] Error storing dataset in IndexedDB:', err);
  }
}

/**
 * Delete a dataset from storage
 */
export async function deleteHistoricalDataset(id: string): Promise<void> {
  inMemoryDatasets.delete(id);

  // 1. Update localStorage metadata index
  const currentList = await getSavedDatasetsList();
  const updatedList = currentList.filter((d) => d.id !== id);
  updateSavedDatasetsIndex(updatedList);

  // 2. Remove from IndexedDB
  try {
    const db = await getIDBDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[DatasetStorage] Error deleting dataset from IndexedDB:', err);
  }
}

/**
 * Check if an identical dataset already exists
 */
export async function findDuplicateDataset(params: {
  instrument: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  priceType: string;
}): Promise<SavedHistoricalDataset | null> {
  const list = await getSavedDatasetsList();
  const match = list.find(
    (d) =>
      d.instrument.toLowerCase() === params.instrument.toLowerCase() &&
      d.timeframe.toLowerCase() === params.timeframe.toLowerCase() &&
      d.startDate === params.startDate &&
      d.endDate === params.endDate &&
      d.priceType === params.priceType
  );
  return match || null;
}
