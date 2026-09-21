package com.webeditor.project.application;

import java.util.Map;

public record SnapshotDocument(String entry, Map<String, SnapshotFile> files) {
}
