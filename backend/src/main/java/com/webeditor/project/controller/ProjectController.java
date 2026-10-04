package com.webeditor.project.controller;

import com.webeditor.common.response.ApiResponse;
import com.webeditor.project.application.ProjectRequests;
import com.webeditor.project.application.ProjectResponses;
import com.webeditor.project.application.ProjectService;
import com.webeditor.project.application.SaveSnapshotRequest;
import com.webeditor.project.application.SnapshotService;
import com.webeditor.project.application.RestoreRevisionRequest;
import java.util.List;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private final ProjectService projectService;
    private final SnapshotService snapshotService;

    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param projectService 项目元数据服务
     * @param snapshotService 快照保存及恢复服务
     */
    public ProjectController(ProjectService projectService, SnapshotService snapshotService) {
        this.projectService = projectService;
        this.snapshotService = snapshotService;
    }

    /**
     * 调用旧项目创建服务，返回 201 及项目摘要；此路由目前由安全配置禁用。
     *
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PostMapping
    ResponseEntity<ApiResponse<ProjectResponses.Summary>> create(
            @Valid @RequestBody ProjectRequests.Create request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.created(projectService.create(request)));
    }

    /**
     * 分页返回旧项目摘要，此路由目前由安全配置禁用。
     *
     * @param page 从 0 开始的页码
     * @param size 每页记录数
     */
    @GetMapping
    ApiResponse<ProjectResponses.PageResult<ProjectResponses.Summary>> list(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ApiResponse.ok(projectService.list(page, size));
    }

    /**
     * 返回旧项目详情，并附带用于元数据并发控制的强 ETag。
     *
     * @param id 项目 ID
     */
    @GetMapping("/{id}")
    ResponseEntity<ApiResponse<ProjectResponses.Details>> get(@PathVariable @Min(1) long id) {
        ProjectResponses.Details details = projectService.get(id);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(id, details.stateVersion()))
                .body(ApiResponse.ok(details));
    }

    /**
     * 解析 If-Match 版本后更新旧项目元数据，响应携带新的 ETag。
     *
     * @param id 项目 ID
     * @param ifMatch 客户端提交的强 ETag
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PutMapping("/{id}")
    ResponseEntity<ApiResponse<ProjectResponses.Summary>> update(@PathVariable @Min(1) long id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody ProjectRequests.Update request) {
        ProjectResponses.Summary result = projectService.update(id, request, stateVersion(id, ifMatch));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(id, result.stateVersion()))
                .body(ApiResponse.ok(result));
    }

    /**
     * 按 If-Match 版本软删除旧项目，返回 204 和下一状态版本的 ETag。
     *
     * @param id 项目 ID
     * @param ifMatch 客户端提交的强 ETag
     */
    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@PathVariable @Min(1) long id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
        long expected = stateVersion(id, ifMatch);
        projectService.delete(id, expected);
        return ResponseEntity.noContent().header(HttpHeaders.ETAG, etag(id, expected + 1)).build();
    }

    /**
     * 将入口、文件集合及预期快照版本交给旧快照保存服务。
     *
     * @param id 项目 ID
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PutMapping("/{id}/snapshot")
    ApiResponse<ProjectResponses.SnapshotSaved> saveSnapshot(
            @PathVariable @Min(1) long id,
            @Valid @RequestBody SaveSnapshotRequest request) {
        return ApiResponse.ok(snapshotService.save(id, request));
    }

    /**
     * 返回旧项目的快照版本历史。
     *
     * @param id 项目 ID
     */
    @GetMapping("/{id}/revisions")
    ApiResponse<List<ProjectResponses.Revision>> listRevisions(@PathVariable @Min(1) long id) {
        return ApiResponse.ok(projectService.listRevisions(id));
    }

    /**
     * 按预期当前版本将指定历史快照恢复为新版本。
     *
     * @param id 项目 ID
     * @param version 版本号
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PostMapping("/{id}/revisions/{version}/restore")
    ApiResponse<ProjectResponses.SnapshotSaved> restoreRevision(
            @PathVariable @Min(1) long id,
            @PathVariable @Min(1) int version,
            @Valid @RequestBody RestoreRevisionRequest request) {
        return ApiResponse.ok(snapshotService.restore(id, version, request));
    }

    /**
     * 由项目 ID 和状态版本生成强 ETag，供 If-Match 并发校验使用。
     *
     * @param id 项目 ID
     * @param version 版本号
     */
    private String etag(long id, long version) { return "\"project-" + id + "-" + version + "\""; }

    /**
     * 要求单个匹配项目的强 If-Match ETag，缺失返回 428，格式错误转换为状态冲突。
     *
     * @param id 项目 ID
     * @param ifMatch 客户端提交的强 ETag
     */
    private long stateVersion(long id, String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    HttpStatus.PRECONDITION_REQUIRED, "更新项目必须提供 If-Match");
        }
        String prefix = "\"project-" + id + "-";
        if (!ifMatch.startsWith(prefix) || !ifMatch.endsWith("\"") || ifMatch.contains(",") || ifMatch.startsWith("W/")) {
            throw new com.webeditor.common.exception.ProjectStateConflictException("If-Match 必须是单个匹配的强 ETag");
        }
        try { return Long.parseLong(ifMatch.substring(prefix.length(), ifMatch.length() - 1)); }
        catch (NumberFormatException exception) {
            throw new com.webeditor.common.exception.ProjectStateConflictException("If-Match ETag 格式无效");
        }
    }
}
