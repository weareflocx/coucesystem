export interface HistoryEntry<T> {
  snapshot: T;
  label: string;
  restoreTime: boolean;
}

export class UndoHistory<T> {
  readonly #limit: number;
  readonly #past: HistoryEntry<T>[] = [];
  readonly #future: HistoryEntry<T>[] = [];

  constructor(limit = 100) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get undoLabel(): string {
    return this.#past.at(-1)?.label ?? "";
  }

  get redoLabel(): string {
    return this.#future.at(-1)?.label ?? "";
  }

  record(snapshot: T, label: string, restoreTime = false): void {
    this.#past.push({ snapshot, label, restoreTime });
    if (this.#past.length > this.#limit) this.#past.shift();
    this.#future.length = 0;
  }

  undo(currentSnapshot: T): HistoryEntry<T> | null {
    const target = this.#past.pop();
    if (!target) return null;
    this.#future.push({
      snapshot: currentSnapshot,
      label: target.label,
      restoreTime: target.restoreTime
    });
    return target;
  }

  redo(currentSnapshot: T): HistoryEntry<T> | null {
    const target = this.#future.pop();
    if (!target) return null;
    this.#past.push({
      snapshot: currentSnapshot,
      label: target.label,
      restoreTime: target.restoreTime
    });
    return target;
  }
}
