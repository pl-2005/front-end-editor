package com.webeditor;

import com.webeditor.storage.MinioProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableConfigurationProperties(MinioProperties.class)
@EnableScheduling
public class EditorApplication {
    /**
     * 启动 Spring Boot 应用，加载项目配置及各业务组件。
     *
     * @param args 启动参数
     */
    public static void main(String[] args) {
        SpringApplication.run(EditorApplication.class, args);
    }
}
