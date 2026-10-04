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

    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param projects 项目仓储
     * @param revisions 快照修订仓储
     * @param storage 对象存储接口
     * @param codec 快照编解码器
     * @param validator 快照校验器
     */
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

    /**
     * 为旧快照流程创建项目，校验入口路径并规范化元数据后返回摘要。
     *
     * @param request 业务请求数据，字段约束见请求类型
     */
    @Transactional
    public ProjectResponses.Summary create(ProjectRequests.Create request) {
        String template = defaultIfBlank(request.template(), "vanilla");
        String entry = defaultIfBlank(request.entry(), "/index.html");
        validator.validatePath(entry);
        Project project = new Project(request.name().trim(), normalizeDescription(request.description()),
                template.trim(), entry);
        return ProjectResponses.Summary.from(projects.saveAndFlush(project));
    }

    /**
     * 按更新时间倒序分页读取有效项目并转换为摘要。
     *
     * @param page 从 0 开始的页码
     * @param size 每页记录数
     */
    @Transactional(readOnly = true)
    public ProjectResponses.PageResult<ProjectResponses.Summary> list(int page, int size) {
        var result = projects.findAllByStatus(ACTIVE,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "updatedAt")));
        return new ProjectResponses.PageResult<>(result.getContent().stream()
                .map(ProjectResponses.Summary::from).toList(), result.getNumber(), result.getSize(),
                result.getTotalElements(), result.getTotalPages());
    }

    /**
     * 读取有效项目及其当前快照文件；尚无快照时文件集合为空。
     *
     * @param id 项目 ID
     */
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

    /**
     * 校验元数据预期版本后更新名称、描述和模板，刷新持久化状态并返回摘要。
     *
     * @param id 项目 ID
     * @param request 业务请求数据，字段约束见请求类型
     * @param expectedStateVersion 预期元数据锁版本
     */
    @Transactional
    public ProjectResponses.Summary update(long id, ProjectRequests.Update request, long expectedStateVersion) {
        Project project = requireActive(id);
        requireStateVersion(project, expectedStateVersion);
        String template = defaultIfBlank(request.template(), project.getTemplate());
        project.updateMetadata(request.name().trim(), normalizeDescription(request.description()), template.trim());
        return ProjectResponses.Summary.from(projects.saveAndFlush(project));
    }

    /**
     * 校验预期状态版本后软删除旧项目；协作项目必须走专门的删除协调流程。
     *
     * @param id 项目 ID
     * @param expectedStateVersion 预期元数据锁版本
     */
    @Transactional
    public void delete(long id, long expectedStateVersion) {
        Project project = requireActive(id);
        if (project.getTeamId() != null && !project.isLegacyUnowned())
            throw new com.webeditor.collaboration.CollabFailure(409, "COLLAB_DELETE_COORDINATION_REQUIRED");
        requireStateVersion(project, expectedStateVersion);
        project.delete();
        projects.saveAndFlush(project);
    }

    /**
     * 比较实体锁版本和客户端预期值，失配时抛出元数据并发冲突。
     *
     * @param project 项目实体或摘要
     * @param expected 客户端预期的元数据锁版本
     */
    private void requireStateVersion(Project project, long expected) {
        if (project.getLockVersion() != expected) {
            throw new ProjectStateConflictException("项目元数据已被修改，请刷新后重试");
        }
    }

    /**
     * 按版本倒序返回旧项目的快照历史，禁止协作项目使用旧版本接口。
     *
     * @param id 项目 ID
     */
    @Transactional(readOnly = true)
    public List<ProjectResponses.Revision> listRevisions(long id) {
        Project project = requireActive(id);
        if (project.getTeamId() != null && !project.isLegacyUnowned())
            throw new com.webeditor.collaboration.CollabFailure(403, "COLLAB_LEGACY_WRITE_DISABLED");
        return revisions.findAllByProjectIdOrderByVersionDesc(id).stream()
                .map(revision -> ProjectResponses.Revision.from(revision, project.getCurrentVersion()))
                .toList();
    }

    /**
     * 读取有效项目，不存在或已删除时抛出资源不存在异常。
     *
     * @param id 项目 ID
     */
    private Project requireActive(long id) {
        return projects.findByIdAndStatus(id, ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("项目不存在"));
    }

    /**
     * 输入为空时返回默认值，否则保留原输入。
     *
     * @param value 待规范化或处理的文本
     * @param fallback 输入为空时使用的默认值
     */
    private String defaultIfBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    /**
     * 去除描述首尾空白，空描述规范化为 null。
     *
     * @param value 待规范化或处理的文本
     */
    private String normalizeDescription(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
