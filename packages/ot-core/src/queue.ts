/**
 * queue.ts - Pending-op queue.
 *
 * A pending op is one that has been submitted locally but not yet assigned
 * a global seq by the leader.  The queue maintains insertion order and
 * exposes enqueue / dequeue / peek / drain.
 */

import type { ClientSeq, Operation, Seq } from '@polychrome/protocol';

/** Extended record stored in the queue. */
export interface PendingEntry {
  /** The op as submitted (seq === 0). */
  op:        Operation;
  /** parentSeq at the moment the op was enqueued. */
  parentSeq: Seq;
  /** Resolve callback for the Promise returned to submitLocal. */
  resolve:   (confirmed: Operation) => void;
  /** Reject callback (used when the op is cancelled, e.g. leader changed). */
  reject:    (err: Error) => void;
}

/**
 * FIFO queue for pending (unconfirmed) local ops.
 *
 * Thread-safety: this class is single-threaded JS; no locking needed.
 */
export class PendingQueue {
  private readonly _entries: PendingEntry[] = [];

  /** Number of pending ops. */
  get size(): number {
    return this._entries.length;
  }

  /** Add a new pending entry at the tail. */
  enqueue(entry: PendingEntry): void {
    this._entries.push(entry);
  }

  /** Remove and return the entry at the head (undefined if empty). */
  dequeue(): PendingEntry | undefined {
    return this._entries.shift();
  }

  /** Peek at the entry at the head without removing it. */
  peek(): PendingEntry | undefined {
    return this._entries[0];
  }

  /** Find entry by clientSeq (O(n) - queue is typically tiny). */
  findByClientSeq(clientSeq: ClientSeq): PendingEntry | undefined {
    return this._entries.find(e => e.op.clientSeq === clientSeq);
  }

  /**
   * Remove and return ALL entries.
   * Used when the leader changes so they can be re-sent.
   */
  drain(): PendingEntry[] {
    return this._entries.splice(0);
  }

  /** Iterate entries without modifying the queue. */
  [Symbol.iterator](): Iterator<PendingEntry> {
    return this._entries[Symbol.iterator]();
  }
}
