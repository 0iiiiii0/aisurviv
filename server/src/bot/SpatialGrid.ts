/**
 * Lightweight uniform spatial hash for short-range entity queries.
 *
 * A position accessor is supported because surviv.io stores object positions
 * under `object.data.pos`, while standalone tests and other callers may expose
 * `pos` directly.
 */
export class SpatialGrid<T> {
    private readonly cells = new Map<string, T[]>();
    private readonly cellSize: number;
    private readonly getPosition: (entity: T) => { x: number; y: number } | undefined;

    constructor(
        cellSize = 64,
        getPosition: (entity: T) => { x: number; y: number } | undefined = (
            entity: T,
        ): { x: number; y: number } | undefined => (entity as unknown as { pos?: { x: number; y: number } }).pos,
    ) {
        if (!Number.isFinite(cellSize) || cellSize <= 0) {
            throw new RangeError("SpatialGrid cellSize must be greater than zero");
        }
        this.cellSize = cellSize;
        this.getPosition = getPosition;
    }

    private getKey(x: number, y: number): string {
        return `${Math.floor(x / this.cellSize)}_${Math.floor(y / this.cellSize)}`;
    }

    rebuild(entities: Iterable<T>): void {
        this.cells.clear();
        for (const entity of entities) {
            const pos = this.getPosition(entity);
            if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
            const key = this.getKey(pos.x, pos.y);
            const list = this.cells.get(key);
            if (list) list.push(entity);
            else this.cells.set(key, [entity]);
        }
    }

    queryRadius(center: { x: number; y: number }, radius: number): T[] {
        if (
            !Number.isFinite(center.x)
            || !Number.isFinite(center.y)
            || !Number.isFinite(radius)
            || radius < 0
        ) {
            return [];
        }

        const result: T[] = [];
        const r2 = radius * radius;
        const minCX = Math.floor((center.x - radius) / this.cellSize);
        const maxCX = Math.floor((center.x + radius) / this.cellSize);
        const minCY = Math.floor((center.y - radius) / this.cellSize);
        const maxCY = Math.floor((center.y + radius) / this.cellSize);

        for (let cx = minCX; cx <= maxCX; cx += 1) {
            for (let cy = minCY; cy <= maxCY; cy += 1) {
                const list = this.cells.get(`${cx}_${cy}`);
                if (!list) continue;
                for (const entity of list) {
                    const pos = this.getPosition(entity);
                    if (!pos) continue;
                    const dx = pos.x - center.x;
                    const dy = pos.y - center.y;
                    if (dx * dx + dy * dy <= r2) result.push(entity);
                }
            }
        }
        return result;
    }

    clear(): void {
        this.cells.clear();
    }

    get populatedCellCount(): number {
        return this.cells.size;
    }
}
