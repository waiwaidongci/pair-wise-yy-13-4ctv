import {
  Box,
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
  CallMergeRounded,
  CheckCircleOutlineRounded,
  CloudQueueRounded,
  PersonOutlineRounded,
} from "@mui/icons-material";
import { useSyncStore } from "../stores/syncStore";
import type { ConflictResolution, SyncConflict } from "../types/review";

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function ResolutionButtons({ conflict }: { conflict: SyncConflict }) {
  const resolveConflict = useSyncStore((state) => state.resolveConflict);
  const dismissConflict = useSyncStore((state) => state.dismissConflict);

  const button = (label: string, resolution: ConflictResolution, color: "primary" | "error" | "success" = "primary") => (
    <Button
      key={label}
      size="small"
      variant="outlined"
      color={color}
      onClick={() => resolveConflict(conflict.id, resolution)}
    >
      {label}
    </Button>
  );

  if (conflict.kind === "same-line-comment") {
    return (
      <>
        {button("两条都保留", "keep-both", "success")}
        {button("保留我的", "keep-local")}
        {button("保留同事的", "keep-remote")}
      </>
    );
  }
  if (conflict.kind === "same-comment-state") {
    return (
      <>
        {button(`保留我的（${conflict.localLabel === "你" ? "你" : conflict.localLabel}）`, "keep-local")}
        {button("保留同事的", "keep-remote")}
      </>
    );
  }
  return (
    <>
      {button("保留评论（含回复）", "keep-remote", "success")}
      {button("仍删除", "keep-local", "error")}
    </>
  );
}

export default function ConflictCenter() {
  const open = useSyncStore((state) => state.conflictCenterOpen);
  const setOpen = useSyncStore((state) => state.setConflictCenterOpen);
  const conflicts = useSyncStore((state) => state.conflicts);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 15 }}>
        <CallMergeRounded color="error" fontSize="small" />
        冲突裁决中心
        <Chip size="small" color="error" label={`${conflicts.length} 待裁决`} sx={{ ml: "auto" }} />
      </DialogTitle>
      <DialogContent dividers>
        {conflicts.length === 0 && (
          <Typography sx={{ py: 4, textAlign: "center", fontSize: 12, color: "text.secondary" }}>
            没有待裁决的冲突。两边改动会按发生顺序并入，不会互相覆盖。
          </Typography>
        )}
        <Stack spacing={1.2}>
          {conflicts.map((conflict) => (
            <Stack
              key={conflict.id}
              spacing={1}
              sx={{ p: 1.2, border: "1px solid", borderColor: "error.light", borderRadius: 1.2, bgcolor: "error.50" }}
            >
              <Typography sx={{ fontSize: 11.5, lineHeight: 1.7 }}>{conflict.description}</Typography>
              <Stack direction="row" spacing={1} divider={<Divider orientation="vertical" flexItem />}>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flex: 1 }}>
                  <PersonOutlineRounded sx={{ fontSize: 14, color: "primary.main" }} />
                  <Box>
                    <Typography sx={{ fontSize: 10.5, fontWeight: 800 }}>{conflict.localLabel}</Typography>
                    <Typography sx={{ fontSize: 9.5, color: "text.secondary" }}>{formatTime(conflict.localAt)}</Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flex: 1 }}>
                  <CloudQueueRounded sx={{ fontSize: 14, color: "warning.main" }} />
                  <Box>
                    <Typography sx={{ fontSize: 10.5, fontWeight: 800 }}>{conflict.remoteLabel}</Typography>
                    <Typography sx={{ fontSize: 9.5, color: "text.secondary" }}>{formatTime(conflict.remoteAt)}</Typography>
                  </Box>
                </Stack>
              </Stack>
              <Stack direction="row" spacing={0.6} justifyContent="flex-end">
                <ResolutionButtons conflict={conflict} />
              </Stack>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" startIcon={<CheckCircleOutlineRounded />} onClick={() => setOpen(false)}>
          稍后裁决
        </Button>
      </DialogActions>
    </Dialog>
  );
}
