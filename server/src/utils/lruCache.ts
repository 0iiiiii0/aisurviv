export class LruCache<K, V> {
    private readonly map = new Map<K, V>();
    private readonly maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.maxSize) {
            const firstKey = this.map.keys().next().value;
            if (firstKey !== undefined) this.map.delete(firstKey);
        }
        this.map.set(key, value);
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    delete(key: K): void {
        this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}
