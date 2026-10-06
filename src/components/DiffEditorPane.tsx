import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { monaco } from "../utils/monaco";
import type { CommentDraft, CommentSide, DiffFile, DiffViewMode, ReviewComment } from "../types/review";

export interface DiffEditorHandle {
  nextChange: () => number | null;
  previousChange: () => number | null;
  revealLine: (line: number, side?: CommentSide) => void;
  getModifiedLine: () => number;
}

interface DiffEditorPaneProps {
  file: DiffFile;
  viewMode: DiffViewMode;
  hideUnchanged: boolean;
  comments: ReviewComment[];
  activeDraft: CommentDraft | null;
  onLineClick: (draft: CommentDraft) => void;
}

const DiffEditorPane = forwardRef<DiffEditorHandle, DiffEditorPaneProps>(function DiffEditorPane(
  { file, viewMode, hideUnchanged, comments, activeDraft, onLineClick },
  ref,
) {
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const disposablesRef = useRef<Monaco.IDisposable[]>([]);
  const decorationCollectionsRef = useRef<Monaco.editor.IEditorDecorationsCollection[]>([]);
  const [ready, setReady] = useState(false);

  const revealLine = (line: number, side: CommentSide = "modified") => {
    const editor = editorRef.current;
    if (!editor) return;
    const target = side === "original" ? editor.getOriginalEditor() : editor.getModifiedEditor();
    target.revealLineInCenter(line);
    target.setPosition({ lineNumber: line, column: 1 });
    target.focus();
  };

  const changeLines = () => {
    const editor = editorRef.current;
    if (!editor) return [];
    return (editor.getLineChanges() ?? [])
      .map((change) => change.modifiedStartLineNumber || change.modifiedEndLineNumber || Math.max(1, change.originalEndLineNumber))
      .filter((line, index, all) => line > 0 && all.indexOf(line) === index)
      .sort((left, right) => left - right);
  };

  const moveToChange = (direction: 1 | -1): number | null => {
    const points = changeLines();
    if (!points.length) return null;
    const current = editorRef.current?.getModifiedEditor().getPosition()?.lineNumber ?? 1;
    const next =
      direction === 1
        ? points.find((line) => line > current) ?? points[0]
        : points.slice().reverse().find((line) => line < current) ?? points[points.length - 1];
    revealLine(next, "modified");
    return next;
  };

  useImperativeHandle(ref, () => ({
    nextChange: () => moveToChange(1),
    previousChange: () => moveToChange(-1),
    revealLine,
    getModifiedLine: () => editorRef.current?.getModifiedEditor().getPosition()?.lineNumber ?? 1,
  }));

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const collection of decorationCollectionsRef.current) collection.clear();
    decorationCollectionsRef.current = [];

    const toDecoration = (comment: ReviewComment) => ({
      range: new monaco.Range(comment.line, 1, comment.line, 1),
      options: {
        isWholeLine: true,
        className: comment.outdated ? "review-comment-line review-comment-line-outdated" : "review-comment-line",
        glyphMarginClassName: comment.outdated ? "review-comment-glyph review-comment-glyph-outdated" : "review-comment-glyph",
        hoverMessage: comment.outdated ? { value: "⚠️ 文件内容已更新，该评论位置失效" } : undefined,
      },
    });
    const originalDecorations = comments.filter((comment) => comment.side === "original").map(toDecoration);
    const modifiedDecorations = comments.filter((comment) => comment.side === "modified").map(toDecoration);

    decorationCollectionsRef.current.push(editor.getOriginalEditor().createDecorationsCollection(originalDecorations));
    decorationCollectionsRef.current.push(editor.getModifiedEditor().createDecorationsCollection(modifiedDecorations));
  }, [comments, file.id, ready]);

  useEffect(
    () => () => {
      for (const disposable of disposablesRef.current) disposable.dispose();
      for (const collection of decorationCollectionsRef.current) collection.clear();
    },
    [],
  );

  return (
    <DiffEditor
      height="100%"
      language={file.language}
      original={file.oldContent}
      modified={file.newContent}
      theme="vs"
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      options={{
        automaticLayout: true,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: viewMode === "side-by-side",
        renderIndicators: true,
        renderOverviewRuler: true,
        minimap: { enabled: false },
        lineNumbersMinChars: 4,
        glyphMargin: true,
        folding: true,
        showFoldingControls: "mouseover",
        wordWrap: "off",
        diffWordWrap: "off",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        fontFamily: '"SFMono-Regular", "Cascadia Code", Menlo, monospace',
        fontSize: 12.5,
        lineHeight: 20,
        hideUnchangedRegions: {
          enabled: hideUnchanged,
          contextLineCount: 3,
          minimumLineCount: 5,
          revealLineCount: 12,
        },
        renderLineHighlight: "line",
        overviewRulerBorder: false,
        scrollbar: {
          verticalScrollbarSize: 11,
          horizontalScrollbarSize: 11,
          useShadows: false,
        },
      }}
      onMount={(editor, monacoApi) => {
        editorRef.current = editor;
        setReady(true);
        const attach = (side: CommentSide) => {
          const target = side === "original" ? editor.getOriginalEditor() : editor.getModifiedEditor();
          const disposable = target.onMouseDown((event) => {
            const targetType = event.target.type;
            const allowed =
              targetType === monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
              targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
              targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;
            const line = event.target.position?.lineNumber;
            if (allowed && line) onLineClick({ fileId: file.id, line, side });
          });
          disposablesRef.current.push(disposable);
        };
        attach("original");
        attach("modified");
      }}
    />
  );
});

export default DiffEditorPane;
