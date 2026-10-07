package com.webeditor.collaboration;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.LongAdder;
import org.springframework.stereotype.Component;

/** Fixed names only; no content, credentials or arbitrary labels. */
@Component
public class CollabMetrics {
    public enum Name { AUTH_FAILURE, AUTHORIZATION_DENIED, TICKET_ISSUED, TICKET_CONSUMED, TICKET_REJECTED,
        CAS_CONFLICT, PERSIST_SUCCESS, PERSIST_FAILURE, PERSIST_NANOS, CLEANUP_DELETED, CLEANUP_FAILURE,
        OUTBOX_ACK, OUTBOX_FAILURE, RECOVERY_SUCCESS, RECOVERY_FAILURE, REDIS_FAILURE }
    private final Map<Name, LongAdder> counters = new java.util.EnumMap<>(Name.class);
    public CollabMetrics() { for (var name : Name.values()) counters.put(name, new LongAdder()); }
    public void increment(Name name) { add(name, 1); }
    public void add(Name name, long value) { counters.get(name).add(value); }
    public Map<String, Long> snapshot() {
        Map<String, Long> result = new LinkedHashMap<>();
        counters.forEach((name, value) -> result.put(name.name().toLowerCase(java.util.Locale.ROOT), value.sum()));
        return result;
    }
}
