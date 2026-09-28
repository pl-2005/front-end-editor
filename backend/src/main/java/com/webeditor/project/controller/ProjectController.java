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

    public ProjectController(ProjectService projectService, SnapshotService snapshotService) {
        this.projectService = projectService;
        this.snapshotService = snapshotService;
    }

    @PostMapping
    ResponseEntity<ApiResponse<ProjectResponses.Summary>> create(
            @Valid @RequestBody ProjectRequests.Create request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.created(projectService.create(request)));
    }

    @GetMapping
    ApiResponse<ProjectResponses.PageResult<ProjectResponses.Summary>> list(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ApiResponse.ok(projectService.list(page, size));
    }

    @GetMapping("/{id}")
    ResponseEntity<ApiResponse<ProjectResponses.Details>> get(@PathVariable @Min(1) long id) {
        ProjectResponses.Details details = projectService.get(id);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(id, details.stateVersion()))
                .body(ApiResponse.ok(details));
    }

    @PutMapping("/{id}")
    ResponseEntity<ApiResponse<ProjectResponses.Summary>> update(@PathVariable @Min(1) long id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody ProjectRequests.Update request) {
        ProjectResponses.Summary result = projectService.update(id, request, stateVersion(id, ifMatch));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(id, result.stateVersion()))
                .body(ApiResponse.ok(result));
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@PathVariable @Min(1) long id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
        long expected = stateVersion(id, ifMatch);
        projectService.delete(id, expected);
        return ResponseEntity.noContent().header(HttpHeaders.ETAG, etag(id, expected + 1)).build();
    }

    @PutMapping("/{id}/snapshot")
    ApiResponse<ProjectResponses.SnapshotSaved> saveSnapshot(
            @PathVariable @Min(1) long id,
            @Valid @RequestBody SaveSnapshotRequest request) {
        return ApiResponse.ok(snapshotService.save(id, request));
    }

    @GetMapping("/{id}/revisions")
    ApiResponse<List<ProjectResponses.Revision>> listRevisions(@PathVariable @Min(1) long id) {
        return ApiResponse.ok(projectService.listRevisions(id));
    }

    @PostMapping("/{id}/revisions/{version}/restore")
    ApiResponse<ProjectResponses.SnapshotSaved> restoreRevision(
            @PathVariable @Min(1) long id,
            @PathVariable @Min(1) int version,
            @Valid @RequestBody RestoreRevisionRequest request) {
        return ApiResponse.ok(snapshotService.restore(id, version, request));
    }

    private String etag(long id, long version) { return "\"project-" + id + "-" + version + "\""; }

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
