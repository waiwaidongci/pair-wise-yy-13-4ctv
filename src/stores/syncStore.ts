import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as server from "../server/mockServer";
import type {
  ConflictResolution,
  OutboxEntry,
  OutboxStatus,
  SyncConflict,
  SyncOp,
  SyncOpKind,
} from "../types/review";
import { useReviewStore } from "./reviewStore";

// ===== 操作构造 =====

export function createOpId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function makeOp<K extends SyncOpKind>(
  kind: K,
  payload: Extract<SyncOp, { kind: K }>["payload"],
  baseVersion: number,
): Extract<SyncOp, { kind: K }> {
  return {
    id: createOpId(),
    kind,
    createdAt: new Date().toISOString(),
    baseVersion,
    payload,
  } as Extract<SyncOp, { kind: K }>;
}

function describeRemoteOp(op: SyncOp): string {
  switch (op.kind) {
    case "comment:add":
      return `新评论：${op.payload.body.slice(0, 16)}…`;
    case "reply:add":
      return `新回复：${op.payload.body.slice(0, 16)}…`;
    case "comment:resolve":
      return op.payload.resolved ? "标记评论为已解决" : "重新打开评论";
    case "comment:delete":
      return "删除了一条评论";
    case "file:viewed":
      return `标记 ${op.payload.fileId} 为已查看`;
    case "file:unviewed":
      return `取消标记 ${op.payload.fileId} 的已查看`;
  }
}

// ===== 服务端状态应用参数（reviewStore 实现）=====

export interface ApplyServerStateArgs {
  version: number;
  comments: server.ServerComment[];
  reviewedFiles: string[];
  files: Record<string, server.ServerFileState>;
  invalidations: server.FileInvalidation[];
  syncedClientIds?: string[];
  conflictMap?: Record<string, string>;
  appliedDeleteIds?: string[];
}

interface SyncState {
  simulatedOffline: boolean;
  serverVersion: number;
  outbox: OutboxEntry[];
  conflicts: SyncConflict[];
  invalidatedFiles: string[];
  syncStatus: "idle" | "syncing" | "error";
  lastSyncAt: string | null;
  lastError: string | null;
  remoteFeed: Array<{ id: string; description: string; at: string }>;
  conflictCenterOpen: boolean;
  outboxOpen: boolean;

  setSimulatedOffline: (value: boolean) => void;
  isOnline: () => boolean;
  enqueue: (op: SyncOp) => void;
  syncNow: () => Promise<void>;
  pullNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
  discardOp: (opId: string) => void;
  resolveConflict: (conflictId: string, resolution: ConflictResolution) => void;
  dismissConflict: (conflictId: string) => void;
  clearInvalidation: (fileId: string) => void;
  setConflictCenterOpen: (open: boolean) => void;
  setOutboxOpen: (open: boolean) => void;
  resetAll: () => void;
}

let offlineTimers: number[] = [];

function effectiveOnline(get: () => SyncState): boolean {
  return !get().simulatedOffline && typeof navigator !== "undefined" && navigator.onLine;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => {
      if (typeof window !== "undefined") {
        window.addEventListener("online", () => {
          if (!get().simulatedOffline) void get().syncNow();
        });
      }
      return {
        simulatedOffline: false,
        serverVersion: 1,
        outbox: [],
        conflicts: [],
        invalidatedFiles: [],
        syncStatus: "idle",
        lastSyncAt: null,
        lastError: null,
        remoteFeed: [],
        conflictCenterOpen: false,
        outboxOpen: false,

        isOnline: () => effectiveOnline(get),

        setSimulatedOffline: (value) => {
          set({ simulatedOffline: value });
          if (value) {
            offlineTimers.forEach(clearTimeout);
            offlineTimers = [];
            offlineTimers.push(
              window.setTimeout(() => void server.colleagueActivity(), 3500),
              window.setTimeout(() => void server.colleagueActivity(), 8000),
            );
          } else {
            offlineTimers.forEach(clearTimeout);
            offlineTimers = [];
            if (typeof navigator !== "undefined" && navigator.onLine) void get().syncNow();
          }
        },

        enqueue: (op) => {
          set((state) => ({
            outbox: [
              ...state.outbox,
              { op, status: "pending", attempts: 0, enqueuedAt: new Date().toISOString() },
            ],
          }));
          if (effectiveOnline(get)) void get().syncNow();
        },

        syncNow: async () => {
          if (get().syncStatus === "syncing") return;
          if (!effectiveOnline(get)) return;
          const pending = get().outbox.filter(
            (entry) => entry.status === "pending" || entry.status === "failed",
          );
          if (pending.length === 0) {
            await get().pullNow();
            return;
          }
          set({ syncStatus: "syncing", lastError: null });
          set((state) => ({
            outbox: state.outbox.map((entry) =>
              pending.some((item) => item.op.id === entry.op.id)
                ? { ...entry, status: "inflight" as OutboxStatus }
                : entry,
            ),
          }));
          try {
            const result = await server.pushOps(
              pending.map((entry) => entry.op),
              get().serverVersion,
            );
            const syncedClientIds = new Set<string>();
            const appliedDeleteIds = new Set<string>();
            for (const entry of pending) {
              const delivered =
                result.appliedOpIds.includes(entry.op.id) || result.duplicatedOpIds.includes(entry.op.id);
              if (!delivered) continue;
              if (entry.op.kind === "comment:add") syncedClientIds.add(entry.op.payload.clientId);
              if (entry.op.kind === "reply:add") syncedClientIds.add(entry.op.payload.clientId);
              if (entry.op.kind === "comment:delete") appliedDeleteIds.add(entry.op.payload.commentId);
            }
            const conflictMap: Record<string, string> = {};
            for (const conflict of result.conflicts) {
              conflictMap[conflict.entityId] = conflict.id;
              if (conflict.remoteEntityId) conflictMap[conflict.remoteEntityId] = conflict.id;
            }
            useReviewStore.getState().applyServerState({
              version: result.version,
              comments: result.comments,
              reviewedFiles: result.reviewedFiles,
              files: result.files,
              invalidations: result.invalidations,
              syncedClientIds: [...syncedClientIds],
              conflictMap,
              appliedDeleteIds: [...appliedDeleteIds],
            });
            if (result.conflicts.length > 0) {
              set((state) => ({
                conflicts: [
                  ...state.conflicts,
                  ...result.conflicts.map((conflict) => ({
                    id: conflict.id,
                    kind: conflict.kind,
                    entityType: conflict.entityType,
                    entityId: conflict.entityId,
                    remoteEntityId: conflict.remoteEntityId,
                    fileId: conflict.fileId,
                    line: conflict.line,
                    side: conflict.side,
                    description: conflict.description,
                    localLabel: conflict.localLabel,
                    localAt: conflict.localAt,
                    remoteLabel: conflict.remoteLabel,
                    remoteAt: conflict.remoteAt,
                    remoteValue: conflict.remoteValue,
                    resolution: null,
                    createdAt: new Date().toISOString(),
                  })),
                ],
              }));
            }
            if (result.invalidations.length > 0) {
              set((state) => ({
                invalidatedFiles: [
                  ...new Set([...state.invalidatedFiles, ...result.invalidations.map((item) => item.fileId)]),
                ],
              }));
            }
            set((state) => ({
              serverVersion: result.version,
              syncStatus: "idle",
              lastSyncAt: new Date().toISOString(),
              outbox: state.outbox.map((entry) => {
                if (
                  result.appliedOpIds.includes(entry.op.id) ||
                  result.duplicatedOpIds.includes(entry.op.id)
                ) {
                  return { ...entry, status: "done" as OutboxStatus, error: undefined };
                }
                if (pending.some((item) => item.op.id === entry.op.id)) {
                  return { ...entry, status: "done" as OutboxStatus, error: undefined };
                }
                return entry;
              }),
            }));
            void get().pullNow();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            set((state) => ({
              syncStatus: "error",
              lastError: message,
              outbox: state.outbox.map((entry) =>
                entry.status === "inflight"
                  ? { ...entry, status: "failed" as OutboxStatus, attempts: entry.attempts + 1, error: message }
                  : entry,
              ),
            }));
          }
        },

        pullNow: async () => {
          if (!effectiveOnline(get)) return;
          try {
            const result = await server.pullState(get().serverVersion);
            const conflictMap: Record<string, string> = {};
            useReviewStore.getState().applyServerState({
              version: result.version,
              comments: result.comments,
              reviewedFiles: result.reviewedFiles,
              files: result.files,
              invalidations: result.invalidations,
              conflictMap,
            });
            set({
              serverVersion: result.version,
              remoteFeed: result.remoteOps.slice(-8).map((record) => ({
                id: `${record.version}-${record.op.id}`,
                description: describeRemoteOp(record.op),
                at: record.at,
              })),
            });
            if (result.invalidations.length > 0) {
              set((state) => ({
                invalidatedFiles: [
                  ...new Set([...state.invalidatedFiles, ...result.invalidations.map((item) => item.fileId)]),
                ],
              }));
            }
          } catch {
            /* 拉取失败静默，下次同步再试 */
          }
        },

        retryFailed: async () => {
          await get().syncNow();
        },

        discardOp: (opId) => {
          const entry = get().outbox.find((item) => item.op.id === opId);
          if (entry && entry.status !== "done") {
            useReviewStore.getState().rollbackOp(entry.op);
          }
          set((state) => ({ outbox: state.outbox.filter((item) => item.op.id !== opId) }));
        },

        resolveConflict: (conflictId, resolution) => {
          const conflict = get().conflicts.find((item) => item.id === conflictId);
          if (!conflict) return;
          useReviewStore.getState().adjudicateConflict(conflict, resolution);
          set((state) => ({
            conflicts: state.conflicts.filter((item) => item.id !== conflictId),
          }));
          if (effectiveOnline(get)) void get().syncNow();
        },

        dismissConflict: (conflictId) => {
          useReviewStore.getState().adjudicateConflict(
            get().conflicts.find((item) => item.id === conflictId)!,
            "keep-both",
          );
          set((state) => ({
            conflicts: state.conflicts.filter((item) => item.id !== conflictId),
          }));
        },

        clearInvalidation: (fileId) => {
          set((state) => ({
            invalidatedFiles: state.invalidatedFiles.filter((id) => id !== fileId),
          }));
        },

        setConflictCenterOpen: (open) => set({ conflictCenterOpen: open }),
        setOutboxOpen: (open) => set({ outboxOpen: open }),

        resetAll: () => {
          server.resetServer();
          try {
            localStorage.removeItem("diff-scope-review-v1");
            localStorage.removeItem("diff-scope-sync-v1");
          } catch {
            /* ignore */
          }
          window.location.reload();
        },
      };
    },
    {
      name: "diff-scope-sync-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        simulatedOffline: state.simulatedOffline,
        serverVersion: state.serverVersion,
        outbox: state.outbox,
        conflicts: state.conflicts,
        invalidatedFiles: state.invalidatedFiles,
      }),
    },
  ),
);

// 联网状态 Hook
import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const simulatedOffline = useSyncStore((state) => state.simulatedOffline);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return !simulatedOffline && online;
}
