package com.webeditor;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.mockito.AdditionalMatchers.aryEq;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.webeditor.collaboration.*;
import com.webeditor.identity.application.AuthRateLimiter;
import com.webeditor.identity.application.TokenService;
import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.project.application.*;
import com.webeditor.project.domain.Project;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.project.repository.ProjectRevisionRepository;
import com.webeditor.storage.StorageException;
import com.webeditor.team.application.TeamService;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:collaboration;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "editor.collaboration.creation-enabled=true", "editor.collaboration.storage-secret=" + CollaborationStorageTests.SECRET })
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CollaborationStorageTests {
    static final String SECRET = "test-only-collaboration-storage-secret-32";
    @Autowired CollabProjectService creation;
    @Autowired CollabPersistenceService persistence;
    @Autowired CollabBackupService backups;
    @MockitoSpyBean CollabStore store;
    @Autowired ProjectRepository projects;
    @Autowired ProjectRevisionRepository revisions;
    @Autowired AppUserRepository users;
    @Autowired TeamService teams;
    @Autowired SnapshotService snapshots;
    @Autowired TokenService tokens;
    @Autowired TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @MockitoBean CollabInitializer initializer;
    @MockitoBean CollabObjectStorage storage;
    @MockitoBean AuthRateLimiter limiter;
    final Map<String, byte[]> objects = new ConcurrentHashMap<>();
    AppUser owner;
    long teamId;

    @BeforeAll void schema() throws Exception {
        String sql = new ClassPathResource("db/migration/V10__collaboration_storage_foundation.sql").getContentAsString(StandardCharsets.UTF_8)
                .replace("DROP CHECK", "DROP CONSTRAINT")
                .replace("ALTER TABLE project ADD COLUMN initialization_source_id BIGINT NULL;", "");
        try (var connection = jdbc.getDataSource().getConnection()) {
            org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(connection,
                    new org.springframework.core.io.ByteArrayResource(sql.getBytes(StandardCharsets.UTF_8)));
        }
    }
    @BeforeEach void setup() {
        String username = "collab" + UUID.randomUUID().toString().substring(0, 10);
        owner = users.saveAndFlush(new AppUser(username, username, null, null, "{bcrypt}unused", username, "#123456"));
        teamId = teams.create(owner.getId(), "Collaboration test", null).id();
        when(initializer.initialize(anyLong(), anyString(), anyList())).thenReturn(new byte[]{1, 2, 3});
        when(initializer.copy(anyLong(), any(), any())).thenReturn(new byte[]{4, 5, 6});
        doAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            objects.put(call.getArgument(0), ((byte[]) call.getArgument(1)).clone()); return null;
        }).when(storage).put(anyString(), any());
        when(storage.get(anyString())).thenAnswer(call -> objects.get(call.getArgument(0)).clone());
    }
    long create() { return creation.create(teamId, owner.getId(), new ProjectRequests.Create("Test", null, "vanilla", "/index.html")).id(); }
    String bearer() { return "Bearer " + tokens.issue(owner); }

    @Test void createsDurableInitialDocumentWithoutRevisionAndMetadataDoesNotExposeLegacyVersion() throws Exception {
        long id = create(); CollabPointer p = persistence.describe(id);
        assertThat(p.epoch()).isEqualTo(1); assertThat(p.generation()).isEqualTo(1);
        assertThat(persistence.load(id, 1, 1)).containsExactly(1, 2, 3);
        assertThat(projects.findById(id).orElseThrow().getCurrentObjectKey()).isNull();
        assertThat(projects.findById(id).orElseThrow().getCurrentVersion()).isZero();
        assertThat(revisions.findAllByProjectIdOrderByVersionDesc(id)).isEmpty();
        mvc.perform(get("/api/teams/{team}/projects/{id}", teamId, id).header("Authorization", bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.collaboration.generation").value(1))
                .andExpect(jsonPath("$.data.version").doesNotExist()).andExpect(jsonPath("$.data.files").doesNotExist())
                .andExpect(jsonPath("$.data.collaboration.objectKey").doesNotExist());
        mvc.perform(delete("/api/teams/{team}/projects/{id}", teamId, id).header("Authorization", bearer()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("COLLAB_DELETE_COORDINATION_REQUIRED"));
    }
    @Test void failedUploadLeavesInvisibleInitializingProjectAndRetryCanActivateIt() throws Exception {
        doThrow(new StorageException("unavailable")).when(storage).put(anyString(), any());
        assertThatThrownBy(this::create).isInstanceOfSatisfying(CollabFailure.class, e -> {
            assertThat(e.code()).isEqualTo("COLLAB_INITIALIZATION_FAILED"); assertThat(e.initializingProjectId()).isNotNull();
        });
        Project p = projects.findAll().stream().filter(v -> Long.valueOf(teamId).equals(v.getTeamId())).findFirst().orElseThrow();
        assertThat(p.getStatus()).isEqualTo((byte) 2); assertThat(store.find(p.getId())).isEmpty();
        mvc.perform(get("/api/teams/{team}/projects", teamId).header("Authorization", bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(0));
        mvc.perform(get("/api/teams/{team}/projects/{id}", teamId, p.getId()).header("Authorization", bearer())).andExpect(status().isNotFound());
        doAnswer(call -> { objects.put(call.getArgument(0), call.getArgument(1)); return null; }).when(storage).put(anyString(), any());
        creation.retry(teamId, owner.getId(), p.getId());
        assertThat(persistence.load(p.getId(), 1, 1)).containsExactly(1, 2, 3);
    }
    @Test void failedPointerInsertRollsBackActivationAndLeavesUploadedObjectProtected() {
        doThrow(new IllegalStateException("database unavailable")).when(store).insert(any());
        assertThatThrownBy(this::create).isInstanceOfSatisfying(CollabFailure.class, e -> assertThat(e.code()).isEqualTo("COLLAB_INITIALIZATION_FAILED"));
        Project p = projects.findAll().stream().filter(v -> Long.valueOf(teamId).equals(v.getTeamId())).findFirst().orElseThrow();
        assertThat(p.getStatus()).isEqualTo((byte) 2); assertThat(store.find(p.getId())).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collab_object_guard WHERE lease_until > CURRENT_TIMESTAMP", Long.class)).isPositive();
    }
    @Test void concurrentPersistOnlyOneWinsAndReceiptsSurviveLaterSaves() throws Exception {
        long id = create(); CountDownLatch uploads = new CountDownLatch(2);
        doAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            objects.put(call.getArgument(0), call.getArgument(1)); uploads.countDown();
            assertThat(uploads.await(5, TimeUnit.SECONDS)).isTrue(); return null;
        }).when(storage).put(anyString(), any());
        try (var executor = Executors.newFixedThreadPool(2)) {
            var a = executor.submit(() -> saveOutcome(id, "a", new byte[]{10}));
            var b = executor.submit(() -> saveOutcome(id, "b", new byte[]{11}));
            List<Object> results = List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
            assertThat(results.stream().filter(CollabPointer.class::isInstance).count()).isEqualTo(1);
            assertThat(results.stream().filter(CollabFailure.class::isInstance).map(v -> ((CollabFailure) v).code())).containsExactly("COLLAB_GENERATION_CONFLICT");
            CollabPointer winner = persistence.describe(id);
            byte[] saved = persistence.load(id, 1, 2);
            String key = saved[0] == 10 ? "a" : "b";
            assertThat(persistence.persist(id, 1, 1, key, saved)).isEqualTo(winner);
            persistence.persist(id, 1, 2, "next", new byte[]{12});
            assertThat(persistence.persist(id, 1, 1, key, saved)).isEqualTo(winner);
            assertThatThrownBy(() -> persistence.persist(id, 1, 1, key, new byte[]{99}))
                    .isInstanceOfSatisfying(CollabFailure.class, e -> assertThat(e.code()).isEqualTo("COLLAB_IDEMPOTENCY_CONFLICT"));
            assertThat(persistence.describe(id).generation()).isEqualTo(3);
        }
    }
    Object saveOutcome(long id, String key, byte[] bytes) {
        try { return persistence.persist(id, 1, 1, key, bytes); } catch (CollabFailure e) { return e; }
    }
    @Test void rejectsOldEpochAndCorruptObjectsWithoutChangingPointer() {
        long id = create(); CollabPointer p = persistence.describe(id);
        assertThatThrownBy(() -> persistence.persist(id, 2, 1, "old", new byte[]{8}))
                .isInstanceOfSatisfying(CollabFailure.class, e -> assertThat(e.code()).isEqualTo("COLLAB_EPOCH_CONFLICT"));
        objects.put(p.objectKey(), new byte[]{3, 2, 1});
        assertThatThrownBy(() -> persistence.load(id, 1, 1)).isInstanceOfSatisfying(CollabFailure.class, e -> assertThat(e.code()).isEqualTo("COLLAB_STORAGE_CORRUPT"));
        assertThat(persistence.describe(id)).isEqualTo(p);
    }
    @Test void copyUsesCurrentPointerAndV1WritesAreRejected() {
        long id = create(); persistence.persist(id, 1, 1, "latest", new byte[]{9, 8});
        CollabPointer source = persistence.describe(id);
        long copyId = creation.copy(teamId, owner.getId(), id, "Copy").id();
        verify(initializer).copy(eq(copyId), eq(source), aryEq(new byte[]{9, 8}));
        assertThat(persistence.describe(copyId).generation()).isEqualTo(1);
        assertThatThrownBy(() -> snapshots.save(id, new SaveSnapshotRequest(0, "/index.html", Map.of("/index.html", new SnapshotFile("hello")))))
                .isInstanceOfSatisfying(CollabFailure.class, e -> assertThat(e.code()).isEqualTo("COLLAB_LEGACY_WRITE_DISABLED"));
    }
    @Test void cleanerProtectsCurrentUploadsAndBackupsAndRequiresTwoObservations() {
        long id = create(); String current = persistence.describe(id).objectKey();
        Instant now = Instant.now(); String orphan = CollabPointer.key(id, 1, 40, "a".repeat(64));
        String uploading = CollabPointer.key(id, 1, 41, "b".repeat(64));
        String backup = CollabPointer.key(id, 1, 42, "c".repeat(64));
        tx.executeWithoutResult(status -> store.lease(uploading));
        jdbc.update("INSERT INTO collab_backup_reference VALUES (?, ?, ?)", "test-backup", backup, java.sql.Timestamp.from(now.plus(Duration.ofDays(90))));
        when(storage.list()).thenReturn(List.of(new CollabObjectStorage.ObjectInfo(current, now.minus(Duration.ofDays(60))),
                new CollabObjectStorage.ObjectInfo(orphan, now.minus(Duration.ofDays(60))),
                new CollabObjectStorage.ObjectInfo(uploading, now.minus(Duration.ofDays(60))),
                new CollabObjectStorage.ObjectInfo(backup, now.minus(Duration.ofDays(60))),
                new CollabObjectStorage.ObjectInfo("projects/legacy.json.gz", now.minus(Duration.ofDays(60)))));
        CollabOrphanCleaner cleaner = new CollabOrphanCleaner(storage, store, tx, Duration.ofDays(30), Duration.ofSeconds(1));
        cleaner.cleanAt(now); verify(storage, never()).delete(anyString());
        cleaner.cleanAt(now.plusSeconds(2)); verify(storage, never()).delete(anyString());
        cleaner.cleanAt(now.plus(Duration.ofDays(31))); verify(storage).delete(orphan);
        verify(storage, never()).delete(current); verify(storage, never()).delete(uploading); verify(storage, never()).delete(backup);
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> store.lease(orphan))).isInstanceOf(CollabFailure.class);
    }
    @Test void backupPinKeepsFormerCurrentObjectAndRetiredObjectsCannotBePinned() {
        long id = create(); CollabPointer pinned = backups.pinCurrent(id, "backup", Instant.now().plus(Duration.ofDays(90)));
        persistence.persist(id, 1, 1, "move-pointer", new byte[]{7});
        assertThat(store.referenced(pinned.objectKey(), Instant.now())).isTrue();
        String retired = CollabPointer.key(id, 1, 50, "d".repeat(64));
        jdbc.update("INSERT INTO collab_object_guard VALUES (?, 'DELETING', ?, ?)", retired,
                java.sql.Timestamp.from(Instant.EPOCH), java.sql.Timestamp.from(Instant.EPOCH));
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> store.pinBackup("late-backup", retired, Instant.now().plusSeconds(100))))
                .isInstanceOfSatisfying(CollabFailure.class, e -> assertThat(e.code()).isEqualTo("COLLAB_OBJECT_RETIRED"));
    }
    @Test void internalApiRequiresHmacAndRejectsNonceReplayAndTampering() throws Exception {
        long id = create(); String path = "/internal/collaboration/projects/" + id + "/describe";
        mvc.perform(get(path).header("Authorization", bearer())).andExpect(status().isUnauthorized());
        String timestamp = Long.toString(Instant.now().getEpochSecond()), nonce = UUID.randomUUID().toString();
        String sig = InternalHmac.sign(SECRET, "GET", path, "storage", timestamp, nonce, new byte[0]);
        mvc.perform(get(path).header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce).header("X-Collab-Signature", sig)).andExpect(status().isOk());
        mvc.perform(get(path).header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce).header("X-Collab-Signature", sig)).andExpect(status().isUnauthorized());
        mvc.perform(get(path + "?generation=999").header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", UUID.randomUUID()).header("X-Collab-Signature", sig)).andExpect(status().isUnauthorized());
    }
}
