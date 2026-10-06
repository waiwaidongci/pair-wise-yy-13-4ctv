import type { CommentSide, ReviewComment } from "../types/review";
import type { ViewedMark } from "../types/sync";
import { mockChangeLines, mockDiffFiles } from "./mockDiff";

/** 当前登录的评审人（本机用户） */
export const LOCAL_AUTHOR = "林澈";

function anchorOf(fileId: string, line: number, side: CommentSide): string {
  const file = mockDiffFiles.find((item) => item.id === fileId);
  if (!file) return "";
  const content = side === "original" ? file.oldContent : file.newContent;
  return content.split("\n")[line - 1] ?? "";
}

function seedComment(
  id: string,
  fileId: string,
  line: number,
  author: string,
  body: string,
  createdAt: string,
  resolved: boolean,
  replies: ReviewComment["replies"] = [],
): ReviewComment {
  return {
    id,
    fileId,
    line,
    side: "modified",
    author,
    body,
    createdAt,
    resolved,
    replies,
    anchorText: anchorOf(fileId, line, "modified"),
    anchorRevision: 1,
  };
}

export const initialComments: ReviewComment[] = [
  seedComment(
    "comment-payment-cache-version",
    "payment-service",
    mockChangeLines["payment-service"][0],
    "林澈",
    "缓存版本参与 key 后，旧版本数据不会命中；这里还需要确认发版期间双写时间足够长。",
    new Date(Date.now() - 42 * 60_000).toISOString(),
    false,
    [
      {
        id: "reply-cache-1",
        author: "陈乔木",
        body: "已确认灰度期间会保留 30 分钟双写，并监控 cache.miss 指标。",
        createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
    ],
  ),
  seedComment(
    "comment-payment-retry",
    "payment-service",
    mockChangeLines["payment-service"][4],
    "赵明",
    "重试只覆盖网络错误和网关超时就可以，业务拒绝不能重试，当前分类是正确的。",
    new Date(Date.now() - 26 * 60_000).toISOString(),
    true,
  ),
  seedComment(
    "comment-order-table-selection",
    "order-table",
    mockChangeLines["order-table"][1],
    "周岚",
    "批量选择在翻页后会不会丢数据？建议状态层使用 Set，并补一个跨页选择测试。",
    new Date(Date.now() - 18 * 60_000).toISOString(),
    false,
  ),
  seedComment(
    "comment-validator-phone",
    "validators",
    mockChangeLines["validators"][0],
    "林澈",
    "手机号校验从宽松改为大陆号段，需要确认海外手机号是否走单独入口。",
    new Date(Date.now() - 9 * 60_000).toISOString(),
    false,
  ),
];

/** 所有文件的初始版本号 */
export const initialRevisions: Record<string, number> = Object.fromEntries(mockDiffFiles.map((file) => [file.id, 1]));

/** 初始已查看标记（与历史版本 reviewedFiles: ["router"] 对齐） */
export const initialViewedMarks: Record<string, ViewedMark> = {
  router: {
    viewed: true,
    revision: 1,
    updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    source: "server",
  },
};
