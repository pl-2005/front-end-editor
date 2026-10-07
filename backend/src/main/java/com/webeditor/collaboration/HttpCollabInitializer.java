package com.webeditor.collaboration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class HttpCollabInitializer implements CollabInitializer {
    private final ObjectMapper mapper;
    private final String secret;
    private final URI uri;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param mapper JSON 序列化器
     * @param url 本机初始化服务地址
     * @param secret 签名密钥
     */
    public HttpCollabInitializer(ObjectMapper mapper,
            @Value("${editor.collaboration.initializer.url:http://127.0.0.1:8091/internal/initialize}") String url,
            @Value("${editor.collaboration.initializer.secret:}") String secret) {
        this.mapper = mapper; this.secret = secret; this.uri = URI.create(url);
        if (!"http".equals(uri.getScheme()) || !"127.0.0.1".equals(uri.getHost()) || uri.getUserInfo() != null
                || uri.getQuery() != null || uri.getFragment() != null || !"/internal/initialize".equals(uri.getPath()))
            throw new IllegalArgumentException("Initializer must use the loopback internal endpoint");
    }
    /**
     * 调用本机初始化服务，将初始文件编码为 epoch 为 1 的文档。
     *
     * @param id 项目 ID
     * @param entry 入口文件绝对路径
     * @param files 文件集合
     */
    public byte[] initialize(long id, String entry, List<FileInput> files) {
        return call(Map.of("projectId", id, "epoch", 1, "entry", entry, "files", files));
    }
    /**
     * 携带源文档身份和 Base64 二进制，请求本机服务生成独立的目标文档。
     *
     * @param id 项目 ID
     * @param source 源协作文档指针
     * @param bytes 文档二进制内容
     */
    public byte[] copy(long id, CollabPointer source, byte[] bytes) {
        return call(Map.of("projectId", id, "epoch", 1, "source", Map.of("projectId", source.projectId(), "epoch", source.epoch(), "bytes", Base64.getEncoder().encodeToString(bytes))));
    }
    /**
     * 签名请求并限时调用回环地址；限量读取响应，核对类型、长度、摘要及目标身份后返回文档。
     *
     * @param input 请求输入
     */
    private byte[] call(Map<String, ?> input) {
        try {
            byte[] body = mapper.writeValueAsBytes(input);
            String timestamp = Long.toString(Instant.now().getEpochSecond()), nonce = UUID.randomUUID().toString();
            var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce)
                    .header("X-Collab-Signature", InternalHmac.sign(secret, "POST", uri.getPath(), "initializer", timestamp, nonce, body))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (var stream = response.body()) {
                if (response.statusCode() != 200 || !response.headers().firstValue("Content-Type").orElse("").equals(CollabPointer.CONTENT_TYPE))
                    throw new CollabFailure(503, "COLLAB_INITIALIZER_UNAVAILABLE");
                byte[] bytes = stream.readNBytes(CollabPointer.MAX_BYTES + 1);
                CollabPersistenceService.validateBytes(bytes);
                if (!response.headers().firstValue("X-Collab-Content-Hash").orElse("").equals(CollabPersistenceService.hash(bytes))
                        || !response.headers().firstValue("Content-Length").orElse("").equals(Integer.toString(bytes.length))
                        || !response.headers().firstValue("X-Collab-Epoch").orElse("").equals(input.get("epoch").toString())
                        || !response.headers().firstValue("X-Collab-Project-Id").orElse("").equals(input.get("projectId").toString()))
                    throw new CollabFailure(503, "COLLAB_INITIALIZER_INVALID_RESPONSE");
                return bytes;
            }
        } catch (CollabFailure e) { throw e; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new CollabFailure(503, "COLLAB_INITIALIZER_UNAVAILABLE"); }
        catch (Exception e) { throw new CollabFailure(503, "COLLAB_INITIALIZER_UNAVAILABLE"); }
    }
    public byte[] rebuild(CollabPointer source, long epoch, byte[] bytes) {
        return call(Map.of("projectId", source.projectId(), "epoch", epoch, "source",
                Map.of("projectId", source.projectId(), "epoch", source.epoch(), "bytes", Base64.getEncoder().encodeToString(bytes))));
    }
}
