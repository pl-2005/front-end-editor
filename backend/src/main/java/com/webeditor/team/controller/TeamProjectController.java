package com.webeditor.team.controller;

import com.webeditor.common.response.ApiResponse;
import com.webeditor.common.exception.ProjectStateConflictException;
import com.webeditor.common.security.CurrentUser;
import com.webeditor.project.application.ProjectRequests;
import com.webeditor.project.application.ProjectResponses;
import com.webeditor.project.application.ProjectService;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.collaboration.*;
import com.webeditor.team.application.TeamAccessService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController @RequestMapping("/api/teams/{teamId}/projects")
public class TeamProjectController {
    private final TeamAccessService access;
    private final ProjectRepository projects;
    private final ProjectService service;
    private final CollabProjectService collabProjects;
    private final CollabPersistenceService persistence;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param access 团队及项目权限校验服务
     * @param projects 项目仓储
     * @param service 业务服务
     * @param collabProjects 协作项目初始化及复制服务
     * @param persistence 协作文档持久化服务
     */
    public TeamProjectController(TeamAccessService access, ProjectRepository projects, ProjectService service,
            CollabProjectService collabProjects, CollabPersistenceService persistence) {
        this.access = access; this.projects = projects; this.service = service;
        this.collabProjects = collabProjects; this.persistence = persistence;
    }
    /**
     * 按成员权限创建并初始化团队协作项目，返回 201、摘要和元数据 ETag。
     *
     * @param teamId 团队 ID
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PostMapping
    ResponseEntity<ApiResponse<CollabProjectResponses.Summary>> create(@PathVariable @Min(1) long teamId,
            @Valid @RequestBody ProjectRequests.Create request) {
        var result = collabProjects.create(teamId, CurrentUser.id(), request);
        return ResponseEntity.status(201).header(HttpHeaders.ETAG, etag(result.id(), result.stateVersion())).body(ApiResponse.ok(result));
    }
    /**
     * 为当前成员重试指定项目的初始化，返回已激活项目摘要。
     *
     * @param teamId 团队 ID
     * @param projectId 项目 ID
     */
    @PostMapping("/{projectId}/initialize")
    ApiResponse<CollabProjectResponses.Summary> retry(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long projectId) {
        return ApiResponse.ok(collabProjects.retry(teamId, CurrentUser.id(), projectId));
    }
    public record CopyRequest(@NotBlank @Size(max = 100) String name) {}
    /**
     * 复制源项目当前协作文档为独立项目，返回 201、摘要和 ETag。
     *
     * @param teamId 团队 ID
     * @param projectId 项目 ID
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PostMapping("/{projectId}/copy")
    ResponseEntity<ApiResponse<CollabProjectResponses.Summary>> copy(@PathVariable @Min(1) long teamId,
            @PathVariable @Min(1) long projectId, @Valid @RequestBody CopyRequest request) {
        var result = collabProjects.copy(teamId, CurrentUser.id(), projectId, request.name());
        return ResponseEntity.status(201).header(HttpHeaders.ETAG, etag(result.id(), result.stateVersion())).body(ApiResponse.ok(result));
    }
    /**
     * 验证团队成员权限后分页返回可见项目，按更新时间倒序排列。
     *
     * @param teamId 团队 ID
     * @param page 从 0 开始的页码
     * @param size 每页记录数
     */
    @GetMapping
    ApiResponse<ProjectResponses.PageResult<CollabProjectResponses.Summary>> list(@PathVariable @Min(1) long teamId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        access.member(teamId, CurrentUser.id());
        var result = projects.findVisible(teamId, CurrentUser.id(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "updatedAt")));
        return ApiResponse.ok(new ProjectResponses.PageResult<>(result.map(CollabProjectResponses.Summary::from).getContent(),
                result.getNumber(), result.getSize(), result.getTotalElements(), result.getTotalPages()));
    }
    /**
     * 验证项目访问权限后返回元数据及协作指针，并附带 ETag。
     *
     * @param teamId 团队 ID
     *
     * @param projectId 项目 ID
     */
    @GetMapping("/{projectId}")
    ResponseEntity<ApiResponse<CollabProjectResponses.Details>> get(@PathVariable @Min(1) long teamId,
            @PathVariable @Min(1) long projectId) {
        var project = access.project(teamId, projectId, CurrentUser.id());
        var details = CollabProjectResponses.Details.from(project, persistence.describe(projectId));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(projectId, details.stateVersion()))
                .body(ApiResponse.ok(details));
    }
    /**
     * 验证成员权限及 If-Match，更新元数据后重新读取摘要并返回新 ETag。
     *
     * @param teamId 团队 ID
     * @param projectId 项目 ID
     * @param ifMatch 客户端提交的强 ETag
     * @param request 业务请求数据，字段约束见请求类型
     */
    @PutMapping("/{projectId}")
    ResponseEntity<ApiResponse<CollabProjectResponses.Summary>> update(@PathVariable @Min(1) long teamId,
            @PathVariable @Min(1) long projectId, @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody ProjectRequests.Update request) {
        access.project(teamId, projectId, CurrentUser.id());
        service.update(projectId, request, version(projectId, ifMatch));
        var result = CollabProjectResponses.Summary.from(access.project(teamId, projectId, CurrentUser.id()));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(projectId, result.stateVersion())).body(ApiResponse.ok(result));
    }
    /**
     * 验证项目访问权限后返回删除协调冲突；当前协作项目删除尚未开放。
     *
     * @param teamId 团队 ID
     * @param projectId 项目 ID
     * @param ifMatch 客户端提交的强 ETag
     */
    @DeleteMapping("/{projectId}")
    ResponseEntity<Void> delete(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long projectId,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
        access.project(teamId, projectId, CurrentUser.id());
        throw new CollabFailure(409, "COLLAB_DELETE_COORDINATION_REQUIRED");
    }
    /**
     * 由项目 ID 和元数据锁版本生成强 ETag。
     *
     * @param id 项目 ID
     * @param version 版本号
     */
    private static String etag(long id, long version) { return "\"project-" + id + "-" + version + "\""; }
    /**
     * 从匹配项目的 If-Match 中解析版本；缺失返回 428，格式不合法返回状态冲突。
     *
     * @param id 项目 ID
     * @param value 客户端提交的 If-Match ETag
     */
    private static long version(long id, String value) {
        if (value == null || value.isBlank()) throw new ResponseStatusException(HttpStatus.PRECONDITION_REQUIRED, "更新项目必须提供 If-Match");
        String prefix = "\"project-" + id + "-";
        if (!value.startsWith(prefix) || !value.endsWith("\"") || value.contains(","))
            throw new ProjectStateConflictException("If-Match 格式无效");
        try { return Long.parseLong(value.substring(prefix.length(), value.length() - 1)); }
        catch (NumberFormatException exception) { throw new ProjectStateConflictException("If-Match 格式无效"); }
    }
}
