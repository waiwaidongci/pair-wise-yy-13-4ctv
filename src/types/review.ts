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

export interface CommentReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  /** 本机待同步，尚未并入服务端 */
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
  /** 本机待同步，尚未并入服务端 */
  pending?: boolean;
  /** 文件内容更新后锚点丢失，位置无法重算 */
  outdated?: boolean;
  /** 与服务端版本冲突，待裁决 */
  conflictId?: string;
  /** 锚定行的文本，内容更新后据此重算位置 */
  anchorText?: string;
  /** 锚定时的文件版本 */
  anchorRevision?: number;
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
