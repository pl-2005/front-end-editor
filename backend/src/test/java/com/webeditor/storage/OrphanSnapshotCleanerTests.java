package com.webeditor.storage;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.webeditor.project.repository.ProjectRevisionRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class OrphanSnapshotCleanerTests {
    private static final Instant NOW = Instant.parse("2026-09-20T12:00:00Z");

    @Test
    void removesOnlyOldUnreferencedObjects() {
        SnapshotStorage storage = mock(SnapshotStorage.class);
        ProjectRevisionRepository revisions = mock(ProjectRevisionRepository.class);
        var orphan = new SnapshotStorage.StoredObject("projects/1/revisions/orphan.json.gz", NOW.minus(Duration.ofDays(2)));
        var referenced = new SnapshotStorage.StoredObject("projects/1/revisions/kept.json.gz", NOW.minus(Duration.ofDays(2)));
        var recent = new SnapshotStorage.StoredObject("projects/1/revisions/recent.json.gz", NOW.minus(Duration.ofHours(1)));
        when(storage.list("projects/")).thenReturn(List.of(orphan, referenced, recent));
        when(revisions.existsByObjectKey(orphan.key())).thenReturn(false);
        when(revisions.existsByObjectKey(referenced.key())).thenReturn(true);

        new OrphanSnapshotCleaner(storage, revisions, Duration.ofDays(1),
                Clock.fixed(NOW, ZoneOffset.UTC)).clean();

        verify(storage).delete(orphan.key());
        verify(storage, never()).delete(referenced.key());
        verify(storage, never()).delete(recent.key());
    }
}
