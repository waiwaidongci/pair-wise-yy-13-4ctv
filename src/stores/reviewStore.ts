import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mockChangeLines, mockDiffFiles } from "../data/mockDiff";
import type { CommentDraft, CommentSide, DiffViewMode, ReviewComment } from "../types/review";

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
}

const initialComments: ReviewComment[] = [
  {
    id: "comment-payment-cache-version",
    fileId: "payment-service",
    line: mockChangeLines["payment-service"][0],
    side: "modified",
    author: "林澈",
    body: "缓存版本参与 key 后，旧版本数据不会命中；这里还需要确认发版期间双写时间足够长。",
    createdAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    resolved: false,
    replies: [
      {
        id: "reply-cache-1",
        author: "陈乔木",
        body: "已确认灰度期间会保留 30 分钟双写，并监控 cache.miss 指标。",
        createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
    ],
  },
  {
    id: "comment-payment-retry",
    fileId: "payment-service",
    line: mockChangeLines["payment-service"][4],
    side: "modified",
    author: "赵明",
    body: "重试只覆盖网络错误和网关超时就可以，业务拒绝不能重试，当前分类是正确的。",
    createdAt: new Date(Date.now() - 26 * 60_000).toISOString(),
    resolved: true,
    replies: [],
  },
  {
    id: "comment-order-table-selection",
    fileId: "order-table",
    line: mockChangeLines["order-table"][1],
    side: "modified",
    author: "周岚",
    body: "批量选择在翻页后会不会丢数据？建议状态层使用 Set，并补一个跨页选择测试。",
    createdAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    resolved: false,
    replies: [],
  },
  {
    id: "comment-validator-phone",
    fileId: "validators",
    line: mockChangeLines["validators"][0],
    side: "modified",
    author: "林澈",
    body: "手机号校验从宽松改为大陆号段，需要确认海外手机号是否走单独入口。",
    createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    resolved: false,
    replies: [],
  },
];

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      files: mockDiffFiles,
      selectedFileId: mockDiffFiles[0].id,
      viewMode: "side-by-side",
      hideUnchanged: true,
      reviewedFiles: ["router"],
      comments: initialComments,
      draft: null,

      setSelectedFile: (selectedFileId) => set({ selectedFileId, draft: null }),
      setViewMode: (viewMode) => set({ viewMode }),
      setHideUnchanged: (hideUnchanged) => set({ hideUnchanged }),

      toggleReviewed: (fileId) => {
        const target = fileId ?? get().selectedFileId;
        set((state) => ({
          reviewedFiles: state.reviewedFiles.includes(target)
            ? state.reviewedFiles.filter((id) => id !== target)
            : [...state.reviewedFiles, target],
        }));
      },

      setDraft: (draft) => set({ draft }),

      addComment: (draft, body) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        const comment: ReviewComment = {
          id: `comment-${Date.now()}`,
          fileId: draft.fileId,
          line: draft.line,
          side: draft.side,
          author: "林澈",
          body: trimmed,
          createdAt: new Date().toISOString(),
          resolved: false,
          replies: [],
        };
        set((state) => ({ comments: [...state.comments, comment], draft: null }));
      },

      addReply: (commentId, body) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  replies: [
                    ...comment.replies,
                    {
                      id: `reply-${Date.now()}-${comment.replies.length}`,
                      author: "林澈",
                      body: trimmed,
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : comment,
          ),
        }));
      },

      resolveComment: (commentId, resolved = true) =>
        set((state) => ({
          comments: state.comments.map((comment) => (comment.id === commentId ? { ...comment, resolved } : comment)),
        })),

      deleteComment: (commentId) =>
        set((state) => ({ comments: state.comments.filter((comment) => comment.id !== commentId) })),
    }),
    {
      name: "diff-scope-review-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedFileId: state.selectedFileId,
        viewMode: state.viewMode,
        hideUnchanged: state.hideUnchanged,
        reviewedFiles: state.reviewedFiles,
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
