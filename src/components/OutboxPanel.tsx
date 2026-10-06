import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import {
  CheckCircleRounded,
  DeleteOutlineRounded,
  ErrorOutlineRounded,
  HourglassTopRounded,
  ReplayRounded,
  SyncRounded,
} from "@mui/icons-material";
import { useSyncStore } from "../stores/syncStore";
import type { OutboxEntry, SyncOpKind } from "../types/review";

const KIND_LABEL: Record<SyncOpKind, string> = {
  "comment:add": "评论",
  "reply:add": "回复",
  "comment:resolve": "解决状态",
  "comment:delete": "删除评论",
  "file:viewed": "标记已查看",
  "file:unviewed": "取消已查看",
};

function describeOp(op: OutboxEntry["op"]): string {
  switch (op.kind) {
    case "comment:add":
      return `在 ${op.payload.fileId} ${op.payload.side === "original" ? "旧行" : "新行"} ${op.payload.line}：${op.payload.body.slice(0, 20)}`;
    case "reply:add":
      return `回复评论：${op.payload.body.slice(0, 20)}`;
    case "comment:resolve":
      return op.payload.resolved ? "标记评论为已解决" : "重新打开评论";
    case "comment:delete":
      return "删除一条评论";
    case "file:viewed":
      return `标记 ${op.payload.fileId} 为已查看`;
    case "file:unviewed":
      return `取消标记 ${op.payload.fileId} 的已查看`;
  }
}

function StatusChip({ status }: { status: OutboxEntry["status"] }) {
  if (status === "pending") return <Chip size="small" icon={<HourglassTopRounded fontSize="small" />} label="待同步" color="warning" />;
  if (status === "inflight") return <Chip size="small" icon={<SyncRounded fontSize="small" />} label="同步中" color="info" />;
  if (status === "failed") return <Chip size="small" icon={<ErrorOutlineRounded fontSize="small" />} label="失败" color="error" />;
  return <Chip size="small" icon={<CheckCircleRounded fontSize="small" />} label="已同步" color="success" variant="outlined" />;
}

export default function OutboxPanel() {
  const open = useSyncStore((state) => state.outboxOpen);
  const setOpen = useSyncStore((state) => state.setOutboxOpen);
  const outbox = useSyncStore((state) => state.outbox);
  const remoteFeed = useSyncStore((state) => state.remoteFeed);
  const syncStatus = useSyncStore((state) => state.syncStatus);
  const retryFailed = useSyncStore((state) => state.retryFailed);
  const discardOp = useSyncStore((state) => state.discardOp);

  const active = outbox.filter((entry) => entry.status !== "done");
  const done = outbox.filter((entry) => entry.status === "done").slice(-6);
  const failedCount = outbox.filter((entry) => entry.status === "failed").length;

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 15 }}>
        <SyncRounded color="primary" fontSize="small" />
        待同步操作
        {failedCount > 0 && <Chip size="small" color="error" label={`${failedCount} 失败`} sx={{ ml: "auto" }} />}
      </DialogTitle>
      <DialogContent dividers>
        {active.length === 0 && done.length === 0 && (
          <Typography sx={{ py: 4, textAlign: "center", fontSize: 12, color: "text.secondary" }}>
            没有待同步操作。离线时的评论、回复和已查看标记会先记在这里。
          </Typography>
        )}
        <Stack spacing={0.8}>
          {active.map((entry) => (
            <Stack
              key={entry.op.id}
              spacing={0.6}
              sx={{
                p: 1,
                border: "1px solid",
                borderColor: entry.status === "failed" ? "error.light" : "divider",
                borderRadius: 1,
                bgcolor: entry.status === "failed" ? "error.50" : "background.paper",
              }}
            >
              <Stack direction="row" spacing={0.6} alignItems="center">
                <Chip size="small" label={KIND_LABEL[entry.op.kind]} variant="outlined" sx={{ height: 18, fontSize: 9.5 }} />
                <StatusChip status={entry.status} />
                <Typography sx={{ fontSize: 9.5, color: "text.secondary", ml: "auto" }}>
                  {new Date(entry.op.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 11, lineHeight: 1.6 }}>{describeOp(entry.op)}</Typography>
              {entry.error && (
                <Typography sx={{ fontSize: 10, color: "error.main" }}>
                  {entry.error}（已重试 {entry.attempts} 次）
                </Typography>
              )}
              <Stack direction="row" spacing={0.6} justifyContent="flex-end">
                {entry.status === "failed" && (
                  <Button size="small" startIcon={<ReplayRounded />} onClick={() => void retryFailed()}>
                    重试
                  </Button>
                )}
                <Button size="small" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => discardOp(entry.op.id)}>
                  丢弃
                </Button>
              </Stack>
            </Stack>
          ))}
        </Stack>

        {done.length > 0 && (
          <>
            <Divider sx={{ my: 1.2 }}>
              <Chip size="small" label="已同步" sx={{ height: 18, fontSize: 9.5 }} />
            </Divider>
            <Stack spacing={0.6}>
              {done.map((entry) => (
                <Stack key={entry.op.id} direction="row" spacing={0.6} alignItems="center" sx={{ opacity: 0.75 }}>
                  <Chip size="small" label={KIND_LABEL[entry.op.kind]} variant="outlined" sx={{ height: 18, fontSize: 9.5 }} />
                  <Typography sx={{ fontSize: 10.5, flex: 1 }}>{describeOp(entry.op)}</Typography>
                  <StatusChip status={entry.status} />
                </Stack>
              ))}
            </Stack>
          </>
        )}

        {remoteFeed.length > 0 && (
          <>
            <Divider sx={{ my: 1.2 }}>
              <Chip size="small" label="同事动态" sx={{ height: 18, fontSize: 9.5 }} />
            </Divider>
            <Stack spacing={0.5}>
              {remoteFeed.map((item) => (
                <Typography key={item.id} sx={{ fontSize: 10.5, color: "text.secondary" }}>
                  · {item.description}
                </Typography>
              ))}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={() => setOpen(false)}>
          关闭
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<ReplayRounded />}
          disabled={syncStatus === "syncing" || failedCount === 0}
          onClick={() => void retryFailed()}
        >
          全部重试
        </Button>
      </DialogActions>
    </Dialog>
  );
}
