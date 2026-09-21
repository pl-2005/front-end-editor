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
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
    ApiResponse<ProjectResponses.Details> get(@PathVariable @Min(1) long id) {
        return ApiResponse.ok(projectService.get(id));
    }

    @PutMapping("/{id}")
    ApiResponse<ProjectResponses.Summary> update(@PathVariable @Min(1) long id,
                                                  @Valid @RequestBody ProjectRequests.Update request) {
        return ApiResponse.ok(projectService.update(id, request));
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@PathVariable @Min(1) long id) {
        projectService.delete(id);
        return ResponseEntity.noContent().build();
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
}
