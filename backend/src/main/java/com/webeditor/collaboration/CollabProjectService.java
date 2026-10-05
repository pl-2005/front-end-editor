package com.webeditor.collaboration;

import com.webeditor.project.application.ProjectRequests;
import com.webeditor.project.domain.Project;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.team.application.TeamAccessService;
import com.webeditor.team.repository.TeamRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class CollabProjectService {
    private final ProjectRepository projects;
    private final TeamRepository teams;
    private final TeamAccessService access;
    private final CollabStore store;
    private final CollabObjectStorage storage;
    private final CollabInitializer initializer;
    private final ProjectTemplateService templates;
    private final CollabPersistenceService persistence;
    private final CollabGatewayClient gateway;
    private final TransactionTemplate tx;
    private final boolean creationEnabled;
    /**
     * 初始化组件依赖及配置，供后续业务方法使用。
     *
     * @param projects 项目仓储
     * @param teams 团队仓储或服务
     * @param access 团队及项目权限校验服务
     * @param store 协作指针及对象保护记录仓储
     * @param storage 对象存储接口
     * @param initializer Yjs 文档初始化服务
     * @param templates 初始文件模板服务
     * @param persistence 协作文档持久化服务
     * @param tx 事务执行模板
     * @param creationEnabled 协作项目创建开关
     */
    public CollabProjectService(ProjectRepository projects, TeamRepository teams, TeamAccessService access,
            CollabStore store, CollabObjectStorage storage, CollabInitializer initializer, ProjectTemplateService templates,
            CollabPersistenceService persistence, CollabGatewayClient gateway, TransactionTemplate tx,
            @Value("${editor.collaboration.creation-enabled:false}") boolean creationEnabled) {
        this.projects = projects; this.teams = teams; this.access = access; this.store = store; this.storage = storage;
        this.initializer = initializer; this.templates = templates; this.persistence = persistence; this.gateway = gateway; this.tx = tx; this.creationEnabled = creationEnabled;
    }
    /**
     * 校验创建开关、成员权限和模板，先预留项目 ID，再初始化二进制文档并激活项目。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param request 业务请求数据，字段约束见请求类型
     * @return 已激活协作项目的摘要
     */
    public CollabProjectResponses.Summary create(long teamId, long userId, ProjectRequests.Create request) {
        enabled(); access.member(teamId, userId);
        String template = blank(request.template(), "vanilla"), entry = blank(request.entry(), "/index.html");
        var files = templates.files(template, entry); // Validate before reserving an ID.
        Project p = reserve(teamId, userId, request.name().trim(), request.description(), template, entry);
        return attempt(p.getId(), () -> activate(teamId, userId, p.getId(), initializer.initialize(p.getId(), entry, files)));
    }
    /**
     * 重试尚在初始化中的项目；复制项目时重新读取源文档，已激活项目直接返回摘要。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param projectId 项目 ID
     * @return 初始化成功或此前已激活项目的摘要
     */
    public CollabProjectResponses.Summary retry(long teamId, long userId, long projectId) {
        enabled(); access.member(teamId, userId);
        Project p = projects.findById(projectId).filter(v -> Long.valueOf(teamId).equals(v.getTeamId()) && !v.isLegacyUnowned())
                .orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
        if (p.getStatus() == 1) return CollabProjectResponses.Summary.from(p);
        if (p.getStatus() != 2) throw new CollabFailure(409, "COLLAB_INITIALIZATION_CONFLICT");
        if (p.getInitializationSourceId() != null) {
            access.project(teamId, p.getInitializationSourceId(), userId);
            return attempt(projectId, () -> {
                CurrentDocument source = currentForCopy(p.getInitializationSourceId());
                return activate(teamId, userId, projectId, initializer.copy(projectId, source.pointer(), source.bytes()));
            });
        }
        return attempt(projectId, () -> activate(teamId, userId, projectId, initializer.initialize(projectId, p.getEntryFile(), templates.files(p.getTemplate(), p.getEntryFile()))));
    }
    /**
     * 读取可访问的源项目当前文档，预留目标项目并记录源 ID，然后生成独立文档并激活副本。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param sourceId 源项目 ID
     * @param name 名称
     * @return 新建独立副本的项目摘要
     */
    public CollabProjectResponses.Summary copy(long teamId, long userId, long sourceId, String name) {
        enabled(); Project source = access.project(teamId, sourceId, userId);
        CurrentDocument document = currentForCopy(sourceId);
        Project target = tx.execute(status -> {
            Project p = reserveWithinTransaction(teamId, userId, name.trim(), source.getDescription(), source.getTemplate(), source.getEntryFile());
            p.setInitializationSourceId(sourceId); return projects.saveAndFlush(p);
        });
        return attempt(target.getId(), () -> activate(teamId, userId, target.getId(), initializer.copy(target.getId(), document.pointer(), document.bytes())));
    }
    private record CurrentDocument(CollabPointer pointer, byte[] bytes) {}
    /** A successful flush covers its captured sequence; later saves may advance the current pointer. */
    private CurrentDocument currentForCopy(long sourceId) {
        var durable = gateway.flush(sourceId);
        for (int count = 0; count < 3; count++) {
            CollabPointer pointer = persistence.describe(sourceId);
            if (durable != null && (pointer.epoch() != durable.epoch() || pointer.generation() < durable.generation()))
                throw new CollabFailure(409, "COLLAB_EPOCH_CONFLICT");
            try { return new CurrentDocument(pointer, persistence.load(sourceId, pointer.epoch(), pointer.generation())); }
            catch (CollabFailure e) { if (!"COLLAB_GENERATION_CONFLICT".equals(e.code())) throw e; }
        }
        throw new CollabFailure(503, "COLLAB_COPY_BUSY");
    }
    /**
     * 执行初始化操作，将存储、数据库及 503 协作故障转换为携带项目 ID 的可重试错误。
     *
     * @param id 项目 ID
     * @param action 待执行的初始化操作
     */
    private CollabProjectResponses.Summary attempt(long id, java.util.function.Supplier<CollabProjectResponses.Summary> action) {
        try { return action.get(); }
        catch (com.webeditor.storage.StorageException | org.springframework.dao.DataAccessException e) {
            throw CollabFailure.initialization(id, e);
        } catch (CollabFailure e) {
            if (e.status() == 503) throw CollabFailure.initialization(id, e);
            throw e;
        }
    }
    /**
     * 在独立事务中预留初始化状态的项目记录。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param name 名称
     * @param description 描述，允许为空
     * @param template 项目模板标识
     * @param entry 入口文件绝对路径
     */
    private Project reserve(long teamId, long userId, String name, String description, String template, String entry) {
        return tx.execute(status -> reserveWithinTransaction(teamId, userId, name, description, template, entry));
    }
    /**
     * 在调用方事务内锁定团队并复查成员权限，保存初始化状态项目以取得 ID。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param name 名称
     * @param description 描述，允许为空
     * @param template 项目模板标识
     * @param entry 入口文件绝对路径
     */
    private Project reserveWithinTransaction(long teamId, long userId, String name, String description, String template, String entry) {
        teams.lockActive(teamId).orElseThrow(() -> new CollabFailure(404, "TEAM_NOT_FOUND"));
        access.member(teamId, userId);
        return projects.saveAndFlush(Project.initializing(teamId, userId, name, description, template, entry));
    }
    /**
     * 取得对象租约并上传初始文档，事务内复查权限和状态后登记初始指针并激活项目。
     *
     * @param teamId 团队 ID
     * @param userId 用户 ID
     * @param id 项目 ID
     * @param bytes 文档二进制内容
     * @return 已激活项目的摘要
     */
    private CollabProjectResponses.Summary activate(long teamId, long userId, long id, byte[] bytes) {
        CollabPersistenceService.validateBytes(bytes);
        String hash = CollabPersistenceService.hash(bytes), key = CollabPointer.key(id, 1, 1, hash);
        tx.executeWithoutResult(status -> store.lease(key));
        storage.put(key, bytes);
        return tx.execute(status -> {
            teams.lockActive(teamId).orElseThrow(() -> new CollabFailure(404, "TEAM_NOT_FOUND"));
            access.member(teamId, userId);
            Project p = projects.findByIdForUpdate(id).filter(v -> Long.valueOf(teamId).equals(v.getTeamId()) && !v.isLegacyUnowned())
                    .orElseThrow(() -> new CollabFailure(404, "PROJECT_NOT_FOUND"));
            if (p.getStatus() == 1) return CollabProjectResponses.Summary.from(p);
            if (p.getStatus() != 2) throw new CollabFailure(409, "COLLAB_INITIALIZATION_CONFLICT");
            store.requireLease(key);
            store.insert(new CollabPointer(id, 1, 1, key, hash, bytes.length, CollabPointer.CONTENT_TYPE));
            p.activate(); return CollabProjectResponses.Summary.from(projects.saveAndFlush(p));
        });
    }
    /**
     * 创建开关关闭时抛出 503，阻止新建、复制及初始化重试。
     */
    private void enabled() { if (!creationEnabled) throw new CollabFailure(503, "COLLAB_CREATION_DISABLED"); }
    /**
     * 去除输入首尾空白；输入为空时使用默认值。
     *
     * @param input 请求输入
     * @param fallback 输入为空时使用的默认值
     */
    private static String blank(String input, String fallback) { return input == null || input.isBlank() ? fallback : input.trim(); }
}
