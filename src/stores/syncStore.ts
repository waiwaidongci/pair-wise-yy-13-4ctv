import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { LOCAL_AUTHOR } from "../data/initialReview";
import { conflictPairKey, detectLineConflicts } from "../sync/merge";
import { failNextPush, injectColleagueActivity, pullSnapshot, pushOps } from "../sync/mockServer";
import type { Adjudication, CommentAddOp, CommentConflict, SyncOp, SyncOpInput } from "../types/sync";
import { uid } from "../utils/id";
import { useReviewStore } from "./reviewStore";

interface SyncState {
  browserOnline: boolean;
  /** 演练用：模拟通勤断网 */
  simulatedOffline: boolean;
  syncing: boolean;
  /** 待同步操作队列，按 seq（发生顺序）并入服务端 */
  pendingOps: SyncOp[];
  conflicts: CommentConflict[];
  /** 已裁决过的评论对，避免重复报冲突 */
  adjudicatedPairs: string[];
  nextSeq: number;
  lastSyncAt: string | null;
  lastError: string | null;
  enqueue: (input: SyncOpInput) => void;
  dropOpsForComment: (commentId: string) => void;
  flush: (force?: boolean) => Promise<void>;
  retryNow: () => void;
  setBrowserOnline: (online: boolean) => void;
  setSimulatedOffline: (offline: boolean) => void;
  adjudicate: (conflictId: string, choice: Adjudication) => void;
  simulateColleague: () => void;
  simulatePushFailure: () => void;
}

export const selectIsOnline = (state: { browserOnline: boolean; simulatedOffline: boolean }): boolean =>
  state.browserOnline && !state.simulatedOffline;

const backoffMs = (attempts: number): number => Math.min(2 ** attempts * 2000, 30_000);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => {
      /** 合并服务端快照后：清理已失效的冲突、检测新冲突、回写评论上的冲突标记 */
      const reconcileConflicts = () => {
        const comments = useReviewStore.getState().comments;
        const existing = get().conflicts;
        const knownPairs = new Set([
          ...get().adjudicatedPairs,
          ...existing.map((conflict) => conflictPairKey(conflict.localCommentId, conflict.serverCommentId)),
        ]);
        const fresh = detectLineConflicts(comments, LOCAL_AUTHOR, knownPairs);
        const commentIds = new Set(comments.map((comment) => comment.id));
        const surviving = existing.filter(
          (conflict) => commentIds.has(conflict.localCommentId) && commentIds.has(conflict.serverCommentId),
        );
        const conflicts = [...surviving, ...fresh];
        set({ conflicts });
        useReviewStore.getState().flagConflicts(conflicts);
      };

      return {
        browserOnline: typeof navigator === "undefined" ? true : navigator.onLine,
        simulatedOffline: false,
        syncing: false,
        pendingOps: [],
        conflicts: [],
        adjudicatedPairs: [],
        nextSeq: 1,
        lastSyncAt: null,
        lastError: null,

        enqueue: (input) => {
          set((state) => {
            // 同一目标的同类操作只留最新一条，避免队列里堆叠无意义的中间态
            let queue = state.pendingOps;
            if (input.kind === "file.viewed") {
              queue = queue.filter((op) => !(op.kind === "file.viewed" && op.fileId === input.fileId));
            }
            if (input.kind === "comment.resolve") {
              queue = queue.filter((op) => !(op.kind === "comment.resolve" && op.commentId === input.commentId));
            }
            const op: SyncOp = {
              ...input,
              opId: uid("op"),
              seq: state.nextSeq,
              createdAt: new Date().toISOString(),
              status: "pending",
              attempts: 0,
            } as SyncOp;
            return { pendingOps: [...queue, op], nextSeq: state.nextSeq + 1 };
          });
          void get().flush();
        },

        dropOpsForComment: (commentId) =>
          set((state) => ({
            pendingOps: state.pendingOps.filter((op) => {
              if (op.kind === "comment.add") return op.comment.id !== commentId;
              if (op.kind === "comment.reply" || op.kind === "comment.resolve" || op.kind === "comment.delete") {
                return op.commentId !== commentId;
              }
              return true;
            }),
          })),

        flush: async (force = false) => {
          if (get().syncing || !selectIsOnline(get())) return;
          set({ syncing: true });
          try {
            // 1. 按发生顺序推送待同步操作；失败则保留队列等待重试
            for (;;) {
              const due = get()
                .pendingOps.filter((op) => op.status !== "syncing" && (force || (op.nextRetryAt ?? 0) <= Date.now()))
                .sort((left, right) => left.seq - right.seq);
              if (!due.length) break;
              const dueIds = new Set(due.map((op) => op.opId));
              set((state) => ({
                pendingOps: state.pendingOps.map((op) => (dueIds.has(op.opId) ? { ...op, status: "syncing" as const } : op)),
              }));
              try {
                const { acked } = await pushOps(due);
                const ackedSet = new Set(acked);
                const ackedOps = get().pendingOps.filter((op) => ackedSet.has(op.opId));
                set((state) => ({ pendingOps: state.pendingOps.filter((op) => !ackedSet.has(op.opId)) }));
                useReviewStore.getState().markOpsSynced(ackedOps);
              } catch (error) {
                const message = errorMessage(error);
                set((state) => ({
                  lastError: message,
                  pendingOps: state.pendingOps.map((op) =>
                    op.status === "syncing"
                      ? {
                          ...op,
                          status: "failed" as const,
                          attempts: op.attempts + 1,
                          lastError: message,
                          nextRetryAt: Date.now() + backoffMs(op.attempts + 1),
                        }
                      : op,
                  ),
                }));
                break;
              }
            }
            // 2. 拉取服务端快照，与本机未确认操作合并
            try {
              const snapshot = await pullSnapshot();
              useReviewStore.getState().applyServerSnapshot(snapshot, get().pendingOps);
              reconcileConflicts();
              set({ lastSyncAt: new Date().toISOString(), lastError: null });
            } catch (error) {
              set({ lastError: errorMessage(error) });
            }
          } finally {
            set({ syncing: false });
          }
          // 同步期间新入队的操作接着冲刷；失败退避未到期的操作交给定时器
          const hasDue = get().pendingOps.some((op) => op.status !== "failed" || (op.nextRetryAt ?? 0) <= Date.now());
          if (hasDue && selectIsOnline(get())) void get().flush();
        },

        retryNow: () => {
          set((state) => ({
            pendingOps: state.pendingOps.map((op) => (op.status === "failed" ? { ...op, nextRetryAt: 0 } : op)),
          }));
          void get().flush(true);
        },

        setBrowserOnline: (online) => {
          set({ browserOnline: online });
          if (online) void get().flush();
        },

        setSimulatedOffline: (offline) => {
          set({ simulatedOffline: offline });
          if (!offline) void get().flush(true);
        },

        adjudicate: (conflictId, choice) => {
          const conflict = get().conflicts.find((item) => item.id === conflictId);
          if (!conflict) return;
          set((state) => ({
            adjudicatedPairs: [...state.adjudicatedPairs, conflictPairKey(conflict.localCommentId, conflict.serverCommentId)],
          }));
          // 被裁掉的一方生成删除操作并入队；两者保留则无需变更
          if (choice === "local") useReviewStore.getState().deleteComment(conflict.serverCommentId);
          if (choice === "server") useReviewStore.getState().deleteComment(conflict.localCommentId);
          set((state) => ({ conflicts: state.conflicts.filter((item) => item.id !== conflictId) }));
          useReviewStore.getState().flagConflicts(get().conflicts);
        },

        simulateColleague: () => {
          const pendingAdd = get().pendingOps.find((op): op is CommentAddOp => op.kind === "comment.add");
          const target = pendingAdd
            ? { fileId: pendingAdd.comment.fileId, line: pendingAdd.comment.line, side: pendingAdd.comment.side }
            : undefined;
          injectColleagueActivity(target);
          void get().flush(true);
        },

        simulatePushFailure: () => failNextPush(1),
      };
    },
    {
      name: "diff-scope-sync-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        simulatedOffline: state.simulatedOffline,
        pendingOps: state.pendingOps,
        conflicts: state.conflicts,
        adjudicatedPairs: state.adjudicatedPairs,
        nextSeq: state.nextSeq,
        lastSyncAt: state.lastSyncAt,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SyncState>;
        return {
          ...current,
          ...stored,
          // 刷新页面时把“同步中”的操作退回待同步，避免卡死
          pendingOps: (stored.pendingOps ?? []).map((op) =>
            op.status === "syncing" ? { ...op, status: "pending" as const } : op,
          ),
        };
      },
    },
  ),
);
