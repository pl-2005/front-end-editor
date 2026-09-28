package com.webeditor.storage;

import com.webeditor.project.repository.ProjectRevisionRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OrphanSnapshotCleaner {
    private static final String LEGACY_SNAPSHOT_PREFIX = "projects/";
    private static final Logger log = LoggerFactory.getLogger(OrphanSnapshotCleaner.class);
    private final SnapshotStorage storage;
    private final ProjectRevisionRepository revisions;
    private final Duration gracePeriod;
    private final Clock clock;

    @Autowired
    public OrphanSnapshotCleaner(SnapshotStorage storage, ProjectRevisionRepository revisions,
                                 @Value("${editor.storage.orphan-cleanup.grace-period:24h}") Duration gracePeriod) {
        this(storage, revisions, gracePeriod, Clock.systemUTC());
    }

    OrphanSnapshotCleaner(SnapshotStorage storage, ProjectRevisionRepository revisions,
                          Duration gracePeriod, Clock clock) {
        this.storage = storage;
        this.revisions = revisions;
        this.gracePeriod = gracePeriod;
        this.clock = clock;
    }

    @Scheduled(cron = "${editor.storage.orphan-cleanup.cron:0 30 3 * * *}")
    public void clean() {
        Instant cutoff = clock.instant().minus(gracePeriod);
        int removed = 0;
        for (SnapshotStorage.StoredObject object : storage.list(LEGACY_SNAPSHOT_PREFIX)) {
            if (!object.key().startsWith(LEGACY_SNAPSHOT_PREFIX)) {
                log.warn("Ignoring object outside legacy snapshot namespace");
                continue;
            }
            if (object.lastModified().isAfter(cutoff) || revisions.existsByObjectKey(object.key())) {
                continue;
            }
            try {
                storage.delete(object.key());
                removed++;
            } catch (StorageException exception) {
                log.warn("Could not remove orphaned snapshot object {}", object.key(), exception);
            }
        }
        if (removed > 0) {
            log.info("Removed {} orphaned snapshot objects", removed);
        }
    }
}
