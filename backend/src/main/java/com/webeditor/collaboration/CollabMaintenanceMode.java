package com.webeditor.collaboration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Maintenance can start only with every public write switch closed. */
@Component
public class CollabMaintenanceMode {
    private final boolean enabled;
    public CollabMaintenanceMode(@Value("${editor.collaboration.maintenance.enabled:false}") boolean enabled,
            @Value("${editor.collaboration.creation-enabled:false}") boolean creation,
            @Value("${editor.collaboration.ticket-enabled:false}") boolean tickets,
            @Value("${editor.collaboration.gateway.enabled:false}") boolean gateway) {
        if (enabled && (creation || tickets || gateway))
            throw new IllegalArgumentException("Maintenance requires creation, tickets and gateway disabled");
        this.enabled = enabled;
    }
    public boolean enabled() { return enabled; }
    public void require() { if (!enabled) throw new CollabFailure(503, "COLLAB_MAINTENANCE_DISABLED"); }
    public void writable() { if (enabled) throw new CollabFailure(503, "COLLAB_MAINTENANCE_REQUIRED"); }
}
