import {
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CloudOffRounded,
  CloudQueueRounded,
  ErrorOutlineRounded,
  SyncRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
import { useOnlineStatus, useSyncStore } from "../stores/syncStore";

function formatTime(value: string | null): string {
  if (!value) return "尚未同步";
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

export default function SyncControls() {
  const online = useOnlineStatus();
  const simulatedOffline = useSyncStore((state) => state.simulatedOffline);
  const outbox = useSyncStore((state) => state.outbox);
  const conflicts = useSyncStore((state) => state.conflicts);
  const syncStatus = useSyncStore((state) => state.syncStatus);
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const setSimulatedOffline = useSyncStore((state) => state.setSimulatedOffline);
  const syncNow = useSyncStore((state) => state.syncNow);
  const setOutboxOpen = useSyncStore((state) => state.setOutboxOpen);
  const setConflictCenterOpen = useSyncStore((state) => state.setConflictCenterOpen);

  const pendingCount = outbox.filter((entry) => entry.status === "pending" || entry.status === "failed").length;
  const failedCount = outbox.filter((entry) => entry.status === "failed").length;
  const syncing = syncStatus === "syncing";

  return (
    <Stack direction="row" spacing={0.7} alignItems="center" sx={{ display: { xs: "none", md: "flex" } }}>
      <Tooltip title={online ? "在线：操作会自动同步到服务端" : "离线：操作先保存在本机，恢复联网后自动并入"}>
        <Chip
          size="small"
          icon={online ? <CloudQueueRounded fontSize="small" /> : <CloudOffRounded fontSize="small" />}
          label={online ? "在线" : "离线"}
          color={online ? "success" : "default"}
          variant={online ? "outlined" : "filled"}
        />
      </Tooltip>
      <Tooltip title="模拟断网，验证离线评审与恢复同步">
        <Stack direction="row" spacing={0.4} alignItems="center">
          <Switch
            size="small"
            checked={simulatedOffline}
            onChange={(event) => setSimulatedOffline(event.target.checked)}
          />
          <Typography sx={{ fontSize: 10, color: "text.secondary" }}>模拟离线</Typography>
        </Stack>
      </Tooltip>

      <Tooltip title={syncing ? "正在同步…" : `上次同步：${formatTime(lastSyncAt)}`}>
        <span>
          <Chip
            size="small"
            icon={syncing ? <CircularProgress size={12} /> : <SyncRounded fontSize="small" />}
            label={syncing ? "同步中" : "立即同步"}
            variant="outlined"
            onClick={() => void syncNow()}
            disabled={!online || syncing}
            sx={{ cursor: "pointer" }}
          />
        </span>
      </Tooltip>

      <Tooltip title="待同步操作队列">
        <Badge badgeContent={pendingCount} color={failedCount ? "error" : "warning"}>
          <Chip
            size="small"
            icon={failedCount ? <ErrorOutlineRounded fontSize="small" /> : <SyncRounded fontSize="small" />}
            label={failedCount ? `${failedCount} 失败` : "待同步"}
            color={failedCount ? "error" : "default"}
            variant={pendingCount ? "filled" : "outlined"}
            onClick={() => setOutboxOpen(true)}
            sx={{ cursor: "pointer" }}
          />
        </Badge>
      </Tooltip>

      <Tooltip title="冲突待裁决">
        <Badge badgeContent={conflicts.length} color="error">
          <Chip
            size="small"
            icon={<WarningAmberRounded fontSize="small" />}
            label="冲突"
            color={conflicts.length ? "error" : "default"}
            variant={conflicts.length ? "filled" : "outlined"}
            onClick={() => setConflictCenterOpen(true)}
            sx={{ cursor: "pointer" }}
          />
        </Badge>
      </Tooltip>

      <Box sx={{ display: { xs: "none", xl: "block" } }}>
        <Button size="small" color="inherit" onClick={() => useSyncStore.getState().resetAll()}>
          重置演示
        </Button>
      </Box>
    </Stack>
  );
}
