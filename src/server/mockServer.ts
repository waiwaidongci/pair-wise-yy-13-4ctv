import { mockChangeLines, mockDiffFiles } from "../data/mockDiff";
import { seedComments } from "../data/seedComments";
import { hashContent, snippetFor } from "../utils/anchor";
import type { CommentAnchor, CommentSide, SyncOp } from "../types/review";

// ===== 服务端数据形状 =====

export interface ServerReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  pending?: boolean;
}

export interface ServerComment {
  id: string;
  fileId: string;
  line: number;
  side: CommentSide;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: ServerReply[];
  anchor: CommentAnchor;
  deleted?: boolean;
}

export interface ServerFileState {
  oldContent: string;
  newContent: string;
  hash: string;
}

export interface FileInvalidation {
  fileId: string;
  at: string;
  reason: string;
}

interface AppliedRecord {
  version: number;
  op: SyncOp;
  at: string;
}

interface ServerData {
  version: number;
  comments: ServerComment[];
  reviewedFiles: string[];
  files: Record<string, ServerFileState>;
  appliedOpIds: string[];
  history: AppliedRecord[];
  invalidations: FileInvalidation[];
  failNextPush: boolean;
}

export interface PushConflict {
  id: string;
  kind: "same-line-comment" | "same-comment-state" | "deleted-with-replies";
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
}

export interface PushResult {
  version: number;
  comments: ServerComment[];
  reviewedFiles: string[];
  files: Record<string, ServerFileState>;
  appliedOpIds: string[];
  duplicatedOpIds: string[];
  conflicts: PushConflict[];
  invalidations: FileInvalidation[];
}

export interface PullResult {
  version: number;
  comments: ServerComment[];
  reviewedFiles: string[];
  files: Record<string, ServerFileState>;
  remoteOps: AppliedRecord[];
  invalidations: FileInvalidation[];
}

const STORAGE_KEY = "diff-scope-server-v1";
const LATENCY_MS = 420;
const COLLEAGUES = ["陈乔木", "周岚", "赵明"];

function now() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildSeedComments(): ServerComment[] {
  const extra: ServerComment = {
    id: "comment-order-store-risk-sort",
    fileId: "order-store",
    line: mockChangeLines["order-store"][0],
    side: "modified",
    author: "陈乔木",
    body: "按风险排序的 computed 建议确认大列表场景下的性能，必要时改为虚拟滚动。",
    createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    resolved: false,
    replies: [],
    anchor: anchorFor("order-store", 0),
  };
  return [...seedComments, extra].map((comment) => ({
    ...comment,
    deleted: false,
    replies: comment.replies.map((reply) => ({ ...reply })),
  }));
}

function anchorFor(fileId: string, index: number, side: CommentSide = "modified"): CommentAnchor {
  const file = mockDiffFiles.find((item) => item.id === fileId)!;
  const line = mockChangeLines[fileId][index];
  return { line, side, snippet: snippetFor(file, side, line) };
}

function buildInitialData(): ServerData {
  const files: Record<string, ServerFileState> = {};
  for (const file of mockDiffFiles) {
    files[file.id] = {
      oldContent: file.oldContent,
      newContent: file.newContent,
      hash: hashContent(file.oldContent, file.newContent),
    };
  }
  return {
    version: 1,
    comments: buildSeedComments(),
    reviewedFiles: ["router"],
    files,
    appliedOpIds: [],
    history: [],
    invalidations: [],
    failNextPush: false,
  };
}

function loadData(): ServerData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ServerData;
      if (parsed && Array.isArray(parsed.comments) && parsed.files) return parsed;
    }
  } catch {
    /* 落盘数据损坏时重建 */
  }
  return buildInitialData();
}

function saveData(data: ServerData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* 存储不可用时仅保留内存态 */
  }
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function publicState(data: ServerData) {
  return {
    comments: clone(data.comments.filter((comment) => !comment.deleted)),
    reviewedFiles: [...data.reviewedFiles],
    files: clone(data.files),
  };
}

// ===== 单条操作应用（含冲突检测）=====

function applyOp(data: ServerData, op: SyncOp, clientVersion: number): PushConflict | null {
  const concurrent = data.version > clientVersion;
  switch (op.kind) {
    case "comment:add": {
      const payload = op.payload;
      const rival = data.comments.find(
        (comment) =>
          !comment.deleted &&
          comment.fileId === payload.fileId &&
          comment.side === payload.side &&
          comment.line === payload.line &&
          comment.id !== payload.clientId,
      );
      data.comments.push({
        id: payload.clientId,
        fileId: payload.fileId,
        line: payload.line,
        side: payload.side,
        author: payload.author,
        body: payload.body,
        createdAt: op.createdAt,
        resolved: false,
        replies: [],
        anchor: payload.anchor,
      });
      if (rival) {
        return {
          id: `conflict-${op.id}`,
          kind: "same-line-comment",
          entityType: "comment",
          entityId: payload.clientId,
          remoteEntityId: rival.id,
          fileId: payload.fileId,
          line: payload.line,
          side: payload.side,
          description: `你和同事 ${rival.author} 在同一行（${payload.fileId} ${payload.side === "original" ? "旧行" : "新行"} ${payload.line}）各留了一条评论，两条都已保留。`,
          localLabel: `你（${payload.author}）`,
          localAt: op.createdAt,
          remoteLabel: rival.author,
          remoteAt: rival.createdAt,
        };
      }
      return null;
    }
    case "reply:add": {
      const payload = op.payload;
      const target = data.comments.find((comment) => comment.id === payload.commentId);
      if (!target || target.deleted) {
        if (target) {
          target.replies.push({
            id: payload.clientId,
            author: payload.author,
            body: payload.body,
            createdAt: op.createdAt,
          });
        }
        return {
          id: `conflict-${op.id}`,
          kind: "deleted-with-replies",
          entityType: "comment",
          entityId: payload.commentId,
          fileId: target?.fileId,
          line: target?.line,
          side: target?.side,
          description: `你回复的评论已被同事删除；回复内容已保留，等待裁决。`,
          localLabel: `你（${payload.author}）`,
          localAt: op.createdAt,
          remoteLabel: "同事",
          remoteAt: now(),
        };
      }
      target.replies.push({
        id: payload.clientId,
        author: payload.author,
        body: payload.body,
        createdAt: op.createdAt,
      });
      target.replies.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return null;
    }
    case "comment:resolve": {
      const payload = op.payload;
      const target = data.comments.find((comment) => comment.id === payload.commentId);
      if (!target) return null;
      if (concurrent && target.resolved !== payload.resolved) {
        return {
          id: `conflict-${op.id}`,
          kind: "same-comment-state",
          entityType: "comment",
          entityId: payload.commentId,
          fileId: target.fileId,
          line: target.line,
          side: target.side,
          description: `两边都修改了同一条评论的解决状态：你标记为${payload.resolved ? "已解决" : "未解决"}，同事标记为${target.resolved ? "已解决" : "未解决"}。`,
          localLabel: "你",
          localAt: op.createdAt,
          remoteLabel: target.author,
          remoteAt: target.createdAt,
          remoteValue: target.resolved,
        };
      }
      target.resolved = payload.resolved;
      return null;
    }
    case "comment:delete": {
      const payload = op.payload;
      const target = data.comments.find((comment) => comment.id === payload.commentId);
      if (!target) return null;
      if (concurrent && target.replies.length > 0) {
        const last = target.replies[target.replies.length - 1];
        return {
          id: `conflict-${op.id}`,
          kind: "deleted-with-replies",
          entityType: "comment",
          entityId: payload.commentId,
          fileId: target.fileId,
          line: target.line,
          side: target.side,
          description: `你删除的评论下有同事的回复（${target.replies.length} 条）；删除未生效，等待裁决。`,
          localLabel: "你",
          localAt: op.createdAt,
          remoteLabel: last.author,
          remoteAt: last.createdAt,
        };
      }
      target.deleted = true;
      return null;
    }
    case "file:viewed":
    case "file:unviewed": {
      const fileId = op.payload.fileId;
      // 文件内容已更新且未处理：已查看标记作废，本次标记不生效。
      if (data.invalidations.some((item) => item.fileId === fileId)) return null;
      const mark = op.kind === "file:viewed";
      const index = data.reviewedFiles.indexOf(fileId);
      if (mark && index < 0) data.reviewedFiles.push(fileId);
      if (!mark && index >= 0) data.reviewedFiles.splice(index, 1);
      return null;
    }
  }
}

// ===== 对外 API =====

export async function pushOps(ops: SyncOp[], clientVersion: number): Promise<PushResult> {
  await sleep(LATENCY_MS);
  const data = loadData();
  if (data.failNextPush) {
    data.failNextPush = false;
    saveData(data);
    throw new Error("模拟服务端错误：同步被拒绝，可点击重试");
  }
  const appliedOpIds: string[] = [];
  const duplicatedOpIds: string[] = [];
  const conflicts: PushConflict[] = [];
  for (const op of ops) {
    if (data.appliedOpIds.includes(op.id)) {
      duplicatedOpIds.push(op.id);
      continue; // 幂等：重复补传不会重复生效
    }
    data.appliedOpIds.push(op.id);
    data.history.push({ version: data.version, op, at: now() });
    const conflict = applyOp(data, op, clientVersion);
    if (conflict) conflicts.push(conflict);
    else appliedOpIds.push(op.id);
  }
  data.version += 1;
  const invalidations = data.invalidations.splice(0, data.invalidations.length);
  saveData(data);
  const state = publicState(data);
  return {
    version: data.version,
    ...state,
    appliedOpIds,
    duplicatedOpIds,
    conflicts,
    invalidations,
  };
}

export async function pullState(clientVersion: number): Promise<PullResult> {
  await sleep(LATENCY_MS);
  const data = loadData();
  const invalidations = data.invalidations.splice(0, data.invalidations.length);
  saveData(data);
  const state = publicState(data);
  return {
    version: data.version,
    ...state,
    remoteOps: data.history
      .filter((record) => record.version > clientVersion)
      .map((record) => ({ ...record, op: clone(record.op) })),
    invalidations,
  };
}

// 模拟离线期间同事产生的动态（评论、回复、解决状态、已查看）。
export async function colleagueActivity(): Promise<string> {
  await sleep(260);
  const data = loadData();
  const author = COLLEAGUES[Math.floor(Math.random() * COLLEAGUES.length)];
  const actions: Array<() => string | null> = [
    () => {
      const target = data.comments.find((comment) => !comment.deleted && comment.replies.length < 3);
      if (!target) return null;
      const bodies = [
        "补充一点：这里的灰度窗口建议配置中心可动态调整。",
        "同意，另外需要补一个监控看板观察缓存命中率。",
        "已在测试环境验证，双写期间没有出现旧版本误命中。",
      ];
      target.replies.push({
        id: `reply-server-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        author,
        body: bodies[Math.floor(Math.random() * bodies.length)],
        createdAt: now(),
      });
      return `${author} 回复了评论「${target.body.slice(0, 12)}…」`;
    },
    () => {
      const fileId = "payment-service";
      const line = mockChangeLines[fileId][0];
      // 允许在已有评论的同一行追加：用户离线在同一行评论时即触发同行冲突。
      data.comments.push({
        id: `comment-server-${Date.now()}`,
        fileId,
        line,
        side: "modified",
        author: "周岚",
        body: "这里的双写窗口需要支持按渠道配置，建议抽象成独立的灰度策略模块。",
        createdAt: now(),
        resolved: false,
        replies: [],
        anchor: anchorFor(fileId, 0),
      });
      return `周岚 在 payment.ts 新行 ${line} 发表了评论`;
    },
    () => {
      // 切换某条评论的解决状态：与用户的离线修改可能形成状态冲突。
      const candidates = data.comments.filter((comment) => !comment.deleted);
      if (candidates.length === 0) return null;
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      target.resolved = !target.resolved;
      return `${target.author} ${target.resolved ? "标记评论为已解决" : "重新打开评论"}「${target.body.slice(0, 10)}…」`;
    },
    () => {
      const fileId = "order-store";
      if (data.reviewedFiles.includes(fileId)) return null;
      data.reviewedFiles.push(fileId);
      return "同事标记 orderStore.ts 为已查看";
    },
  ];
  const order = actions.map((_, index) => index).sort(() => Math.random() - 0.5);
  let description: string | null = null;
  for (const index of order) {
    description = actions[index]();
    if (description) break;
  }
  data.version += 1;
  saveData(data);
  return description ?? "同事暂无新动态";
}

// 模拟同事推送新提交：文件内容变化 → 已查看失效、评论位置重算。
export async function pushNewPatch(): Promise<FileInvalidation[]> {
  await sleep(480);
  const data = loadData();
  const at = now();
  const invalidations: FileInvalidation[] = [];

  const payment = data.files["payment-service"];
  if (payment) {
    const lines = payment.newContent.split("\n");
    // 在新行 41 前插入 2 行：其后评论行号整体 +2
    lines.splice(40, 0, "// 结算链路追踪 v2：按渠道隔离缓存键", "const trace = startCheckoutTrace(channel);");
    // 按文本定位 EMPTY_ORDER 行并改写：锚点 snippet 失效 → 孤立
    const emptyOrderIndex = lines.findIndex((text) => text.includes("EMPTY_ORDER"));
    if (emptyOrderIndex >= 0) {
      lines[emptyOrderIndex] = "if (!payload.items.length) return fail(\"EMPTY_ORDER_V2\", traceId);";
    }
    payment.newContent = lines.join("\n");
    payment.hash = hashContent(payment.oldContent, payment.newContent);
    invalidations.push({ fileId: "payment-service", at, reason: "同事推送新提交：payment.ts 新增 2 行并改写校验逻辑" });
  }

  const validators = data.files["validators"];
  if (validators) {
    const lines = validators.newContent.split("\n");
    // 删除新行 27：其后评论行号整体 -1
    lines.splice(26, 1);
    validators.newContent = lines.join("\n");
    validators.hash = hashContent(validators.oldContent, validators.newContent);
    invalidations.push({ fileId: "validators", at, reason: "同事推送新提交：validators.ts 删除 1 行，位置已重算" });
  }

  for (const invalidation of invalidations) {
    data.reviewedFiles = data.reviewedFiles.filter((id) => id !== invalidation.fileId);
    data.invalidations.push(invalidation);
  }
  data.version += 1;
  saveData(data);
  return invalidations;
}

export function setFailNextPush(value: boolean) {
  const data = loadData();
  data.failNextPush = value;
  saveData(data);
}

export function resetServer() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
