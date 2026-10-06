import { mockChangeLines, mockDiffFiles } from "./mockDiff";
import { snippetFor } from "../utils/anchor";
import type { CommentSide, ReviewComment } from "../types/review";

function anchorFor(fileId: string, index: number, side: CommentSide = "modified") {
  const file = mockDiffFiles.find((f) => f.id === fileId)!;
  const line = mockChangeLines[fileId][index];
  return { line, side, snippet: snippetFor(file, side, line) };
}

// 本机初始评论，与服务端种子保持相同 id，避免合并时重复。
export const seedComments: ReviewComment[] = [
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
    anchor: anchorFor("payment-service", 0),
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
    anchor: anchorFor("payment-service", 4),
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
    anchor: anchorFor("order-table", 1),
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
    anchor: anchorFor("validators", 0),
  },
  {
    id: "comment-payment-empty-order",
    fileId: "payment-service",
    line: mockChangeLines["payment-service"][1],
    side: "modified",
    author: "陈乔木",
    body: "EMPTY_ORDER 的错误码需要和前端约定，建议统一到错误码枚举里，避免各端理解不一致。",
    createdAt: new Date(Date.now() - 7 * 60_000).toISOString(),
    resolved: false,
    replies: [],
    anchor: anchorFor("payment-service", 1),
  },
];
