export type DiffViewMode = "side-by-side" | "inline";
export type DiffFileStatus = "modified" | "added" | "deleted" | "renamed";
export type CommentSide = "original" | "modified";

export interface DiffFile {
  id: string;
  path: string;
  oldPath?: string;
  language: string;
  status: DiffFileStatus;
  oldContent: string;
  newContent: string;
  additions: number;
  deletions: number;
  description: string;
}

export interface CommentAnchor {
  line: number;
  side: CommentSide;
  snippet: string;
}

export interface CommentReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  pending?: boolean;
}

export interface ReviewComment {
  id: string;
  fileId: string;
  line: number;
  side: CommentSide;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
  anchor: CommentAnchor;
  pending?: boolean;
  deleted?: boolean;
  conflict?: boolean;
  conflictId?: string;
  orphaned?: boolean;
  reanchoredFrom?: number;
}

export interface CommentDraft {
  fileId: string;
  line: number;
  side: CommentSide;
}

export interface ReviewSummary {
  pullRequest: string;
  title: string;
  author: string;
  branch: string;
  baseBranch: string;
  reviewers: string[];
  updatedAt: string;
}

// ===== 离线同步：待同步操作（outbox）=====

export type SyncOpKind =
  | "comment:add"
  | "reply:add"
  | "comment:resolve"
  | "comment:delete"
  | "file:viewed"
  | "file:unviewed";

interface SyncOpBase {
  id: string;
  kind: SyncOpKind;
  createdAt: string;
  baseVersion: number;
}

export interface CommentAddOp extends SyncOpBase {
  kind: "comment:add";
  payload: {
    clientId: string;
    fileId: string;
    line: number;
    side: CommentSide;
    author: string;
    body: string;
    anchor: CommentAnchor;
  };
}

export interface ReplyAddOp extends SyncOpBase {
  kind: "reply:add";
  payload: {
    commentId: string;
    clientId: string;
    author: string;
    body: string;
  };
}

export interface CommentResolveOp extends SyncOpBase {
  kind: "comment:resolve";
  payload: { commentId: string; resolved: boolean };
}

export interface CommentDeleteOp extends SyncOpBase {
  kind: "comment:delete";
  payload: { commentId: string };
}

export interface FileViewedOp extends SyncOpBase {
  kind: "file:viewed" | "file:unviewed";
  payload: { fileId: string };
}

export type SyncOp = CommentAddOp | ReplyAddOp | CommentResolveOp | CommentDeleteOp | FileViewedOp;

export type OutboxStatus = "pending" | "inflight" | "done" | "failed";

export interface OutboxEntry {
  op: SyncOp;
  status: OutboxStatus;
  attempts: number;
  error?: string;
  enqueuedAt: string;
}

// ===== 冲突与裁决 =====

export type ConflictKind = "same-line-comment" | "same-comment-state" | "deleted-with-replies";
export type ConflictResolution = "keep-local" | "keep-remote" | "keep-both";

export interface SyncConflict {
  id: string;
  kind: ConflictKind;
  entityType: "comment" | "file";
  entityId: string;
  remoteEntityId?: string;
  fileId?: string;
  line?: number;
  side?: CommentSide;
  description: string;
  localLabel: string;
  localAt: string;
  remoteLabel: string;
  remoteAt: string;
  remoteValue?: unknown;
  resolution: ConflictResolution | null;
  createdAt: string;
}
