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
