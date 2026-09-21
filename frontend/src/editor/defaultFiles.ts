import type { ProjectFiles } from '../types/project'

export const DEFAULT_FILES: ProjectFiles = {
  '/index.html': { code: `<main class="card">
  <p class="eyebrow">SANDBOX READY</p>
  <h1>开始创作你的页面</h1>
  <p>修改左侧文件，预览会即时更新。</p>
  <button id="action">试一试</button>
</main>` },
  '/styles.css': { code: `* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #eef2e9; background: #121510; }
.card { width: min(560px, 90vw); padding: 48px; border: 1px solid #3a4135; border-radius: 24px; }
.eyebrow { color: #b6f36b; font: 700 12px monospace; letter-spacing: .16em; }
h1 { font-size: clamp(36px, 8vw, 64px); line-height: 1; }
button { padding: 10px 18px; border: 0; border-radius: 999px; background: #b6f36b; cursor: pointer; }` },
  '/index.js': { code: `import "./styles.css";

document.querySelector("#action")?.addEventListener("click", () => {
  console.log("你好，Sandpack！");
});` },
}
