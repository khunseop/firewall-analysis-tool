import json

nodes_part1 = []
nodes_part2 = []
edges_part1 = []
edges_part2 = []

def fnode(id_, name, path, summary, tags, complexity="simple", extra_type="file", lang_notes=None):
    n = {
        "id": id_,
        "type": extra_type,
        "name": name,
        "filePath": path,
        "summary": summary,
        "tags": tags,
        "complexity": complexity,
    }
    if lang_notes:
        n["languageNotes"] = lang_notes
    return n

def snode(id_, name, path, line_range, summary, tags, complexity="simple", ntype="function"):
    return {
        "id": id_,
        "type": ntype,
        "name": name,
        "filePath": path,
        "lineRange": line_range,
        "summary": summary,
        "tags": tags,
        "complexity": complexity,
    }

def edge(source, target, etype, weight):
    return {"source": source, "target": target, "type": etype, "direction": "forward", "weight": weight}

# ============ PART 1 FILES ============

# 1. env.py
p = "backend/alembic/env.py"
nodes_part1.append(fnode(f"file:{p}", "env.py", p,
    "Alembic 비동기 마이그레이션 실행 환경을 설정하며 오프라인/온라인 모드로 DB 스키마 마이그레이션을 실행한다.",
    ["migration", "database", "alembic", "infrastructure"], "simple"))
nodes_part1.append(snode(f"function:{p}:run_migrations_offline", "run_migrations_offline", p, [38,48],
    "DB 접속 없이 URL만으로 마이그레이션 SQL을 생성하는 오프라인 모드 실행 함수.", ["migration", "alembic"]))
nodes_part1.append(snode(f"function:{p}:run_migrations_online", "run_migrations_online", p, [60,69],
    "비동기 엔진을 생성해 실제 DB 커넥션으로 온라인 마이그레이션을 실행하는 함수.", ["migration", "alembic", "async"]))
for fn in ["run_migrations_offline", "run_migrations_online"]:
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{fn}", "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{fn}", "exports", 0.8))
for tgt in ["backend/app/core/config.py", "backend/app/db/session.py", "backend/app/models/__init__.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 2. devices.py
p = "backend/app/api/api_v1/endpoints/devices.py"
nodes_part1.append(fnode(f"file:{p}", "devices.py", p,
    "장비(방화벽) CRUD, 엑셀 일괄 등록/내보내기, 연결 테스트 등 Devices 페이지의 백엔드 API 엔드포인트를 제공한다.",
    ["api-handler", "device-management", "excel-export", "crud"], "complex"))
funcs = [
    ("create_device", [45,67], "신규 장비를 생성하고 감사 로그를 남기는 API 핸들러.", ["api-handler", "device-management"]),
    ("download_excel_template", [88,191], "장비 일괄 등록용 엑셀 템플릿 파일을 생성해 다운로드로 제공하는 핸들러.", ["api-handler", "excel", "template"]),
    ("update_device", [204,227], "기존 장비 정보를 수정하고 변경 이력을 기록하는 API 핸들러.", ["api-handler", "device-management"]),
    ("delete_device", [230,249], "장비를 삭제하고 감사 로그를 남기는 API 핸들러.", ["api-handler", "device-management"]),
    ("test_connection", [252,268], "장비에 대한 연결 테스트를 수행하는 API 핸들러.", ["api-handler", "device-management", "validation"]),
    ("bulk_import_devices", [271,448], "엑셀 파일을 파싱해 여러 장비를 검증 후 일괄 등록하는 API 핸들러.", ["api-handler", "excel", "bulk-import"], "complex"),
    ("_create_export_task", [455,481], "내보내기 작업(ExportTask) 레코드를 생성하는 내부 헬퍼 함수.", ["utility", "export"]),
    ("direct_export_device", [485,501], "단일 장비의 정책/오브젝트를 백그라운드로 즉시 추출·내보내는 API 핸들러.", ["api-handler", "export", "background-task"]),
    ("bulk_export_devices", [505,529], "여러 장비의 데이터를 백그라운드로 일괄 내보내는 API 핸들러.", ["api-handler", "export", "background-task"]),
    ("download_export_task_result", [551,569], "완료된 내보내기 작업의 결과 파일을 다운로드로 제공하는 핸들러.", ["api-handler", "export", "file-download"]),
]
for f_entry in funcs:
    name, lr, summ, tags = f_entry[0], f_entry[1], f_entry[2], f_entry[3]
    complexity = f_entry[4] if len(f_entry) > 4 else "moderate"
    nodes_part1.append(snode(f"function:{p}:{name}", name, p, lr, summ, tags, complexity))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "exports", 0.8))
for tgt in ["backend/app/__init__.py", "backend/app/core/auth.py", "backend/app/crud/__init__.py",
            "backend/app/db/session.py", "backend/app/models/__init__.py", "backend/app/models/user.py",
            "backend/app/schemas/__init__.py", "backend/app/services/__init__.py",
            "backend/app/services/audit_log.py", "backend/app/services/device_service.py",
            "backend/app/services/export/tasks.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))
# calls edges
edges_part1.append(edge(f"function:{p}:create_device", "function:backend/app/services/audit_log.py:log_activity", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:update_device", "function:backend/app/crud/crud_device.py:update_device", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:update_device", "function:backend/app/services/audit_log.py:log_activity", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:delete_device", "function:backend/app/crud/crud_device.py:remove_device", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:delete_device", "function:backend/app/services/audit_log.py:log_activity", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:test_connection", "function:backend/app/services/device_service.py:test_device_connection", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:bulk_import_devices", "function:backend/app/services/audit_log.py:log_activity", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:direct_export_device", "function:backend/app/services/export/tasks.py:run_export_task", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:bulk_export_devices", "function:backend/app/services/export/tasks.py:run_export_task", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:get_dashboard_stats", "function:backend/app/crud/crud_device.py:get_dashboard_stats", "calls", 0.8))
# get_dashboard_stats function node wasn't created (it's below 10 lines) - need to add it as node since used as calls source
nodes_part1.append(snode(f"function:{p}:get_dashboard_stats", "get_dashboard_stats", p, [81,85],
    "전체 장비의 대시보드 통계를 조회해 반환하는 API 핸들러.", ["api-handler", "dashboard", "statistics"]))
edges_part1.append(edge(f"file:{p}", f"function:{p}:get_dashboard_stats", "contains", 1.0))
edges_part1.append(edge(f"file:{p}", f"function:{p}:get_dashboard_stats", "exports", 0.8))

# 3. firewall_query.py
p = "backend/app/api/api_v1/endpoints/firewall_query.py"
nodes_part1.append(fnode(f"file:{p}", "firewall_query.py", p,
    "동기화된 정책/오브젝트 조회, 검색, 변경 이력, 동기화 이력, 정책 diff 등 방화벽 데이터 조회 전용 API 엔드포인트 모음.",
    ["api-handler", "query", "policy", "search"], "complex"))
funcs = [
    ("parse_index", [17,29], "동기화된 정책의 인덱스(Resolver 기반 멤버 테이블)를 재생성하는 API 핸들러.", ["api-handler", "indexing"]),
    ("count_device_objects", [45,56], "장비별 네트워크/서비스 오브젝트 개수를 집계해 반환하는 API 핸들러.", ["api-handler", "statistics"]),
    ("search_policies", [60,81], "조건식 기반으로 정책을 검색하고 유효 오브젝트 이름 집합을 함께 반환하는 API 핸들러.", ["api-handler", "search", "policy"]),
    ("get_object_details", [111,160], "이름으로 네트워크/서비스 오브젝트 또는 그룹의 상세 정보를 조회하는 API 핸들러.", ["api-handler", "object-lookup"]),
    ("search_objects", [172,300], "네트워크/서비스 오브젝트와 그룹을 다양한 조건으로 검색하는 API 핸들러.", ["api-handler", "search", "object"], "complex"),
    ("get_object_usage_counts", [304,343], "정책의 출발지/목적지/서비스 필드를 분석해 오브젝트별 사용 횟수를 집계하는 API 핸들러.", ["api-handler", "statistics", "policy"]),
    ("get_policy_history", [347,375], "특정 정책 규칙의 변경 이력을 조회하는 API 핸들러.", ["api-handler", "change-log", "policy"]),
    ("get_change_stats", [386,415], "주 단위로 그룹화된 변경 통계를 집계해 반환하는 API 핸들러.", ["api-handler", "statistics", "change-log"]),
    ("get_policy_change_logs", [419,447], "여러 장비의 최근 정책 변경 로그를 조회하는 API 핸들러.", ["api-handler", "change-log"]),
    ("get_sync_history", [451,475], "장비의 동기화 이력을 조회하는 API 핸들러.", ["api-handler", "sync-history"]),
    ("get_object_count_history", [479,513], "주 단위 오브젝트 개수 추이를 동기화 이력에서 계산하는 API 핸들러.", ["api-handler", "statistics", "history"]),
    ("get_policy_diff", [517,667], "두 동기화 시점 사이의 정책 변경 내역(diff)을 계산해 반환하는 API 핸들러.", ["api-handler", "policy", "diff"], "complex"),
]
for f_entry in funcs:
    name, lr, summ, tags = f_entry[0], f_entry[1], f_entry[2], f_entry[3]
    complexity = f_entry[4] if len(f_entry) > 4 else "moderate"
    nodes_part1.append(snode(f"function:{p}:{name}", name, p, lr, summ, tags, complexity))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "exports", 0.8))
for tgt in ["backend/app/__init__.py", "backend/app/crud/__init__.py", "backend/app/db/session.py",
            "backend/app/models/__init__.py", "backend/app/models/change_log.py",
            "backend/app/models/sync_history.py", "backend/app/schemas/__init__.py",
            "backend/app/services/policy_indexer.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))
edges_part1.append(edge(f"function:{p}:parse_index", "function:backend/app/services/policy_indexer.py:rebuild_policy_indices", "calls", 0.8))
# add read_db_device_policies and count_device_policies as small nodes (used as calls sources)
nodes_part1.append(snode(f"function:{p}:read_db_device_policies", "read_db_device_policies", p, [33,34],
    "장비의 DB 저장된 정책 목록을 조회하는 API 핸들러.", ["api-handler", "policy"]))
edges_part1.append(edge(f"file:{p}", f"function:{p}:read_db_device_policies", "contains", 1.0))
edges_part1.append(edge(f"file:{p}", f"function:{p}:read_db_device_policies", "exports", 0.8))
edges_part1.append(edge(f"function:{p}:read_db_device_policies", "function:backend/app/crud/crud_policy.py:get_policies_by_device", "calls", 0.8))

nodes_part1.append(snode(f"function:{p}:count_device_policies", "count_device_policies", p, [38,41],
    "장비의 정책 개수를 조회하는 API 핸들러.", ["api-handler", "statistics", "policy"]))
edges_part1.append(edge(f"file:{p}", f"function:{p}:count_device_policies", "contains", 1.0))
edges_part1.append(edge(f"file:{p}", f"function:{p}:count_device_policies", "exports", 0.8))
edges_part1.append(edge(f"function:{p}:count_device_policies", "function:backend/app/crud/crud_policy.py:count_policies_by_device", "calls", 0.8))

edges_part1.append(edge(f"function:{p}:search_policies", "function:backend/app/crud/crud_policy.py:search_policies", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:search_objects", "function:backend/app/crud/crud_network_object.py:search_network_objects", "calls", 0.8))
edges_part1.append(edge(f"function:{p}:search_objects", "function:backend/app/crud/crud_service.py:search_services", "calls", 0.8))

# 4. config.py
p = "backend/app/core/config.py"
nodes_part1.append(fnode(f"file:{p}", "config.py", p,
    "환경변수(.env) 로드 및 암호화 키 자동 생성을 포함한 애플리케이션 전역 설정(Settings)을 정의한다.",
    ["configuration", "settings", "security", "entry-point"], "moderate"))
nodes_part1.append(snode(f"function:{p}:_ensure_env_file", "_ensure_env_file", p, [18,66],
    "`.env` 파일이 없으면 기본값과 자동 생성된 암호화 키로 새로 작성하는 초기화 함수.", ["configuration", "initialization", "security"]))
nodes_part1.append(snode(f"class:{p}:Settings", "Settings", p, [69,77],
    "DB 연결 문자열, 암호화 키, JWT 설정 등 애플리케이션 전역 설정을 담는 Pydantic 설정 클래스.",
    ["configuration", "settings", "singleton"], "simple", ntype="class"))
for nid in [f"function:{p}:_ensure_env_file", f"class:{p}:Settings"]:
    edges_part1.append(edge(f"file:{p}", nid, "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", nid, "exports", 0.8))

# 5. security.py
p = "backend/app/core/security.py"
nodes_part1.append(fnode(f"file:{p}", "security.py", p,
    "Fernet 대칭키 기반 비밀번호 암호화/복호화 유틸리티 함수를 제공한다.",
    ["security", "encryption", "utility"], "simple"))
nodes_part1.append(snode(f"function:{p}:encrypt", "encrypt", p, [7,12],
    "Fernet 키로 평문 문자열을 암호화하는 함수.", ["security", "encryption"]))
nodes_part1.append(snode(f"function:{p}:decrypt", "decrypt", p, [14,19],
    "Fernet 키로 암호화된 문자열을 복호화하는 함수.", ["security", "encryption"]))
for fn in ["encrypt", "decrypt"]:
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{fn}", "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{fn}", "exports", 0.8))
edges_part1.append(edge(f"file:{p}", "file:backend/app/core/config.py", "imports", 0.7))

# 6. crud/base.py
p = "backend/app/crud/base.py"
nodes_part1.append(fnode(f"file:{p}", "base.py", p,
    "장비 스코프 객체(NetworkObject/Group, Service/Group) 공통 CRUD 로직을 제네릭 함수로 제공하는 공유 모듈.",
    ["crud", "utility", "generic", "database"], "moderate"))
nodes_part1.append(snode(f"function:{p}:search_groups", "search_groups", p, [73,93],
    "그룹형 오브젝트(NetworkGroup/ServiceGroup)를 이름·멤버·설명 조건으로 검색하는 제네릭 함수.", ["crud", "search", "generic"]))
edges_part1.append(edge(f"file:{p}", f"function:{p}:search_groups", "contains", 1.0))
edges_part1.append(edge(f"file:{p}", f"function:{p}:search_groups", "exports", 0.8))

# 7. crud_change_log.py
p = "backend/app/crud/crud_change_log.py"
nodes_part1.append(fnode(f"file:{p}", "crud_change_log.py", p,
    "정책/오브젝트 변경 이력(ChangeLog) 레코드를 생성하고 장비별로 조회하는 CRUD 함수 모음.",
    ["crud", "change-log", "database"], "simple"))
for tgt in ["backend/app/models/change_log.py", "backend/app/schemas/change_log.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 8. crud_deletion_workflow.py
p = "backend/app/crud/crud_deletion_workflow.py"
nodes_part1.append(fnode(f"file:{p}", "crud_deletion_workflow.py", p,
    "삭제 워크플로우 프로젝트 및 산출 파일(DeletionWorkflowFile) 생성/조회/상태갱신을 담당하는 CRUD 계층.",
    ["crud", "deletion-workflow", "database"], "complex"))
funcs = [
    ("create_project", [10,30], "삭제 워크플로우 신규 프로젝트를 생성하는 함수.", ["crud", "deletion-workflow"]),
    ("set_project_running", [73,85], "프로젝트를 실행 중 상태로 표시하고 태스크 ID·실행자 정보를 기록하는 함수.", ["crud", "deletion-workflow", "state"]),
    ("clear_project_running", [88,97], "프로젝트의 실행 중 상태를 해제하는 함수.", ["crud", "deletion-workflow", "state"]),
    ("update_project", [103,116], "프로젝트의 메모/기준일 등 메타데이터를 수정하는 함수.", ["crud", "deletion-workflow"]),
    ("upsert_file", [119,153], "프로젝트-태스크-슬롯 기준으로 산출 파일을 생성하거나 갱신하는 함수.", ["crud", "deletion-workflow", "file"]),
    ("get_file", [156,169], "프로젝트/태스크/슬롯 조건으로 저장된 산출 파일을 조회하는 함수.", ["crud", "deletion-workflow", "file"]),
    ("clear_output_files", [182,195], "지정된 태스크들의 산출 파일을 삭제하는 함수.", ["crud", "deletion-workflow", "file"]),
]
for name, lr, summ, tags in funcs:
    nodes_part1.append(snode(f"function:{p}:{name}", name, p, lr, summ, tags))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "exports", 0.8))
edges_part1.append(edge(f"file:{p}", "file:backend/app/models/deletion_workflow.py", "imports", 0.7))

# 9. crud_device.py
p = "backend/app/crud/crud_device.py"
nodes_part1.append(fnode(f"file:{p}", "crud_device.py", p,
    "장비 등록/수정/삭제, 동기화 상태 갱신, 대시보드 통계 등 Device 모델에 대한 핵심 CRUD 및 집계 로직을 제공한다.",
    ["crud", "device-management", "database", "dashboard"], "complex"))
funcs = [
    ("update_device", [47,61], "장비 정보를 부분 갱신하는 함수.", ["crud", "device-management"]),
    ("remove_device", [63,90], "장비와 연관 데이터를 삭제하는 함수.", ["crud", "device-management"]),
    ("update_sync_status", [93,127], "장비의 동기화 상태와 진행 단계를 갱신하는 함수.", ["crud", "device-management", "sync"]),
    ("update_collected_system_info", [158,168], "SSH/API로 수집한 장비의 시스템 정보(호스트명/시리얼/OS)를 저장하는 함수.", ["crud", "device-management"]),
    ("get_dashboard_stats", [171,235], "전체 장비의 정책/오브젝트 수, 동기화 상태 등 대시보드 통계를 집계하는 함수.", ["crud", "dashboard", "statistics"]),
    ("update_device_stats_cache", [238,279], "장비별 정책/오브젝트 개수 캐시를 재계산해 갱신하는 함수.", ["crud", "cache", "statistics"]),
]
for name, lr, summ, tags in funcs:
    nodes_part1.append(snode(f"function:{p}:{name}", name, p, lr, summ, tags))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "exports", 0.8))
for tgt in ["backend/app/core/security.py", "backend/app/models/analysis.py", "backend/app/models/change_log.py",
            "backend/app/models/device.py", "backend/app/models/network_group.py", "backend/app/models/network_object.py",
            "backend/app/models/notification_log.py", "backend/app/models/policy.py", "backend/app/models/policy_members.py",
            "backend/app/models/service.py", "backend/app/models/service_group.py", "backend/app/schemas/device.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 10. crud_network_group.py
p = "backend/app/crud/crud_network_group.py"
nodes_part1.append(fnode(f"file:{p}", "crud_network_group.py", p,
    "네트워크 그룹 오브젝트에 대한 조회/생성/수정/삭제 및 검색 CRUD 함수 모음.",
    ["crud", "network-object", "database"], "simple"))
for tgt in ["backend/app/crud/__init__.py", "backend/app/crud/base.py", "backend/app/models/network_group.py",
            "backend/app/schemas/network_group.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 11. crud_network_object.py
p = "backend/app/crud/crud_network_object.py"
nodes_part1.append(fnode(f"file:{p}", "crud_network_object.py", p,
    "네트워크 오브젝트 조회/생성/수정/삭제와 IP·이름 기반 검색을 제공하는 CRUD 모듈.",
    ["crud", "network-object", "search", "database"], "moderate"))
nodes_part1.append(snode(f"function:{p}:search_network_objects", "search_network_objects", p, [39,91],
    "이름·IP·유형·설명 등 다중 조건으로 네트워크 오브젝트를 검색하는 함수.", ["crud", "search", "network-object"]))
edges_part1.append(edge(f"file:{p}", f"function:{p}:search_network_objects", "contains", 1.0))
edges_part1.append(edge(f"file:{p}", f"function:{p}:search_network_objects", "exports", 0.8))
for tgt in ["backend/app/crud/__init__.py", "backend/app/crud/base.py", "backend/app/models/network_object.py",
            "backend/app/schemas/network_object.py", "backend/app/services/normalize.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 12. crud_notification_log.py
p = "backend/app/crud/crud_notification_log.py"
nodes_part1.append(fnode(f"file:{p}", "crud_notification_log.py", p,
    "알림 로그 생성, 필터링 조회(카테고리/기간/검색어), 오래된 로그 정리를 담당하는 CRUD 모듈.",
    ["crud", "notification", "database"], "moderate"))
funcs = [
    ("get_notification_logs", [17,74], "카테고리/유형/검색어/기간 조건으로 알림 로그를 필터링 조회하는 함수.", ["crud", "notification", "search"]),
    ("delete_old_logs", [77,87], "지정 일수보다 오래된 알림 로그를 삭제하는 함수.", ["crud", "notification", "cleanup"]),
]
for name, lr, summ, tags in funcs:
    nodes_part1.append(snode(f"function:{p}:{name}", name, p, lr, summ, tags))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "contains", 1.0))
    edges_part1.append(edge(f"file:{p}", f"function:{p}:{name}", "exports", 0.8))
for tgt in ["backend/app/models/notification_log.py", "backend/app/schemas/notification_log.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 13. crud_pending_policy_change.py
p = "backend/app/crud/crud_pending_policy_change.py"
nodes_part1.append(fnode(f"file:{p}", "crud_pending_policy_change.py", p,
    "PolicyBuilder 편집모드에서 생성된 대기중 정책 변경사항(pending_policy_changes)을 장비별로 저장/조회/수정/삭제하는 CRUD 모듈.",
    ["crud", "policy-builder", "database"], "simple"))
nodes_part1.append(snode(f"function:{p}:create", "create", p, [23,35],
    "PolicyBuilder 편집모드의 대기중 정책 변경사항을 새로 생성하는 함수.", ["crud", "policy-builder"]))
edges_part1.append(edge(f"file:{p}", f"function:{p}:create", "contains", 1.0))
edges_part1.append(edge(f"file:{p}", f"function:{p}:create", "exports", 0.8))
for tgt in ["backend/app/models/pending_policy_change.py", "backend/app/schemas/pending_policy_change.py"]:
    edges_part1.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# ============ PART 2 FILES ============

# 14. crud_service.py
p = "backend/app/crud/crud_service.py"
nodes_part2.append(fnode(f"file:{p}", "crud_service.py", p,
    "서비스(포트/프로토콜) 오브젝트 조회/생성/수정/삭제와 검색을 제공하는 CRUD 모듈.",
    ["crud", "service-object", "search", "database"], "moderate"))
nodes_part2.append(snode(f"function:{p}:search_services", "search_services", p, [39,92],
    "이름·프로토콜·포트·설명 조건으로 서비스 오브젝트를 검색하는 함수.", ["crud", "search", "service-object"]))
edges_part2.append(edge(f"file:{p}", f"function:{p}:search_services", "contains", 1.0))
edges_part2.append(edge(f"file:{p}", f"function:{p}:search_services", "exports", 0.8))
for tgt in ["backend/app/crud/__init__.py", "backend/app/crud/base.py", "backend/app/models/service.py",
            "backend/app/schemas/service.py", "backend/app/services/normalize.py"]:
    edges_part2.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 15. crud_service_group.py
p = "backend/app/crud/crud_service_group.py"
nodes_part2.append(fnode(f"file:{p}", "crud_service_group.py", p,
    "서비스 그룹 오브젝트에 대한 조회/생성/수정/삭제 및 검색 CRUD 함수 모음.",
    ["crud", "service-object", "database"], "simple"))
for tgt in ["backend/app/crud/__init__.py", "backend/app/crud/base.py", "backend/app/models/service_group.py",
            "backend/app/schemas/service_group.py"]:
    edges_part2.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 16. crud_settings.py
p = "backend/app/crud/crud_settings.py"
nodes_part2.append(fnode(f"file:{p}", "crud_settings.py", p,
    "키-값 기반 애플리케이션 설정(Settings) 항목을 조회/생성/수정하는 CRUD 모듈.",
    ["crud", "settings", "database"], "simple"))
for tgt in ["backend/app/models/settings.py", "backend/app/schemas/settings.py"]:
    edges_part2.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 17. crud_sync_schedule.py
p = "backend/app/crud/crud_sync_schedule.py"
nodes_part2.append(fnode(f"file:{p}", "crud_sync_schedule.py", p,
    "동기화 스케줄 등록/조회/수정/삭제 및 실행 상태 갱신을 담당하는 CRUD 모듈.",
    ["crud", "scheduler", "database"], "moderate"))
funcs = [
    ("update_sync_schedule", [42,55], "동기화 스케줄 설정을 부분 갱신하는 함수.", ["crud", "scheduler"]),
    ("update_schedule_run_status", [65,79], "스케줄의 마지막 실행 상태와 시각을 갱신하는 함수.", ["crud", "scheduler", "state"]),
]
for name, lr, summ, tags in funcs:
    nodes_part2.append(snode(f"function:{p}:{name}", name, p, lr, summ, tags))
    edges_part2.append(edge(f"file:{p}", f"function:{p}:{name}", "contains", 1.0))
    edges_part2.append(edge(f"file:{p}", f"function:{p}:{name}", "exports", 0.8))
for tgt in ["backend/app/models/sync_schedule.py", "backend/app/schemas/sync_schedule.py"]:
    edges_part2.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 18. db/session.py
p = "backend/app/db/session.py"
nodes_part2.append(fnode(f"file:{p}", "session.py", p,
    "SQLAlchemy 비동기 엔진과 세션 팩토리를 생성하고, SQLite PRAGMA 설정 및 요청 스코프 세션 의존성(get_db)을 제공한다.",
    ["database", "sqlalchemy", "session", "config"], "simple"))
edges_part2.append(edge(f"file:{p}", "file:backend/app/core/config.py", "imports", 0.7))

# 19. models/__init__.py
p = "backend/app/models/__init__.py"
nodes_part2.append(fnode(f"file:{p}", "__init__.py", p,
    "모든 SQLAlchemy ORM 모델을 한곳에서 재노출하는 모델 패키지 배럴 파일.",
    ["barrel", "entry-point", "orm", "database"], "simple"))
for tgt in ["backend/app/models/analysis.py", "backend/app/models/change_log.py", "backend/app/models/deletion_workflow.py",
            "backend/app/models/device.py", "backend/app/models/export_task.py", "backend/app/models/network_group.py",
            "backend/app/models/network_object.py", "backend/app/models/notification_log.py",
            "backend/app/models/pending_policy_change.py", "backend/app/models/policy.py",
            "backend/app/models/policy_members.py", "backend/app/models/service.py",
            "backend/app/models/service_group.py", "backend/app/models/settings.py",
            "backend/app/models/sync_history.py", "backend/app/models/sync_schedule.py",
            "backend/app/models/user.py"]:
    edges_part2.append(edge(f"file:{p}", f"file:{tgt}", "imports", 0.7))

# 20. models/change_log.py
p = "backend/app/models/change_log.py"
nodes_part2.append(fnode(f"file:{p}", "change_log.py", p,
    "정책/오브젝트 변경 이력을 기록하는 ChangeLog ORM 모델을 정의한다.",
    ["data-model", "orm", "change-log"], "simple"))
nodes_part2.append(snode(f"class:{p}:ChangeLog", "ChangeLog", p, [7,35],
    "정책/오브젝트의 생성·수정·삭제 이력을 저장하는 ORM 모델.", ["data-model", "orm", "change-log"], "simple", ntype="class"))
edges_part2.append(edge(f"file:{p}", f"class:{p}:ChangeLog", "contains", 1.0))
edges_part2.append(edge(f"file:{p}", f"class:{p}:ChangeLog", "exports", 0.8))
edges_part2.append(edge(f"file:{p}", "file:backend/app/db/session.py", "imports", 0.7))

# 21. models/deletion_workflow.py
p = "backend/app/models/deletion_workflow.py"
nodes_part2.append(fnode(f"file:{p}", "deletion_workflow.py", p,
    "삭제 워크플로우 프로젝트(DeletionWorkflowProject)와 산출 파일(DeletionWorkflowFile) ORM 모델을 정의한다.",
    ["data-model", "orm", "deletion-workflow"], "simple"))
nodes_part2.append(snode(f"class:{p}:DeletionWorkflowProject", "DeletionWorkflowProject", p, [7,26],
    "삭제 워크플로우 작업 단위를 나타내는 프로젝트 ORM 모델.", ["data-model", "orm", "deletion-workflow"], "simple", ntype="class"))
nodes_part2.append(snode(f"class:{p}:DeletionWorkflowFile", "DeletionWorkflowFile", p, [29,44],
    "프로젝트의 각 단계별 산출 파일을 저장하는 ORM 모델.", ["data-model", "orm", "deletion-workflow"], "simple", ntype="class"))
for cn in ["DeletionWorkflowProject", "DeletionWorkflowFile"]:
    edges_part2.append(edge(f"file:{p}", f"class:{p}:{cn}", "contains", 1.0))
    edges_part2.append(edge(f"file:{p}", f"class:{p}:{cn}", "exports", 0.8))
edges_part2.append(edge(f"file:{p}", "file:backend/app/db/session.py", "imports", 0.7))

# 22. models/device.py
p = "backend/app/models/device.py"
nodes_part2.append(fnode(f"file:{p}", "device.py", p,
    "벤더별 연결 정보, HA 구성, 동기화 상태, 수집 임계값 등을 포함하는 Device ORM 모델을 정의한다.",
    ["data-model", "orm", "device-management"], "moderate"))
nodes_part2.append(snode(f"class:{p}:Device", "Device", p, [4,90],
    "벤더 종류, 접속 정보(암호화 저장), HA 구성, 동기화 상태, 수집 임계값 등을 담는 핵심 장비 ORM 모델.",
    ["data-model", "orm", "device-management"], "moderate", ntype="class"))
edges_part2.append(edge(f"file:{p}", f"class:{p}:Device", "contains", 1.0))
edges_part2.append(edge(f"file:{p}", f"class:{p}:Device", "exports", 0.8))
edges_part2.append(edge(f"file:{p}", "file:backend/app/db/session.py", "imports", 0.7))

# 23. models/export_task.py
p = "backend/app/models/export_task.py"
nodes_part2.append(fnode(f"file:{p}", "export_task.py", p,
    "장비 데이터 내보내기(Excel export) 백그라운드 작업의 상태를 추적하는 ExportTask ORM 모델을 정의한다.",
    ["data-model", "orm", "export"], "simple"))
nodes_part2.append(snode(f"class:{p}:ExportTask", "ExportTask", p, [5,34],
    "장비 데이터 내보내기 백그라운드 작업의 진행 상태와 결과 파일 경로를 추적하는 ORM 모델.", ["data-model", "orm", "export"], "simple", ntype="class"))
edges_part2.append(edge(f"file:{p}", f"class:{p}:ExportTask", "contains", 1.0))
edges_part2.append(edge(f"file:{p}", f"class:{p}:ExportTask", "exports", 0.8))
edges_part2.append(edge(f"file:{p}", "file:backend/app/db/session.py", "imports", 0.7))

# 24. models/network_group.py
p = "backend/app/models/network_group.py"
nodes_part2.append(fnode(f"file:{p}", "network_group.py", p,
    "네트워크 오브젝트 그룹을 나타내는 NetworkGroup ORM 모델을 정의한다.",
    ["data-model", "orm", "network-object"], "simple"))
nodes_part2.append(snode(f"class:{p}:NetworkGroup", "NetworkGroup", p, [7,30],
    "네트워크 오브젝트 그룹을 나타내는 ORM 모델.", ["data-model", "orm", "network-object"], "simple", ntype="class"))
edges_part2.append(edge(f"file:{p}", f"class:{p}:NetworkGroup", "contains", 1.0))
edges_part2.append(edge(f"file:{p}", f"class:{p}:NetworkGroup", "exports", 0.8))
edges_part2.append(edge(f"file:{p}", "file:backend/app/db/session.py", "imports", 0.7))

# 25. models/network_object.py
p = "backend/app/models/network_object.py"
nodes_part2.append(fnode(f"file:{p}", "network_object.py", p,
    "IP/CIDR/범위 등의 네트워크 오브젝트를 나타내는 NetworkObject ORM 모델을 정의한다.",
    ["data-model", "orm", "network-object"], "simple"))
nodes_part2.append(snode(f"class:{p}:NetworkObject", "NetworkObject", p, [7,34],
    "IP/CIDR/범위 등의 네트워크 오브젝트를 나타내는 ORM 모델.", ["data-model", "orm", "network-object"], "simple", ntype="class"))
edges_part2.append(edge(f"file:{p}", f"class:{p}:NetworkObject", "contains", 1.0))
edges_part2.append(edge(f"file:{p}", f"class:{p}:NetworkObject", "exports", 0.8))
edges_part2.append(edge(f"file:{p}", "file:backend/app/db/session.py", "imports", 0.7))

# Write out
out1 = {"nodes": nodes_part1, "edges": edges_part1}
out2 = {"nodes": nodes_part2, "edges": edges_part2}

with open("/Users/hoon/Code/firewall-analysis-tool/.ua/intermediate/batch-2-part-1.json", "w", encoding="utf-8") as f:
    json.dump(out1, f, ensure_ascii=False, indent=2)
with open("/Users/hoon/Code/firewall-analysis-tool/.ua/intermediate/batch-2-part-2.json", "w", encoding="utf-8") as f:
    json.dump(out2, f, ensure_ascii=False, indent=2)

print("part1 nodes:", len(nodes_part1), "edges:", len(edges_part1))
print("part2 nodes:", len(nodes_part2), "edges:", len(edges_part2))

# dedupe check
def dupes(lst, key):
    seen = set()
    d = []
    for x in lst:
        k = key(x)
        if k in seen:
            d.append(k)
        seen.add(k)
    return d

print("dup node ids part1:", dupes(nodes_part1, lambda n: n["id"]))
print("dup node ids part2:", dupes(nodes_part2, lambda n: n["id"]))

allnodeids = set(n["id"] for n in nodes_part1) | set(n["id"] for n in nodes_part2)
# external allowed targets: neighborMap symbols + batchImportData paths (file: prefix) already covered by our own file nodes for in-batch
external_ok = set()
import json as js
external_files = [
"backend/app/__init__.py","backend/app/core/auth.py","backend/app/crud/__init__.py","backend/app/models/user.py",
"backend/app/schemas/__init__.py","backend/app/services/__init__.py","backend/app/services/audit_log.py",
"backend/app/services/device_service.py","backend/app/services/export/tasks.py","backend/app/models/sync_history.py",
"backend/app/services/policy_indexer.py","backend/app/models/analysis.py","backend/app/models/notification_log.py",
"backend/app/models/policy.py","backend/app/models/policy_members.py","backend/app/models/service.py",
"backend/app/models/service_group.py","backend/app/schemas/device.py","backend/app/schemas/network_group.py",
"backend/app/schemas/network_object.py","backend/app/services/normalize.py","backend/app/schemas/notification_log.py",
"backend/app/models/pending_policy_change.py","backend/app/schemas/pending_policy_change.py",
"backend/app/schemas/service.py","backend/app/schemas/service_group.py","backend/app/models/settings.py",
"backend/app/schemas/settings.py","backend/app/models/sync_schedule.py","backend/app/schemas/sync_schedule.py",
"backend/app/models/change_log.py","backend/app/schemas/change_log.py","backend/app/models/deletion_workflow.py",
"backend/app/crud/crud_policy.py",
]
for fp in external_files:
    external_ok.add(f"file:{fp}")
external_ok.add("function:backend/app/services/audit_log.py:log_activity")
external_ok.add("function:backend/app/services/device_service.py:test_device_connection")
external_ok.add("function:backend/app/services/export/tasks.py:run_export_task")
external_ok.add("function:backend/app/services/policy_indexer.py:rebuild_policy_indices")
external_ok.add("function:backend/app/crud/crud_policy.py:get_policies_by_device")
external_ok.add("function:backend/app/crud/crud_policy.py:count_policies_by_device")
external_ok.add("function:backend/app/crud/crud_policy.py:search_policies")

bad = []
for e in edges_part1 + edges_part2:
    if e["source"] not in allnodeids and e["source"] not in external_ok:
        bad.append(("source", e))
    if e["target"] not in allnodeids and e["target"] not in external_ok:
        bad.append(("target", e))
print("bad edges:", len(bad))
for b in bad[:20]:
    print(b)
