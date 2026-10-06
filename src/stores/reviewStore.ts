import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mockDiffFiles } from "../data/mockDiff";
import { seedComments } from "../data/seedComments";
import type { ServerComment, ServerFileState } from "../server/mockServer";
import { reanchor, snippetFor } from "../utils/anchor";
import type {
  CommentDraft,
  CommentSide,
  ConflictResolution,
  DiffViewMode,
  ReviewComment,
  SyncConflict,
  SyncOp,
} from "../types/review";
import { createOpId, makeOp, useSyncStore } from "./syncStore";

interface ApplyServerStateArgs {
  version: number;
  comments: ServerComment[];
  reviewedFiles: string[];
  files: Record<string, ServerFileState>;
  invalidations: Array<{ fileId: string; at: string; reason: string }>;
  syncedClientIds?: string[];
  conflictMap?: Record<string, string>;
  appliedDeleteIds?: string[];
}

interface ReviewState {
  files: typeof mockDiffFiles;
  selectedFileId: string;
  viewMode: DiffViewMode;
  hideUnchanged: boolean;
  reviewedFiles: string[];
  comments: ReviewComment[];
  draft: CommentDraft | null;
  setSelectedFile: (fileId: string) => void;
  setViewMode: (mode: DiffViewMode) => void;
  setHideUnchanged: (value: boolean) => void;
  toggleReviewed: (fileId?: string) => void;
  setDraft: (draft: CommentDraft | null) => void;
  addComment: (draft: CommentDraft, body: string) => void;
  addReply: (commentId: string, body: string) => void;
  resolveComment: (commentId: string, resolved?: boolean) => void;
  deleteComment: (commentId: string) => void;
  rollbackOp: (op: SyncOp) => void;
  reanchorComment: (commentId: string, line: number, side: CommentSide) => void;
  adjudicateConflict: (conflict: SyncConflict, resolution: ConflictResolution) => void;
  applyServerState: (args: ApplyServerStateArgs) => void;
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      files: mockDiffFiles,
      selectedFileId: mockDiffFiles[0].id,
      viewMode: "side-by-side",
      hideUnchanged: true,
      reviewedFiles: ["router"],
      comments: seedComments,
      draft: null,

      setSelectedFile: (selectedFileId) => set({ selectedFileId, draft: null }),
      setViewMode: (viewMode) => set({ viewMode }),
      setHideUnchanged: (hideUnchanged) => set({ hideUnchanged }),

      toggleReviewed: (fileId) => {
        const target = fileId ?? get().selectedFileId;
        const mark = !get().reviewedFiles.includes(target);
        const op = makeOp(
          mark ? "file:viewed" : "file:unviewed",
          { fileId: target },
          useSyncStore.getState().serverVersion,
        );
        set((state) => ({
          reviewedFiles: mark
            ? [...state.reviewedFiles, target]
            : state.reviewedFiles.filter((id) => id !== target),
        }));
        useSyncStore.getState().enqueue(op);
      },

      setDraft: (draft) => set({ draft }),

      addComment: (draft, body) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        const file = get().files.find((item) => item.id === draft.fileId);
        const snippet = file ? snippetFor(file, draft.side, draft.line) : "";
        const clientId = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const op = makeOp(
          "comment:add",
          {
            clientId,
            fileId: draft.fileId,
            line: draft.line,
            side: draft.side,
            author: "林澈",
            body: trimmed,
            anchor: { line: draft.line, side: draft.side, snippet },
          },
          useSyncStore.getState().serverVersion,
        );
        const comment: ReviewComment = {
          id: clientId,
          fileId: draft.fileId,
          line: draft.line,
          side: draft.side,
          author: "林澈",
          body: trimmed,
          createdAt: op.createdAt,
          resolved: false,
          replies: [],
          anchor: { line: draft.line, side: draft.side, snippet },
          pending: true,
        };
        set((state) => ({ comments: [...state.comments, comment], draft: null }));
        useSyncStore.getState().enqueue(op);
      },

      addReply: (commentId, body) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        const clientId = `reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const op = makeOp(
          "reply:add",
          { commentId, clientId, author: "林澈", body: trimmed },
          useSyncStore.getState().serverVersion,
        );
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  replies: [
                    ...comment.replies,
                    {
                      id: clientId,
                      author: "林澈",
                      body: trimmed,
                      createdAt: op.createdAt,
                      pending: true,
                    },
                  ],
                }
              : comment,
          ),
        }));
        useSyncStore.getState().enqueue(op);
      },

      resolveComment: (commentId, resolved = true) => {
        const op = makeOp(
          "comment:resolve",
          { commentId, resolved },
          useSyncStore.getState().serverVersion,
        );
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.id === commentId ? { ...comment, resolved } : comment,
          ),
        }));
        useSyncStore.getState().enqueue(op);
      },

      deleteComment: (commentId) => {
        const op = makeOp(
          "comment:delete",
          { commentId },
          useSyncStore.getState().serverVersion,
        );
        // 乐观删除：标记 deleted（界面隐藏），保留记录以便回滚或冲突恢复。
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.id === commentId ? { ...comment, deleted: true } : comment,
          ),
        }));
        useSyncStore.getState().enqueue(op);
      },

      rollbackOp: (op) => {
        switch (op.kind) {
          case "comment:add":
            set((state) => ({
              comments: state.comments.filter((comment) => comment.id !== op.payload.clientId),
            }));
            break;
          case "reply:add":
            set((state) => ({
              comments: state.comments.map((comment) =>
                comment.id === op.payload.commentId
                  ? { ...comment, replies: comment.replies.filter((reply) => reply.id !== op.payload.clientId) }
                  : comment,
              ),
            }));
            break;
          case "comment:resolve":
            set((state) => ({
              comments: state.comments.map((comment) =>
                comment.id === op.payload.commentId
                  ? { ...comment, resolved: !op.payload.resolved }
                  : comment,
              ),
            }));
            break;
          case "comment:delete":
            set((state) => ({
              comments: state.comments.map((comment) =>
                comment.id === op.payload.commentId ? { ...comment, deleted: false } : comment,
              ),
            }));
            break;
          case "file:viewed":
          case "file:unviewed":
            set((state) => ({
              reviewedFiles:
                op.kind === "file:viewed"
                  ? state.reviewedFiles.filter((id) => id !== op.payload.fileId)
                  : [...state.reviewedFiles, op.payload.fileId],
            }));
            break;
        }
      },

      reanchorComment: (commentId, line, side) => {
        const target = get().comments.find((comment) => comment.id === commentId);
        const file = target ? get().files.find((item) => item.id === target.fileId) : undefined;
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  line,
                  side,
                  orphaned: false,
                  reanchoredFrom: comment.reanchoredFrom ?? comment.line,
                  anchor: {
                    line,
                    side,
                    snippet: file ? snippetFor(file, side, line) : comment.anchor.snippet,
                  },
                }
              : comment,
          ),
        }));
      },

      adjudicateConflict: (conflict, resolution) => {
        const baseVersion = useSyncStore.getState().serverVersion;
        const enqueue = (op: SyncOp) => useSyncStore.getState().enqueue(op);
        switch (conflict.kind) {
          case "same-line-comment": {
            if (resolution === "keep-local" && conflict.remoteEntityId) {
              // 保留我的：删除同事的评论
              enqueue(makeOp("comment:delete", { commentId: conflict.remoteEntityId }, baseVersion));
            } else if (resolution === "keep-remote") {
              // 保留同事的：删除我的评论
              if (conflict.entityId) {
                set((state) => ({
                  comments: state.comments.filter((comment) => comment.id !== conflict.entityId),
                }));
                enqueue(makeOp("comment:delete", { commentId: conflict.entityId }, baseVersion));
              }
            }
            // keep-both：两条都保留
            break;
          }
          case "same-comment-state": {
            if (resolution === "keep-local" && conflict.entityId) {
              const localValue = get().comments.find((comment) => comment.id === conflict.entityId)?.resolved;
              if (localValue !== undefined) {
                enqueue(makeOp("comment:resolve", { commentId: conflict.entityId, resolved: localValue }, baseVersion));
              }
            } else if (resolution === "keep-remote" && conflict.entityId) {
              const remoteValue = conflict.remoteValue as boolean;
              set((state) => ({
                comments: state.comments.map((comment) =>
                  comment.id === conflict.entityId
                    ? { ...comment, resolved: remoteValue, conflict: false, conflictId: undefined }
                    : comment,
                ),
              }));
            }
            break;
          }
          case "deleted-with-replies": {
            if (resolution === "keep-local" && conflict.entityId) {
              // 仍删除
              set((state) => ({
                comments: state.comments.map((comment) =>
                  comment.id === conflict.entityId
                    ? { ...comment, deleted: true, conflict: false, conflictId: undefined }
                    : comment,
                ),
              }));
              enqueue(makeOp("comment:delete", { commentId: conflict.entityId }, baseVersion));
            }
            // keep-remote / keep-both：保留评论（含回复）
            break;
          }
        }
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.conflictId === conflict.id
              ? { ...comment, conflict: false, conflictId: undefined }
              : comment,
          ),
        }));
      },

      applyServerState: (args) => {
        const {
          comments: serverComments,
          reviewedFiles: serverReviewed,
          files: serverFiles,
          invalidations,
          syncedClientIds,
          conflictMap,
          appliedDeleteIds,
        } = args;
        const synced = new Set(syncedClientIds ?? []);
        const conflicts = new Set(Object.keys(conflictMap ?? {}));
        const deleted = new Set(appliedDeleteIds ?? []);
        const invalidated = new Set(invalidations.map((item) => item.fileId));

        set((state) => {
          // 1. 文件内容更新
          const nextFiles = state.files.map((file) => {
            const serverFile = serverFiles[file.id];
            if (!serverFile) return file;
            if (serverFile.oldContent === file.oldContent && serverFile.newContent === file.newContent) {
              return file;
            }
            return { ...file, oldContent: serverFile.oldContent, newContent: serverFile.newContent };
          });

          // 2. 已查看：内容更新的文件作废
          const nextReviewed = serverReviewed.filter((id) => !invalidated.has(id));

          // 3. 评论合并：服务端为准，本地乐观标记保留到 op 被确认为止
          const serverIds = new Set(serverComments.map((comment) => comment.id));
          const merged: ReviewComment[] = serverComments.map((serverComment) => {
            const local = state.comments.find((comment) => comment.id === serverComment.id);
            const isConflicted = conflicts.has(serverComment.id);
            const base = (isConflicted && local ? local : serverComment) as ReviewComment;
            return {
              ...base,
              pending: false,
              deleted: false,
              conflict: isConflicted,
              conflictId: isConflicted ? conflictMap![serverComment.id] : undefined,
              replies: base.replies.map((reply) => ({
                ...reply,
                pending: synced.has(reply.id) ? false : reply.pending,
              })),
            };
          });
          const localOnly: ReviewComment[] = state.comments
            .filter((comment) => {
              if (serverIds.has(comment.id)) return false;
              if (deleted.has(comment.id)) return false;
              return true;
            })
            .map((comment) => ({
              ...comment,
              pending: synced.has(comment.id) ? false : comment.pending,
              conflict: conflicts.has(comment.id) ? true : comment.conflict,
              conflictId: conflicts.has(comment.id) ? conflictMap![comment.id] : comment.conflictId,
              deleted: deleted.has(comment.id) ? true : comment.deleted,
              replies: comment.replies.map((reply) => ({
                ...reply,
                pending: synced.has(reply.id) ? false : reply.pending,
              })),
            }));

          let nextComments = [...merged, ...localOnly];

          // 4. 内容更新 → 按锚点 snippet 重算位置
          nextComments = nextComments.map((comment) => {
            const file = nextFiles.find((item) => item.id === comment.fileId);
            if (!file) return comment;
            const result = reanchor(comment.anchor, file);
            if (result.orphaned) {
              return { ...comment, orphaned: true };
            }
            if (result.line !== comment.line) {
              return {
                ...comment,
                line: result.line,
                reanchoredFrom: comment.reanchoredFrom ?? comment.line,
                orphaned: false,
                anchor: { ...comment.anchor, line: result.line },
              };
            }
            return comment;
          });

          return { files: nextFiles, reviewedFiles: nextReviewed, comments: nextComments };
        });
      },
    }),
    {
      name: "diff-scope-review-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedFileId: state.selectedFileId,
        viewMode: state.viewMode,
        hideUnchanged: state.hideUnchanged,
        reviewedFiles: state.reviewedFiles,
        comments: state.comments,
        files: state.files,
      }),
    },
  ),
);

export function commentsForFile(comments: ReviewComment[], fileId: string): ReviewComment[] {
  return comments
    .filter((comment) => comment.fileId === fileId && !comment.deleted)
    .sort(
      (left, right) =>
        Number(left.resolved) - Number(right.resolved) ||
        Number(left.conflict ?? false) - Number(right.conflict ?? false) ||
        left.line - right.line,
    );
}

export function commentSideLabel(side: CommentSide): string {
  return side === "original" ? "旧行" : "新行";
}
