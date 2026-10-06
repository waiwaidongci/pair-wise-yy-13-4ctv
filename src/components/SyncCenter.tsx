import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CloudDoneRounded,
  CloudOffRounded,
  CloudQueueRounded,
  ErrorOutlineRounded,
  GroupAddRounded,
  HeartBrokenRounded,
  SyncRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
import { selectIsOnline, useSyncStore } from "../stores/syncStore";

function formatTime(iso: string | null): string {
  if (!iso) return "从未";
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** 同步中心：网络状态、待同步队列、失败重试、冲突与演练入口 */
export default function SyncCenter() {
  const browserOnline = useSyncStore((state) => state.browserOnline);
  const simulatedOffline = useSyncStore((state) => state.simulatedOffline);
  const syncing = useSyncStore((state) => state.syncing);
  const pendingOps = useSyncStore((state) => state.pendingOps);
  const conflicts = useSyncStore((state) => state.conflicts);
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const lastError = useSyncStore((state) => state.lastError);
  const setSimulatedOffline = useSyncStore((state) => state.setSimulatedOffline);
  const retryNow = useSyncStore((state) => state.retryNow);
  const flush = useSyncStore((state) => state.flush);
  const simulateColleague = useSyncStore((state) => state.simulateColleague);
  const simulatePushFailure = useSyncStore((state) => state.simulatePushFailure);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const online = selectIsOnline({ browserOnline, simulatedOffline });
  const failed = pendingOps.filter((op) => op.status === "failed").length;
  const pending = pendingOps.length - failed;

  const chip = !online ? (
    <Chip icon={<CloudOffRounded />} size="small" color="warning" label={`离线 · ${pendingOps.length} 条待同步`} />
  ) : syncing ? (
    <Chip icon={<SyncRounded className="sync-spin" />} size="small" color="info" label="同步中…" />
  ) : failed > 0 ? (
    <Chip icon={<ErrorOutlineRounded />} size="small" color="error" label={`${failed} 条同步失败`} />
  ) : pending > 0 ? (
    <Chip icon={<CloudQueueRounded />} size="small" color="info" variant="outlined" label={`${pending} 条待同步`} />
  ) : (
    <Chip icon={<CloudDoneRounded />} size="small" color="success" variant="outlined" label="已同步" />
  );

  return (
    <>
      <Stack direction="row" spacing={0.6} alignItems="center">
        {conflicts.length > 0 && (
          <Tooltip title="同一行两侧都有修改，需要裁决">
            <Chip icon={<WarningAmberRounded />} size="small" color="error" label={`${conflicts.length} 冲突`} />
          </Tooltip>
        )}
        <Tooltip title="同步中心">
          <Box onClick={(event) => setAnchor(event.currentTarget)} sx={{ cursor: "pointer", display: "flex" }}>
            {chip}
          </Box>
        </Tooltip>
      </Stack>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} sx={{ "& .MuiPaper-root": { minWidth: 300 } }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 900 }}>同步中心</Typography>
          <Typography sx={{ fontSize: 10, color: "text.secondary", mt: 0.3 }}>
            上次同步 {formatTime(lastSyncAt)} · 待同步 {pendingOps.length} 条{failed ? `（失败 ${failed}）` : ""}
          </Typography>
          {lastError && (
            <Typography sx={{ fontSize: 10, color: "error.main", mt: 0.4 }}>最近错误：{lastError}</Typography>
          )}
        </Box>
        <Divider />
        <MenuItem onClick={() => void flush(true)} disabled={!online || syncing}>
          <SyncRounded fontSize="small" sx={{ mr: 1 }} />
          <ListItemText primaryTypographyProps={{ fontSize: 12 }}>立即同步</ListItemText>
        </MenuItem>
        <MenuItem onClick={retryNow} disabled={!online || failed === 0}>
          <CloudDoneRounded fontSize="small" sx={{ mr: 1 }} />
          <ListItemText primaryTypographyProps={{ fontSize: 12 }}>重试失败操作（{failed}）</ListItemText>
        </MenuItem>
        <Box sx={{ px: 2, py: 0.5 }}>
          <FormControlLabel
            control={
              <Switch size="small" checked={simulatedOffline} onChange={(event) => setSimulatedOffline(event.target.checked)} />
            }
            label={<Typography sx={{ fontSize: 11.5 }}>模拟断网（通勤模式）</Typography>}
          />
          {!browserOnline && <Typography sx={{ fontSize: 9.5, color: "warning.main" }}>浏览器当前处于离线状态</Typography>}
        </Box>
        <Divider />
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontSize: 10, color: "text.secondary", mb: 0.8 }}>演练工具</Typography>
          <Stack direction="row" spacing={0.8}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<GroupAddRounded />}
              onClick={() => {
                simulateColleague();
                setAnchor(null);
              }}
            >
              模拟同事变更
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<HeartBrokenRounded />}
              onClick={() => {
                simulatePushFailure();
                setAnchor(null);
              }}
            >
              下次推送失败
            </Button>
          </Stack>
        </Box>
      </Menu>
    </>
  );
}
