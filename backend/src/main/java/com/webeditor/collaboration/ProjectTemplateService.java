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
                new CollabInitializer.FileInput("/index.html", "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\">\n  <title>Web Editor</title>\n  <link rel=\"stylesheet\" href=\"/styles.css\">\n</head>\n<body>\n  <h1>Hello, Web Editor!</h1>\n  <script type=\"module\" src=\"/index.js\"></script>\n</body>\n</html>\n"),
                new CollabInitializer.FileInput("/styles.css", "body { font-family: sans-serif; padding: 2rem; }\n"),
                new CollabInitializer.FileInput("/index.js", "console.log('Hello, Web Editor!');\n"));
    }
}
