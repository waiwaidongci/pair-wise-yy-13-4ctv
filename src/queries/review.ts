import { useQuery } from "@tanstack/react-query";
import type { ReviewSummary } from "../types/review";

async function fetchReviewSummary(): Promise<ReviewSummary> {
  await new Promise((resolve) => window.setTimeout(resolve, 280));
  return {
    pullRequest: "PR #4821",
    title: "订单结算与退款链路性能优化",
    author: "陈乔木",
    branch: "feature/checkout-performance",
    baseBranch: "main",
    reviewers: ["林澈", "赵明", "周岚"],
    updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  };
}

export function useReviewSummary() {
  return useQuery({
    queryKey: ["review-summary"],
    queryFn: fetchReviewSummary,
  });
}
