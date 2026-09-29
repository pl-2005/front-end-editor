package com.webeditor.project;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.project.repository.ProjectRevisionRepository;
import com.webeditor.storage.SnapshotStorage;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Import(ProjectControllerTests.TestStorageConfiguration.class)
class ProjectControllerTests {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ProjectRevisionRepository revisions;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private InMemorySnapshotStorage storage;

    @BeforeEach
    void resetState() {
        revisions.deleteAll();
        projects.deleteAll();
        storage.clear();
    }

    @Test
    void supportsProjectCrudAndSoftDelete() throws Exception {
        long id = createProject("演示项目");

        mockMvc.perform(get("/api/projects/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("演示项目"))
                .andExpect(jsonPath("$.data.version").value(0))
                .andExpect(jsonPath("$.data.files").isEmpty());

        mockMvc.perform(put("/api/projects/{id}", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"缺少ETag\",\"description\":\"updated\",\"template\":\"vanilla\"}"))
                .andExpect(status().isPreconditionRequired());

        mockMvc.perform(put("/api/projects/{id}", id)
                        .header("If-Match", etag(id, 0))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"已重命名","description":"updated","template":"vanilla"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("已重命名"))
                .andExpect(jsonPath("$.data.entry").value("/index.html"))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(header().string("ETag", etag(id, 1)));

        mockMvc.perform(put("/api/projects/{id}", id)
                        .header("If-Match", etag(id, 0))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"陈旧更新\",\"description\":\"updated\",\"template\":\"vanilla\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));

        mockMvc.perform(get("/api/projects?page=0&size=20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.items[0].name").value("已重命名"));

        mockMvc.perform(delete("/api/projects/{id}", id).header("If-Match", etag(id, 0)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));

        mockMvc.perform(delete("/api/projects/{id}", id).header("If-Match", etag(id, 1)))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/projects/{id}", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PROJECT_NOT_FOUND"));
    }

    @Test
    void savesLoadsAndDeduplicatesSnapshots() throws Exception {
        long id = createProject("快照项目");
        String snapshot = """
                {
                  "expectedVersion":0,
                  "entry":"/index.html",
                  "files":{
                    "/index.html":{"code":"<h1>Hello</h1>"},
                    "/index.js":{"code":"console.log('hello')"}
                  }
                }
                """;

        mockMvc.perform(put("/api/projects/{id}/snapshot", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(snapshot))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(1))
                .andExpect(jsonPath("$.data.contentHash").isString());

        mockMvc.perform(get("/api/projects/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(1))
                .andExpect(jsonPath("$.data.files['/index.html'].code").value("<h1>Hello</h1>"));

        String identicalAtVersionOne = snapshot.replace("\"expectedVersion\":0", "\"expectedVersion\":1");
        mockMvc.perform(put("/api/projects/{id}/snapshot", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(identicalAtVersionOne))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(1));
    }

    @Test
    void rejectsStaleVersionsAndUnsafePaths() throws Exception {
        long id = createProject("冲突项目");
        String valid = """
                {"expectedVersion":0,"entry":"/index.html","files":{"/index.html":{"code":"ok"}}}
                """;
        mockMvc.perform(put("/api/projects/{id}/snapshot", id)
                        .contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isOk());

        mockMvc.perform(put("/api/projects/{id}/snapshot", id)
                        .contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));

        mockMvc.perform(put("/api/projects/{id}/snapshot", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"expectedVersion":1,"entry":"/../secret.js","files":{"/../secret.js":{"code":"x"}}}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SNAPSHOT"));
    }

    @Test
    void listsAndRestoresARevisionAsANewVersion() throws Exception {
        long id = createProject("恢复项目");
        saveSnapshot(id, 0, "第一版");
        saveSnapshot(id, 1, "第二版");

        mockMvc.perform(get("/api/projects/{id}/revisions", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].version").value(2))
                .andExpect(jsonPath("$.data[0].current").value(true))
                .andExpect(jsonPath("$.data[1].version").value(1));

        mockMvc.perform(post("/api/projects/{id}/revisions/{version}/restore", id, 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(3));

        mockMvc.perform(get("/api/projects/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(3))
                .andExpect(jsonPath("$.data.files['/index.html'].code").value("第一版"));
    }

    @Test
    void rejectsRestoreWhenExpectedVersionIsStaleOrRevisionIsMissing() throws Exception {
        long id = createProject("恢复冲突");
        saveSnapshot(id, 0, "内容");

        mockMvc.perform(post("/api/projects/{id}/revisions/{version}/restore", id, 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":0}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));

        mockMvc.perform(post("/api/projects/{id}/revisions/{version}/restore", id, 99)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REVISION_NOT_FOUND"));
    }

    private void saveSnapshot(long id, int expectedVersion, String content) throws Exception {
        mockMvc.perform(put("/api/projects/{id}/snapshot", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"expectedVersion":%d,"entry":"/index.html","files":{"/index.html":{"code":"%s"}}}
                                """.formatted(expectedVersion, content)))
                .andExpect(status().isOk());
    }

    private long createProject(String name) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"%s","description":"test"}
                                """.formatted(name)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(201))
                .andReturn();
        JsonNode json = objectMapper.readTree(result.getResponse().getContentAsByteArray());
        return json.path("data").path("id").asLong();
    }

    private String etag(long id, long version) {
        return "\"project-" + id + "-" + version + "\"";
    }

    @TestConfiguration
    static class TestStorageConfiguration {
        @Bean
        @Primary
        InMemorySnapshotStorage inMemorySnapshotStorage() {
            return new InMemorySnapshotStorage();
        }
    }

    static class InMemorySnapshotStorage implements SnapshotStorage {
        private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

        @Override
        public void put(String objectKey, byte[] content) {
            objects.put(objectKey, content.clone());
        }

        @Override
        public byte[] get(String objectKey) {
            byte[] value = objects.get(objectKey);
            if (value == null) {
                throw new IllegalStateException("Missing test object " + objectKey);
            }
            return value.clone();
        }

        @Override
        public void delete(String objectKey) {
            objects.remove(objectKey);
        }

        void clear() {
            objects.clear();
        }
    }
}
