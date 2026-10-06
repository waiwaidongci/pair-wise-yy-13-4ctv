import { useMemo, useState } from "react";
import {
  Box,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AddRounded,
  CheckCircleRounded,
  DeleteOutlineRounded,
  DescriptionRounded,
  DriveFileRenameOutlineRounded,
  SearchRounded,
} from "@mui/icons-material";
import { useReviewStore } from "../stores/reviewStore";
import { useSyncStore } from "../stores/syncStore";
import type { DiffFile, DiffFileStatus } from "../types/review";

function statusIcon(status: DiffFileStatus) {
  if (status === "added") return <AddRounded fontSize="small" />;
  if (status === "deleted") return <DeleteOutlineRounded fontSize="small" />;
  if (status === "renamed") return <DriveFileRenameOutlineRounded fontSize="small" />;
  return <DescriptionRounded fontSize="small" />;
}

function statusColor(status: DiffFileStatus): string {
  if (status === "added") return "success.main";
  if (status === "deleted") return "error.main";
  if (status === "renamed") return "warning.main";
  return "info.main";
}

export default function FileTree() {
  const files = useReviewStore((state) => state.files);
  const selectedFileId = useReviewStore((state) => state.selectedFileId);
  const reviewedFiles = useReviewStore((state) => state.reviewedFiles);
  const comments = useReviewStore((state) => state.comments);
  const setSelectedFile = useReviewStore((state) => state.setSelectedFile);
  const toggleReviewed = useReviewStore((state) => state.toggleReviewed);
  const invalidatedFiles = useSyncStore((state) => state.invalidatedFiles);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => files.filter((file) => `${file.path}${file.description}`.toLowerCase().includes(query.trim().toLowerCase())),
    [files, query],
  );
  const progress = Math.round((reviewedFiles.length / files.length) * 100);

  return (
    <Paper variant="outlined" sx={{ minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ p: 1.4, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" alignItems="center">
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 950 }}>变更文件</Typography>
            <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.25 }}>{files.length} 个文件 · {progress}% 已查看</Typography>
          </Box>
          <Chip size="small" label={`${reviewedFiles.length}/${files.length}`} color={progress === 100 ? "success" : "default"} />
        </Stack>
        <TextField
          size="small"
          fullWidth
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按路径或说明搜索"
          sx={{ mt: 1.1 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }}
        />
        <LinearProgress variant="determinate" value={progress} sx={{ mt: 1.2, height: 5, borderRadius: 99 }} />
      </Box>
      <List dense disablePadding className="scroll-area" sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 0.8 }}>
        {filtered.map((file: DiffFile) => {
          const selected = file.id === selectedFileId;
          const reviewed = reviewedFiles.includes(file.id);
          const fileComments = comments.filter((comment) => comment.fileId === file.id);
          const unresolved = fileComments.filter((comment) => !comment.resolved).length;
          return (
            <ListItemButton
              key={file.id}
              selected={selected}
              onClick={() => setSelectedFile(file.id)}
              sx={{
                alignItems: "flex-start",
                gap: 0.7,
                borderRadius: 1.1,
                mb: 0.45,
                border: "1px solid",
                borderColor: selected ? "primary.main" : "transparent",
                bgcolor: selected ? "primary.50" : undefined,
              }}
            >
              <Tooltip title={reviewed ? "标记为未查看" : "标记为已查看"}>
                <Checkbox
                  size="small"
                  checked={reviewed}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggleReviewed(file.id)}
                  icon={<Box sx={{ width: 17, height: 17, border: "1.5px solid", borderColor: "grey.400", borderRadius: 0.5 }} />}
                  checkedIcon={<CheckCircleRounded color="success" />}
                  sx={{ mt: -0.4, ml: -0.35 }}
                />
              </Tooltip>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={0.55} alignItems="center">
                  <Box sx={{ color: statusColor(file.status), display: "flex" }}>{statusIcon(file.status)}</Box>
                  <Typography noWrap sx={{ flex: 1, fontSize: 11.5, fontWeight: selected ? 900 : 800 }}>{file.path}</Typography>
                </Stack>
                {file.oldPath && (
                  <Typography noWrap sx={{ mt: 0.35, fontSize: 9.5, color: "text.secondary" }}>原路径：{file.oldPath}</Typography>
                )}
                <Typography noWrap sx={{ mt: 0.45, fontSize: 9.8, color: "text.secondary" }}>{file.description}</Typography>
                <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mt: 0.7 }}>
                  <Typography sx={{ fontSize: 9.5, color: "success.main", fontFamily: "monospace", fontWeight: 850 }}>+{file.additions}</Typography>
                  <Typography sx={{ fontSize: 9.5, color: "error.main", fontFamily: "monospace", fontWeight: 850 }}>-{file.deletions}</Typography>
                  {fileComments.length > 0 && (
                    <Chip size="small" label={`${fileComments.length} 评论${unresolved ? ` / ${unresolved} 未解决` : ""}`} color={unresolved ? "warning" : "success"} sx={{ height: 18, fontSize: 9 }} />
                  )}
                  {invalidatedFiles.includes(file.id) && (
                    <Tooltip title="文件内容已更新：原已查看标记作废，评论位置已重算，请重新评审">
                      <Chip size="small" color="info" label="内容已更新" sx={{ height: 18, fontSize: 9 }} />
                    </Tooltip>
                  )}
                  {reviewed && <Chip size="small" color="success" label="已查看" sx={{ height: 18, fontSize: 9 }} />}
                </Stack>
              </Box>
            </ListItemButton>
          );
        })}
      </List>
      <Divider />
      <Box sx={{ p: 1.1 }}>
        <Typography sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1.55 }}>
          Monaco 仅渲染视口附近行；数千行 Diff 仍可连续滚动。
        </Typography>
      </Box>
    </Paper>
  );
}
