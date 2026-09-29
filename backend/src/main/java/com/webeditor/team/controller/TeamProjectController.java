package com.webeditor.team.controller;

import com.webeditor.common.response.ApiResponse;
import com.webeditor.common.exception.ProjectStateConflictException;
import com.webeditor.common.security.CurrentUser;
import com.webeditor.project.application.ProjectRequests;
import com.webeditor.project.application.ProjectResponses;
import com.webeditor.project.application.ProjectService;
import com.webeditor.project.repository.ProjectRepository;
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
    public TeamProjectController(TeamAccessService access, ProjectRepository projects, ProjectService service) {
        this.access = access; this.projects = projects; this.service = service;
    }
    @GetMapping
    ApiResponse<ProjectResponses.PageResult<ProjectResponses.Summary>> list(@PathVariable @Min(1) long teamId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        access.member(teamId, CurrentUser.id());
        var result = projects.findVisible(teamId, CurrentUser.id(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "updatedAt")));
        return ApiResponse.ok(new ProjectResponses.PageResult<>(result.map(ProjectResponses.Summary::from).getContent(),
                result.getNumber(), result.getSize(), result.getTotalElements(), result.getTotalPages()));
    }
    @GetMapping("/{projectId}")
    ResponseEntity<ApiResponse<ProjectResponses.Details>> get(@PathVariable @Min(1) long teamId,
            @PathVariable @Min(1) long projectId) {
        access.project(teamId, projectId, CurrentUser.id());
        var details = service.get(projectId);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(projectId, details.stateVersion()))
                .body(ApiResponse.ok(details));
    }
    @PutMapping("/{projectId}")
    ResponseEntity<ApiResponse<ProjectResponses.Summary>> update(@PathVariable @Min(1) long teamId,
            @PathVariable @Min(1) long projectId, @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody ProjectRequests.Update request) {
        access.project(teamId, projectId, CurrentUser.id());
        var result = service.update(projectId, request, version(projectId, ifMatch));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag(projectId, result.stateVersion())).body(ApiResponse.ok(result));
    }
    @DeleteMapping("/{projectId}")
    ResponseEntity<Void> delete(@PathVariable @Min(1) long teamId, @PathVariable @Min(1) long projectId,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
        access.project(teamId, projectId, CurrentUser.id());
        long expected = version(projectId, ifMatch);
        service.delete(projectId, expected);
        return ResponseEntity.noContent().header(HttpHeaders.ETAG, etag(projectId, expected + 1)).build();
    }
    private static String etag(long id, long version) { return "\"project-" + id + "-" + version + "\""; }
    private static long version(long id, String value) {
        if (value == null || value.isBlank()) throw new ResponseStatusException(HttpStatus.PRECONDITION_REQUIRED, "更新项目必须提供 If-Match");
        String prefix = "\"project-" + id + "-";
        if (!value.startsWith(prefix) || !value.endsWith("\"") || value.contains(","))
            throw new ProjectStateConflictException("If-Match 格式无效");
        try { return Long.parseLong(value.substring(prefix.length(), value.length() - 1)); }
        catch (NumberFormatException exception) { throw new ProjectStateConflictException("If-Match 格式无效"); }
    }
}
