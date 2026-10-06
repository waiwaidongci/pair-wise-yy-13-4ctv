import type { CommentReply, CommentSide, ReviewComment } from "../types/review";

export type SyncOpKind = "comment.add" | "comment.reply" | "comment.resolve" | "comment.delete" | "file.viewed";
export type SyncOpStatus = "pending" | "syncing" | "failed";

interface OpBase {
  /** 客户端生成的幂等键，重复补传不会重复生效 */
  opId: string;
  /** 本机单调递增序号，恢复联网后按发生顺序并入 */
  seq: number;
  kind: SyncOpKind;
  createdAt: string;
  status: SyncOpStatus;
  attempts: number;
  lastError?: string;
  /** 失败退避：早于此时间不参与重试 */
  nextRetryAt?: number;
}

export interface CommentAddOp extends OpBase {
  kind: "comment.add";
  comment: ReviewComment;
}

export interface CommentReplyOp extends OpBase {
  kind: "comment.reply";
  commentId: string;
  reply: CommentReply;
}

export interface CommentResolveOp extends OpBase {
  kind: "comment.resolve";
  commentId: string;
  resolved: boolean;
}

export interface CommentDeleteOp extends OpBase {
  kind: "comment.delete";
  commentId: string;
}

export interface FileViewedOp extends OpBase {
  kind: "file.viewed";
  fileId: string;
  viewed: boolean;
  /** 用户实际查看的文件版本，内容更新后该标记失效 */
  revision: number;
}

export type SyncOp = CommentAddOp | CommentReplyOp | CommentResolveOp | CommentDeleteOp | FileViewedOp;

/** enqueue 入参：不含 opId/seq 等由队列统一赋值的字段 */
export type SyncOpInput =
  | { kind: "comment.add"; comment: ReviewComment }
  | { kind: "comment.reply"; commentId: string; reply: CommentReply }
  | { kind: "comment.resolve"; commentId: string; resolved: boolean }
  | { kind: "comment.delete"; commentId: string }
  | { kind: "file.viewed"; fileId: string; viewed: boolean; revision: number };

export interface ViewedMark {
  viewed: boolean;
  /** 标记时查看的文件版本 */
  revision: number;
  updatedAt: string;
  source: "local" | "server";
}

/** 同一行两侧各有一份修改，裁决前都保留 */
export interface CommentConflict {
  id: string;
  fileId: string;
  line: number;
  side: CommentSide;
  localCommentId: string;
  serverCommentId: string;
  /** 差异说明 */
  summary: string;
  createdAt: string;
}

export type Adjudication = "local" | "server" | "both";

export interface ServerFileContent {
  oldContent: string;
  newContent: string;
}

export interface ServerSnapshot {
  comments: ReviewComment[];
  viewedMarks: Record<string, ViewedMark>;
  revisions: Record<string, number>;
  fileContents: Record<string, ServerFileContent>;
  serverTime: string;
}
