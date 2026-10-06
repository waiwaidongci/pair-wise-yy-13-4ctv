import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AddCommentRounded,
  CheckCircleRounded,
  CompareArrowsRounded,
  DensityMediumRounded,
  KeyboardArrowDownRounded,
  KeyboardArrowUpRounded,
  SplitscreenRounded,
  UnfoldLessRounded,
  ViewAgendaRounded,
} from "@mui/icons-material";
import CommentPanel from "../components/CommentPanel";
import DiffEditorPane, { type DiffEditorHandle } from "../components/DiffEditorPane";
import FileTree from "../components/FileTree";
import { commentsForFile, useReviewStore } from "../stores/reviewStore";
import type { CommentSide } from "../types/review";

export default function DiffPage() {
  const files = useReviewStore((state) => state.files);
  const selectedFileId = useReviewStore((state) => state.selectedFileId);
  const viewMode = useReviewStore((state) => state.viewMode);
  const hideUnchanged = useReviewStore((state) => state.hideUnchanged);
  const reviewedFiles = useReviewStore((state) => state.reviewedFiles);
  const comments = useReviewStore((state) => state.comments);
  const draft = useReviewStore((state) => state.draft);
  const setViewMode = useReviewStore((state) => state.setViewMode);
  const setHideUnchanged = useReviewStore((state) => state.setHideUnchanged);
  const setDraft = useReviewStore((state) => state.setDraft);
  const toggleReviewed = useReviewStore((state) => state.toggleReviewed);
  const editorRef = useRef<DiffEditorHandle | null>(null);
  const [lastJump, setLastJump] = useState<number | null>(null);
  const selectedFile = files.find((file) => file.id === selectedFileId)!;
  const fileComments = useMemo(() => commentsForFile(comments, selectedFileId), [comments, selectedFileId]);
  const reviewed = reviewedFiles.includes(selectedFileId);

  const reveal = (side: CommentSide, line: number) => {
    editorRef.current?.revealLine(line, side);
    setLastJump(line);
  };

  const createCurrentComment = () => {
    editorRef.current?.getModifiedLine();
    setDraft({ fileId: selectedFileId, line: editorRef.current?.getModifiedLine() ?? 1, side: "modified" });
  };

  const moveNext = () => {
    const line = editorRef.current?.nextChange();
    if (line) setLastJump(line);
  };

  const movePrevious = () => {
    const line = editorRef.current?.previousChange();
    if (line) setLastJump(line);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isNext = event.key === "F7" || (event.altKey && event.key === "ArrowDown");
      const isPrevious = event.shiftKey && event.key === "F7" || (event.altKey && event.key === "ArrowUp");
      if (isNext) {
        event.preventDefault();
        moveNext();
      }
      if (isPrevious) {
        event.preventDefault();
        movePrevious();
      }
      if (event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        createCurrentComment();
      }
      if (event.altKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        toggleReviewed();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFileId, toggleReviewed]);

  return (
    <Box sx={{ px: { xs: 1.2, xl: 2 }, py: 1.6, maxWidth: 1920, mx: "auto" }}>
      <Paper
        variant="outlined"
        sx={{
          px: 1.3,
          py: 1,
          mb: 1.2,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={viewMode}
          onChange={(_, value) => value && setViewMode(value)}
        >
          <ToggleButton value="side-by-side">
            <SplitscreenRounded fontSize="small" sx={{ mr: 0.6 }} /> 并排
          </ToggleButton>
          <ToggleButton value="inline">
            <ViewAgendaRounded fontSize="small" sx={{ mr: 0.6 }} /> 行内
          </ToggleButton>
        </ToggleButtonGroup>
        <Divider orientation="vertical" flexItem />
        <FormControlLabel
          control={<Switch size="small" checked={hideUnchanged} onChange={(event) => setHideUnchanged(event.target.checked)} />}
          label={<Typography sx={{ fontSize: 11.5, fontWeight: 750 }}>折叠未修改区域</Typography>}
        />
        <Divider orientation="vertical" flexItem />
        <Tooltip title="上一处修改（Shift+F7 / Alt+↑）">
          <Button size="small" startIcon={<KeyboardArrowUpRounded />} onClick={movePrevious}>上一处</Button>
        </Tooltip>
        <Tooltip title="下一处修改（F7 / Alt+↓）">
          <Button size="small" startIcon={<KeyboardArrowDownRounded />} onClick={moveNext}>下一处</Button>
        </Tooltip>
        <Divider orientation="vertical" flexItem />
        <Button size="small" startIcon={<AddCommentRounded />} onClick={createCurrentComment}>评论当前行</Button>
        <Box sx={{ flex: 1 }} />
        {lastJump && <Chip size="small" icon={<CompareArrowsRounded />} label={`已跳到新行 ${lastJump}`} />}
        <Chip size="small" icon={<DensityMediumRounded />} label={`${selectedFile.additions} 增 / ${selectedFile.deletions} 删`} color="primary" variant="outlined" />
        <Button
          size="small"
          variant={reviewed ? "contained" : "outlined"}
          color={reviewed ? "success" : "primary"}
          startIcon={<CheckCircleRounded />}
          onClick={() => toggleReviewed()}
        >
          {reviewed ? "已查看" : "标记已查看"}
        </Button>
      </Paper>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "255px minmax(620px, 1fr) 330px" },
          gridTemplateRows: { xs: "auto", lg: "calc(100vh - 164px)" },
          gap: 1.2,
          minHeight: 0,
        }}
      >
        <Box sx={{ minHeight: { xs: 420, lg: 0 } }}>
          <FileTree />
        </Box>

        <Paper variant="outlined" sx={{ minHeight: { xs: 620, lg: 0 }, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Box sx={{ px: 1.3, py: 0.9, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={0.7}>
                <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 950, fontFamily: "monospace" }}>{selectedFile.path}</Typography>
                <Chip size="small" label={selectedFile.language} sx={{ height: 19, fontSize: 9 }} />
                {selectedFile.status === "renamed" && <Chip size="small" color="warning" label="重命名" sx={{ height: 19, fontSize: 9 }} />}
              </Stack>
              <Typography noWrap sx={{ mt: 0.25, fontSize: 10, color: "text.secondary" }}>{selectedFile.description}</Typography>
            </Box>
            <Tooltip title="点击行号可评论任意旧行或新行">
              <Chip size="small" icon={<AddCommentRounded />} label={`${fileComments.length} 条评论`} />
            </Tooltip>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
            <DiffEditorPane
              ref={editorRef}
              file={selectedFile}
              viewMode={viewMode}
              hideUnchanged={hideUnchanged}
              comments={fileComments}
              activeDraft={draft}
              onLineClick={setDraft}
            />
            <Box sx={{ position: "absolute", right: 18, bottom: 16, bgcolor: "rgba(15,23,42,.82)", color: "white", px: 1.2, py: 0.65, borderRadius: 1, fontSize: 10.2, pointerEvents: "none" }}>
              单词级差异 · 折叠未修改 · Monaco 虚拟滚动
            </Box>
          </Box>
        </Paper>

        <Box sx={{ minHeight: { xs: 520, lg: 0 } }}>
          <CommentPanel
            draft={draft}
            onDraftChange={setDraft}
            onReveal={reveal}
            onCreateCurrent={createCurrentComment}
          />
        </Box>
      </Box>

      <Paper variant="outlined" sx={{ mt: 1.2, px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1.2, flexWrap: "wrap" }}>
        <UnfoldLessRounded fontSize="small" color="action" />
        <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
          大 Diff 仅调度可见行；切换文件会保留本地评论、已查看状态和审查视图设置。
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
          快捷键：F7 下一处 · Shift+F7 上一处 · Alt+C 评论 · Alt+R 已查看
        </Typography>
      </Paper>
    </Box>
  );
}
