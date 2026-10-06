# DiffScope 代码审查工作台

基于 React、TypeScript、Vite、Monaco Editor、MUI、Zustand、TanStack Query 和 React Router 的大差异审查工具。

## 运行

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm build
```

## 功能

- Monaco 提供的并排与行内 Diff 模式、语法高亮、单词级差异和虚拟滚动。
- 折叠未修改区域，F7 / Alt+↓ 快速跳转下一处修改。
- 文件树显示新增/删除行数与已查看状态。
- 任意行添加评论、回复评论、标记解决，并在编辑器中显示评论定位标记。
- mock patch 在本地生成，不依赖后端服务。
