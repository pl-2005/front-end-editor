package com.webeditor.storage;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.DefaultApplicationArguments;

@ExtendWith(MockitoExtension.class)
class MinioBucketInitializerTests {
    @Mock
    private MinioClient minioClient;

    private final MinioProperties properties = new MinioProperties(
            "http://localhost:9000", "access-key", "secret-key", "web-editor-test");

    @Test
    void createsBucketWhenItDoesNotExist() throws Exception {
        when(minioClient.bucketExists(any(BucketExistsArgs.class))).thenReturn(false);

        new MinioBucketInitializer(minioClient, properties)
                .run(new DefaultApplicationArguments(new String[0]));

        verify(minioClient).makeBucket(any(MakeBucketArgs.class));
    }

    @Test
    void leavesExistingBucketUntouched() throws Exception {
        when(minioClient.bucketExists(any(BucketExistsArgs.class))).thenReturn(true);

        new MinioBucketInitializer(minioClient, properties)
                .run(new DefaultApplicationArguments(new String[0]));

        verify(minioClient, never()).makeBucket(any(MakeBucketArgs.class));
    }
}
