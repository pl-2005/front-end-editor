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
import java.sql.Timestamp;
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
        "editor.collaboration.creation-enabled=true", "editor.collaboration.ticket-enabled=true",
        "editor.collaboration.storage-secret=" + CollaborationStorageTests.SECRET,
        "editor.collaboration.maintenance.secret=test-only-independent-maintenance-secret-32" })
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CollaborationStorageTests {
    static final String SECRET = "test-only-collaboration-storage-secret-32";
    @Autowired CollabProjectService creation;
    @Autowired CollabPersistenceService persistence;
    @Autowired CollabTicketService tickets;
    @Autowired CollabDeleteService deletes;
    @Autowired com.webeditor.identity.application.AuthService authService;
    @MockitoBean CollabGatewayClient gateway;
    @Autowired CollabBackupService backups;
    @Autowired CollabMetrics metrics;
    @MockitoSpyBean CollabStore store;
    @MockitoSpyBean CollabControlEvents events;
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
            org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration/V11__collaboration_tickets_and_nonces.sql"));
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

    CollabRecoveryService recovery() {
        return new CollabRecoveryService(jdbc, projects, store, storage, initializer,
                new CollabMaintenanceMode(true, false, false, false), tx, metrics, Duration.ofDays(30));
    }
    @Test void recoveryRebuildsCurrentObjectAtomicallyAndRetriesReturnOriginalReceipt() {
        long id = create(); var old = persistence.describe(id); String op = UUID.randomUUID().toString();
        when(initializer.rebuild(eq(old), eq(2L), any())).thenReturn(new byte[]{7, 8, 9});
        var service = recovery(); var restored = service.recover(id, op, 1, 1);
        assertThat(restored.epoch()).isEqualTo(2); assertThat(restored.generation()).isEqualTo(1);
        assertThat(restored.objectKey()).contains("/epochs/2/1-");
        assertThat(persistence.load(id, 2, 1)).containsExactly(7, 8, 9);
        assertThat(service.status(id).state()).isEqualTo("COMMITTED");
        assertThat(service.recover(id, op, 1, 1)).isEqualTo(restored);
        assertThatThrownBy(() -> service.recover(id, op, 1, 2)).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> tickets.consume(tickets.issue(id, owner.getId()).ticket(), id, 1)).isInstanceOf(CollabFailure.class);
        assertThat(store.referenced(old.objectKey(), Instant.now())).isTrue();
        verify(initializer, times(1)).rebuild(eq(old), eq(2L), any());
        assertThat(revisions.findAllByProjectIdOrderByVersionDesc(id)).isEmpty();
    }
    @Test void corruptRecoveryStaysFencedAcrossServiceRestartAndRejectsWritesAndDelete() {
        long id = create(); var old = persistence.describe(id); String op = UUID.randomUUID().toString();
        objects.put(old.objectKey(), new byte[]{9});
        assertThatThrownBy(() -> recovery().recover(id, op, 1, 1)).isInstanceOf(CollabFailure.class);
        assertThat(recovery().status(id).state()).isEqualTo("FAILED");
        assertThat(deletes.control(id).state()).isEqualTo("FENCED");
        assertThat(persistence.describe(id)).isEqualTo(old);
        assertThatThrownBy(() -> tickets.issue(id, owner.getId())).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> persistence.persist(id, 1, 1, "blocked", new byte[]{5})).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> deletes.delete(teamId, id, owner.getId(), projects.findById(id).orElseThrow().getLockVersion())).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> recovery().recover(id, UUID.randomUUID().toString(), 1, 1)).isInstanceOf(CollabFailure.class);
        verify(initializer, never()).rebuild(any(), anyLong(), any());
        objects.put(old.objectKey(), new byte[]{1, 2, 3});
        when(initializer.rebuild(any(), eq(2L), any())).thenReturn(new byte[]{7, 8, 9});
        assertThat(recovery().recover(id, op, 1, 1).epoch()).isEqualTo(2);
    }
    @Test void failedUploadAndDatabaseCommitPreserveAuthorityAndOperationObjects() {
        long id = create(); var old = persistence.describe(id); String op = UUID.randomUUID().toString();
        when(initializer.rebuild(any(), anyLong(), any())).thenReturn(new byte[]{7, 8, 9});
        doThrow(new StorageException("sensitive-storage-response")).when(storage).put(contains("/epochs/2/"), any());
        assertThatThrownBy(() -> recovery().recover(id, op, 1, 1)).hasMessage("COLLAB_RECOVERY_FAILED");
        var failed = recovery().status(id);
        assertThat(persistence.describe(id)).isEqualTo(old);
        assertThat(store.referenced(failed.targetObjectKey(), Instant.now().plus(Duration.ofDays(90)))).isTrue();
        doAnswer(call -> { objects.put(call.getArgument(0), ((byte[]) call.getArgument(1)).clone()); return null; })
                .when(storage).put(anyString(), any());
        doThrow(new IllegalStateException("commit failed with secret")).when(store).requireLease(contains("/epochs/2/"));
        assertThatThrownBy(() -> recovery().recover(id, op, 1, 1)).hasMessage("COLLAB_RECOVERY_FAILED");
        assertThat(persistence.describe(id)).isEqualTo(old);
        doCallRealMethod().when(store).requireLease(anyString());
        assertThat(recovery().recover(id, op, 1, 1).epoch()).isEqualTo(2);
    }
    @Test void recoveryRejectsDeletedProjectsAndStalePreconditions() {
        long id = create();
        assertThatThrownBy(() -> recovery().recover(id, UUID.randomUUID().toString(), 2, 1)).isInstanceOf(CollabFailure.class);
        assertThat(recovery().status(id)).isNull();
        tx.executeWithoutResult(s -> { var p = projects.findByIdForUpdate(id).orElseThrow(); p.delete(); projects.flush(); });
        assertThatThrownBy(() -> recovery().recover(id, UUID.randomUUID().toString(), 1, 1)).isInstanceOf(CollabFailure.class);
        assertThat(recovery().status(id)).isNull();
    }
    @Test void maintenanceHmacHasIndependentAuthorityAndPersistentReplayProtection() throws Exception {
        String path = "/internal/collaboration/maintenance/projects/after/0";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(get(path).header("Authorization", bearer())).andExpect(status().isUnauthorized());
        String timestamp = Long.toString(Instant.now().getEpochSecond()), nonce = UUID.randomUUID().toString();
        String supplied = InternalHmac.sign("test-only-independent-maintenance-secret-32", "GET", path, "maintenance", timestamp, nonce, new byte[0]);
        mvc.perform(get(path).header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce).header("X-Collab-Signature", supplied))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("COLLAB_MAINTENANCE_DISABLED"));
        mvc.perform(get(path).header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce).header("X-Collab-Signature", supplied))
                .andExpect(status().isUnauthorized());
        nonce = UUID.randomUUID().toString();
        mvc.perform(get(path).header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce)
                .header("X-Collab-Signature", InternalHmac.sign(SECRET, "GET", path, "storage", timestamp, nonce, new byte[0])))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/internal/collaboration/metrics")).andExpect(status().isUnauthorized());
        assertThatThrownBy(() -> new CollabMaintenanceMode(true, false, true, false)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CollabMaintenanceMode(true, false, false, true)).isInstanceOf(IllegalArgumentException.class);
    }

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
                .andExpect(status().isPreconditionRequired());
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
    @Test void ticketRouteRequiresBearerAndLegacyRoutesRemainClosed() throws Exception {
        long id = create();
        mvc.perform(post("/api/projects/{id}/collab-ticket", id)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/projects/{id}/collab-ticket", id).header("Authorization", bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.ticket").isString())
                .andExpect(jsonPath("$.data.epoch").value(1));
        mvc.perform(get("/api/projects/{id}", id).header("Authorization", bearer())).andExpect(status().isForbidden());
    }
    @Test void concurrentHandshakeConsumesOpaqueTicketExactlyOnce() throws Exception {
        long id = create(); var ticket = tickets.issue(id, owner.getId());
        assertThat(ticket.ticket()).hasSize(43);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collab_ticket WHERE token_hash=?", Long.class, ticket.ticket())).isZero();
        try (var executor = Executors.newFixedThreadPool(2)) {
            Callable<Object> consume = () -> { try { return tickets.consume(ticket.ticket(), id, 1); } catch (CollabFailure e) { return e; } };
            var a = executor.submit(consume); var b = executor.submit(consume);
            var results = List.of(a.get(5, TimeUnit.SECONDS), b.get(5, TimeUnit.SECONDS));
            assertThat(results.stream().filter(CollabTicketService.Identity.class::isInstance).count()).isEqualTo(1);
            assertThat(results.stream().filter(CollabFailure.class::isInstance).count()).isEqualTo(1);
        }
    }
    @Test void ticketsCannotCrossProjectsOrEpochsAndExpire() {
        long id = create(), other = create(); var ticket = tickets.issue(id, owner.getId());
        assertThatThrownBy(() -> tickets.consume(ticket.ticket(), other, 1)).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> tickets.consume(ticket.ticket(), id, 2)).isInstanceOf(CollabFailure.class);
        assertThat(tickets.consume(ticket.ticket(), id, 1).projectId()).isEqualTo(id);
        var expired = tickets.issue(id, owner.getId());
        jdbc.update("UPDATE collab_ticket SET expires_at=? WHERE token_hash=?", java.sql.Timestamp.from(Instant.now().minusSeconds(1)),
                CollabPersistenceService.hash(expired.ticket().getBytes(StandardCharsets.US_ASCII)));
        assertThatThrownBy(() -> tickets.consume(expired.ticket(), id, 1)).isInstanceOf(CollabFailure.class);
    }
    @Test void currentMemberAndWaterlineAreRecheckedAtHandshakeAndLeaseRenewal() {
        long id = create();
        var live = tickets.consume(tickets.issue(id, owner.getId()).ticket(), id, 1);
        var lease = tickets.authorization(live);
        var old = tickets.issue(id, owner.getId());
        tx.executeWithoutResult(status -> users.incrementAuthzVersion(owner.getId()));
        assertThatThrownBy(() -> tickets.consume(old.ticket(), id, 1)).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> tickets.revalidate(lease)).isInstanceOf(CollabFailure.class);
        var current = tickets.issue(id, owner.getId());
        jdbc.update("UPDATE team_member SET status='REMOVED', removed_at=CURRENT_TIMESTAMP WHERE team_id=? AND user_id=?", teamId, owner.getId());
        assertThatThrownBy(() -> tickets.consume(current.ticket(), id, 1)).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> tickets.issue(id, owner.getId())).isInstanceOf(CollabFailure.class);
    }
    @Test void crossTeamAndDeletedProjectsCannotObtainTickets() {
        long id = create(); String name = "outsider" + UUID.randomUUID().toString().substring(0, 8);
        var outsider = users.saveAndFlush(new AppUser(name, name, null, null, "{bcrypt}unused", name, "#123456"));
        assertThatThrownBy(() -> tickets.issue(id, outsider.getId())).isInstanceOf(CollabFailure.class);
        var ticket = tickets.issue(id, owner.getId());
        jdbc.update("UPDATE project SET status=0 WHERE id=?", id);
        assertThatThrownBy(() -> tickets.consume(ticket.ticket(), id, 1)).isInstanceOf(CollabFailure.class);
    }
    @Test void copyFlushesBeforeReservationAndFailureLeavesNoNewProject() {
        long id = create(); long before = projects.count();
        when(gateway.flush(id)).thenThrow(new CollabFailure(503, "COLLAB_FLUSH_FAILED"));
        assertThatThrownBy(() -> creation.copy(teamId, owner.getId(), id, "Unavailable copy")).isInstanceOf(CollabFailure.class);
        assertThat(projects.count()).isEqualTo(before);
        doAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            var saved = persistence.persist(id, 1, 1, "flush-copy", new byte[]{91});
            return new CollabGatewayClient.Durable(id, 1, saved.generation(), saved.contentHash(), 1);
        }).when(gateway).flush(id);
        long copied = creation.copy(teamId, owner.getId(), id, "Latest copy").id();
        var expected = persistence.describe(id);
        verify(initializer).copy(eq(copied), eq(expected), aryEq(new byte[]{91}));
    }
    private void acknowledgeDelete(long id) {
        when(gateway.fence(eq(id), anyString())).thenAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            var pointer = persistence.describe(id);
            return new CollabGatewayClient.Fence(id, call.getArgument(1), pointer.epoch(), pointer.generation(),
                    pointer.contentHash(), 0, "a".repeat(64));
        });
    }
    @Test void deleteFlushesLatestStateRetainsOriginalObjectAndIsIdempotent() throws Exception {
        long id = create(); var before = persistence.describe(id);
        long version = projects.findById(id).orElseThrow().getLockVersion();
        var oldTicket = tickets.issue(id, owner.getId());
        when(gateway.fence(eq(id), anyString())).thenAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            var pointer = persistence.persist(id, 1, 1, "delete-flush", new byte[]{42});
            return new CollabGatewayClient.Fence(id, call.getArgument(1), 1, pointer.generation(), pointer.contentHash(), 1, "b".repeat(64));
        });
        String path = "/api/teams/" + teamId + "/projects/" + id;
        mvc.perform(delete(path).header("Authorization", bearer()).header("If-Match", "\"project-" + id + "-" + version + "\""))
                .andExpect(status().isNoContent());
        var retained = store.find(id).orElseThrow();
        assertThat(retained.epoch()).isEqualTo(2); assertThat(retained.generation()).isEqualTo(2);
        assertThat(retained.objectKey()).contains("/epochs/1/"); assertThat(objects.get(retained.objectKey())).containsExactly((byte) 42);
        assertThat(store.referenced(retained.objectKey(), Instant.now())).isTrue();
        assertThat(projects.findById(id).orElseThrow().getStatus()).isZero();
        assertThatThrownBy(() -> persistence.describe(id)).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> persistence.load(id, before.epoch(), before.generation())).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> persistence.persist(id, 1, 2, "late", new byte[]{43})).isInstanceOf(CollabFailure.class);
        assertThatThrownBy(() -> tickets.consume(oldTicket.ticket(), id, 1)).isInstanceOf(CollabFailure.class);
        mvc.perform(delete(path).header("Authorization", bearer()).header("If-Match", "\"project-" + id + "-" + version + "\""))
                .andExpect(status().isNoContent());
        verify(gateway, times(1)).fence(eq(id), anyString());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collab_control_event WHERE project_id=? AND event_type='PROJECT_DELETED'", Long.class, id)).isEqualTo(1);
        assertThat(revisions.findAllByProjectIdOrderByVersionDesc(id)).isEmpty();
    }
    @Test void missingFenceAckLeavesPreparedAndReconciliationCanAbortThenRetry() {
        long id = create(); var pointer = persistence.describe(id);
        long version = projects.findById(id).orElseThrow().getLockVersion();
        when(gateway.fence(eq(id), anyString())).thenThrow(new CollabFailure(503, "COLLAB_FENCE_FAILED"));
        assertThatThrownBy(() -> deletes.delete(teamId, id, owner.getId(), version)).isInstanceOf(CollabFailure.class);
        assertThat(projects.findById(id).orElseThrow().getStatus()).isEqualTo((byte) 1);
        assertThat(persistence.describe(id)).isEqualTo(pointer);
        assertThatThrownBy(() -> tickets.issue(id, owner.getId())).isInstanceOfSatisfying(CollabFailure.class, e -> assertThat(e.status()).isEqualTo(503));
        String operation = deletes.control(id).operationId();
        acknowledgeDelete(id);
        jdbc.update("UPDATE collab_operation SET lease_until=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), operation);
        new CollabControlDispatcher(jdbc, gateway, deletes, true).reconcile();
        assertThat(deletes.operation(operation).state()).isEqualTo("ABORTED");
        assertThat(deletes.control(id).state()).isEqualTo("ACTIVE");
        deletes.delete(teamId, id, owner.getId(), version);
        assertThat(deletes.control(id).state()).isEqualTo("DELETED");
    }
    @Test void databaseFailureRollsBackDeleteAndWritesAbortEvent() {
        long id = create(); var pointer = persistence.describe(id); acknowledgeDelete(id);
        long version = projects.findById(id).orElseThrow().getLockVersion();
        CollabControlEvents target = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(events);
        doThrow(new IllegalStateException("simulated commit failure")).when(target).operation(eq(id), anyLong(), anyLong(), anyString(), eq(true));
        assertThatThrownBy(() -> deletes.delete(teamId, id, owner.getId(), version)).isInstanceOf(IllegalStateException.class);
        assertThat(projects.findById(id).orElseThrow().getStatus()).isEqualTo((byte) 1);
        assertThat(persistence.describe(id)).isEqualTo(pointer);
        assertThat(jdbc.queryForObject("SELECT state FROM collab_operation WHERE project_id=?", String.class, id)).isEqualTo("ABORTED");
        assertThat(jdbc.queryForObject("SELECT event_type FROM collab_control_event WHERE project_id=?", String.class, id)).isEqualTo("OPERATION_ABORTED");
    }
    @Test void concurrentDeleteRetriesCommitOneOperationAndOneOutboxEvent() throws Exception {
        long id = create(); var pointer = persistence.describe(id);
        long version = projects.findById(id).orElseThrow().getLockVersion();
        var barrier = new CyclicBarrier(2);
        when(gateway.fence(eq(id), anyString())).thenAnswer(call -> {
            barrier.await(5, TimeUnit.SECONDS);
            return new CollabGatewayClient.Fence(id, call.getArgument(1), pointer.epoch(), pointer.generation(), pointer.contentHash(), 0, "d".repeat(64));
        });
        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> a = pool.submit(() -> deletes.delete(teamId, id, owner.getId(), version));
            Future<?> b = pool.submit(() -> deletes.delete(teamId, id, owner.getId(), version));
            a.get(10, TimeUnit.SECONDS); b.get(10, TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collab_operation WHERE project_id=?", Long.class, id)).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collab_control_event WHERE project_id=?", Long.class, id)).isEqualTo(1);
            assertThat(projects.findById(id).orElseThrow().getStatus()).isZero();
        } finally { pool.shutdownNow(); }
    }
    @Test void metadataRaceAfterFenceAbortsInsteadOfDeletingChangedProject() {
        long id = create();
        long version = projects.findById(id).orElseThrow().getLockVersion();
        when(gateway.fence(eq(id), anyString())).thenAnswer(call -> {
            jdbc.update("UPDATE project SET lock_version=lock_version+1 WHERE id=?", id);
            var p = persistence.describe(id);
            return new CollabGatewayClient.Fence(id, call.getArgument(1), p.epoch(), p.generation(), p.contentHash(), 0, "c".repeat(64));
        });
        assertThatThrownBy(() -> deletes.delete(teamId, id, owner.getId(), version)).isInstanceOf(com.webeditor.common.exception.ProjectStateConflictException.class);
        assertThat(projects.findById(id).orElseThrow().getStatus()).isEqualTo((byte) 1);
        assertThat(deletes.control(id).state()).isEqualTo("ACTIVE");
    }
    @Test void revocationOutboxSharesAuthorizationTransactionAndDeliveryRetries() {
        long before = users.findById(owner.getId()).orElseThrow().getAuthzVersion();
        CollabControlEvents target = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(events);
        doThrow(new IllegalStateException("outbox failure")).when(target).revoked(eq(owner.getId()), isNull(), anyLong());
        assertThatThrownBy(() -> authService.logout(owner.getId())).isInstanceOf(IllegalStateException.class);
        assertThat(users.findById(owner.getId()).orElseThrow().getAuthzVersion()).isEqualTo(before);
        reset(target); authService.logout(owner.getId());
        String eventId = jdbc.queryForObject("SELECT id FROM collab_control_event WHERE user_id=?", String.class, owner.getId());
        doThrow(new CollabFailure(503, "unavailable")).when(gateway).control(any());
        var dispatcher = new CollabControlDispatcher(jdbc, gateway, deletes, true); dispatcher.deliver();
        assertThat(jdbc.queryForObject("SELECT attempts FROM collab_control_event WHERE id=?", Integer.class, eventId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT acknowledged_at FROM collab_control_event WHERE id=?", Timestamp.class, eventId)).isNull();
        jdbc.update("UPDATE collab_control_event SET next_attempt_at=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), eventId);
        doNothing().when(gateway).control(any()); dispatcher.deliver();
        assertThat(jdbc.queryForObject("SELECT acknowledged_at FROM collab_control_event WHERE id=?", Timestamp.class, eventId)).isNotNull();
    }
    @Test void operationQueriesRequireInternalHmacAndAreReachableWithoutBearer() throws Exception {
        long id = create(); long version = projects.findById(id).orElseThrow().getLockVersion();
        when(gateway.fence(eq(id), anyString())).thenThrow(new CollabFailure(503, "COLLAB_FENCE_FAILED"));
        assertThatThrownBy(() -> deletes.delete(teamId, id, owner.getId(), version)).isInstanceOf(CollabFailure.class);
        String path = "/internal/collaboration/operations/" + deletes.control(id).operationId();
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        String timestamp = Long.toString(Instant.now().getEpochSecond()), nonce = UUID.randomUUID().toString();
        mvc.perform(get(path).header("X-Collab-Timestamp", timestamp).header("X-Collab-Nonce", nonce)
                .header("X-Collab-Signature", InternalHmac.sign(SECRET, "GET", path, "storage", timestamp, nonce, new byte[0])))
                .andExpect(status().isOk()).andExpect(jsonPath("$.state").value("PREPARED"));
    }
    @Test void internalTicketAndLeaseEndpointsRequireHmacAndNonceSurvivesNewAuthenticator() throws Exception {
        long id = create(); var ticket = tickets.issue(id, owner.getId());
        String path = "/internal/collaboration/tickets/consume";
        byte[] body = ("{\"ticket\":\"" + ticket.ticket() + "\",\"projectId\":" + id + ",\"epoch\":1}").getBytes(StandardCharsets.UTF_8);
        mvc.perform(post(path).contentType("application/json").content(body)).andExpect(status().isUnauthorized());
        String timestamp = Long.toString(Instant.now().getEpochSecond()), nonce = UUID.randomUUID().toString();
        String sig = InternalHmac.sign(SECRET, "POST", path, "storage", timestamp, nonce, body);
        mvc.perform(post(path).contentType("application/json").content(body).header("X-Collab-Timestamp", timestamp)
                .header("X-Collab-Nonce", nonce).header("X-Collab-Signature", sig))
                .andExpect(status().isOk()).andExpect(jsonPath("$.identity.userId").value(owner.getId()))
                .andExpect(jsonPath("$.authorization.authzVersion").value(users.findById(owner.getId()).orElseThrow().getAuthzVersion()));
        var request = new org.springframework.mock.web.MockHttpServletRequest("POST", path);
        request.setContent(body); request.addHeader("X-Collab-Timestamp", timestamp); request.addHeader("X-Collab-Nonce", nonce); request.addHeader("X-Collab-Signature", sig);
        assertThatThrownBy(() -> new CollabInternalAuth(jdbc, SECRET).authenticate(request)).isInstanceOf(CollabFailure.class);
        mvc.perform(post("/internal/collaboration/connections/revalidate").contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
    }
}
