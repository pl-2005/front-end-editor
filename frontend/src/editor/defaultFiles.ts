import type { ProjectFiles } from '../types/project'

export const DEFAULT_FILES: ProjectFiles = {
  '/index.html': {
    code: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>简单计数器</title>
</head>
<body>
  <main class="card">
    <h1>简单计数器</h1>
    <p>点击按钮，改变计数。</p>
    <p id="count" class="count" role="status" aria-live="polite">0</p>
    <div class="actions">
      <button id="decrement" type="button" aria-label="减一">−1</button>
      <button id="reset" type="button">重置</button>
      <button id="increment" type="button" aria-label="加一">+1</button>
    </div>
  </main>
  <script type="module" src="/index.js"></script>
</body>
</html>`,
  },
  '/styles.css': {
    code: `* {
  box-sizing: border-box;
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  font-family: system-ui, sans-serif;
  color: #1e293b;
  background: #f5f7fb;
  color-scheme: light;
}
.card {
  width: min(400px, 90vw);
  padding: 32px;
  border: 1px solid #dbe3ee;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 12px 36px #0f172a0d;
  text-align: center;
}
h1 {
  margin: 0;
  font-size: 28px;
}
.count {
  margin: 24px 0;
  color: #2563eb;
  font-size: 72px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}
button {
  padding: 10px 18px;
  border: 0;
  border-radius: 999px;
  color: #ffffff;
  background: #2563eb;
  font: inherit;
  cursor: pointer;
}
button:hover {
  background: #1d4ed8;
}
button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 4px;
}`,
  },
  '/index.js': {
    code: `import "./styles.css";

let count = 0;
const display = document.querySelector("#count");

function updateCount(value) {
  count = value;
  display.textContent = String(count);
  console.log(count);
}

document.querySelector("#decrement")?.addEventListener("click", () => {
  updateCount(count - 1);
});

document.querySelector("#reset")?.addEventListener("click", () => {
  updateCount(0);
});

document.querySelector("#increment")?.addEventListener("click", () => {
  updateCount(count + 1);
});`,
  },
}
