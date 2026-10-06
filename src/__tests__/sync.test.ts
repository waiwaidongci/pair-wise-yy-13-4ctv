// 临时测试入口：验证离线同步核心逻辑（幂等、冲突、失效重算）
import * as server from "../server/mockServer";
import { reanchor, hashContent } from "../utils/anchor";
import { mockDiffFiles } from "../data/mockDiff";
import type { SyncOp } from "../types/review";

// ===== 浏览器 API mock =====
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
};
(globalThis as any).window = {
  setTimeout: (fn: () => void) => {
    fn();
    return 0;
  },
};
let uuidCounter = 0;
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => `uuid-${uuidCounter++}` },
  configurable: true,
});

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${message}`);
  }
}

function makeOp<K extends SyncOp["kind"]>(
  kind: K,
  payload: any,
): Extract<SyncOp, { kind: K }> {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    kind,
    createdAt: new Date().toISOString(),
    baseVersion: 1,
    payload,
  } as Extract<SyncOp, { kind: K }>;
}

async function main() {
  console.log("\n[1] 初始服务端状态");
  const initial = await server.pullState(0);
  assert(initial.comments.length >= 5, `种子评论加载 (${initial.comments.length} 条)`);
  assert(initial.reviewedFiles.includes("router"), "已查看种子包含 router");
  assert(initial.version === 1, `初始版本为 1 (实际 ${initial.version})`);

  console.log("\n[2] 幂等：重复补传不会多出评论");
  const fileId = "payment-service";
  const line = 100;
  const op = makeOp("comment:add", {
    clientId: "client-c1",
    fileId,
    line,
    side: "modified",
    author: "测试员",
    body: "离线评论",
    anchor: { line, side: "modified", snippet: "x" },
  });
  const first = await server.pushOps([op], 1);
  assert(first.appliedOpIds.includes(op.id), "首次推送应用成功");
  const countAfterFirst = first.comments.filter((c) => c.id === "client-c1").length;
  const second = await server.pushOps([op], first.version);
  assert(second.duplicatedOpIds.includes(op.id), "重复推送被识别为 duplicated");
  const countAfterSecond = second.comments.filter((c) => c.id === "client-c1").length;
  assert(countAfterFirst === 1 && countAfterSecond === 1, `重复补传不产生重复评论 (${countAfterSecond} 条)`);

  console.log("\n[3] 同行冲突：两边在同一行各留评论");
  const conflictOp = makeOp("comment:add", {
    clientId: "client-c2",
    fileId,
    line,
    side: "modified",
    author: "测试员",
    body: "离线同行评论",
    anchor: { line, side: "modified", snippet: "x" },
  });
  // 先让服务端在同一行有一条同事评论
  await server.colleagueActivity();
  // 手动构造一条服务端同行评论
  const state3 = await server.pullState(0);
  const rivalLine = state3.comments.find((c) => c.fileId === fileId && c.side === "modified")?.line ?? line;
  const conflictOp2 = makeOp("comment:add", {
    clientId: "client-c3",
    fileId,
    line: rivalLine,
    side: "modified",
    author: "测试员",
    body: "与同事同行",
    anchor: { line: rivalLine, side: "modified", snippet: "x" },
  });
  const conflictResult = await server.pushOps([conflictOp2], 1);
  const sameLineConflict = conflictResult.conflicts.find((c) => c.kind === "same-line-comment");
  assert(!!sameLineConflict, "检测到同行评论冲突");
  assert(
    conflictResult.comments.filter((c) => c.fileId === fileId && c.line === rivalLine).length >= 2,
    "两边评论都保留（各留一份）",
  );

  console.log("\n[4] 回复按顺序并入，不覆盖");
  const target = (await server.pullState(0)).comments[0];
  const replyOp = makeOp("reply:add", {
    commentId: target.id,
    clientId: "client-r1",
    author: "测试员",
    body: "离线回复",
  });
  const replyResult = await server.pushOps([replyOp], 1);
  const updated = replyResult.comments.find((c) => c.id === target.id);
  assert(!!updated?.replies.some((r) => r.id === "client-r1"), "离线回复已并入");

  console.log("\n[5] 已查看标记并入");
  const viewedOp = makeOp("file:viewed", { fileId: "order-table" });
  const viewedResult = await server.pushOps([viewedOp], 1);
  assert(viewedResult.reviewedFiles.includes("order-table"), "已查看标记并入");

  console.log("\n[6] 内容更新：已查看失效 + 锚点重算");
  const before = await server.pullState(0);
  const paymentBefore = before.files["payment-service"];
  const invalidations = await server.pushNewPatch();
  assert(invalidations.some((i) => i.fileId === "payment-service"), "payment-service 内容更新产生失效记录");
  const after = await server.pullState(0);
  const paymentAfter = after.files["payment-service"];
  assert(paymentAfter.hash !== paymentBefore.hash, "payment-service 内容哈希变化");
  assert(!after.reviewedFiles.includes("payment-service"), "内容更新后已查看标记作废");

  // 锚点重算：找一条 payment-service 的评论验证
  const paymentComments = after.comments.filter((c) => c.fileId === "payment-service");
  let reanchoredCount = 0;
  let orphanedCount = 0;
  for (const comment of paymentComments) {
    const file = mockDiffFiles.find((f) => f.id === "payment-service")!;
    // 用更新后的内容构造 DiffFile
    const nextFile = { ...file, oldContent: paymentAfter.oldContent, newContent: paymentAfter.newContent };
    const result = reanchor(comment.anchor, nextFile);
    if (result.orphaned) {
      orphanedCount += 1;
      console.log(`    孤立：${comment.id} (原 ${comment.anchor.line}) snippet="${comment.anchor.snippet.slice(0, 30)}"`);
    } else if (result.line !== comment.anchor.line) {
      reanchoredCount += 1;
      console.log(`    重算：${comment.id} ${comment.anchor.line} → ${result.line}`);
    } else {
      console.log(`    不变：${comment.id} (${comment.anchor.line})`);
    }
  }
  console.log(`    重算：${reanchoredCount} 条位置重算，${orphanedCount} 条孤立`);
  assert(reanchoredCount > 0, "有评论位置被重算（行号偏移）");
  assert(orphanedCount > 0, "有评论锚点失效变孤立（snippet 被改写）");

  console.log("\n[7] 哈希稳定性");
  const f = mockDiffFiles[0];
  assert(hashContent(f.oldContent, f.newContent) === hashContent(f.oldContent, f.newContent), "相同内容哈希稳定");
  assert(hashContent(f.oldContent, f.newContent) !== hashContent(f.oldContent + "x", f.newContent), "内容变化哈希变化");

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
