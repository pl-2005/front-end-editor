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
    public static void main(String[] args) {
        SpringApplication.run(EditorApplication.class, args);
    }
}
