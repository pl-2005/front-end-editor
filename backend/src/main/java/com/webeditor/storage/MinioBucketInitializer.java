package com.webeditor.storage;

import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
        prefix = "editor.storage.minio",
        name = "initialize-bucket",
        havingValue = "true",
        matchIfMissing = true
)
public class MinioBucketInitializer implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(MinioBucketInitializer.class);

    private final MinioClient minioClient;
    private final MinioProperties properties;

    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param minioClient MinIO 客户端
     * @param properties MinIO 存储配置
     */
    public MinioBucketInitializer(MinioClient minioClient, MinioProperties properties) {
        this.minioClient = minioClient;
        this.properties = properties;
    }

    /**
     * 应用启动时检查配置的 MinIO 桶，不存在则创建；失败向启动流程传播。
     *
     * @param args 启动参数
     */
    @Override
    public void run(ApplicationArguments args) throws Exception {
        String bucket = properties.bucket();
        boolean exists = minioClient.bucketExists(BucketExistsArgs.builder().bucket(bucket).build());
        if (!exists) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            log.info("Created private MinIO bucket: {}", bucket);
        } else {
            log.info("MinIO bucket is ready: {}", bucket);
        }
    }
}
