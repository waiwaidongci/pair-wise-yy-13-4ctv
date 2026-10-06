import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CommitRounded,
  DoneAllRounded,
  ForkRightRounded,
  KeyboardRounded,
  RateReviewRounded,
  VisibilityRounded,
} from "@mui/icons-material";
import { Outlet } from "react-router-dom";
import { useReviewSummary } from "../queries/review";
import { useReviewStore } from "../stores/reviewStore";

export default function AppShell() {
  const { data, isLoading } = useReviewSummary();
  const files = useReviewStore((state) => state.files);
  const reviewedFiles = useReviewStore((state) => state.reviewedFiles);
  const comments = useReviewStore((state) => state.comments);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const unresolved = comments.filter((comment) => !comment.resolved).length;
  const progress = Math.round((reviewedFiles.length / files.length) * 100);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: "1px solid", borderColor: "divider", bgcolor: "rgba(255,255,255,.94)", backdropFilter: "blur(18px)" }}>
        <Toolbar sx={{ minHeight: 64, gap: 1.6 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: 1.2, bgcolor: "#172033", color: "#fff", display: "grid", placeItems: "center", fontWeight: 950, fontSize: 12 }}>
            DS
          </Box>
          <Box sx={{ minWidth: 250 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 950 }}>DiffScope 代码审查</Typography>
            <Typography noWrap sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.3 }}>
              {isLoading ? "载入变更集..." : `${data?.pullRequest} · ${data?.title}`}
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          <Stack direction="row" spacing={0.6} sx={{ display: { xs: "none", lg: "flex" } }}>
            <Chip size="small" icon={<ForkRightRounded />} label={data?.branch ?? "feature"} variant="outlined" />
            <Chip size="small" icon={<CommitRounded />} label={`${additions} 增 / ${deletions} 删`} />
            <Chip size="small" icon={<RateReviewRounded />} color={unresolved ? "warning" : "success"} label={`${unresolved} 条未解决`} />
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="F7 或 Alt+↓ 跳到下一处修改；Alt+↑ 返回上一处">
            <Button size="small" color="inherit" startIcon={<KeyboardRounded />}>键盘导航</Button>
          </Tooltip>
          <Box sx={{ width: 150, display: { xs: "none", md: "block" } }}>
            <Stack direction="row" alignItems="center" spacing={0.8}>
              <VisibilityRounded fontSize="small" color="action" />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 9.5, color: "text.secondary" }}>已查看 {reviewedFiles.length} / {files.length}</Typography>
                <LinearProgress variant="determinate" value={progress} sx={{ mt: 0.5, height: 5, borderRadius: 9 }} />
              </Box>
              <Typography sx={{ fontSize: 10.5, fontWeight: 850 }}>{progress}%</Typography>
            </Stack>
          </Box>
          <Stack direction="row" spacing={-0.8} sx={{ display: { xs: "none", sm: "flex" } }}>
            {(data?.reviewers ?? ["林", "赵", "周"]).map((reviewer, index) => (
              <Avatar key={reviewer} sx={{ width: 30, height: 30, fontSize: 11, border: "2px solid white", bgcolor: ["#34568b", "#0b8a73", "#8b5e34"][index % 3] }}>
                {reviewer.slice(-1)}
              </Avatar>
            ))}
          </Stack>
          <Tooltip title="当前变更已通过本地自动保存">
            <Chip icon={<DoneAllRounded />} size="small" color="success" variant="outlined" label="自动保存" />
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Outlet />
    </Box>
  );
}
