import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AddCommentRounded,
  CheckCircleRounded,
  DeleteOutlineRounded,
  ForumRounded,
  GpsFixedRounded,
  ReplayRounded,
  ReplyRounded,
  SubdirectoryArrowRightRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
import type { CommentDraft, CommentSide } from "../types/review";
import { commentSideLabel, commentsForFile, useReviewStore } from "../stores/reviewStore";
import { useSyncStore } from "../stores/syncStore";

export default function CommentPanel({
  draft,
  onDraftChange,
  onReveal,
  onCreateCurrent,
  onReanchor,
}: {
  draft: CommentDraft | null;
  onDraftChange: (draft: CommentDraft | null) => void;
  onReveal: (side: CommentSide, line: number) => void;
  onCreateCurrent: () => void;
  onReanchor: (commentId: string, side: CommentSide, line: number) => void;
}) {
  const selectedFileId = useReviewStore((state) => state.selectedFileId);
  const files = useReviewStore((state) => state.files);
  const comments = useReviewStore((state) => state.comments);
  const addComment = useReviewStore((state) => state.addComment);
  const addReply = useReviewStore((state) => state.addReply);
  const resolveComment = useReviewStore((state) => state.resolveComment);
  const deleteComment = useReviewStore((state) => state.deleteComment);
  const setConflictCenterOpen = useSyncStore((state) => state.setConflictCenterOpen);
  const [draftBody, setDraftBody] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const selectedFile = files.find((file) => file.id === selectedFileId)!;
  const currentComments = commentsForFile(comments, selectedFileId);
  const unresolved = currentComments.filter((comment) => !comment.resolved).length;

  const submitDraft = () => {
    if (!draft || !draftBody.trim()) return;
    addComment(draft, draftBody);
    setDraftBody("");
  };

  return (
    <Paper variant="outlined" sx={{ minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ p: 1.4, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" alignItems="center" spacing={0.8}>
          <ForumRounded color="primary" fontSize="small" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 950 }}>审阅线程</Typography>
            <Typography noWrap sx={{ fontSize: 10, color: "text.secondary", mt: 0.25 }}>{selectedFile.path}</Typography>
          </Box>
          <Chip size="small" color={unresolved ? "warning" : "success"} label={`${unresolved} 未解决`} />
        </Stack>
        <Button fullWidth size="small" variant="outlined" startIcon={<AddCommentRounded />} onClick={onCreateCurrent} sx={{ mt: 1.1 }}>
          评论当前光标行
        </Button>
      </Box>

      {draft && (
        <Box sx={{ p: 1.3, bgcolor: "primary.50", borderBottom: "1px solid", borderColor: "divider" }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 0.8 }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 900, flex: 1 }}>
              {commentSideLabel(draft.side)} {draft.line}
            </Typography>
            <Button size="small" onClick={() => onDraftChange(null)}>取消</Button>
          </Stack>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={3}
            autoFocus
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            placeholder="说明风险、建议或需要补充的测试"
          />
          <Button fullWidth variant="contained" size="small" sx={{ mt: 0.8 }} disabled={!draftBody.trim()} onClick={submitDraft}>
            提交评论
          </Button>
        </Box>
      )}

      <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 1 }}>
        {currentComments.length === 0 && (
          <Box sx={{ py: 7, textAlign: "center", color: "text.secondary" }}>
            <ForumRounded sx={{ fontSize: 34, opacity: 0.45 }} />
            <Typography sx={{ mt: 1, fontSize: 11.5 }}>当前文件还没有评论</Typography>
            <Typography sx={{ mt: 0.4, fontSize: 10 }}>点击行号或使用上方按钮开始讨论</Typography>
          </Box>
        )}
        <Stack spacing={1}>
          {currentComments.map((comment) => (
            <Paper
              key={comment.id}
              variant="outlined"
              sx={{
                p: 1.1,
                borderColor: comment.conflict
                  ? "error.light"
                  : comment.resolved
                    ? "success.light"
                    : "divider",
                bgcolor: comment.conflict ? "error.50" : comment.resolved ? "success.50" : "background.paper",
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.7} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`${commentSideLabel(comment.side)} ${comment.line}`}
                  onClick={() => onReveal(comment.side, comment.line)}
                  sx={{ cursor: "pointer", fontFamily: "monospace" }}
                />
                {comment.pending && <Chip size="small" color="warning" label="待同步" sx={{ height: 18, fontSize: 9 }} />}
                {comment.conflict && (
                  <Chip
                    size="small"
                    color="error"
                    icon={<WarningAmberRounded fontSize="small" />}
                    label="冲突待裁决"
                    onClick={() => setConflictCenterOpen(true)}
                    sx={{ height: 18, fontSize: 9, cursor: "pointer" }}
                  />
                )}
                {comment.orphaned && (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label="位置已失效"
                    sx={{ height: 18, fontSize: 9 }}
                  />
                )}
                {comment.reanchoredFrom !== undefined && !comment.orphaned && (
                  <Tooltip title={`内容更新后位置重算：原 ${comment.reanchoredFrom} → ${comment.line}`}>
                    <Chip size="small" color="info" variant="outlined" label={`重算 ${comment.reanchoredFrom}→${comment.line}`} sx={{ height: 18, fontSize: 9 }} />
                  </Tooltip>
                )}
                <Typography sx={{ fontSize: 10.5, fontWeight: 850, flex: 1 }}>{comment.author}</Typography>
                {comment.orphaned && (
                  <Tooltip title="重新定位到附近修改行">
                    <IconButton size="small" color="primary" onClick={() => onReanchor(comment.id, comment.side, comment.line)}>
                      <GpsFixedRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={comment.resolved ? "重新打开" : "标记已解决"}>
                  <IconButton size="small" color={comment.resolved ? "primary" : "success"} onClick={() => resolveComment(comment.id, !comment.resolved)}>
                    {comment.resolved ? <ReplayRounded fontSize="small" /> : <CheckCircleRounded fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="删除评论">
                  <IconButton size="small" color="error" onClick={() => deleteComment(comment.id)}>
                    <DeleteOutlineRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Typography sx={{ mt: 0.8, fontSize: 11.2, lineHeight: 1.6 }}>{comment.body}</Typography>
              <Typography sx={{ mt: 0.5, fontSize: 9.5, color: "text.secondary" }}>
                {new Date(comment.createdAt).toLocaleString("zh-CN", { hour12: false })}
              </Typography>

              {comment.replies.map((reply) => (
                <Box key={reply.id} sx={{ mt: 1, ml: 1.2, pl: 1.2, borderLeft: "2px solid", borderColor: "divider" }}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <SubdirectoryArrowRightRounded sx={{ fontSize: 14, color: "text.secondary" }} />
                    <Typography sx={{ fontSize: 10.5, fontWeight: 850 }}>{reply.author}</Typography>
                    {reply.pending && <Chip size="small" color="warning" label="待同步" sx={{ height: 16, fontSize: 8.5 }} />}
                    <Typography sx={{ fontSize: 9, color: "text.secondary", ml: "auto" }}>
                      {new Date(reply.createdAt).toLocaleTimeString("zh-CN", { hour12: false, minute: "2-digit" })}
                    </Typography>
                  </Stack>
                  <Typography sx={{ mt: 0.45, fontSize: 10.8, color: "text.secondary", lineHeight: 1.55 }}>{reply.body}</Typography>
                </Box>
              ))}

              <Divider sx={{ my: 1 }} />
              <Stack direction="row" spacing={0.6}>
                <TextField
                  size="small"
                  fullWidth
                  value={replyDrafts[comment.id] ?? ""}
                  onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                  placeholder="回复..."
                />
                <IconButton
                  size="small"
                  color="primary"
                  disabled={!(replyDrafts[comment.id] ?? "").trim()}
                  onClick={() => {
                    addReply(comment.id, replyDrafts[comment.id] ?? "");
                    setReplyDrafts((current) => ({ ...current, [comment.id]: "" }));
                  }}
                >
                  <ReplyRounded fontSize="small" />
                </IconButton>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Box>
    </Paper>
  );
}
