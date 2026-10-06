import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { initialComments, initialRevisions, initialViewedMarks, LOCAL_AUTHOR } from "../data/initialReview";
import { mockDiffFiles } from "../data/mockDiff";
import { applyOpToComments, applyViewedOp, reanchorComments } from "../sync/merge";
import type { CommentDraft, CommentSide, DiffFile, DiffViewMode, ReviewComment } from "../types/review";
import type { CommentConflict, ServerFileContent, ServerSnapshot, SyncOp, ViewedMark } from "../types/sync";
import { uid } from "../utils/id";
import { useSyncStore } from "./syncStore";

interface ReviewState {
  files: DiffFile[];
  selectedFileId: string;
  viewMode: DiffViewMode;
  hideUnchanged: boolean;
  /** 已查看标记（含查看时的文件版本），内容更新后自动失效 */
  viewedMarks: Record<string, ViewedMark>;
  fileRevisions: Record<string, number>;
  /** 派生：标记有效且版本未过期的文件 */
  reviewedFiles: string[];
  /** 派生：看过但内容已更新、需要重看的文件 */
  staleFiles: string[];
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
  /** 合并服务端快照：文件版本/内容、评论、已查看标记，并重放本机未确认操作 */
  applyServerSnapshot: (snapshot: ServerSnapshot, pendingOps: SyncOp[]) => void;
  /** 操作被服务端确认后，清除对应评论/回复的待同步标记 */
  markOpsSynced: (ops: SyncOp[]) => void;
  /** 回写评论上的冲突标记 */
  flagConflicts: (conflicts: CommentConflict[]) => void;
}

function deriveViewed(marks: Record<string, ViewedMark>, revisions: Record<string, number>) {
  const reviewedFiles: string[] = [];
  const staleFiles: string[] = [];
  for (const [fileId, mark] of Object.entries(marks)) {
    if (!mark.viewed) continue;
    if (mark.revision >= (revisions[fileId] ?? 1)) reviewedFiles.push(fileId);
    else staleFiles.push(fileId);
  }
  return { reviewedFiles, staleFiles };
}

function anchorTextOf(files: DiffFile[], fileId: string, side: CommentSide, line: number): string {
  const file = files.find((item) => item.id === fileId);
  if (!file) return "";
  const content = side === "original" ? file.oldContent : file.newContent;
  return content.split("\n")[line - 1] ?? "";
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      files: mockDiffFiles,
      selectedFileId: mockDiffFiles[0].id,
      viewMode: "side-by-side",
      hideUnchanged: true,
      viewedMarks: initialViewedMarks,
      fileRevisions: initialRevisions,
      ...deriveViewed(initialViewedMarks, initialRevisions),
      comments: initialComments,
      draft: null,

      setSelectedFile: (selectedFileId) => set({ selectedFileId, draft: null }),
      setViewMode: (viewMode) => set({ viewMode }),
      setHideUnchanged: (hideUnchanged) => set({ hideUnchanged }),

      toggleReviewed: (fileId) => {
        const target = fileId ?? get().selectedFileId;
        const state = get();
        const revision = state.fileRevisions[target] ?? 1;
        const current = state.reviewedFiles.includes(target);
        const viewedMarks: Record<string, ViewedMark> = {
          ...state.viewedMarks,
          [target]: { viewed: !current, revision, updatedAt: new Date().toISOString(), source: "local" },
        };
        set({ viewedMarks, ...deriveViewed(viewedMarks, state.fileRevisions) });
        useSyncStore.getState().enqueue({ kind: "file.viewed", fileId: target, viewed: !current, revision });
      },

      setDraft: (draft) => set({ draft }),

      addComment: (draft, body) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        const state = get();
        const comment: ReviewComment = {
          id: uid("comment"),
          fileId: draft.fileId,
          line: draft.line,
          side: draft.side,
          author: LOCAL_AUTHOR,
          body: trimmed,
          createdAt: new Date().toISOString(),
          resolved: false,
          replies: [],
          pending: true,
          anchorText: anchorTextOf(state.files, draft.fileId, draft.side, draft.line),
          anchorRevision: state.fileRevisions[draft.fileId] ?? 1,
        };
        // 断网时先记在本机（乐观生效），操作入队等待并入
        set((current) => ({ comments: [...current.comments, comment], draft: null }));
        useSyncStore.getState().enqueue({ kind: "comment.add", comment });
      },

      addReply: (commentId, body) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        const reply = {
          id: uid("reply"),
          author: LOCAL_AUTHOR,
          body: trimmed,
          createdAt: new Date().toISOString(),
          pending: true as const,
        };
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.id === commentId ? { ...comment, replies: [...comment.replies, reply] } : comment,
          ),
        }));
        useSyncStore.getState().enqueue({ kind: "comment.reply", commentId, reply });
      },

      resolveComment: (commentId, resolved = true) => {
        set((state) => ({
          comments: state.comments.map((comment) => (comment.id === commentId ? { ...comment, resolved } : comment)),
        }));
        useSyncStore.getState().enqueue({ kind: "comment.resolve", commentId, resolved });
      },

      deleteComment: (commentId) => {
        set((state) => ({ comments: state.comments.filter((comment) => comment.id !== commentId) }));
        const sync = useSyncStore.getState();
        // 尚未推送的新建/回复操作直接丢弃，删除操作入队（服务端幂等）
        sync.dropOpsForComment(commentId);
        sync.enqueue({ kind: "comment.delete", commentId });
      },

      applyServerSnapshot: (snapshot, pendingOps) =>
        set((state) => {
          // 1. 文件版本与内容
          const fileRevisions = { ...state.fileRevisions };
          let files = state.files;
          const changed: { fileId: string; content: ServerFileContent; revision: number }[] = [];
          for (const [fileId, revision] of Object.entries(snapshot.revisions)) {
            if (revision <= (fileRevisions[fileId] ?? 1)) continue;
            fileRevisions[fileId] = revision;
            const content = snapshot.fileContents[fileId];
            if (!content) continue;
            files = files.map((file) =>
              file.id === fileId ? { ...file, oldContent: content.oldContent, newContent: content.newContent } : file,
            );
            changed.push({ fileId, content, revision });
          }

          // 2. 评论：服务端快照 + 按发生顺序重放本机未确认操作（幂等）
          const ordered = [...pendingOps].sort((left, right) => left.seq - right.seq);
          let comments = snapshot.comments;
          for (const op of ordered) comments = applyOpToComments(comments, op);

          // 3. 内容更新过的文件：评论位置失效重算
          for (const { fileId, content, revision } of changed) {
            comments = reanchorComments(comments, fileId, content, revision);
          }

          // 4. 待同步标记以队列为准
          const pendingCommentIds = new Set(
            ordered.filter((op) => op.kind === "comment.add").map((op) => (op as Extract<SyncOp, { kind: "comment.add" }>).comment.id),
          );
          const pendingReplyIds = new Set(
            ordered.filter((op) => op.kind === "comment.reply").map((op) => (op as Extract<SyncOp, { kind: "comment.reply" }>).reply.id),
          );
          comments = comments.map((comment) => ({
            ...comment,
            pending: pendingCommentIds.has(comment.id) || undefined,
            replies: comment.replies.map((reply) => ({ ...reply, pending: pendingReplyIds.has(reply.id) || undefined })),
          }));

          // 5. 已查看标记：服务端快照 + 本机未确认操作；版本过期的标记派生时失效
          let viewedMarks = snapshot.viewedMarks;
          for (const op of ordered) {
            if (op.kind === "file.viewed") viewedMarks = applyViewedOp(viewedMarks, op);
          }

          return { files, comments, fileRevisions, viewedMarks, ...deriveViewed(viewedMarks, fileRevisions) };
        }),

      markOpsSynced: (ops) =>
        set((state) => {
          const commentIds = new Set(
            ops.filter((op) => op.kind === "comment.add").map((op) => (op as Extract<SyncOp, { kind: "comment.add" }>).comment.id),
          );
          const replyIds = new Set(
            ops.filter((op) => op.kind === "comment.reply").map((op) => (op as Extract<SyncOp, { kind: "comment.reply" }>).reply.id),
          );
          if (!commentIds.size && !replyIds.size) return state;
          return {
            comments: state.comments.map((comment) => ({
              ...comment,
              pending: comment.pending && commentIds.has(comment.id) ? undefined : comment.pending,
              replies: comment.replies.map((reply) =>
                reply.pending && replyIds.has(reply.id) ? { ...reply, pending: undefined } : reply,
              ),
            })),
          };
        }),

      flagConflicts: (conflicts) =>
        set((state) => ({
          comments: state.comments.map((comment) => {
            const conflict = conflicts.find(
              (item) => item.localCommentId === comment.id || item.serverCommentId === comment.id,
            );
            const conflictId = conflict?.id;
            return comment.conflictId === conflictId ? comment : { ...comment, conflictId };
          }),
        })),
    }),
    {
      name: "diff-scope-review-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedFileId: state.selectedFileId,
        viewMode: state.viewMode,
        hideUnchanged: state.hideUnchanged,
        viewedMarks: state.viewedMarks,
        fileRevisions: state.fileRevisions,
        comments: state.comments,
      }),
    },
  ),
);

export function commentsForFile(comments: ReviewComment[], fileId: string): ReviewComment[] {
  return comments
    .filter((comment) => comment.fileId === fileId)
    .sort((left, right) => Number(left.resolved) - Number(right.resolved) || left.line - right.line);
}

export function commentSideLabel(side: CommentSide): string {
  return side === "original" ? "旧行" : "新行";
}
