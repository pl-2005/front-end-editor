/**
 * 为新建 HTML 文件提供空白页面结构，其他文件从空内容开始。
 *
 * @param path 新文件路径
 */
export function newFileContent(path: string): string {
  if (!path.toLowerCase().endsWith('.html')) return ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>新页面</title>
</head>
<body>

</body>
</html>`
}
