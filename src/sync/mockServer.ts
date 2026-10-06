import { initialComments, initialRevisions, initialViewedMarks } from "../data/initialReview";
import { mockChangeLines, mockDiffFiles } from "../data/mockDiff";
import type { CommentSide, ReviewComment } from "../types/review";
import type { ServerFileContent, ServerSnapshot, SyncOp, ViewedMark } from "../types/sync";
import { uid } from "../utils/id";
import { applyOpToComments, applyViewedOp } from "./merge";

/**
 * 模拟服务端：独立存储（自己的 localStorage 命名空间），
 * 与本机状态完全隔离，用来演练断网续传、失败重试与并发合并。
 */

interface ServerState {
  comments: ReviewComment[];
  viewedMarks: Record<string, ViewedMark>;
  revisions: Record<string, number>;
  fileContents: Record<string, ServerFileContent>;
  /** 已应用的操作幂等键，重复补传直接跳过 */
  appliedOpIds: string[];
}

const STORAGE_KEY = "diff-scope-server-v1";
const LATENCY_MS = 260;

/** 故障注入：下一次推送在第 N 条操作后“断线”（默认 0，即第一条就失败） */
let failNextPushAfter: number | null = null;

const memoryFallback = new Map<string, string>();

function readStorage(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
  } catch {
    /* 隐私模式等场景降级到内存 */
  }
  return memoryFallback.get(key) ?? null;
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* 降级到内存 */
  }
  memoryFallback.set(key, value);
}

function buildInitialState(): ServerState {
  return {
    comments: initialComments.map((comment) => ({ ...comment, replies: comment.replies.map((reply) => ({ ...reply })) })),
    viewedMarks: { ...initialViewedMarks },
    revisions: { ...initialRevisions },
    fileContents: Object.fromEntries(
      mockDiffFiles.map((file) => [file.id, { oldContent: file.oldContent, newContent: file.newContent }]),
    ),
    appliedOpIds: [],
  };
}

function loadState(): ServerState {
  const raw = readStorage(STORAGE_KEY);
  if (!raw) {
    const initial = buildInitialState();
    saveState(initial);
    return initial;
  }
  try {
    return JSON.parse(raw) as ServerState;
  } catch {
    const initial = buildInitialState();
    saveState(initial);
    return initial;
  }
}

function saveState(state: ServerState): void {
  writeStorage(STORAGE_KEY, JSON.stringify(state));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SyncTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncTransportError";
  }
}

/**
 * 推送一批待同步操作。按序应用，逐条幂等：
 * - opId 已应用过 → 跳过但仍视为成功（重复补传安全）；
 * - 实体 id 已存在 → reducer 天然去重。
 * 注入故障时模拟“传到一半断线”：已应用的不回滚，客户端整体重试也不会重复。
 */
export async function pushOps(ops: SyncOp[]): Promise<{ acked: string[] }> {
  await delay(LATENCY_MS);
  const state = loadState();
  const acked: string[] = [];
  let applied = 0;
  for (const op of ops) {
    if (failNextPushAfter !== null && applied >= failNextPushAfter) {
      failNextPushAfter = null;
      saveState(state);
      throw new SyncTransportError(`连接中断：第 ${applied + 1} 条操作推送失败，已应用 ${applied} 条`);
    }
    if (!state.appliedOpIds.includes(op.opId)) {
      if (op.kind === "file.viewed") {
        state.viewedMarks = applyViewedOp(state.viewedMarks, op);
      } else {
        state.comments = applyOpToComments(state.comments, op);
      }
      state.appliedOpIds.push(op.opId);
    }
    applied += 1;
    acked.push(op.opId);
  }
  failNextPushAfter = null;
  saveState(state);
  return { acked };
}

/** 拉取服务端快照（深拷贝，避免引用共享） */
export async function pullSnapshot(): Promise<ServerSnapshot> {
  await delay(LATENCY_MS);
  const state = loadState();
  return {
    comments: state.comments.map((comment) => ({ ...comment, replies: comment.replies.map((reply) => ({ ...reply })) })),
    viewedMarks: Object.fromEntries(Object.entries(state.viewedMarks).map(([key, mark]) => [key, { ...mark }])),
    revisions: { ...state.revisions },
    fileContents: Object.fromEntries(Object.entries(state.fileContents).map(([key, content]) => [key, { ...content }])),
    serverTime: new Date().toISOString(),
  };
}

/** 让下一次推送失败（after 条之后断线），用于演练失败重试与幂等补传 */
export function failNextPush(after = 0): void {
  failNextPushAfter = after;
}

interface ColleagueTarget {
  fileId: string;
  line: number;
  side: CommentSide;
}

/**
 * 模拟同事在服务端的处理：
 * 1. 在同一行留下一条不同内容的评论（制造冲突）；
 * 2. 解决一条未解决的评论并回复；
 * 3. 推送 payment-service 新版本（行号偏移 + 一行被改写 → 位置重算/失效）；
 * 4. 推送 router 新版本（已查看标记失效）。
 */
export function injectColleagueActivity(target?: ColleagueTarget): void {
  const state = loadState();
  const now = new Date().toISOString();

  const spot: ColleagueTarget = target ?? {
    fileId: "payment-service",
    line: mockChangeLines["payment-service"][1],
    side: "modified",
  };
  const spotContent = state.fileContents[spot.fileId];
  const spotLines = (spot.side === "original" ? spotContent.oldContent : spotContent.newContent).split("\n");
  state.comments.push({
    id: uid("comment-server"),
    fileId: spot.fileId,
    line: spot.line,
    side: spot.side,
    author: "赵明",
    body: "服务端补充：这里我按灰度方案改过一版，超时阈值与缓存双写需要再核对，细节见今晚的评审纪要。",
    createdAt: now,
    resolved: false,
    replies: [],
    anchorText: spotLines[spot.line - 1] ?? "",
    anchorRevision: state.revisions[spot.fileId] ?? 1,
  });

  const victim = state.comments.find((comment) => !comment.resolved && comment.author !== "赵明");
  if (victim) {
    victim.resolved = true;
    victim.replies.push({
      id: uid("reply-server"),
      author: "周岚",
      body: "已按评审意见调整并验证，服务端标记解决。",
      createdAt: now,
    });
  }

  const payment = state.fileContents["payment-service"];
  if (payment) {
    const header = ["// v2 灰度：缓存双写观测埋点", "// 旧 key 在灰度期间保持只读", ""];
    const shifted = payment.newContent
      .split("\n")
      .map((line) => (line === "return retry(" ? "return retryWithMetrics(" : line));
    payment.newContent = [...header, ...shifted].join("\n");
    state.revisions["payment-service"] = (state.revisions["payment-service"] ?? 1) + 1;
  }

  const router = state.fileContents["router"];
  if (router) {
    router.newContent = `// 路由守卫审计：登录态校验前置\n${router.newContent}`;
    state.revisions["router"] = (state.revisions["router"] ?? 1) + 1;
  }

  saveState(state);
}

/** 重置服务端到初始状态（演示用） */
export function resetServer(): void {
  saveState(buildInitialState());
}
