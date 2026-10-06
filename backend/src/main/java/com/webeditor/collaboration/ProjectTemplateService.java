package com.webeditor.collaboration;

import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ProjectTemplateService {
    /**
     * 生成 vanilla 模板的三个初始文件；其他模板或入口组合暂不支持。
     *
     * @param template 项目模板标识
     * @param entry 入口文件绝对路径
     */
    public List<CollabInitializer.FileInput> files(String template, String entry) {
        if (!"vanilla".equals(template) || !"/index.html".equals(entry))
            throw new CollabFailure(400, "COLLAB_TEMPLATE_UNSUPPORTED");
        return List.of(
                new CollabInitializer.FileInput("/index.html", """
                        <!doctype html>
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
                        </html>
                        """),
                new CollabInitializer.FileInput("/styles.css", """
                        * {
                          box-sizing: border-box;
                        }
                        body {
                          margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #eef2e9; background: #121510;
                        }
                        .card {
                          width: min(400px, 90vw); padding: 32px; border: 1px solid #3a4135; border-radius: 24px; text-align: center;
                        }
                        h1 {
                          margin: 0; font-size: 28px;
                        }
                        .count {
                          margin: 24px 0; color: #b6f36b; font-size: 72px; font-weight: 700; font-variant-numeric: tabular-nums;
                        }
                        .actions {
                          display: flex; justify-content: center; gap: 12px;
                        }
                        button {
                          padding: 10px 18px; border: 0; border-radius: 999px; color: #121510; background: #b6f36b; font: inherit; cursor: pointer;
                        }
                        button:hover {
                          background: #c9ff8c;
                        }
                        button:focus-visible {
                          outline: 2px solid #eef2e9; outline-offset: 4px;
                        }
                        """),
                new CollabInitializer.FileInput("/index.js", """
                        import "./styles.css";

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
                        });
                        """));
    }
}
