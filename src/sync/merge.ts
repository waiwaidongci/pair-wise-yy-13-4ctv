import type { ReviewComment } from "../types/review";
import type { CommentConflict, FileViewedOp, ServerFileContent, SyncOp, ViewedMark } from "../types/sync";
import { uid } from "../utils/id";

/**
 * 把一条待同步操作应用到评论列表。
 * 客户端合并与服务端入库共用同一个 reducer：所有分支都按实体 id 幂等，
 * 同一条操作重复补传不会多出评论或回复。
 */
export function applyOpToComments(comments: ReviewComment[], op: SyncOp): ReviewComment[] {
  switch (op.kind) {
    case "comment.add": {
      if (comments.some((comment) => comment.id === op.comment.id)) return comments;
      return [...comments, { ...op.comment, pending: undefined }];
    }
    case "comment.reply":
      return comments.map((comment) => {
        if (comment.id !== op.commentId) return comment;
        if (comment.replies.some((reply) => reply.id === op.reply.id)) return comment;
        return { ...comment, replies: [...comment.replies, { ...op.reply, pending: undefined }] };
      });
    case "comment.resolve":
      return comments.map((comment) => (comment.id === op.commentId ? { ...comment, resolved: op.resolved } : comment));
    case "comment.delete":
      return comments.filter((comment) => comment.id !== op.commentId);
    default:
      return comments;
  }
}

/** 已查看标记按文件取最新一条（last-write-wins） */
export function applyViewedOp(marks: Record<string, ViewedMark>, op: FileViewedOp): Record<string, ViewedMark> {
  const current = marks[op.fileId];
  if (current && current.updatedAt >= op.createdAt) return marks;
  return {
    ...marks,
    [op.fileId]: { viewed: op.viewed, revision: op.revision, updatedAt: op.createdAt, source: "server" },
  };
}

/**
 * 文件内容更新后重算评论位置：
 * 按锚定行文本在新内容里找最近匹配行；找不到则标记位置失效（outdated）。
 */
export function reanchorComments(
  comments: ReviewComment[],
  fileId: string,
  content: ServerFileContent,
  revision: number,
): ReviewComment[] {
  const pools: Record<"original" | "modified", string[]> = {
    original: content.oldContent.split("\n"),
    modified: content.newContent.split("\n"),
  };
  return comments.map((comment) => {
    if (comment.fileId !== fileId) return comment;
    if (!comment.anchorText) return { ...comment, anchorRevision: revision };
    const pool = pools[comment.side];
    const located = locateLine(pool, comment.anchorText, comment.line);
    if (located === null) {
      return { ...comment, outdated: true, anchorRevision: revision };
    }
    return { ...comment, line: located, outdated: false, anchorRevision: revision };
  });
}

function locateLine(pool: string[], anchorText: string, previousLine: number): number | null {
  let best: number | null = null;
  for (let index = 0; index < pool.length; index += 1) {
    if (pool[index] !== anchorText) continue;
    if (best === null || Math.abs(index + 1 - previousLine) < Math.abs(best - previousLine)) best = index + 1;
  }
  if (best !== null) return best;
  const trimmed = anchorText.trim();
  if (!trimmed) return null;
  for (let index = 0; index < pool.length; index += 1) {
    if (pool[index].trim() !== trimmed) continue;
    if (best === null || Math.abs(index + 1 - previousLine) < Math.abs(best - previousLine)) best = index + 1;
  }
  return best;
}

export function conflictPairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join("::");
}

/**
 * 检测同一行两侧各改过的评论：同一 (文件, 侧, 行) 上，
 * 本机用户与他人各有一条内容不同的评论 → 各留一份，生成冲突待裁决。
 */
export function detectLineConflicts(
  comments: ReviewComment[],
  localAuthor: string,
  knownPairs: Set<string>,
): CommentConflict[] {
  const groups = new Map<string, ReviewComment[]>();
  for (const comment of comments) {
    const key = `${comment.fileId}|${comment.side}|${comment.line}`;
    const group = groups.get(key);
    if (group) group.push(comment);
    else groups.set(key, [comment]);
  }
  const conflicts: CommentConflict[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const mine = group.filter((comment) => comment.author === localAuthor);
    const theirs = group.filter((comment) => comment.author !== localAuthor);
    for (const local of mine) {
      for (const server of theirs) {
        if (local.body === server.body) continue;
        const pairKey = conflictPairKey(local.id, server.id);
        if (knownPairs.has(pairKey)) continue;
        knownPairs.add(pairKey);
        conflicts.push({
          id: uid("conflict"),
          fileId: local.fileId,
          line: local.line,
          side: local.side,
          localCommentId: local.id,
          serverCommentId: server.id,
          summary: describeDifference(local, server),
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
  return conflicts;
}

/** 生成两份评论的差异说明 */
export function describeDifference(local: ReviewComment, server: ReviewComment): string {
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const prefix = commonPrefixLength(local.body, server.body);
  const localTail = excerpt(local.body.slice(prefix));
  const serverTail = excerpt(server.body.slice(prefix));
  const divergence =
    prefix > 0
      ? `前 ${prefix} 字相同，之后本地写「${localTail}」，服务端写「${serverTail}」。`
      : `本地以「${localTail}」开头，服务端以「${serverTail}」开头。`;
  return (
    `同一行存在两个版本：本地 ${local.author} 写于 ${formatTime(local.createdAt)}（${local.body.length} 字），` +
    `服务端 ${server.author} 写于 ${formatTime(server.createdAt)}（${server.body.length} 字）。` +
    `${divergence}裁决前两份都保留，裁决后定稿。`
  );
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function excerpt(text: string): string {
  return text.length > 36 ? `${text.slice(0, 36)}…` : text || "（空）";
}
