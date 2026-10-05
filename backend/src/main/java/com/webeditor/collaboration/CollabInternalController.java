package com.webeditor.collaboration;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/collaboration/projects/{id}")
public class CollabInternalController {
    private final CollabPersistenceService service;
    private final CollabInternalAuth auth;

    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param service 业务服务
     * @param auth 持久化 nonce 的内部认证组件
     */
    public CollabInternalController(CollabPersistenceService service,
            CollabInternalAuth auth) { this.service = service; this.auth = auth; }
    /**
     * 验证内部 HMAC 请求后返回当前协作文档指针。
     *
     * @param id 项目 ID
     * @param request 当前 HTTP 请求
     */
    @GetMapping("/describe")
    CollabPointer describe(@PathVariable long id, HttpServletRequest request) throws IOException {
        auth.authenticate(request); return service.describe(id);
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
        auth.authenticate(request);
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
        byte[] bytes = auth.authenticate(request);
        if (!CollabPointer.CONTENT_TYPE.equals(request.getContentType())) throw new CollabFailure(415, "COLLAB_INVALID_CONTENT_TYPE");
        return service.persist(id, epoch, generation, key, bytes);
    }
}
