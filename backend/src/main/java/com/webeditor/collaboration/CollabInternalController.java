package com.webeditor.collaboration;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/collaboration/projects/{id}")
public class CollabInternalController {
    private final CollabPersistenceService service;
    private final String secret;
    private final Map<String, Long> nonces = new HashMap<>();
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param service 业务服务
     * @param secret 签名密钥
     */
    public CollabInternalController(CollabPersistenceService service,
            @Value("${editor.collaboration.storage-secret:}") String secret) { this.service = service; this.secret = secret; }
    /**
     * 验证内部 HMAC 请求后返回当前协作文档指针。
     *
     * @param id 项目 ID
     * @param request 当前 HTTP 请求
     */
    @GetMapping("/describe")
    CollabPointer describe(@PathVariable long id, HttpServletRequest request) throws IOException {
        authenticate(request); return service.describe(id);
    }
    /**
     * 验证内部请求并返回指定 epoch 和 generation 对应的文档二进制。
     *
     * @param id 项目 ID
     * @param epoch 文档生命周期编号
     * @param generation 文档持久化代次
     * @param request 当前 HTTP 请求
     */
    @GetMapping("/epochs/{epoch}/generations/{generation}/load")
    ResponseEntity<byte[]> load(@PathVariable long id, @PathVariable long epoch, @PathVariable long generation,
            HttpServletRequest request) throws IOException {
        authenticate(request);
        return ResponseEntity.ok().header("Content-Type", CollabPointer.CONTENT_TYPE).body(service.load(id, epoch, generation));
    }
    /**
     * 验证内部签名及二进制内容类型，再按幂等键保存文档。
     *
     * @param id 项目 ID
     * @param epoch 文档生命周期编号
     * @param generation 调用方预期的当前持久化代次
     * @param key 本次保存的幂等键
     * @param request 当前 HTTP 请求
     */
    @PostMapping("/epochs/{epoch}/generations/{generation}/persist/{key}")
    CollabPointer persist(@PathVariable long id, @PathVariable long epoch, @PathVariable long generation,
            @PathVariable String key, HttpServletRequest request) throws IOException {
        byte[] bytes = authenticate(request);
        if (!CollabPointer.CONTENT_TYPE.equals(request.getContentType())) throw new CollabFailure(415, "COLLAB_INVALID_CONTENT_TYPE");
        return service.persist(id, epoch, generation, key, bytes);
    }
    /**
     * 限量读取原始请求体，校验时间窗和 HMAC，并登记 nonce 防止重放；返回已认证的请求体。
     *
     * @param request 当前 HTTP 请求
     */
    private byte[] authenticate(HttpServletRequest request) throws IOException {
        String timestamp = request.getHeader("X-Collab-Timestamp"), nonce = request.getHeader("X-Collab-Nonce");
        if (secret.getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32 || request.getQueryString() != null
                || timestamp == null || !timestamp.matches("[0-9]{10}") || nonce == null || !nonce.matches("[a-f0-9-]{36}")
                || Math.abs(Instant.now().getEpochSecond() - Long.parseLong(timestamp)) > 30)
            throw new CollabFailure(401, "COLLAB_INTERNAL_UNAUTHORIZED");
        byte[] body = request.getInputStream().readNBytes(CollabPointer.MAX_BYTES + 1);
        if (body.length > CollabPointer.MAX_BYTES) throw new CollabFailure(413, "COLLAB_DOCUMENT_TOO_LARGE");
        if (!InternalHmac.matches(request.getHeader("X-Collab-Signature"), InternalHmac.sign(secret, request.getMethod(), request.getRequestURI(), "storage", timestamp, nonce, body)))
            throw new CollabFailure(401, "COLLAB_INTERNAL_UNAUTHORIZED");
        synchronized (nonces) {
            long now = System.currentTimeMillis();
            nonces.values().removeIf(expiry -> expiry < now);
            if (nonces.containsKey(nonce) || nonces.size() >= 10000) throw new CollabFailure(401, "COLLAB_INTERNAL_UNAUTHORIZED");
            nonces.put(nonce, now + 61000);
        }
        return body;
    }
}
