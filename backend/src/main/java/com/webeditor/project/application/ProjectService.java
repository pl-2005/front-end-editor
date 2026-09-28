package com.webeditor.project.application;

import com.webeditor.common.exception.ResourceNotFoundException;
import com.webeditor.common.exception.ProjectStateConflictException;
import com.webeditor.project.domain.Project;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.storage.SnapshotStorage;
import java.util.Map;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectService {
    private static final byte ACTIVE = 1;
    private final ProjectRepository projects;
    private final com.webeditor.project.repository.ProjectRevisionRepository revisions;
    private final SnapshotStorage storage;
    private final SnapshotCodec codec;
    private final SnapshotValidator validator;

    public ProjectService(ProjectRepository projects,
                          com.webeditor.project.repository.ProjectRevisionRepository revisions,
                          SnapshotStorage storage, SnapshotCodec codec,
                          SnapshotValidator validator) {
        this.projects = projects;
        this.revisions = revisions;
        this.storage = storage;
        this.codec = codec;
        this.validator = validator;
    }

    @Transactional
    public ProjectResponses.Summary create(ProjectRequests.Create request) {
        String template = defaultIfBlank(request.template(), "vanilla");
        String entry = defaultIfBlank(request.entry(), "/index.html");
        validator.validatePath(entry);
        Project project = new Project(request.name().trim(), normalizeDescription(request.description()),
                template.trim(), entry);
        return ProjectResponses.Summary.from(projects.saveAndFlush(project));
    }

    @Transactional(readOnly = true)
    public ProjectResponses.PageResult<ProjectResponses.Summary> list(int page, int size) {
        var result = projects.findAllByStatus(ACTIVE,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "updatedAt")));
        return new ProjectResponses.PageResult<>(result.getContent().stream()
                .map(ProjectResponses.Summary::from).toList(), result.getNumber(), result.getSize(),
                result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public ProjectResponses.Details get(long id) {
        Project project = requireActive(id);
        Map<String, SnapshotFile> files = Map.of();
        if (project.getCurrentObjectKey() != null) {
            SnapshotDocument document = codec.decode(storage.get(project.getCurrentObjectKey()));
            files = document.files();
        }
        return ProjectResponses.Details.from(project, files);
    }

    @Transactional
    public ProjectResponses.Summary update(long id, ProjectRequests.Update request, long expectedStateVersion) {
        Project project = requireActive(id);
        requireStateVersion(project, expectedStateVersion);
        String template = defaultIfBlank(request.template(), project.getTemplate());
        project.updateMetadata(request.name().trim(), normalizeDescription(request.description()), template.trim());
        return ProjectResponses.Summary.from(projects.saveAndFlush(project));
    }

    @Transactional
    public void delete(long id, long expectedStateVersion) {
        Project project = requireActive(id);
        requireStateVersion(project, expectedStateVersion);
        project.delete();
        projects.saveAndFlush(project);
    }

    private void requireStateVersion(Project project, long expected) {
        if (project.getLockVersion() != expected) {
            throw new ProjectStateConflictException("项目元数据已被修改，请刷新后重试");
        }
    }

    @Transactional(readOnly = true)
    public List<ProjectResponses.Revision> listRevisions(long id) {
        Project project = requireActive(id);
        return revisions.findAllByProjectIdOrderByVersionDesc(id).stream()
                .map(revision -> ProjectResponses.Revision.from(revision, project.getCurrentVersion()))
                .toList();
    }

    private Project requireActive(long id) {
        return projects.findByIdAndStatus(id, ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("项目不存在"));
    }

    private String defaultIfBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private String normalizeDescription(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
