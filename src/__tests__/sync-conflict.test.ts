// 临时测试：冲突裁决专项（same-comment-state / deleted-with-replies）
import * as server from "../server/mockServer";
import type { SyncOp } from "../types/review";

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
};
(globalThis as any).window = { setTimeout: (fn: () => void) => { fn(); return 0; } };
let uuidCounter = 0;
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => `uuid-${uuidCounter++}` },
  configurable: true,
});

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) { passed += 1; console.log(`  ✓ ${message}`); }
  else { failed += 1; console.error(`  ✗ ${message}`); }
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
  console.log("\n[1] 解决状态冲突：用户与同事对同一评论的解决状态改了不同值");
  const fresh = await server.pullState(0);
  const target = fresh.comments.find((c) => c.resolved) ?? fresh.comments[0];
  const baseVersion = fresh.version;
  // 同事重新打开（false）
  await server.pushOps(
    [makeOp("comment:resolve", { commentId: target.id, resolved: !target.resolved })],
    baseVersion,
  );
  // 用户保持已解决（true），基于旧版本
  const userResolve = makeOp("comment:resolve", { commentId: target.id, resolved: target.resolved });
  const result = await server.pushOps([userResolve], baseVersion);
  const stateConflict = result.conflicts.find((c) => c.kind === "same-comment-state");
  assert(!!stateConflict, "检测到解决状态冲突");
  assert(stateConflict?.entityId === target.id, "冲突实体为同一条评论");
  assert(stateConflict?.remoteValue === !target.resolved, "冲突记录了同事的值");
  // 服务端保留同事的值（用户的冲突修改未生效）
  const after = result.comments.find((c) => c.id === target.id);
  assert(after?.resolved === !target.resolved, "冲突未自动覆盖：服务端保留同事的值，等待裁决");

  console.log("\n[2] 删除与回复冲突：用户删除的评论下有同事回复");
  const fresh2 = await server.pullState(0);
  const target2 = fresh2.comments[0];
  // 同事先回复
  await server.pushOps(
    [makeOp("reply:add", { commentId: target2.id, clientId: "colleague-reply", author: "同事", body: "同事回复" })],
    fresh2.version,
  );
  // 用户删除（基于旧版本）
  const deleteOp = makeOp("comment:delete", { commentId: target2.id });
  const result2 = await server.pushOps([deleteOp], fresh2.version);
  const deleteConflict = result2.conflicts.find((c) => c.kind === "deleted-with-replies");
  assert(!!deleteConflict, "检测到删除与回复冲突");
  // 删除未生效：评论仍在，回复保留
  const after2 = result2.comments.find((c) => c.id === target2.id);
  assert(!!after2, "冲突未自动删除：评论仍保留");
  assert(!!after2?.replies.some((r) => r.id === "colleague-reply"), "同事回复仍保留");

  console.log("\n[3] 无冲突场景：用户与同事都标记已查看（幂等并入）");
  const fresh3 = await server.pullState(0);
  const fileId = "validators";
  await server.pushOps([makeOp("file:viewed", { fileId })], fresh3.version);
  const result3 = await server.pushOps([makeOp("file:viewed", { fileId })], fresh3.version);
  assert(!result3.conflicts.some((c) => c.kind === "same-comment-state"), "已查看标记无冲突");
  assert(result3.reviewedFiles.includes(fileId), "已查看标记并入");

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
