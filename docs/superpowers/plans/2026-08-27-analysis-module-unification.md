# Analysis 페이지 모듈형 통합 Implementation Plan

> **상태: 구현 완료 (2026-08-27~28).** 이 계획은 subagent-driven-development로 실행되지 않고 세션 내에서 직접 구현·검증·커밋됐다. 아래 체크박스는 사후 검증(실제 파일/라우트/레지스트리 존재 확인)을 거쳐 일괄 완료 처리한 것으로, 태스크별 개별 실행 로그는 남아있지 않다. 최신 아키텍처 설명은 이 문서가 아닌 프로젝트 루트 `CLAUDE.md`가 정본(source of truth)이다 — 이후 구조가 바뀌면 이 문서는 갱신하지 않고 CLAUDE.md만 갱신한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** deletion_workflow를 별도 메뉴에서 Analysis 페이지 안으로 완전히 통합하고, 6개 분석 유형 + deletion_workflow를 레지스트리 기반 "모듈"로 관리해 향후 신규 분석 모듈 추가가 파일 하나 + 레지스트리 등록만으로 끝나게 한다.

**Architecture:** 백엔드는 `deletion_workflow_projects`/`deletion_workflow_files` 테이블을 `analysis_projects`/`analysis_project_files`로 일반화(`module_type` 컬럼 추가)하고, "프로젝트가 무엇인가"(CRUD)는 공용 라우터로, "프로젝트 안에서 무엇을 실행하는가"(fpat 파이프라인)는 기존 deletion_workflow 전용 라우터로 남긴다. 프론트엔드는 분석 유형별 UI(파라미터 폼/컬럼정의/요약)를 `analysis-modules/` 디렉토리의 개별 파일로 추출해 레지스트리로 등록하고, `AnalysisListPage`/`AnalysisDetailPage`는 이 레지스트리를 순회하도록 리팩터한다. deletion_workflow는 이 레지스트리의 "프로젝트형" 모듈 1개로 등록된다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Alembic + SQLite / React 19 + TypeScript + TanStack Query + React Router v6. 이 저장소에는 pytest/vitest 같은 자동 테스트 러너가 없다 — 백엔드 검증은 `python -c` 기반 직접 함수 호출 스모크 스크립트(기존 관례, 이전 세션에서 사용한 패턴)로, 프론트엔드 검증은 `npm run build`(tsc 타입체크 포함) + `npm run lint`로 한다. 각 태스크의 "테스트" 단계는 이 방식을 따른다.

**Spec:** `docs/superpowers/specs/2026-08-27-analysis-module-unification-design.md`

## Global Constraints

- DB 스키마 변경은 반드시 Alembic 마이그레이션 사용, `python backend/migrate.py`로 적용 (CLAUDE.md)
- 백엔드 임포트는 `app/` 루트 기준 절대경로 (CLAUDE.md)
- BackgroundTasks에는 요청 스코프 세션을 전달하지 않고 태스크 내부에서 자체 `SessionLocal()` 개설 (CLAUDE.md)
- 프론트 쿼리키는 반드시 `src/api/queryKeys.ts` 팩토리만 사용 (CLAUDE.md)
- 파이프라인 실행 로직(processors/WorkspaceRunner)은 모듈 간 공통화하지 않는다 (spec 범위 결정)
- 이력 목록의 "전체" 필터는 quick 분석 + 모든 project형 모듈의 프로젝트를 날짜순 병합해 보여준다 (프론트 클라이언트 사이드 병합, 백엔드 UNION 없음) (spec 범위 결정)
- `/deletion-workflow/legacy`(단발 실행 페이지)의 통합은 이번 범위 밖 (spec 비범위)

---

## Task 1: 백엔드 — 모델 rename + module_type 컬럼 + AnalysisTask 필드 rename (마이그레이션)

**Files:**
- Create: `backend/app/models/analysis_project.py`
- Delete: `backend/app/models/deletion_workflow.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/analysis.py`
- Create: `backend/alembic/versions/<new>_rename_deletion_workflow_to_analysis_project.py`

**Interfaces:**
- Produces: `AnalysisProject`(`analysis_projects` 테이블 — id, device_id, name, status, memo, reference_date, module_type, created_at, updated_at, `files` relationship), `AnalysisProjectFile`(`analysis_project_files` 테이블 — id, project_id, task_id, slot, filename, file_data, created_at, analysis_task_id, `project` relationship)
- Produces: `AnalysisTask.analysis_project_id`(이전 `deletion_workflow_project_id`), `AnalysisTask.analysis_project` relationship(이전 `deletion_workflow_project`)

- [x] **Step 1: `app/models/deletion_workflow.py` 내용을 `app/models/analysis_project.py`로 이동하며 일반화**

`backend/app/models/deletion_workflow.py`의 현재 내용(`DeletionWorkflowProject`/`DeletionWorkflowFile`)을 다음으로 바꿔 `backend/app/models/analysis_project.py`에 새로 작성:

```python
from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, LargeBinary, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.session import Base
import datetime


class AnalysisProject(Base):
    """프로젝트형 분석 모듈(예: deletion_workflow)의 프로젝트.

    module_type으로 어느 모듈에 속하는지 구분한다. 여러 모듈이 이 테이블을 공유하며,
    파이프라인 실행 로직 자체는 각 모듈의 서비스 패키지(예: services/deletion_workflow/)에
    남아있고 이 테이블은 "프로젝트가 무엇인가"(이름/상태/기준일/파일)만 다룬다.
    """
    __tablename__ = "analysis_projects"

    id = Column(Integer, primary_key=True, index=True)
    module_type = Column(String, nullable=False, index=True)  # 예: "deletion_workflow"
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    name = Column(String, nullable=False)
    status = Column(String, default="draft", nullable=False)  # draft/running/completed
    memo = Column(String, nullable=True)
    reference_date = Column(Date, nullable=True)  # 기준일: None이면 실행 시점 현재 날짜 사용

    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    device = relationship("Device")
    files = relationship("AnalysisProjectFile", cascade="all, delete-orphan", back_populates="project")


class AnalysisProjectFile(Base):
    __tablename__ = "analysis_project_files"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("analysis_projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(Integer, nullable=False)    # 모듈 내부 단계 번호 (모듈마다 의미가 다름)
    slot = Column(String, nullable=False)         # output_0 / output_1 / external_1 / external_2
    filename = Column(String, nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)

    # 이 파일을 생성한 분석 실행(AnalysisTask)에 대한 참조. 이력 추적용이며,
    # 이 컬럼 추가 이전에 생성된 기존 파일과의 호환을 위해 nullable이다.
    analysis_task_id = Column(Integer, ForeignKey("analysistasks.id", ondelete="SET NULL"), nullable=True)

    project = relationship("AnalysisProject", back_populates="files")

    __table_args__ = (
        UniqueConstraint("project_id", "task_id", "slot", name="uq_project_task_slot"),
    )
```

- [x] **Step 2: `backend/app/models/deletion_workflow.py` 삭제**

```bash
rm backend/app/models/deletion_workflow.py
```

- [x] **Step 3: `backend/app/models/__init__.py` import 갱신**

`backend/app/models/__init__.py:15`의 다음 줄:
```python
from .deletion_workflow import DeletionWorkflowProject, DeletionWorkflowFile
```
을 다음으로 교체:
```python
from .analysis_project import AnalysisProject, AnalysisProjectFile
```

- [x] **Step 4: `backend/app/models/analysis.py`의 `AnalysisTask` 필드 rename**

`backend/app/models/analysis.py`에서 다음 두 줄:
```python
    pipeline_task_id = Column(Integer, nullable=True)
    deletion_workflow_project_id = Column(Integer, ForeignKey("deletion_workflow_projects.id", ondelete="CASCADE"), nullable=True)

    device = relationship("Device")
    deletion_workflow_project = relationship("DeletionWorkflowProject")
```
을 다음으로 교체:
```python
    pipeline_task_id = Column(Integer, nullable=True)
    analysis_project_id = Column(Integer, ForeignKey("analysis_projects.id", ondelete="CASCADE"), nullable=True)

    device = relationship("Device")
    analysis_project = relationship("AnalysisProject")
```

- [x] **Step 5: 모델 임포트 검증**

```bash
source .venv/bin/activate && cd backend && python -c "
from app.models.analysis_project import AnalysisProject, AnalysisProjectFile
from app.models.analysis import AnalysisTask
print('columns:', [c.name for c in AnalysisTask.__table__.columns])
assert 'analysis_project_id' in [c.name for c in AnalysisTask.__table__.columns]
assert 'module_type' in [c.name for c in AnalysisProject.__table__.columns]
print('OK')
"
```
Expected: `OK` 출력, `deletion_workflow` 문자열이 컬럼명에 없음.

- [x] **Step 6: 마이그레이션 작성 (autogenerate 대신 수동 작성 — rename은 autogenerate가 drop+create로 오인식)**

```bash
source .venv/bin/activate && cd backend && python -m alembic revision -m "rename deletion_workflow tables to analysis_project"
```

생성된 파일의 `upgrade`/`downgrade`를 다음으로 채운다(파일명의 revision id는 자동 생성된 값을 그대로 쓰고, `down_revision`은 직전 head인 `7beff9969c59`로 맞춘다 — `python -m alembic heads`로 현재 head 확인 후 일치시킬 것):

```python
def upgrade() -> None:
    """Rename deletion_workflow_* tables to generic analysis_project_* tables
    and add module_type so other project-type analysis modules can share them."""
    op.rename_table('deletion_workflow_projects', 'analysis_projects')
    op.rename_table('deletion_workflow_files', 'analysis_project_files')

    with op.batch_alter_table('analysis_projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('module_type', sa.String(), nullable=False, server_default='deletion_workflow'))
        batch_op.create_index(batch_op.f('ix_analysis_projects_module_type'), ['module_type'], unique=False)

    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.drop_constraint(
            'fk_analysistasks_deletion_workflow_project_id_deletion_workflow_projects',
            type_='foreignkey',
        )
        batch_op.alter_column('deletion_workflow_project_id', new_column_name='analysis_project_id')
        batch_op.create_foreign_key(
            'fk_analysistasks_analysis_project_id_analysis_projects',
            'analysis_projects', ['analysis_project_id'], ['id'], ondelete='CASCADE',
        )


def downgrade() -> None:
    """Revert analysis_project_* tables back to deletion_workflow_*."""
    with op.batch_alter_table('analysistasks', schema=None) as batch_op:
        batch_op.drop_constraint(
            'fk_analysistasks_analysis_project_id_analysis_projects',
            type_='foreignkey',
        )
        batch_op.alter_column('analysis_project_id', new_column_name='deletion_workflow_project_id')
        batch_op.create_foreign_key(
            'fk_analysistasks_deletion_workflow_project_id_deletion_workflow_projects',
            'deletion_workflow_projects', ['deletion_workflow_project_id'], ['id'], ondelete='CASCADE',
        )

    with op.batch_alter_table('analysis_projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_analysis_projects_module_type'))
        batch_op.drop_column('module_type')

    op.rename_table('analysis_project_files', 'deletion_workflow_files')
    op.rename_table('analysis_projects', 'deletion_workflow_projects')
```

`import sqlalchemy as sa`가 파일 상단에 있는지 확인(`alembic revision`이 기본 생성하는 템플릿에 이미 포함됨).

- [x] **Step 7: 마이그레이션 적용 및 스키마 확인**

```bash
cd /Users/hoon/Code/firewall-analysis-tool && source .venv/bin/activate && python backend/migrate.py
sqlite3 backend/fat.db ".schema analysis_projects" ".schema analysis_project_files"
sqlite3 backend/fat.db "select sql from sqlite_master where name='analysistasks'"
```
Expected: `analysis_projects`에 `module_type` 컬럼 존재, `analysistasks` 스키마에 `analysis_project_id` 컬럼과 `analysis_projects` 참조 FK 존재. `deletion_workflow_projects`/`deletion_workflow_files` 테이블은 더 이상 존재하지 않음(`.tables`로 확인).

- [x] **Step 8: Commit**

```bash
git add backend/app/models/analysis_project.py backend/app/models/__init__.py backend/app/models/analysis.py backend/alembic/versions/
git rm backend/app/models/deletion_workflow.py
git commit -m "refactor: deletion_workflow 테이블을 analysis_project로 일반화 (모델+마이그레이션)"
```

---

## Task 2: 백엔드 — CRUD rename + module_type 파라미터화

**Files:**
- Create: `backend/app/crud/crud_analysis_project.py`
- Delete: `backend/app/crud/crud_deletion_workflow.py`
- Modify: `backend/app/crud/crud_analysis.py`

**Interfaces:**
- Consumes: Task 1의 `AnalysisProject`/`AnalysisProjectFile` 모델
- Produces: `crud_analysis_project.create_project(db, module_type, device_id, name, memo=None, reference_date=None)`, `.list_projects(db, module_type, device_id=None)`, `.get_project(db, project_id)`, `.delete_project(db, project_id)`, `.update_project_status(db, project, status)`, `.update_project(db, project, memo=_UNSET, reference_date=_UNSET)`, `.upsert_file(db, project_id, task_id, slot, filename, data, analysis_task_id=None)`, `.get_file(db, project_id, task_id, slot)`, `.get_project_files(db, project_id)`, `.clear_output_files(db, project_id, task_ids=None)`, `.clear_all_files(db, project_id)`
- Produces: `crud_analysis.get_running_analysis_task_by_project(db, project_id)`(내부에서 `analysis_project_id` 참조), `crud_analysis.list_analysis_tasks_paginated(..., analysis_project_id=None)`(파라미터명 변경) — 그리고 신규로, 명시적 `task_type` 필터가 없을 때 프로젝트형 모듈의 task_type을 자동 제외하는 로직 추가

- [x] **Step 1: `crud_deletion_workflow.py`를 `crud_analysis_project.py`로 복사 후 일반화**

`backend/app/crud/crud_deletion_workflow.py`를 읽어(이미 알고 있는 현재 내용) 다음 변경을 적용해 `backend/app/crud/crud_analysis_project.py`로 새로 작성한다:

1. import 변경:
```python
from app.models.analysis import AnalysisTask
from app.models.analysis_project import AnalysisProjectFile, AnalysisProject
```
2. 모든 `DeletionWorkflowProject`→`AnalysisProject`, `DeletionWorkflowFile`→`AnalysisProjectFile` 치환.
3. `create_project`/`list_projects` 시그니처에 `module_type: str` 추가:

```python
async def create_project(
    db: AsyncSession,
    module_type: str,
    device_id: int,
    name: str,
    memo: Optional[str] = None,
    reference_date: Optional[datetime.date] = None,
) -> AnalysisProject:
    now = datetime.datetime.utcnow()
    project = AnalysisProject(
        module_type=module_type,
        device_id=device_id,
        name=name,
        memo=memo,
        reference_date=reference_date,
        status="draft",
        created_at=now,
        updated_at=now,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


async def list_projects(
    db: AsyncSession,
    module_type: str,
    device_id: Optional[int] = None,
) -> List[AnalysisProject]:
    q = select(AnalysisProject).where(AnalysisProject.module_type == module_type).order_by(AnalysisProject.created_at.desc())
    if device_id is not None:
        q = q.where(AnalysisProject.device_id == device_id)
    result = await db.execute(q)
    return list(result.scalars().all())
```

4. `delete_project`에서 `AnalysisTask.deletion_workflow_project_id`를 `AnalysisTask.analysis_project_id`로 변경(고아 행 정리 로직은 그대로 유지):
```python
async def delete_project(db: AsyncSession, project_id: int) -> None:
    await db.execute(
        delete(AnalysisProjectFile).where(AnalysisProjectFile.project_id == project_id)
    )
    await db.execute(
        delete(AnalysisTask).where(AnalysisTask.analysis_project_id == project_id)
    )
    await db.execute(
        delete(AnalysisProject).where(AnalysisProject.id == project_id)
    )
```

나머지 함수(`get_project`, `update_project_status`, `update_project`, `upsert_file`, `get_file`, `get_project_files`, `clear_output_files`, `clear_all_files`)는 클래스명 치환 외 로직 변경 없음.

- [x] **Step 2: `crud_deletion_workflow.py` 삭제**

```bash
rm backend/app/crud/crud_deletion_workflow.py
```

- [x] **Step 3: `crud_analysis.py` 필드/파라미터 rename + 프로젝트형 모듈 제외 로직 추가**

`backend/app/crud/crud_analysis.py`에서:

```python
async def get_running_analysis_task_by_project(db: AsyncSession, project_id: int) -> Optional[AnalysisTask]:
    """특정 analysis_project에서 진행 중인(IN_PROGRESS) 파이프라인 태스크를 조회합니다."""
    stmt = select(AnalysisTask).filter(
        AnalysisTask.task_status == AnalysisTaskStatus.IN_PROGRESS,
        AnalysisTask.analysis_project_id == project_id,
    )
    result = await db.execute(stmt)
    return result.scalars().first()
```

그리고 파일 상단 근처에 프로젝트형 모듈의 task_type 목록을 상수로 추가(신규 프로젝트형 모듈 추가 시 여기에 값만 더하면 됨):

```python
# 프로젝트형 분석 모듈(예: deletion_workflow)의 task_type 목록.
# list_analysis_tasks_paginated()가 명시적 타입 필터 없이 조회될 때(퀵 분석 이력 목록)
# 이 타입들의 실행 행(파이프라인 단계별로 여러 개 쌓임)을 자동으로 제외한다 —
# 이들은 프로젝트 단위로 별도 조회(analysis_projects 엔드포인트)된다.
PROJECT_MODULE_TASK_TYPES = {"deletion_workflow"}
```

`list_analysis_tasks_paginated`를 다음으로 교체:

```python
async def list_analysis_tasks_paginated(
    db: AsyncSession, *,
    device_id: Optional[int] = None,
    task_type: Optional[str] = None,
    task_status: Optional[str] = None,
    search: Optional[str] = None,
    analysis_project_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[AnalysisTask], int]:
    """분석 실행(task) 이력을 게시판 형태로 검색·페이지네이션 조회합니다.

    task_type이 명시되지 않고 analysis_project_id도 없으면(=퀵 분석 이력 목록 조회)
    PROJECT_MODULE_TASK_TYPES에 속한 실행은 자동으로 제외한다.
    """
    stmt = select(AnalysisTask).options(selectinload(AnalysisTask.device))
    count_stmt = select(func.count()).select_from(AnalysisTask)

    if search:
        stmt = stmt.join(Device, AnalysisTask.device_id == Device.id)
        count_stmt = count_stmt.join(Device, AnalysisTask.device_id == Device.id)

    conditions = []
    if device_id is not None:
        conditions.append(AnalysisTask.device_id == device_id)
    if task_type:
        conditions.append(AnalysisTask.task_type == task_type)
    elif analysis_project_id is None:
        conditions.append(AnalysisTask.task_type.notin_(PROJECT_MODULE_TASK_TYPES))
    if task_status:
        conditions.append(AnalysisTask.task_status == task_status)
    if analysis_project_id is not None:
        conditions.append(AnalysisTask.analysis_project_id == analysis_project_id)
    if search:
        conditions.append(Device.name.ilike(f"%{search}%"))

    if conditions:
        stmt = stmt.where(*conditions)
        count_stmt = count_stmt.where(*conditions)

    total = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(AnalysisTask.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    tasks = (await db.execute(stmt)).scalars().all()

    return tasks, total
```

- [x] **Step 4: 임포트 및 동작 검증**

```bash
source /Users/hoon/Code/firewall-analysis-tool/.venv/bin/activate && cd /Users/hoon/Code/firewall-analysis-tool/backend && python -c "
from app.crud import crud_analysis_project as apcrud
from app import crud
print('apcrud OK:', apcrud.create_project, apcrud.list_projects)
print('crud_analysis OK:', crud.analysis.get_running_analysis_task_by_project, crud.analysis.PROJECT_MODULE_TASK_TYPES)
"
```
Expected: 에러 없이 함수 참조 출력.

- [x] **Step 5: Commit**

```bash
git add backend/app/crud/crud_analysis_project.py backend/app/crud/crud_analysis.py
git rm backend/app/crud/crud_deletion_workflow.py
git commit -m "refactor: crud_deletion_workflow를 crud_analysis_project로 일반화, 퀵 이력에서 프로젝트형 모듈 제외"
```

---

## Task 3: 백엔드 — 공용 analysis_projects 엔드포인트 신설

**Files:**
- Create: `backend/app/api/api_v1/endpoints/analysis_projects.py`
- Modify: `backend/app/api/api_v1/api.py`

**Interfaces:**
- Consumes: Task 2의 `crud_analysis_project` 함수들, `crud.analysis.list_analysis_tasks_paginated`
- Produces: `GET/POST /api/v1/analysis/projects`, `GET/DELETE/PATCH /api/v1/analysis/projects/{project_id}`, `GET /api/v1/analysis/projects/{project_id}/tasks`, `GET /api/v1/analysis/projects/{project_id}/tasks/{analysis_task_id}/result`

- [x] **Step 1: 새 엔드포인트 파일 작성**

`backend/app/api/api_v1/endpoints/analysis_projects.py`를 다음 내용으로 작성한다. 기존 `deletion_workflow.py`의 `list_projects`/`create_project`/`get_project`(상세)/`delete_project`/`update_project`/`list_project_pipeline_tasks`/`get_pipeline_task_result` 로직을 module_type 인자를 받도록 일반화해 옮긴 것이다:

```python
# app/api/api_v1/endpoints/analysis_projects.py
"""
프로젝트형 분석 모듈(예: deletion_workflow)의 공용 프로젝트 CRUD 엔드포인트.

"프로젝트가 무엇인가"(생성/조회/삭제/메모/기준일 수정, 실행 이력)만 다루며,
"프로젝트 안에서 무엇을 실행하는가"(파이프라인 단계 실행)는 모듈별 전용
엔드포인트(예: /deletion-workflow/projects/{id}/run)에 남아있다.
"""

import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Form, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app import crud
from app.crud import crud_analysis_project as apcrud

router = APIRouter()


def _project_dict(project, device) -> dict:
    return {
        "id": project.id,
        "module_type": project.module_type,
        "device_id": project.device_id,
        "device_name": device.name if device else str(project.device_id),
        "device_ip": device.ip_address if device else "",
        "name": project.name,
        "status": project.status,
        "memo": project.memo,
        "reference_date": project.reference_date.isoformat() if project.reference_date else None,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


@router.get("")
async def list_projects(
    module_type: str,
    device_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    """모듈 타입별 프로젝트 목록 조회."""
    projects = await apcrud.list_projects(db, module_type=module_type, device_id=device_id)
    result = []
    for p in projects:
        device = await crud.device.get_device(db=db, device_id=p.device_id)
        result.append(_project_dict(p, device))
    return result


@router.post("")
async def create_project(
    module_type: str = Form(...),
    device_id: int = Form(...),
    name: str = Form(...),
    memo: str = Form(default=""),
    reference_date: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
):
    """새 프로젝트 생성."""
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")

    parsed_ref_date = None
    if reference_date:
        try:
            parsed_ref_date = datetime.date.fromisoformat(reference_date)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"잘못된 날짜 형식: {reference_date} (YYYY-MM-DD 형식 사용)")

    project = await apcrud.create_project(
        db, module_type=module_type, device_id=device_id, name=name,
        memo=memo or None, reference_date=parsed_ref_date,
    )
    await db.commit()
    return _project_dict(project, device)


@router.get("/{project_id}")
async def get_project(project_id: int, db: AsyncSession = Depends(get_db)):
    """프로젝트 상세 조회 (파일 상태 포함)."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    device = await crud.device.get_device(db=db, device_id=project.device_id)
    files_map = await apcrud.get_project_files(db, project_id)

    file_states = [
        {
            "task_id": k[0],
            "slot": k[1],
            "filename": f.filename,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for k, f in sorted(files_map.items())
    ]

    data = _project_dict(project, device)
    data["device_vendor"] = device.vendor if device else ""
    data["files"] = file_states
    return data


@router.delete("/{project_id}")
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db)):
    """프로젝트 삭제 (파일 + 연관 AnalysisTask 실행 이력 cascade)."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    await apcrud.delete_project(db, project_id)
    await db.commit()
    return {"ok": True}


@router.patch("/{project_id}")
async def update_project(
    project_id: int,
    memo: Optional[str] = Form(default=None),
    reference_date: Optional[str] = Form(default=None),
    clear_reference_date: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 메모 또는 기준일을 수정합니다."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    kwargs = {}
    if memo is not None:
        kwargs["memo"] = memo
    if clear_reference_date:
        kwargs["reference_date"] = None
    elif reference_date is not None:
        try:
            kwargs["reference_date"] = datetime.date.fromisoformat(reference_date)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"잘못된 날짜 형식: {reference_date} (YYYY-MM-DD 형식 사용)")

    await apcrud.update_project(db, project, **kwargs)
    await db.commit()
    return {
        "id": project.id,
        "memo": project.memo,
        "reference_date": project.reference_date.isoformat() if project.reference_date else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


@router.get("/{project_id}/tasks")
async def list_project_pipeline_tasks(project_id: int, db: AsyncSession = Depends(get_db)):
    """프로젝트에 속한 파이프라인 태스크(AnalysisTask) 실행 이력을 조회합니다."""
    tasks, total = await crud.analysis.list_analysis_tasks_paginated(
        db, analysis_project_id=project_id, page=1, page_size=1000,
    )
    return {
        "total": total,
        "items": [
            {
                "id": t.id,
                "pipeline_task_id": t.pipeline_task_id,
                "task_status": t.task_status,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "started_at": t.started_at.isoformat() if t.started_at else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "error_message": t.error_message,
                "requested_by_username": t.requested_by_username,
            }
            for t in tasks
        ],
    }


@router.get("/{project_id}/tasks/{analysis_task_id}/result")
async def get_pipeline_task_result(
    project_id: int, analysis_task_id: int, db: AsyncSession = Depends(get_db),
):
    """특정 파이프라인 실행(analysis_task_id)이 저장한 출력 파일 목록을 반환합니다."""
    task = await crud.analysis.get_analysis_task(db, analysis_task_id)
    if not task or task.analysis_project_id != project_id:
        raise HTTPException(status_code=404, detail="해당 프로젝트의 실행을 찾을 수 없습니다.")

    files_map = await apcrud.get_project_files(db, project_id)
    outputs = [
        {"slot": k[1], "filename": f.filename}
        for k, f in sorted(files_map.items())
        if f.analysis_task_id == analysis_task_id
    ]
    return {
        "task_id": task.pipeline_task_id,
        "task_status": task.task_status,
        "error_message": task.error_message,
        "outputs": outputs,
    }
```

- [x] **Step 2: 라우터 등록**

`backend/app/api/api_v1/api.py`에서 import 목록에 `analysis_projects` 추가:
```python
from .endpoints import (
    devices, firewall_sync, firewall_query, export, analysis, analysis_projects,
    websocket, sync_schedule, settings, notifications, deletion_workflow,
    ...  # 기존 나머지 그대로
)
```
그리고 `analysis.router` 등록 줄 바로 아래에 추가:
```python
api_router.include_router(analysis.router, prefix="/analysis", tags=["analysis"], dependencies=_auth)
api_router.include_router(analysis_projects.router, prefix="/analysis/projects", tags=["analysis-projects"], dependencies=_auth)
```

- [x] **Step 3: 라우트 등록 검증**

```bash
source /Users/hoon/Code/firewall-analysis-tool/.venv/bin/activate && cd /Users/hoon/Code/firewall-analysis-tool/backend && python -c "
from app.main import app
schema = app.openapi()
paths = sorted(p for p in schema['paths'] if p.startswith('/api/v1/analysis/projects'))
for p in paths:
    print(p, list(schema['paths'][p].keys()))
"
```
Expected:
```
/api/v1/analysis/projects ['get', 'post']
/api/v1/analysis/projects/{project_id} ['get', 'delete', 'patch']
/api/v1/analysis/projects/{project_id}/tasks ['get']
/api/v1/analysis/projects/{project_id}/tasks/{analysis_task_id}/result ['get']
```

- [x] **Step 4: Commit**

```bash
git add backend/app/api/api_v1/endpoints/analysis_projects.py backend/app/api/api_v1/api.py
git commit -m "feat: 공용 analysis_projects 프로젝트 CRUD 엔드포인트 신설"
```

---

## Task 4: 백엔드 — deletion_workflow 엔드포인트/서비스 정리 (rename 반영 + 이관된 엔드포인트 제거)

**Files:**
- Modify: `backend/app/api/api_v1/endpoints/deletion_workflow.py`
- Modify: `backend/app/services/deletion_workflow/tasks.py`
- Modify: `backend/app/services/deletion_workflow/core/input_resolver.py`

**Interfaces:**
- Consumes: Task 2의 `crud_analysis_project`, Task 3의 신규 엔드포인트(프로젝트 CRUD는 이제 `/analysis/projects`로 이동했으므로 `deletion_workflow.py`에서 제거)
- Produces: `deletion_workflow.py`에는 실행 전용 엔드포인트만 남음 — `POST /projects/{id}/extract`, `POST /projects/{id}/tasks/{task_id}/upload`, `POST /projects/{id}/tasks/{task_id}/run`, `GET /projects/{id}/tasks/{task_id}/download`, `POST /projects/{id}/reset-outputs`, `POST /projects/{id}/reset-all`, `POST /projects/{id}/clear-outputs`, `POST /projects/{id}/complete` (+ 레거시 `GET /tasks`, `POST /tasks/{id}/execute`, `POST /extract`, `GET /redundancy-export/{device_id}`)

- [x] **Step 1: `input_resolver.py` 타입 임포트 변경**

`backend/app/services/deletion_workflow/core/input_resolver.py:37`의 다음 줄:
```python
from app.models.deletion_workflow import DeletionWorkflowFile
```
을 다음으로 교체:
```python
from app.models.analysis_project import AnalysisProjectFile
```
그리고 파일 내 `DeletionWorkflowFile` 타입 힌트 3곳(줄 50, 58, 62, 71, 79 부근)을 모두 `AnalysisProjectFile`로 치환한다.

- [x] **Step 2: `services/deletion_workflow/tasks.py` 임포트/필드명 갱신**

`backend/app/services/deletion_workflow/tasks.py`에서:
```python
from app.crud import crud_deletion_workflow as dwcrud
```
을
```python
from app.crud import crud_analysis_project as dwcrud
```
로 교체(변수 alias `dwcrud`는 파일 내 다른 호출부와의 일관성을 위해 그대로 유지 — "deletion workflow crud" 약어로 재해석). docstring 안의 `DeletionWorkflowFile` 언급(줄 7, 96 부근)도 `AnalysisProjectFile`로 갱신.

`_execute_pipeline_task` 내부에서 `project.device_id`/`project.status` 등 필드 접근은 컬럼명이 그대로이므로 변경 불필요. `dwcrud.get_project`/`dwcrud.upsert_file`/`dwcrud.get_project_files`/`dwcrud.update_project_status`/`dwcrud.clear_output_files` 호출부도 시그니처가 동일하므로 변경 불필요.

- [x] **Step 3: `endpoints/deletion_workflow.py`에서 이관된 프로젝트 CRUD 엔드포인트 제거**

다음 라우트 핸들러 함수 전체를 삭제한다(Task 3에서 `analysis_projects.py`로 이미 옮겨졌으므로):
- `@router.get("/projects")` `list_projects`
- `@router.post("/projects")` `create_project`
- `@router.get("/projects/{project_id}")` `get_project`
- `@router.delete("/projects/{project_id}")` `delete_project`
- `@router.patch("/projects/{project_id}")` `update_project`
- `@router.get("/projects/{project_id}/tasks")` `list_project_pipeline_tasks`
- `@router.get("/projects/{project_id}/tasks/{analysis_task_id}/result")` `get_pipeline_task_result`

- [x] **Step 4: 남은 실행 전용 엔드포인트들의 `crud_deletion_workflow` 참조를 `crud_analysis_project`로 교체**

파일 전체에서 `from app.crud import crud_deletion_workflow as dwcrud`(여러 함수 내부에 지역 임포트로 반복됨, 총 7곳: `project_extract`, `upload_external_file`, `run_project_task`, `list_project_pipeline_tasks`—Step3에서 삭제됨, `get_pipeline_task_result`—Step3에서 삭제됨, `download_task_file`, `reset_project_outputs`, `reset_all_project_files`, `clear_project_outputs`, `complete_project`)를 다음으로 일괄 교체:
```python
from app.crud import crud_analysis_project as dwcrud
```
(변수명 `dwcrud`는 그대로 유지해 호출부 코드는 변경 불필요.)

- [x] **Step 5: `_schedule_pipeline_task` 헬퍼의 필드명 갱신**

파일 상단 `_schedule_pipeline_task` 함수 내:
```python
            deletion_workflow_project_id=project_id,
```
를
```python
            analysis_project_id=project_id,
```
로 교체.

- [x] **Step 6: `run_project_task` 엔드포인트에서 프로젝트 조회 시 `dwcrud.get_project` 사용 확인**

`run_project_task`(및 `project_extract`)는 이미 `dwcrud.get_project(db, project_id)`로 프로젝트를 조회하고 있으므로(Step 4에서 alias를 유지했으니) 추가 변경 불필요. 단, 함수 시그니처에서 `project = await dwcrud.get_project(db, project_id)`가 이제 `AnalysisProject` 인스턴스를 반환함을 주석 등으로 남기지 않아도 무방(타입은 동적).

- [x] **Step 7: 전체 임포트 및 라우트 검증**

```bash
source /Users/hoon/Code/firewall-analysis-tool/.venv/bin/activate && cd /Users/hoon/Code/firewall-analysis-tool/backend && python -c "
from app.main import app
schema = app.openapi()
dw_paths = sorted(p for p in schema['paths'] if 'deletion-workflow' in p)
for p in dw_paths:
    print(p, list(schema['paths'][p].keys()))
assert '/api/v1/deletion-workflow/projects' not in dw_paths
assert '/api/v1/deletion-workflow/projects/{project_id}' not in dw_paths
print('OK — project CRUD 엔드포인트가 deletion-workflow 라우터에서 제거됨')
"
```
Expected: `/api/v1/deletion-workflow/projects/{project_id}/extract`, `.../upload`, `.../run`, `.../download`, `/reset-outputs`, `/reset-all`, `/clear-outputs`, `/complete`, `/tasks`, `/tasks/{task_id}/execute`, `/extract`, `/redundancy-export/{device_id}`만 남고 `OK` 출력.

- [x] **Step 8: Commit**

```bash
git add backend/app/api/api_v1/endpoints/deletion_workflow.py backend/app/services/deletion_workflow/tasks.py backend/app/services/deletion_workflow/core/input_resolver.py
git commit -m "refactor: deletion_workflow 엔드포인트에서 이관된 프로젝트 CRUD 제거, analysis_project 참조로 정리"
```

---

## Task 5: 백엔드 — 전체 파이프라인 스모크 검증

**Files:** 없음(검증 전용 태스크, 파일 변경 없음)

**Interfaces:**
- Consumes: Task 1~4의 모든 산출물

- [x] **Step 1: 프로젝트 생성 → Task 0 실행 → 결과 확인 → 삭제(고아 행 정리 포함) 스모크 스크립트 실행**

```bash
source /Users/hoon/Code/firewall-analysis-tool/.venv/bin/activate && cd /Users/hoon/Code/firewall-analysis-tool/backend && python3 -c "
import asyncio, datetime
from app.db.session import SessionLocal
from app.crud import crud_analysis_project as apcrud
from app import crud
from app.schemas.analysis import AnalysisTaskCreate
from app.models.analysis import AnalysisTaskType
from app.services.deletion_workflow.tasks import run_pipeline_task

async def main():
    async with SessionLocal() as db:
        project = await apcrud.create_project(db, module_type='deletion_workflow', device_id=1, name='plan-verify')
        await db.commit()
        pid = project.id
        task = await crud.analysis.create_analysis_task(db, obj_in=AnalysisTaskCreate(
            device_id=1, task_type=AnalysisTaskType.DELETION_WORKFLOW,
            pipeline_task_id=0, analysis_project_id=pid,
            created_at=datetime.datetime.now(), requested_by_username='plan-verify',
        ))
        tid = task.id
    await run_pipeline_task(tid, pid, 0, None, 'plan-verify')
    async with SessionLocal() as db:
        t = await crud.analysis.get_analysis_task(db, tid)
        assert t.task_status.value == 'success', t.error_message
        files = await apcrud.get_project_files(db, pid)
        assert files[(0, 'output_0')].analysis_task_id == tid
        print('pipeline run OK:', t.task_status, files[(0, 'output_0')].filename)

        # 퀵 이력 목록에서 deletion_workflow 실행이 자동 제외되는지 확인
        tasks, total = await crud.analysis.list_analysis_tasks_paginated(db, page=1, page_size=50)
        assert tid not in [x.id for x in tasks], '퀵 이력 목록에 프로젝트형 실행이 섞여 있음'
        print('quick list exclusion OK (total=%d)' % total)

        await apcrud.delete_project(db, pid)
        await db.commit()
        assert await crud.analysis.get_analysis_task(db, tid) is None
        print('orphan cleanup OK')

asyncio.run(main())
"
```
Expected: `pipeline run OK: ...`, `quick list exclusion OK (...)`, `orphan cleanup OK` 모두 출력, AssertionError 없음.

- [x] **Step 2: `python backend/migrate.py current`로 head 확인**

```bash
cd /Users/hoon/Code/firewall-analysis-tool && source .venv/bin/activate && python backend/migrate.py current
```
Expected: Task 1에서 만든 새 revision이 `(head)`로 표시됨.

---

## Task 6: 프론트엔드 — 공용 analysisProjects API 클라이언트 + 모듈 레지스트리 타입 스캐폴딩

**Files:**
- Create: `frontend/src/api/analysisProjects.ts`
- Create: `frontend/src/components/pages/analysis-modules/types.ts`
- Modify: `frontend/src/api/queryKeys.ts`

**Interfaces:**
- Produces: `AnalysisProject`/`AnalysisProjectDetail`/`ProjectFileState` 타입, `listAnalysisProjects(moduleType, deviceId?)`, `createAnalysisProject(moduleType, deviceId, name, memo?, referenceDate?)`, `getAnalysisProject(id)`, `deleteAnalysisProject(id)`, `updateAnalysisProject(id, patch)`, `listProjectPipelineTasks(projectId)`, `getProjectPipelineTaskResult(projectId, analysisTaskId)`
- Produces: `queryKeys.analysisProjects(moduleType)`, `queryKeys.analysisProject(projectId)`, `queryKeys.analysisProjectTasks(projectId)`
- Produces: `QuickAnalysisModule`/`ProjectAnalysisModule`/`AnalysisModule` 타입 (다음 태스크들이 이 타입을 구현한다)

- [x] **Step 1: `frontend/src/api/analysisProjects.ts` 작성**

```typescript
import { apiClient } from './client'

export interface AnalysisProject {
  id: number
  module_type: string
  device_id: number
  device_name: string
  device_ip: string
  name: string
  status: string  // draft / running / completed
  memo: string | null
  reference_date: string | null
  created_at: string
  updated_at: string
}

export interface ProjectFileState {
  task_id: number
  slot: string
  filename: string
  created_at: string
}

export interface AnalysisProjectDetail extends AnalysisProject {
  device_vendor: string
  files: ProjectFileState[]
}

export interface ProjectPipelineTaskListItem {
  id: number
  pipeline_task_id: number | null
  task_status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  requested_by_username: string | null
}

export const listAnalysisProjects = async (
  moduleType: string,
  deviceId?: number,
): Promise<AnalysisProject[]> => {
  const params: Record<string, string | number> = { module_type: moduleType }
  if (deviceId !== undefined) params.device_id = deviceId
  const res = await apiClient.get<AnalysisProject[]>('/analysis/projects', { params })
  return res.data
}

export const createAnalysisProject = async (
  moduleType: string,
  deviceId: number,
  name: string,
  memo?: string,
  referenceDate?: string,
): Promise<AnalysisProject> => {
  const form = new URLSearchParams()
  form.set('module_type', moduleType)
  form.set('device_id', String(deviceId))
  form.set('name', name)
  if (memo) form.set('memo', memo)
  if (referenceDate) form.set('reference_date', referenceDate)
  const res = await apiClient.post<AnalysisProject>('/analysis/projects', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}

export const getAnalysisProject = async (id: number): Promise<AnalysisProjectDetail> => {
  const res = await apiClient.get<AnalysisProjectDetail>(`/analysis/projects/${id}`)
  return res.data
}

export const deleteAnalysisProject = async (id: number): Promise<void> => {
  await apiClient.delete(`/analysis/projects/${id}`)
}

export const updateAnalysisProject = async (
  id: number,
  patch: { memo?: string; reference_date?: string | null },
): Promise<{ id: number; memo: string | null; reference_date: string | null; updated_at: string }> => {
  const form = new URLSearchParams()
  if (patch.memo !== undefined) form.set('memo', patch.memo ?? '')
  if (patch.reference_date !== undefined) {
    if (patch.reference_date === null) {
      form.set('clear_reference_date', 'true')
    } else {
      form.set('reference_date', patch.reference_date)
    }
  }
  const res = await apiClient.patch(`/analysis/projects/${id}`, form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}

export const listProjectPipelineTasks = async (
  projectId: number,
): Promise<{ total: number; items: ProjectPipelineTaskListItem[] }> => {
  const res = await apiClient.get(`/analysis/projects/${projectId}/tasks`)
  return res.data
}

export interface ProjectPipelineTaskResult {
  task_id: number
  task_status: string
  error_message: string | null
  outputs: { slot: string; filename: string }[]
}

export const getProjectPipelineTaskResult = async (
  projectId: number,
  analysisTaskId: number,
): Promise<ProjectPipelineTaskResult> => {
  const res = await apiClient.get<ProjectPipelineTaskResult>(
    `/analysis/projects/${projectId}/tasks/${analysisTaskId}/result`
  )
  return res.data
}
```

주의: 기존 `frontend/src/api/deletionWorkflow.ts`의 form 전송 함수들은 `fetch()` + `useAuthStore` 토큰 헤더 수동 조립 패턴을 쓰지만, 이 파일은 이미 인증 헤더 인터셉터가 붙어있는 `apiClient`(axios 인스턴스)를 사용한다 — `src/api/client.ts`의 요청 인터셉터가 Bearer 토큰을 자동 주입하므로 더 짧고 이 프로젝트의 다른 신규 API 클라이언트(`api/analysis.ts`)와 일관된 스타일이다.

- [x] **Step 2: `frontend/src/api/queryKeys.ts`에 키 추가**

`frontend/src/api/queryKeys.ts`의 "삭제 워크플로우" 섹션 위(또는 "분석" 섹션 안)에 추가:
```typescript
  analysisProjects: (moduleType: string) => ['analysis-projects', moduleType] as const,
  analysisProject: (projectId: number | string | undefined) => ['analysis-project', projectId] as const,
  analysisProjectTasks: (projectId: number | string | undefined) => ['analysis-project-tasks', projectId] as const,
```

- [x] **Step 3: `frontend/src/components/pages/analysis-modules/types.ts` 작성**

```typescript
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ColDef, RowStyle, RowClassParams } from '@ag-grid-community/core'
import type { StartAnalysisParams } from '@/api/analysis'

/** "새 분석 실행" 다이얼로그의 파라미터 폼이 공유하는 상태 컨텍스트. */
export interface QuickModuleParamsContext {
  deviceId: number | null
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
}

/** 장비+파라미터 선택 → 실행 → 그리드 결과 하나를 보는 단발성 분석 모듈. */
export interface QuickAnalysisModule {
  kind: 'quick'
  type: string
  label: string
  icon: LucideIcon
  description: string
  /** 기본 파라미터(장비 선택) 외 이 모듈만의 추가 입력 UI. 없으면 생략. */
  renderParams?: (ctx: QuickModuleParamsContext) => ReactNode
  /** ctx.values로부터 실제 API 호출 파라미터를 구성. */
  buildParams: (ctx: QuickModuleParamsContext) => StartAnalysisParams
  /** 실행 전 검증. 에러 메시지 문자열을 반환하면 실행이 막히고 토스트로 표시된다. */
  validate?: (ctx: QuickModuleParamsContext) => string | null
  columns: (
    onRuleNameClick: (ruleName: string) => void,
    onPreviewClick: (row: Record<string, unknown>) => void,
  ) => ColDef[]
  summary: (results: Record<string, unknown>[]) => string
  rowStyle?: (p: RowClassParams<Record<string, unknown>>) => RowStyle | undefined
  downloadScript?: (
    results: Record<string, unknown>[],
    device: { name: string; vendor: string },
  ) => { filename: string; content: string } | null
}

/** 프로젝트 생성 → 여러 단계 순차 실행(위저드) → 완료의 프로젝트형 분석 모듈. */
export interface ProjectAnalysisModule {
  kind: 'project'
  type: string  // module_type 값 (analysis_projects.module_type과 일치)
  label: string
  icon: LucideIcon
  description: string
}

export type AnalysisModule = QuickAnalysisModule | ProjectAnalysisModule
```

- [x] **Step 4: 타입체크로 검증**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npx tsc --noEmit -p . 2>&1 | head -40
```
Expected: `analysisProjects.ts`/`types.ts` 관련 에러 없음(이 시점엔 아직 아무도 이 파일들을 사용하지 않으므로 기존 에러도 없어야 함).

- [x] **Step 5: Commit**

```bash
git add frontend/src/api/analysisProjects.ts frontend/src/api/queryKeys.ts frontend/src/components/pages/analysis-modules/types.ts
git commit -m "feat: 공용 analysisProjects API 클라이언트 + 분석 모듈 레지스트리 타입 스캐폴딩"
```

---

## Task 7: 프론트엔드 — quick 모듈 추출 (redundancy, unused, impact)

**Files:**
- Create: `frontend/src/components/pages/analysis-modules/redundancy.tsx`
- Create: `frontend/src/components/pages/analysis-modules/unused.tsx`
- Create: `frontend/src/components/pages/analysis-modules/impact.tsx`

**Interfaces:**
- Consumes: Task 6의 `QuickAnalysisModule` 타입
- Produces: `redundancyModule`, `unusedModule`, `impactModule` (다음 태스크의 레지스트리 index.ts가 import)

이 태스크는 `AnalysisListPage.tsx`(현재 `ANALYSIS_TYPES` 배열, `CreateAnalysisDialog`의 유형별 분기)와 `AnalysisDetailPage.tsx`(현재 `getColumnDefs`/`ResultSummary`의 `analysisType === '...'` 분기, `buildPaloAltoMoveScript`)에 흩어진 로직을 유형별로 옮겨오는 작업이다. 기존 두 페이지 파일은 Task 9~10에서 이 모듈들을 소비하도록 리팩터되며, 이 태스크에서는 아직 어디서도 import되지 않으므로 기존 페이지 동작에는 영향이 없다.

- [x] **Step 1: `redundancy.tsx` 작성**

```tsx
import { Copy, Check } from 'lucide-react'
import type { ColDef, RowClassParams } from '@ag-grid-community/core'
import { formatNumber } from '@/lib/utils'
import { makePolicyCols } from './policyColumns'
import type { QuickAnalysisModule } from './types'

export const redundancyModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'redundancy',
  label: '중복 정책 분석',
  icon: Copy,
  description: '동일하거나 포함 관계에 있는 정책을 탐지합니다. 상위/하위 정책 쌍으로 결과를 보여줍니다.',
  buildParams: () => ({}),
  columns: (onRuleNameClick): ColDef[] => [
    { field: 'set_number', headerName: '중복번호', filter: 'agNumberColumnFilter', pinned: 'left', width: 100, valueFormatter: (p) => formatNumber(p.value) },
    {
      field: 'type', headerName: '구분', filter: 'agTextColumnFilter', pinned: 'left', width: 100,
      valueFormatter: (p) => p.value === 'UPPER' ? '상위 정책' : p.value === 'LOWER' ? '하위 정책' : p.value ?? '',
      cellStyle: (p) => {
        if (p.value === 'UPPER') return { color: '#005bc4', fontWeight: '500' }
        if (p.value === 'LOWER') return { color: '#b26b00', fontWeight: '500' }
        return null
      },
    },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => {
    const sets = new Set(r.map((x) => x['set_number']))
    const upper = r.filter((x) => x['type'] === 'UPPER').length
    const lower = r.filter((x) => x['type'] === 'LOWER').length
    return `${sets.size}개 중복 세트 발견 (상위 ${upper}건 / 하위 ${lower}건)`
  },
  rowStyle: (p: RowClassParams<Record<string, unknown>>) => {
    if (!p.data) return undefined
    if (p.data.type === 'UPPER') return { backgroundColor: '#e8f4fd' }
    if (p.data.type === 'LOWER') return { backgroundColor: '#fff8e1' }
    return undefined
  },
}

// Check는 AnalysisListPage의 선택 카드 UI에서 쓰이던 아이콘이라 이 모듈에선 사용하지 않지만,
// import 정리를 위해 남기지 않는다 — 실제로는 아래 줄처럼 미사용 임포트를 제거해야 한다.
```

주의: 위 코드 블록 맨 아래 `Check` 관련 주석은 실수 방지용 메모다. 실제 작성 시 `import { Copy, Check } from 'lucide-react'`가 아니라 **`import { Copy } from 'lucide-react'`**로 `Check`를 빼고 작성한다(ESLint `no-unused-vars`에 걸림).

- [x] **Step 2: `unused.tsx` 작성**

```tsx
import { Clock } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { makePolicyCols } from './policyColumns'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

export const unusedModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'unused',
  label: '미사용 정책 분석',
  icon: Clock,
  description: '설정 기간 동안 트래픽이 발생하지 않은 정책을 탐지합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">미사용 기준 (일)</label>
      <input
        type="number" min="1"
        value={String(ctx.values.days ?? '90')}
        onChange={(e) => ctx.setValue('days', e.target.value)}
        className="w-32 h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
      />
    </div>
  ),
  buildParams: (ctx) => ({ days: Number(ctx.values.days ?? '90') }),
  columns: (onRuleNameClick): ColDef[] => [
    { field: 'reason', headerName: '미사용 사유', filter: 'agTextColumnFilter', pinned: 'left', width: 150 },
    { field: 'days_unused', headerName: '미사용 일수', filter: 'agNumberColumnFilter', width: 120, valueFormatter: (p) => p.value ? `${p.value}일` : '-' },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => `미사용 정책 ${r.length}건`,
}
```

- [x] **Step 3: `impact.tsx` 작성**

이 모듈은 `PolicyGridPicker`(이동할 정책 다중선택)와 `기준 정책`/`이동 방향`/`맨 아래로 이동` 체크박스, 그리고 `AnalysisDetailPage`의 `ImpactMovePreviewDialog` 연동 및 `buildPaloAltoMoveScript`(팔로알토 이동 스크립트 다운로드)를 함께 옮긴다:

```tsx
import { ArrowLeftRight } from 'lucide-react'
import type { ColDef, RowClassParams } from '@ag-grid-community/core'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PolicyGridPicker } from '@/components/shared/PolicyGridPicker'
import { makePolicyCols } from './policyColumns'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

const MOVE_FEASIBILITY_LABELS: Record<string, { label: string; style: { color: string; fontWeight: string } }> = {
  full:    { label: '가능',    style: { color: '#1f7a4d', fontWeight: '600' } },
  partial: { label: '부분 가능', style: { color: '#b26b00', fontWeight: '600' } },
  blocked: { label: '불가',    style: { color: '#9f403d', fontWeight: '600' } },
}

export const impactModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'impact',
  label: '정책 이동 영향 분석',
  icon: ArrowLeftRight,
  description: '정책을 다른 순번으로 이동했을 때 차단·섀도우 영향을 사전 분석합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    const referencePolicyId = (ctx.values.referencePolicyId as number | null | undefined) ?? null
    const moveToEnd = Boolean(ctx.values.moveToEnd)
    const moveDirection = (ctx.values.moveDirection as string | undefined) ?? 'below'
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">이동할 정책 *</label>
          <PolicyGridPicker
            mode="multi" deviceId={ctx.deviceId} value={targetPolicyIds}
            onChange={(ids) => ctx.setValue('targetPolicyIds', ids)}
            placeholder="이동할 정책을 선택하세요…"
          />
        </div>
        <div className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">기준 정책 *</label>
            <PolicyGridPicker
              mode="single" deviceId={moveToEnd ? null : ctx.deviceId} value={referencePolicyId}
              onChange={(id) => ctx.setValue('referencePolicyId', id)}
              placeholder="기준 정책을 선택하세요…"
            />
            <label className="flex items-center gap-2 text-[12px] text-ds-on-surface-variant cursor-pointer pt-0.5">
              <Checkbox checked={moveToEnd} onCheckedChange={(v) => ctx.setValue('moveToEnd', !!v)} />
              맨 아래로 이동
            </label>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">이동 방향</label>
            <ShadSelect value={moveDirection} onValueChange={(v) => ctx.setValue('moveDirection', v)} disabled={moveToEnd}>
              <SelectTrigger className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm">
                <SelectValue placeholder="이동 방향 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above">기준 정책 위로</SelectItem>
                <SelectItem value="below">기준 정책 아래로</SelectItem>
              </SelectContent>
            </ShadSelect>
          </div>
        </div>
      </div>
    )
  },
  validate: (ctx) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    const referencePolicyId = ctx.values.referencePolicyId as number | null | undefined
    const moveToEnd = Boolean(ctx.values.moveToEnd)
    if (targetPolicyIds.length === 0) return '이동할 정책을 선택하세요.'
    if (!moveToEnd && !referencePolicyId) return '기준 정책을 선택하거나 "맨 아래로 이동"을 선택하세요.'
    return null
  },
  buildParams: (ctx) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    const referencePolicyId = ctx.values.referencePolicyId as number | null | undefined
    const moveToEnd = Boolean(ctx.values.moveToEnd)
    const moveDirection = (ctx.values.moveDirection as string | undefined) ?? 'below'
    return {
      targetPolicyIds,
      referencePolicyId: !moveToEnd && referencePolicyId ? referencePolicyId : undefined,
      moveDirection,
    }
  },
  columns: (onRuleNameClick, onPreviewClick): ColDef[] => [
    {
      field: 'impact_type', headerName: '영향 유형', filter: 'agTextColumnFilter', pinned: 'left', width: 150,
      cellStyle: (p) => {
        const v = String(p.value ?? '')
        if (v.includes('최대 안전')) return { color: '#1f7a4d', fontWeight: '600' }
        if (v.includes('차단')) return { color: '#9f403d', fontWeight: '500' }
        if (v.includes('Shadow')) return { color: '#b26b00', fontWeight: '500' }
        return null
      },
    },
    {
      field: 'move_feasibility', headerName: '이동 가능 여부', filter: 'agTextColumnFilter', pinned: 'left', width: 120,
      valueFormatter: (p) => MOVE_FEASIBILITY_LABELS[p.value as string]?.label ?? '',
      cellStyle: (p) => MOVE_FEASIBILITY_LABELS[p.value as string]?.style ?? null,
    },
    {
      headerName: '순서 미리보기', width: 110, pinned: 'left',
      cellRenderer: (p: { data?: Record<string, unknown> }) => {
        if (p.data?.impact_type !== '최대 안전 이동 위치') return null
        return (
          <button className="text-ds-primary underline-offset-2 hover:underline text-[12px]" onClick={() => onPreviewClick(p.data!)}>
            순서 보기
          </button>
        )
      },
    },
    { field: 'reason', headerName: '사유 / 이동 요약', filter: 'agTextColumnFilter', width: 420, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.5', paddingTop: '6px', paddingBottom: '6px', whiteSpace: 'normal' } },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => {
    const summaryRows = r.filter((x) => x['impact_type'] === '최대 안전 이동 위치')
    const full = summaryRows.filter((x) => x['move_feasibility'] === 'full').length
    const partial = summaryRows.filter((x) => x['move_feasibility'] === 'partial').length
    const blocked = summaryRows.filter((x) => x['move_feasibility'] === 'blocked').length
    return `이동 대상 ${summaryRows.length}건 (완전 가능 ${full} / 부분 가능 ${partial} / 불가 ${blocked})`
  },
  rowStyle: (p: RowClassParams<Record<string, unknown>>) => {
    if (!p.data) return undefined
    if (String(p.data.impact_type ?? '').includes('최대 안전')) return { backgroundColor: '#eaf6ee' }
    return undefined
  },
  downloadScript: (results, device) => {
    if (device.vendor !== 'paloalto') return null
    const rows = results.filter((r) => r['impact_type'] === '최대 안전 이동 위치')
    const groupedByVsys = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      const vsys = String((row['policy'] as Record<string, unknown> | undefined)?.['vsys'] ?? '')
      const list = groupedByVsys.get(vsys) ?? []
      list.push(row)
      groupedByVsys.set(vsys, list)
    }
    const lines: string[] = [
      `# ${device.name} 정책이동 실행 계획 (자동 생성 — 참고용)`,
      '# 분석 시점 스냅샷 기준입니다. 실제 룰베이스와 다를 수 있으니 반드시 검토 후 사용하세요.',
      '# commit은 주석 처리되어 있습니다 — 변경 확인 후 직접 주석을 해제해 실행하세요.',
      '',
      'configure',
    ]
    for (const [vsys, vsysRows] of groupedByVsys) {
      if (vsys) lines.push('', `edit vsys "${vsys}"`)
      for (const row of vsysRows) {
        const ruleName = String((row['policy'] as Record<string, unknown> | undefined)?.['rule_name'] ?? '')
        const feasibility = row['move_feasibility']
        if (feasibility === 'blocked') {
          lines.push(`# '${ruleName}' 이동 불가: ${String(row['reason'] ?? '')}`)
          continue
        }
        if (feasibility === 'full') {
          const referenceName = row['reference_policy_name'] as string | null
          if (!referenceName) {
            lines.push(`move rulebase security rules "${ruleName}" bottom`)
          } else {
            const position = row['requested_move_direction'] === 'above' ? 'before' : 'after'
            lines.push(`move rulebase security rules "${ruleName}" ${position} "${referenceName}"`)
          }
        } else if (feasibility === 'partial') {
          const anchorName = row['blocking_conflict_policy_name'] as string | null
          const position = row['move_direction'] === '아래로' ? 'before' : 'after'
          lines.push(`# 요청한 위치까지는 이동 불가 — 아래는 최대로 안전하게 이동 가능한 위치입니다.`)
          lines.push(`move rulebase security rules "${ruleName}" ${position} "${anchorName}"`)
        }
      }
      if (vsys) lines.push('exit')
    }
    lines.push('', '# commit', 'exit')
    return { filename: `이동계획_${device.name}.txt`, content: lines.join('\n') }
  },
}
```

- [x] **Step 4: `frontend/src/components/pages/analysis-modules/policyColumns.tsx` 공용 헬퍼 작성**

기존 `AnalysisDetailPage.tsx`의 `pv`/`makePolicyCols`를 그대로 옮긴다(6개 모듈 모두가 공유):

```tsx
import React from 'react'
import type { ColDef } from '@ag-grid-community/core'

// 모든 분석 엔진이 정책 데이터를 "policy" 키 아래에 감싸서 반환하므로,
// 중첩된 policy 서브객체에서 필드를 읽는 공용 valueGetter.
export const pv = (key: string) => (p: { data?: Record<string, unknown> }) =>
  (p.data?.policy as Record<string, unknown> | undefined)?.[key] ?? p.data?.[key]

export function makePolicyCols(onRuleNameClick?: (name: string) => void): ColDef[] {
  return [
    { headerName: '순번',        filter: 'agNumberColumnFilter', width: 70,  valueGetter: pv('seq') },
    {
      headerName: '정책명', filter: 'agTextColumnFilter', width: 160, valueGetter: pv('rule_name'),
      ...(onRuleNameClick && {
        cellRenderer: (p: { value: string }) => {
          if (!p.value) return null
          return (
            <button className="text-ds-primary underline-offset-2 hover:underline text-left w-full truncate" onClick={() => onRuleNameClick(p.value)}>
              {p.value}
            </button>
          )
        },
      }),
    },
    { headerName: '액션',        filter: 'agTextColumnFilter',   width: 80,  valueGetter: pv('action') },
    { headerName: '활성',        width: 70,  valueGetter: pv('enable'), valueFormatter: (p) => (p.value ? '활성' : '비활성') },
    { headerName: '출발지',      filter: 'agTextColumnFilter',   width: 200, valueGetter: pv('source') },
    { headerName: '목적지',      filter: 'agTextColumnFilter',   width: 200, valueGetter: pv('destination') },
    { headerName: '서비스',      filter: 'agTextColumnFilter',   width: 160, valueGetter: pv('service') },
    { headerName: '사용자',      filter: 'agTextColumnFilter',   width: 100, valueGetter: pv('user') },
    { headerName: '보안 프로파일', filter: 'agTextColumnFilter', width: 130, valueGetter: pv('security_profile') },
    { headerName: '카테고리',    filter: 'agTextColumnFilter',   width: 100, valueGetter: pv('category') },
    { headerName: '설명',        filter: 'agTextColumnFilter',   width: 150, valueGetter: pv('description') },
    { headerName: '마지막 사용일', filter: 'agTextColumnFilter', width: 130, valueGetter: pv('last_hit_date') },
    { headerName: 'VSYS',        filter: 'agTextColumnFilter',   width: 80,  valueGetter: pv('vsys') },
  ]
}
```
(`redundancy.tsx`/`unused.tsx`/`impact.tsx`의 import 경로 `./policyColumns`가 이 파일을 가리킨다 — 위 Step 1~3의 예시 코드에서 이미 이 경로로 import하고 있으므로 별도 수정 불필요.)

- [x] **Step 5: 타입체크**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npx tsc --noEmit -p . 2>&1 | head -60
```
Expected: 새로 만든 4개 파일에서 에러 없음. (아직 아무도 import하지 않으므로 unused-export 경고는 tsc 기본 설정에서 발생하지 않음 — eslint의 `no-unused-vars`도 export된 심볼에는 적용되지 않으므로 문제 없음)

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/pages/analysis-modules/redundancy.tsx frontend/src/components/pages/analysis-modules/unused.tsx frontend/src/components/pages/analysis-modules/impact.tsx frontend/src/components/pages/analysis-modules/policyColumns.tsx
git commit -m "feat: redundancy/unused/impact 분석 모듈 추출"
```

---

## Task 8: 프론트엔드 — quick 모듈 추출 (unreferenced_objects, risky_ports, over_permissive) + 레지스트리 조립

**Files:**
- Create: `frontend/src/components/pages/analysis-modules/unreferencedObjects.tsx`
- Create: `frontend/src/components/pages/analysis-modules/riskyPorts.tsx`
- Create: `frontend/src/components/pages/analysis-modules/overPermissive.tsx`
- Create: `frontend/src/components/pages/analysis-modules/PolicyMultiSelect.tsx`
- Create: `frontend/src/components/pages/analysis-modules/index.ts`

**Interfaces:**
- Consumes: Task 6의 타입, Task 7의 3개 모듈
- Produces: `unreferencedObjectsModule`, `riskyPortsModule`, `overPermissiveModule`, `ANALYSIS_MODULES: AnalysisModule[]`, `QUICK_MODULES: QuickAnalysisModule[]`, `PROJECT_MODULES: ProjectAnalysisModule[]`, `getModule(type: string): AnalysisModule | undefined`

- [x] **Step 1: `PolicyMultiSelect.tsx` 작성 (기존 `AnalysisListPage.tsx`의 동명 컴포넌트 이동)**

```tsx
import { useQuery } from '@tanstack/react-query'
import Select from 'react-select'
import { getPolicies } from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'

export function PolicyMultiSelect({ deviceId, value, onChange, placeholder }: {
  deviceId: number | null; value: number[]; onChange: (ids: number[]) => void; placeholder?: string
}) {
  const { data: policies = [], isLoading } = useQuery({
    queryKey: queryKeys.policiesRaw(deviceId),
    queryFn: () => getPolicies(deviceId!),
    enabled: !!deviceId, staleTime: 60_000,
  })
  const options = policies.map((p) => ({ value: p.id, label: `[${p.seq}] ${p.rule_name}` }))
  return (
    <Select
      isMulti isLoading={isLoading} options={options}
      value={options.filter((o) => value.includes(o.value))}
      onChange={(vals) => onChange(vals.map((v) => v.value))}
      placeholder={placeholder ?? '정책 선택…'} noOptionsMessage={() => '정책이 없습니다'}
      styles={{
        control: (b) => ({ ...b, fontSize: '14px', minHeight: '36px', borderColor: 'rgba(169,180,185,0.3)', backgroundColor: '#ffffff' }),
        menu: (b) => ({ ...b, fontSize: '14px' }),
      }}
    />
  )
}
```

- [x] **Step 2: `unreferencedObjects.tsx` 작성**

```tsx
import { Unlink } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import type { QuickAnalysisModule } from './types'

export const unreferencedObjectsModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'unreferenced_objects',
  label: '미참조 오브젝트 분석',
  icon: Unlink,
  description: '어떤 정책에도 사용되지 않는 네트워크/서비스 객체를 탐지합니다.',
  buildParams: () => ({}),
  columns: (): ColDef[] => [
    { field: 'object_name', headerName: '객체명', filter: 'agTextColumnFilter', pinned: 'left', width: 200 },
    {
      field: 'object_type', headerName: '객체 유형', filter: 'agTextColumnFilter', width: 150,
      valueFormatter: (p) => {
        const map: Record<string, string> = { network_object: '네트워크 객체', network_group: '네트워크 그룹', service: '서비스 객체', service_group: '서비스 그룹' }
        return map[p.value as string] ?? p.value
      },
    },
  ],
  summary: (r) => {
    const net = r.filter((x) => ['network_object', 'network_group'].includes(String(x['object_type'] ?? ''))).length
    const svc = r.filter((x) => ['service', 'service_group'].includes(String(x['object_type'] ?? ''))).length
    return `미참조 객체 ${r.length}건 (네트워크 ${net}건, 서비스 ${svc}건)`
  },
}
```

- [x] **Step 3: `riskyPorts.tsx` 작성 (정책 선택 파라미터 포함)**

```tsx
import { ShieldAlert } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { makePolicyCols } from './policyColumns'
import { PolicyMultiSelect } from './PolicyMultiSelect'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

export const riskyPortsModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'risky_ports',
  label: '위험 포트 분석',
  icon: ShieldAlert,
  description: 'Well-known 위험 포트(예: Telnet, FTP)가 허용된 정책을 탐지합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">분석 대상 정책 (미선택 시 전체)</label>
      <PolicyMultiSelect
        deviceId={ctx.deviceId}
        value={(ctx.values.targetPolicyIds as number[] | undefined) ?? []}
        onChange={(ids) => ctx.setValue('targetPolicyIds', ids)}
        placeholder="전체 정책 분석"
      />
    </div>
  ),
  buildParams: (ctx) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    return { targetPolicyIds: targetPolicyIds.length > 0 ? targetPolicyIds : undefined }
  },
  columns: (onRuleNameClick): ColDef[] => [
    {
      headerName: '위험 포트', filter: 'agTextColumnFilter', width: 200,
      cellStyle: { color: '#9f403d', fontWeight: '500' },
      valueGetter: (p) => {
        const ports = p.data?.removed_risky_ports
        if (Array.isArray(ports)) return ports.map((r: Record<string, unknown>) => r.definition ?? String(r)).join(', ')
        return p.data?.risky_port_def ?? ''
      },
    },
    { headerName: '서비스', filter: 'agTextColumnFilter', width: 160, valueGetter: (p) => p.data?.policy?.service ?? '' },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => `위험 포트 허용 정책 ${r.length}건`,
}
```

- [x] **Step 4: `overPermissive.tsx` 작성**

```tsx
import { Expand } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { formatNumber } from '@/lib/utils'
import { makePolicyCols } from './policyColumns'
import { PolicyMultiSelect } from './PolicyMultiSelect'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

export const overPermissiveModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'over_permissive',
  label: '과허용 정책 분석',
  icon: Expand,
  description: '출발지·목적지·서비스 범위가 과도하게 넓게 설정된 정책을 탐지합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">분석 대상 정책 (미선택 시 전체)</label>
      <PolicyMultiSelect
        deviceId={ctx.deviceId}
        value={(ctx.values.targetPolicyIds as number[] | undefined) ?? []}
        onChange={(ids) => ctx.setValue('targetPolicyIds', ids)}
        placeholder="전체 정책 분석"
      />
    </div>
  ),
  buildParams: (ctx) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    return { targetPolicyIds: targetPolicyIds.length > 0 ? targetPolicyIds : undefined }
  },
  columns: (onRuleNameClick): ColDef[] => [
    { field: 'source_range_size', headerName: '출발지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
    { field: 'destination_range_size', headerName: '목적지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
    { field: 'service_range_size', headerName: '서비스 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => `과허용 정책 ${r.length}건`,
}
```

- [x] **Step 5: `index.ts` 레지스트리 조립 (deletion_workflow는 Task 11에서 채움 — 지금은 quick 6종만)**

```typescript
import type { AnalysisModule, QuickAnalysisModule, ProjectAnalysisModule } from './types'
import { redundancyModule } from './redundancy'
import { unusedModule } from './unused'
import { impactModule } from './impact'
import { unreferencedObjectsModule } from './unreferencedObjects'
import { riskyPortsModule } from './riskyPorts'
import { overPermissiveModule } from './overPermissive'

export const ANALYSIS_MODULES: AnalysisModule[] = [
  redundancyModule,
  unusedModule,
  impactModule,
  unreferencedObjectsModule,
  riskyPortsModule,
  overPermissiveModule,
]

export const QUICK_MODULES: QuickAnalysisModule[] = ANALYSIS_MODULES.filter(
  (m): m is QuickAnalysisModule => m.kind === 'quick'
)

export const PROJECT_MODULES: ProjectAnalysisModule[] = ANALYSIS_MODULES.filter(
  (m): m is ProjectAnalysisModule => m.kind === 'project'
)

export function getModule(type: string): AnalysisModule | undefined {
  return ANALYSIS_MODULES.find((m) => m.type === type)
}

export function getQuickModule(type: string): QuickAnalysisModule | undefined {
  const m = getModule(type)
  return m?.kind === 'quick' ? m : undefined
}
```

- [x] **Step 6: 타입체크**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npx tsc --noEmit -p . 2>&1 | head -60
```
Expected: 에러 없음.

- [x] **Step 7: Commit**

```bash
git add frontend/src/components/pages/analysis-modules/
git commit -m "feat: 나머지 quick 모듈 추출 + 분석 모듈 레지스트리 조립"
```

---

## Task 9: 프론트엔드 — AnalysisListPage 레지스트리 기반 리팩터

**Files:**
- Modify: `frontend/src/components/pages/AnalysisListPage.tsx`

**Interfaces:**
- Consumes: Task 8의 `QUICK_MODULES`, `getModule`
- Produces: 동일한 페이지 동작(카드 목록, 파라미터 폼, 실행, 이력 목록) — 구현만 레지스트리 기반으로 교체. Task 11에서 프로젝트형 카드/미니폼이 추가될 자리를 남겨둔다.

- [x] **Step 1: `ANALYSIS_TYPES`/`ANALYSIS_TYPE_LABELS`를 레지스트리 기반으로 교체**

`frontend/src/components/pages/AnalysisListPage.tsx` 상단의 다음 블록:
```typescript
interface AnalysisTypeOption { ... }
const ANALYSIS_TYPES: AnalysisTypeOption[] = [ /* 6개 항목 */ ]
const ANALYSIS_TYPE_LABELS: Record<string, string> = Object.fromEntries(ANALYSIS_TYPES.map((t) => [t.value, t.label]))
```
를 다음으로 교체:
```typescript
import { QUICK_MODULES } from './analysis-modules'
import type { QuickAnalysisModule } from './analysis-modules/types'

const ANALYSIS_TYPE_LABELS: Record<string, string> = Object.fromEntries(QUICK_MODULES.map((m) => [m.type, m.label]))
```
(기존 `PolicyMultiSelect` 컴포넌트 정의는 Task 8에서 `analysis-modules/PolicyMultiSelect.tsx`로 이동했으므로 이 파일에서 삭제한다. `getPolicies` import도 더 이상 여기서 쓰지 않으면 제거.)

- [x] **Step 2: `CreateAnalysisDialog`를 레지스트리 기반 파라미터 상태로 리팩터**

기존:
```typescript
const [analysisType, setAnalysisType] = useState('redundancy')
const [days, setDays] = useState('90')
const [targetPolicyIds, setTargetPolicyIds] = useState<number[]>([])
const [referencePolicyId, setReferencePolicyId] = useState<number | null>(null)
const [moveToEnd, setMoveToEnd] = useState(false)
const [moveDirection, setMoveDirection] = useState('below')
```
를 다음으로 교체:
```typescript
const [analysisType, setAnalysisType] = useState(QUICK_MODULES[0].type)
const [values, setValues] = useState<Record<string, unknown>>({})
const setValue = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }))
```

다이얼로그 오픈 시 초기화 블록:
```typescript
const [prevOpen, setPrevOpen] = useState(open)
if (open !== prevOpen) {
  setPrevOpen(open)
  if (open) {
    setDeviceId(initialDeviceId ?? null); setAnalysisType('redundancy'); setDays('90')
    setTargetPolicyIds([]); setReferencePolicyId(null); setMoveToEnd(false); setMoveDirection('below')
  }
}
```
를 다음으로 교체:
```typescript
const [prevOpen, setPrevOpen] = useState(open)
if (open !== prevOpen) {
  setPrevOpen(open)
  if (open) {
    setDeviceId(initialDeviceId ?? null)
    setAnalysisType(QUICK_MODULES[0].type)
    setValues({})
  }
}
```

`startMutation`의 `mutationFn`:
```typescript
mutationFn: () => {
  if (!deviceId) throw new Error('장비를 선택하세요.')
  if (analysisType === 'impact' && targetPolicyIds.length === 0) throw new Error('이동할 정책을 선택하세요.')
  if (analysisType === 'impact' && !moveToEnd && !referencePolicyId) throw new Error('기준 정책을 선택하거나 "맨 아래로 이동"을 선택하세요.')
  const p: StartAnalysisParams = { ... }
  return startAnalysis(deviceId, analysisType, p)
},
```
를 다음으로 교체:
```typescript
mutationFn: () => {
  if (!deviceId) throw new Error('장비를 선택하세요.')
  const module = QUICK_MODULES.find((m) => m.type === analysisType)
  if (!module) throw new Error(`알 수 없는 분석 유형: ${analysisType}`)
  const ctx = { deviceId, values, setValue }
  const validationError = module.validate?.(ctx)
  if (validationError) throw new Error(validationError)
  return startAnalysis(deviceId, analysisType, module.buildParams(ctx))
},
```

카드 목록 렌더링:
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
  {ANALYSIS_TYPES.map((t) => {
    const Icon = t.icon
    const selected = analysisType === t.value
    return (
      <button
        key={t.value}
        type="button"
        onClick={() => { setAnalysisType(t.value); setTargetPolicyIds([]); setReferencePolicyId(null); setMoveToEnd(false) }}
        ...
```
를 다음으로 교체:
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
  {QUICK_MODULES.map((m) => {
    const Icon = m.icon
    const selected = analysisType === m.type
    return (
      <button
        key={m.type}
        type="button"
        onClick={() => { setAnalysisType(m.type); setValues({}) }}
        className={`relative text-left p-3.5 rounded-xl border transition-all ${
          selected ? 'border-ds-primary bg-ds-primary/5 shadow-sm' : 'border-ds-outline-variant/30 hover:border-ds-primary/40 hover:bg-ds-surface-container-low'
        }`}
      >
        {selected && (
          <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-ds-primary flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-white" />
          </span>
        )}
        <Icon className={`w-4 h-4 mb-2 ${selected ? 'text-ds-primary' : 'text-ds-on-surface-variant'}`} />
        <p className={`text-[13px] font-semibold leading-tight mb-1 ${selected ? 'text-ds-primary' : 'text-ds-on-surface'}`}>{m.label}</p>
        <p className="text-[11px] text-ds-on-surface-variant/70 leading-snug">{m.description}</p>
      </button>
    )
  })}
</div>
```

기존의 `{analysisType === 'unused' && (...)}`, `{needsPolicySelect && (...)}`, `{needsMoveTarget && (...)}` 세 블록 전체를 다음 한 줄로 교체(모듈이 자기 파라미터 UI를 직접 그린다):
```tsx
{QUICK_MODULES.find((m) => m.type === analysisType)?.renderParams?.({ deviceId, values, setValue })}
```

- [x] **Step 3: 필터 드롭다운 갱신**

유형 필터의:
```tsx
{ANALYSIS_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
```
를:
```tsx
{QUICK_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}
```
로 교체.

- [x] **Step 4: 더 이상 쓰지 않는 import 정리**

`StartAnalysisParams` 타입 import는 `module.buildParams(ctx)`의 반환 타입 추론에 더 이상 명시적으로 필요 없다면 제거(사용 여부는 `startMutation` 파라미터 타입에서 결정 — `startAnalysis`가 이미 타입을 갖고 있으므로 명시 캐스팅 불필요, 미사용이면 제거). `DeviceSelectorSingle`, `Checkbox`, `ShadSelect`, `PolicyGridPicker`, `Select`(react-select), `getPolicies` 등 기존에 `impact`/`unused`/`risky_ports`/`over_permissive` 전용으로만 쓰이던 import는 이제 각 모듈 파일로 옮겨졌으므로 이 파일에서 미사용이면 제거한다.

- [x] **Step 5: 빌드 + lint 검증**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npm run build 2>&1 | tail -20 && npm run lint 2>&1 | tail -40
```
Expected: 빌드/lint 모두 에러 없음.

- [x] **Step 6: 수동 회귀 확인**

```bash
npm run dev &
```
브라우저에서 `/analysis` 접속 → "새 분석 실행" 클릭 → 6개 카드가 그대로 보이는지, `unused`/`impact`/`risky_ports`/`over_permissive` 선택 시 기존과 동일한 파라미터 UI가 뜨는지, 실행이 정상 동작하는지 확인. 확인 후 `kill %1`로 dev 서버 종료.

- [x] **Step 7: Commit**

```bash
git add frontend/src/components/pages/AnalysisListPage.tsx
git commit -m "refactor: AnalysisListPage가 분석 모듈 레지스트리를 사용하도록 변경"
```

---

## Task 10: 프론트엔드 — AnalysisDetailPage 레지스트리 기반 리팩터

**Files:**
- Modify: `frontend/src/components/pages/AnalysisDetailPage.tsx`

**Interfaces:**
- Consumes: Task 8의 `getQuickModule`

- [x] **Step 1: `getColumnDefs`/`ResultSummary`/`getRowStyle`/`buildPaloAltoMoveScript`/`makePolicyCols`/`pv` 제거하고 모듈 조회로 교체**

`frontend/src/components/pages/AnalysisDetailPage.tsx`에서 다음을 모두 삭제한다:
- `pv` 함수, `makePolicyCols` 함수 (→ `analysis-modules/policyColumns.tsx`로 이미 이동됨)
- `getColumnDefs` 함수 전체
- `buildPaloAltoMoveScript` 함수 전체
- `getRowStyle` 함수 전체
- `ANALYSIS_TYPE_LABELS`, `MOVE_FEASIBILITY_LABELS` 상수(→ 각 모듈 파일로 이동됨)
- `ResultSummary` 컴포넌트 내부의 `summary` 계산용 `useMemo` 블록의 `if (analysisType === '...')` 분기 전체

`ResultSummary` 컴포넌트는 요약 문자열을 prop으로 직접 받도록 시그니처를 바꾼다:
```tsx
function ResultSummary({
  summary, completedAt, onExport, onDownloadScript,
}: {
  summary: string
  completedAt: string | null; onExport: () => void; onDownloadScript?: () => void
}) {
  return (
    <div className="card rounded-xl px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
        <div>
          <p className="text-[13px] font-semibold text-ds-on-surface">{summary}</p>
          {completedAt && (
            <p className="text-[11px] text-ds-on-surface-variant/60 mt-0.5">분석 완료: {formatRelativeTime(completedAt)}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onDownloadScript && (
          <button onClick={onDownloadScript} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors">
            <Download className="w-3 h-3" />
            이동 스크립트(PaloAlto)
          </button>
        )}
        <button onClick={onExport} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors">
          <Download className="w-3 h-3" />
          Excel
        </button>
      </div>
    </div>
  )
}
```

- [x] **Step 2: 메인 컴포넌트에서 모듈 조회 후 사용**

`export function AnalysisDetailPage()` 본문에서 `if (taskQuery.isLoading) ...`/`if (!task) ...` 가드 이후, 기존:
```typescript
const currentStatus = STATUS_LABELS[task.task_status] ?? null
const results = Array.isArray(resultQuery.data?.result_data) ? resultQuery.data!.result_data : []
const columnDefs = getColumnDefs(task.task_type, onRuleNameClick, setPreviewRow)
const rowStyleFn = getRowStyle(task.task_type)
```
를 다음으로 교체:
```typescript
const currentStatus = STATUS_LABELS[task.task_status] ?? null
const results = Array.isArray(resultQuery.data?.result_data) ? resultQuery.data!.result_data as Record<string, unknown>[] : []
const module = getQuickModule(task.task_type)
const columnDefs = module?.columns(onRuleNameClick, setPreviewRow) ?? []
const rowStyleFn = module?.rowStyle
```

헤더의 `{ANALYSIS_TYPE_LABELS[task.task_type] ?? task.task_type}`를 `{module?.label ?? task.task_type}`로 교체.

`ResultSummary` 사용부:
```tsx
<ResultSummary
  analysisType={task.task_type}
  results={results}
  completedAt={resultQuery.data.created_at ?? null}
  onExport={() => {
    const payload = buildExcelPayload(results as Record<string, unknown>[], columnDefs, rowStyleFn, `분석결과_${task.task_type}`)
    exportStyledToExcel(payload).catch((e: Error) => toast.error(e.message))
  }}
  onDownloadScript={
    task.task_type === 'impact' && device?.vendor === 'paloalto'
      ? () => {
          const script = buildPaloAltoMoveScript(results as Record<string, unknown>[], device.name)
          saveBlob(new Blob([script], { type: 'text/plain' }), `이동계획_${device.name}_${task.id}.txt`)
        }
      : undefined
  }
/>
```
를 다음으로 교체:
```tsx
<ResultSummary
  summary={module?.summary(results) ?? `${results.length}건`}
  completedAt={resultQuery.data.created_at ?? null}
  onExport={() => {
    const payload = buildExcelPayload(results, columnDefs, rowStyleFn ?? (() => undefined), `분석결과_${task.task_type}`)
    exportStyledToExcel(payload).catch((e: Error) => toast.error(e.message))
  }}
  onDownloadScript={
    device && module?.downloadScript
      ? () => {
          const script = module.downloadScript!(results, { name: device.name, vendor: device.vendor })
          if (script) saveBlob(new Blob([script.content], { type: 'text/plain' }), script.filename)
        }
      : undefined
  }
/>
```

`AgGridWrapper`의 `getRowStyle={rowStyleFn as ...}` prop은 `rowStyleFn`이 `undefined`일 수 있으므로 `getRowStyle={rowStyleFn}`으로 그대로 전달(AgGridWrapper가 `undefined`를 허용하는지 `frontend/src/components/shared/AgGridWrapper.tsx`의 `getRowStyle` prop 타입을 확인해 `optional`이 아니라면 `getRowStyle={rowStyleFn ?? undefined}`처럼 명시).

- [x] **Step 3: import 정리 및 신규 import 추가**

파일 상단에 추가:
```typescript
import { getQuickModule } from './analysis-modules'
```
더 이상 쓰지 않는 `React`(cellRenderer에서 `React.createElement` 쓰던 부분이 모듈 파일로 이동했다면 미사용 가능성 있음 — `onRuleNameClick`은 이제 모듈에 전달만 하므로 이 파일에 남은 `React.createElement` 사용처가 있는지 확인 후 없으면 `import React from 'react'`를 `import { useMemo, useState } from 'react'`로 축소), `ImpactMovePreviewDialog`는 `task.task_type === 'impact'`일 때 그대로 쓰이므로 유지.

- [x] **Step 4: 빌드 + lint 검증**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npm run build 2>&1 | tail -20 && npm run lint 2>&1 | tail -40
```
Expected: 에러 없음.

- [x] **Step 5: 수동 회귀 확인**

`npm run dev` 후 브라우저에서 기존에 실행해둔 분석 결과(redundancy/impact 등) 상세 페이지를 열어 컬럼/요약/엑셀 다운로드/(팔로알토 장비라면) 이동 스크립트 다운로드가 기존과 동일하게 동작하는지 확인.

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/pages/AnalysisDetailPage.tsx
git commit -m "refactor: AnalysisDetailPage가 분석 모듈 레지스트리를 사용하도록 변경"
```

---

## Task 11: 프론트엔드 — deletion_workflow를 프로젝트형 모듈로 등록 + 공용 ProjectListPage

**Files:**
- Create: `frontend/src/components/pages/analysis-modules/deletionWorkflow.ts`
- Modify: `frontend/src/components/pages/analysis-modules/index.ts`
- Create: `frontend/src/components/pages/ProjectListPage.tsx`
- Delete: `frontend/src/components/pages/DeletionWorkflowListPage.tsx`

**Interfaces:**
- Consumes: Task 6의 `analysisProjects.ts` API 클라이언트, `ProjectAnalysisModule` 타입
- Produces: `deletionWorkflowModule`(등록된 프로젝트형 모듈), `ProjectListPage`(라우트 `/analysis/projects/:moduleType`에서 사용, Task 13에서 연결)

- [x] **Step 1: `deletionWorkflow.ts` 모듈 디스크립터 작성**

```typescript
import { FileX2 } from 'lucide-react'
import type { ProjectAnalysisModule } from './types'

export const deletionWorkflowModule: ProjectAnalysisModule = {
  kind: 'project',
  type: 'deletion_workflow',
  label: '삭제 워크플로우',
  icon: FileX2,
  description: '만료되거나 미사용된 정책을 분류·정리해 삭제 대상을 산출하는 다단계 프로젝트입니다.',
}
```

- [x] **Step 2: `index.ts`에 등록**

`frontend/src/components/pages/analysis-modules/index.ts`의 import/배열에 추가:
```typescript
import { deletionWorkflowModule } from './deletionWorkflow'

export const ANALYSIS_MODULES: AnalysisModule[] = [
  redundancyModule,
  unusedModule,
  impactModule,
  unreferencedObjectsModule,
  riskyPortsModule,
  overPermissiveModule,
  deletionWorkflowModule,
]
```

- [x] **Step 3: `ProjectListPage.tsx` 작성 (기존 `DeletionWorkflowListPage.tsx`를 모듈 파라미터화)**

라우트 파라미터 `:moduleType`으로 레지스트리에서 라벨/생성 로직을 가져오는 범용 페이지. 기존 `DeletionWorkflowListPage.tsx`의 `CreateProjectDialog`/테이블 로직을 그대로 쓰되, `deletionWorkflow`의 project CRUD 대신 `analysisProjects.ts`의 공용 함수를 쓰고, `moduleType`을 라우트 파라미터로 받는다:

```tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import {
  listAnalysisProjects,
  createAnalysisProject,
  deleteAnalysisProject,
  type AnalysisProject,
} from '@/api/analysisProjects'
import { queryKeys } from '@/api/queryKeys'
import { getModule } from './analysis-modules'

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:     { label: '초안',   cls: 'bg-gray-100 text-gray-600' },
  running:   { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '완료',   cls: 'bg-emerald-50 text-emerald-600' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
}

function CreateProjectDialog({ moduleType, moduleLabel, open, onClose }: {
  moduleType: string; moduleLabel: string; open: boolean; onClose: () => void
}) {
  const qc = useQueryClient()
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [memo, setMemo] = useState('')
  const [referenceDate, setReferenceDate] = useState('')

  const mutation = useMutation({
    mutationFn: () => createAnalysisProject(moduleType, deviceId!, name.trim(), memo.trim() || undefined, referenceDate || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.analysisProjects(moduleType) })
      toast.success('프로젝트가 생성되었습니다.')
      setDeviceId(null); setName(''); setMemo(''); setReferenceDate('')
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!deviceId) { toast.error('장비를 선택하세요.'); return }
    if (!name.trim()) { toast.error('프로젝트명을 입력하세요.'); return }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>새 {moduleLabel} 프로젝트</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div>
            <Label>장비</Label>
            <div className="mt-1"><DeviceSelectorSingle value={deviceId} onChange={setDeviceId} /></div>
          </div>
          <div>
            <Label>프로젝트명</Label>
            <Input className="mt-1" placeholder="예: 2026-06 정책 삭제" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>메모 (선택)</Label>
            <Input className="mt-1" placeholder="작업 메모..." value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div>
            <Label>
              기준일 (선택)
              <span className="ml-1.5 text-xs font-normal text-ds-on-surface-variant">— 만료·미사용 판단 기준일. 미설정 시 작업 당일 기준</span>
            </Label>
            <Input type="date" className="mt-1" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} />
          </div>
          <DialogFooter>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-ds-outline-variant hover:bg-black/5">취소</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50">
              {mutation.isPending ? '생성 중...' : '생성'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ProjectListPage() {
  const { moduleType } = useParams<{ moduleType: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)

  const module = moduleType ? getModule(moduleType) : undefined
  const moduleLabel = module?.label ?? moduleType ?? ''

  const { data: projects = [], isLoading } = useQuery({
    queryKey: queryKeys.analysisProjects(moduleType ?? ''),
    queryFn: () => listAnalysisProjects(moduleType!),
    enabled: !!moduleType,
    staleTime: 10_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAnalysisProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.analysisProjects(moduleType ?? '') })
      toast.success('프로젝트가 삭제되었습니다.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDelete = async (p: AnalysisProject) => {
    const ok = await confirm({
      title: '프로젝트 삭제',
      description: `"${p.name}" 프로젝트와 모든 저장 파일이 삭제됩니다.`,
      confirmLabel: '삭제',
      variant: 'destructive',
    })
    if (ok) deleteMutation.mutate(p.id)
  }

  if (!moduleType) return null

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-ds-outline-variant/30 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-ds-on-surface">{moduleLabel}</h1>
          <p className="text-xs text-ds-on-surface-variant mt-0.5">방화벽별 작업을 프로젝트로 관리합니다.</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90">
          <Plus className="w-4 h-4" />
          새 프로젝트
        </button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-ds-on-surface-variant text-sm">로딩 중...</div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="아직 프로젝트가 없습니다."
            action={<button onClick={() => setCreateOpen(true)} className="text-sm text-ds-tertiary hover:underline">첫 프로젝트 만들기 →</button>}
          />
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-ds-outline-variant/30">
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-12">#</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant">장비</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant">프로젝트명</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-24">상태</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-28">기준일</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-28">생성일</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-16"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/analysis/projects/${moduleType}/${p.id}`)}
                  className="border-b border-ds-outline-variant/20 hover:bg-black/[0.02] cursor-pointer group"
                >
                  <td className="py-3 px-3 text-ds-on-surface-variant">{p.id}</td>
                  <td className="py-3 px-3">
                    <div className="font-medium text-ds-on-surface">{p.device_name}</div>
                    <div className="text-xs text-ds-on-surface-variant">{p.device_ip}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-medium text-ds-on-surface">{p.name}</div>
                    {p.memo && <div className="text-xs text-ds-on-surface-variant truncate max-w-xs">{p.memo}</div>}
                  </td>
                  <td className="py-3 px-3"><StatusBadge status={p.status} /></td>
                  <td className="py-3 px-3 text-xs">
                    {p.reference_date ? <span className="text-amber-700 font-medium">{p.reference_date}</span> : <span className="text-ds-on-surface-variant/50">당일</span>}
                  </td>
                  <td className="py-3 px-3 text-ds-on-surface-variant text-xs">{new Date(p.created_at).toLocaleDateString('ko-KR')}</td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(p) }} className="p-1 rounded hover:bg-ds-error/10 text-ds-on-surface-variant hover:text-ds-error">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ArrowRight className="w-3.5 h-3.5 text-ds-on-surface-variant" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateProjectDialog moduleType={moduleType} moduleLabel={moduleLabel} open={createOpen} onClose={() => setCreateOpen(false)} />
      {ConfirmDialogElement}
    </div>
  )
}
```

- [x] **Step 4: 기존 `DeletionWorkflowListPage.tsx` 삭제**

```bash
rm /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/DeletionWorkflowListPage.tsx
```
(이 파일을 import하던 곳은 Task 13에서 라우팅을 정리할 때 함께 제거된다 — 이 태스크 시점에는 `App.tsx`가 아직 옛 파일을 참조하므로 **Task 13 이전에는 빌드가 깨질 수 있음**. 그래서 이 삭제 스텝은 Task 13의 라우팅 정리와 같은 커밋으로 묶어 진행한다 — 아래 Step 5 참고.)

- [x] **Step 5: 타입체크 (App.tsx 미반영 상태이므로 ProjectListPage 자체만 검증)**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npx tsc --noEmit -p . 2>&1 | grep -E "ProjectListPage|analysis-modules|DeletionWorkflowListPage"
```
Expected: `DeletionWorkflowListPage`를 import하는 `App.tsx`에서만 에러가 나야 정상(파일이 삭제됐으므로) — 이 에러는 Task 13에서 해소된다. `ProjectListPage.tsx` 자체에는 에러가 없어야 한다. 이 태스크의 커밋은 `App.tsx` 반영 전이므로, **삭제(Step 4)는 실제로 Task 13에서 수행**하고 이 태스크에서는 `ProjectListPage.tsx`만 새로 추가하는 것으로 범위를 좁힌다 — 즉 Step 4는 이 태스크에서 건너뛰고 Task 13의 Step 1로 이동한다.

- [x] **Step 6: Commit (DeletionWorkflowListPage 삭제 제외)**

```bash
git add frontend/src/components/pages/analysis-modules/deletionWorkflow.ts frontend/src/components/pages/analysis-modules/index.ts frontend/src/components/pages/ProjectListPage.tsx
git commit -m "feat: deletion_workflow를 프로젝트형 모듈로 등록 + 공용 ProjectListPage 신설"
```

---

## Task 12: 프론트엔드 — DeletionWorkflowDetailPage 프로젝트 CRUD를 공용 API로 전환

**Files:**
- Modify: `frontend/src/components/pages/DeletionWorkflowDetailPage.tsx`
- Modify: `frontend/src/components/pages/deletion-workflow/TaskCard.tsx`
- Modify: `frontend/src/components/pages/deletion-workflow/Task0Section.tsx`
- Modify: `frontend/src/api/deletionWorkflow.ts`

**Interfaces:**
- Consumes: Task 6의 `analysisProjects.ts`(`getAnalysisProject`, `updateAnalysisProject`, `AnalysisProjectDetail`, `ProjectFileState`)
- Produces: `deletionWorkflow.ts`에는 실행 전용 함수만 남음(프로젝트 CRUD 제거)

- [x] **Step 1: `frontend/src/api/deletionWorkflow.ts`에서 프로젝트 CRUD 제거**

다음 항목을 삭제한다: `DeletionWorkflowProject` 인터페이스, `ProjectFileState` 인터페이스, `DeletionWorkflowProjectDetail` 인터페이스(→ `analysisProjects.ts`의 `AnalysisProject`/`ProjectFileState`/`AnalysisProjectDetail`로 대체), `listProjects`, `createProject`, `updateProject`, `getProject`, `deleteProject` 함수.

`ProjectTaskRunResponse`/`ProjectPipelineTaskResult` 등 실행 관련 타입과 `runProjectExtract`, `runProjectTask`, `getPipelineTaskResult`, `waitForPipelineTask`, `uploadExternalFile`, `downloadTaskFile`, `resetProjectOutputs`, `resetAllProjectFiles`, `completeProject`, `clearProjectOutputs`, 레거시 함수들(`fetchDeletionTasks`, `extractDeviceData`, `exportRedundancyData`, `executeDeletionTask`)은 그대로 유지한다.

`getPipelineTaskResult`는 이미 Task 4에서 백엔드가 `/deletion-workflow/projects/{id}/tasks/{id}/result`가 아니라 `/analysis/projects/{id}/tasks/{id}/result`로 이동했으므로, 다음처럼 경로를 변경한다:
```typescript
export const getPipelineTaskResult = async (
  projectId: number,
  analysisTaskId: number,
): Promise<ProjectPipelineTaskResult> => {
  const res = await apiClient.get<ProjectPipelineTaskResult>(
    `/analysis/projects/${projectId}/tasks/${analysisTaskId}/result`
  )
  return res.data
}
```
(엔드포인트가 `apiClient`(axios) 기반이라면 그대로 두되, `fetch()` 기반이었다면 `apiClient.get`으로 통일한다 — 기존 `deletionWorkflow.ts`의 `getPipelineTaskResult`가 이미 `apiClient.get`을 쓰고 있었다면 URL 문자열만 교체.)

- [x] **Step 2: `DeletionWorkflowDetailPage.tsx` import 및 쿼리 갱신**

```typescript
import { getProject, runProjectExtract, runProjectTask, getPipelineTaskResult, waitForPipelineTask, resetAllProjectFiles, clearProjectOutputs, updateProject, completeProject, type DeletionWorkflowProjectDetail, type ProjectFileState } from '@/api/deletionWorkflow'
```
를 다음으로 교체:
```typescript
import { runProjectExtract, runProjectTask, getPipelineTaskResult, waitForPipelineTask, resetAllProjectFiles, clearProjectOutputs, completeProject } from '@/api/deletionWorkflow'
import { getAnalysisProject, updateAnalysisProject, type AnalysisProjectDetail, type ProjectFileState } from '@/api/analysisProjects'
```

파일 전체에서 `DeletionWorkflowProjectDetail` 타입 참조를 `AnalysisProjectDetail`로, `getProject(projectId)` 호출을 `getAnalysisProject(projectId)`로, `updateProject(projectId, ...)` 호출을 `updateAnalysisProject(projectId, ...)`로 치환한다. `useQuery`의 `queryKey: queryKeys.deletionWorkflowProject(projectId)`는 `queryKeys.analysisProject(projectId)`로, `qc.setQueryData(queryKeys.deletionWorkflowProject(projectId), ...)`/`qc.setQueryData(['deletion-workflow-project', projectId], ...)`(하드코딩된 배열 리터럴 4곳)도 전부 `queryKeys.analysisProject(projectId)`로 통일한다(기존 코드에 하드코딩된 배열 리터럴이 있던 것은 이번 기회에 CLAUDE.md 규칙대로 팩토리 사용으로 정리).

`refDateMutation`의 `mutationFn: (date: string | null) => updateProject(projectId, { reference_date: date })`도 `updateAnalysisProject`로 교체. `qc.invalidateQueries({ queryKey: queryKeys.deletionWorkflowProjects })` 호출부는 `queryKeys.analysisProjects('deletion_workflow')`로 교체(프로젝트 삭제/생성 후 목록 갱신 목적이므로 모듈타입 하드코딩은 이 페이지가 deletion_workflow 전용이라 허용됨).

`checkSync` 함수의 `projectRef: DeletionWorkflowProjectDetail` 파라미터 타입도 `AnalysisProjectDetail`로 교체.

- [x] **Step 3: `TaskCard.tsx`/`Task0Section.tsx`의 `ProjectFileState` import 경로 변경**

두 파일의:
```typescript
import { ..., type ProjectFileState } from '@/api/deletionWorkflow'
```
에서 `ProjectFileState`만 분리해:
```typescript
import { ... } from '@/api/deletionWorkflow'
import type { ProjectFileState } from '@/api/analysisProjects'
```
로 교체(다른 실행 관련 함수 import는 그대로 `@/api/deletionWorkflow`에서 유지).

- [x] **Step 4: `frontend/src/api/queryKeys.ts`에서 `deletionWorkflowProjects`/`deletionWorkflowProject` 제거**

```typescript
  deletionWorkflowProjects: ['deletion-workflow-projects'] as const,
  deletionWorkflowProject: (projectId: number | string | undefined) =>
    ['deletion-workflow-project', projectId] as const,
```
두 줄을 삭제(Task 6에서 추가한 `analysisProjects`/`analysisProject`로 완전히 대체됨). `deletionWorkflowTasks`(태스크 메타), `deletionWorkflowConfig`(Settings 연동), `deletionWorkflowPipelineTask`(있다면)는 프로젝트 CRUD와 무관하므로 유지.

- [x] **Step 5: 타입체크**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npx tsc --noEmit -p . 2>&1 | head -60
```
Expected: `deletionWorkflowProject`/`getProject`/`updateProject`(deletionWorkflow.ts에서 삭제된 것) 관련 참조 에러가 모두 해소됨. (아직 `App.tsx`/`DeletionWorkflowListPage.tsx`는 Task 13에서 정리하므로 그쪽 에러는 이 시점엔 무시)

- [x] **Step 6: Commit**

```bash
git add frontend/src/api/deletionWorkflow.ts frontend/src/api/queryKeys.ts frontend/src/components/pages/DeletionWorkflowDetailPage.tsx frontend/src/components/pages/deletion-workflow/TaskCard.tsx frontend/src/components/pages/deletion-workflow/Task0Section.tsx
git commit -m "refactor: DeletionWorkflowDetailPage 프로젝트 CRUD를 공용 analysisProjects API로 전환"
```

---

## Task 13: 프론트엔드 — 라우팅/네비게이션 정리 + 구 경로 redirect

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Navbar.tsx`
- Delete: `frontend/src/components/pages/DeletionWorkflowListPage.tsx`

**Interfaces:**
- Consumes: Task 11의 `ProjectListPage`, Task 12에서 정리된 `DeletionWorkflowDetailPage`

- [x] **Step 1: `DeletionWorkflowListPage.tsx` 삭제**

```bash
rm /Users/hoon/Code/firewall-analysis-tool/frontend/src/components/pages/DeletionWorkflowListPage.tsx
```

- [x] **Step 2: `App.tsx` 라우트 갱신**

lazy import 블록에서:
```typescript
const DeletionWorkflowPage = lazy(() => import('@/components/pages/DeletionWorkflowPage').then((m) => ({ default: m.DeletionWorkflowPage })))
const DeletionWorkflowListPage = lazy(() => import('@/components/pages/DeletionWorkflowListPage'))
const DeletionWorkflowDetailPage = lazy(() => import('@/components/pages/DeletionWorkflowDetailPage'))
```
를 다음으로 교체:
```typescript
const DeletionWorkflowPage = lazy(() => import('@/components/pages/DeletionWorkflowPage').then((m) => ({ default: m.DeletionWorkflowPage })))
const ProjectListPage = lazy(() => import('@/components/pages/ProjectListPage'))
const DeletionWorkflowDetailPage = lazy(() => import('@/components/pages/DeletionWorkflowDetailPage'))
```

라우트 정의에서:
```tsx
<Route path="deletion-workflow" element={<DeletionWorkflowListPage />} />
<Route path="deletion-workflow/:id" element={<DeletionWorkflowDetailPage />} />
<Route path="deletion-workflow/legacy" element={<DeletionWorkflowPage />} />
```
를 다음으로 교체:
```tsx
<Route path="analysis/projects/:moduleType" element={<ProjectListPage />} />
<Route path="analysis/projects/deletion_workflow/:id" element={<DeletionWorkflowDetailPage />} />
<Route path="deletion-workflow/legacy" element={<DeletionWorkflowPage />} />
<Route path="deletion-workflow" element={<Navigate to="/analysis/projects/deletion_workflow" replace />} />
<Route path="deletion-workflow/:id" element={<DeletionWorkflowRedirect />} />
```
파일 상단에 리다이렉트용 헬퍼 컴포넌트를 추가(구 경로의 `:id`를 새 경로로 그대로 전달하기 위해 `Navigate`의 정적 `to`만으로는 파라미터 보존이 안 되므로 별도 컴포넌트 사용):
```tsx
function DeletionWorkflowRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/analysis/projects/deletion_workflow/${id}`} replace />
}
```
이를 위해 `App.tsx` 상단 import에 `useParams`를 추가: `import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'`.

**주의:** `analysis/projects/:moduleType`과 `analysis/projects/deletion_workflow/:id`가 둘 다 `Route` 목록에 있을 때 React Router v6는 더 구체적인(정적 세그먼트가 많은) 경로를 우선 매칭하므로 순서와 무관하게 올바르게 라우팅된다 — 순서를 신경 쓰지 않아도 되지만, 가독성을 위해 위 예시처럼 구체적 경로를 먼저 적는다.

- [x] **Step 3: `Navbar.tsx`에서 "Deletion Workflow" 메뉴 제거**

```typescript
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/devices', label: 'Devices' },
  { to: '/policies', label: 'Policies' },
  { to: '/objects', label: 'Objects' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/policy-diff', label: 'Policy Diff' },
  { to: '/schedules', label: 'Schedules' },
  { to: '/deletion-workflow', label: 'Deletion Workflow' },
]
```
에서 마지막 줄(`{ to: '/deletion-workflow', label: 'Deletion Workflow' }`)을 삭제.

- [x] **Step 4: 빌드 + lint 검증**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npm run build 2>&1 | tail -20 && npm run lint 2>&1 | tail -40
```
Expected: 에러 없음. `DeletionWorkflowListPage` 관련 참조가 어디에도 남아있지 않아야 한다:
```bash
grep -rn "DeletionWorkflowListPage" frontend/src
```
Expected: 결과 없음.

- [x] **Step 5: 수동 회귀 확인**

```bash
npm run dev &
```
브라우저에서:
1. 상단 네비게이션에 "Deletion Workflow" 메뉴가 사라지고 "Analysis"만 있는지 확인
2. `/deletion-workflow` 접속 시 `/analysis/projects/deletion_workflow`로 리다이렉트되는지 확인
3. 기존에 만든 프로젝트가 있다면 `/deletion-workflow/<id>` 접속 시 `/analysis/projects/deletion_workflow/<id>`로 리다이렉트되고 위저드가 정상 렌더링되는지 확인
4. `ProjectListPage`에서 새 프로젝트 생성 → 상세 페이지 진입 → Task 0 실행까지 정상 동작하는지 확인

`kill %1`로 dev 서버 종료.

- [x] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/Navbar.tsx
git rm frontend/src/components/pages/DeletionWorkflowListPage.tsx
git commit -m "refactor: deletion_workflow를 Analysis 페이지 라우트로 통합, 구 경로 redirect 추가"
```

---

## Task 14: 프론트엔드 — 이력 목록에 프로젝트형 모듈 필터 + "전체" 병합 뷰

**Files:**
- Modify: `frontend/src/components/pages/AnalysisListPage.tsx`

**Interfaces:**
- Consumes: Task 8의 `PROJECT_MODULES`, Task 6의 `listAnalysisProjects`

- [x] **Step 1: 통합 행 타입 정의 및 병합 헬퍼 추가**

`AnalysisListPage.tsx` 상단(컴포넌트 함수 밖)에 추가:
```typescript
import { PROJECT_MODULES } from './analysis-modules'
import { listAnalysisProjects, type AnalysisProject } from '@/api/analysisProjects'

/** 이력 목록의 "전체" 필터에서 quick 실행과 프로젝트를 함께 보여주기 위한 정규화된 행. */
interface UnifiedHistoryRow {
  id: string
  kind: 'quick' | 'project'
  label: string
  deviceName: string
  deviceIp: string
  statusLabel: string
  statusCls: string
  timestamp: string
  href: string
  raw: AnalysisTaskListItem | AnalysisProject
}

const PROJECT_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:     { label: '초안',   cls: 'bg-gray-100 text-gray-600' },
  running:   { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '완료',   cls: 'bg-emerald-50 text-emerald-600' },
}

function toUnifiedRow(item: AnalysisTaskListItem | AnalysisProject, kind: 'quick' | 'project'): UnifiedHistoryRow {
  if (kind === 'quick') {
    const t = item as AnalysisTaskListItem
    const cfg = STATUS_CONFIG[t.task_status] ?? { label: t.task_status, cls: 'bg-gray-100 text-gray-500' }
    return {
      id: `quick-${t.id}`, kind, label: ANALYSIS_TYPE_LABELS[t.task_type] ?? t.task_type,
      deviceName: t.device_name, deviceIp: t.device_ip,
      statusLabel: cfg.label, statusCls: cfg.cls,
      timestamp: t.created_at, href: `/analysis/${t.id}`, raw: t,
    }
  }
  const p = item as AnalysisProject
  const cfg = PROJECT_STATUS_CONFIG[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-500' }
  const module = PROJECT_MODULES.find((m) => m.type === p.module_type)
  return {
    id: `project-${p.id}`, kind, label: module?.label ?? p.module_type,
    deviceName: p.device_name, deviceIp: p.device_ip,
    statusLabel: cfg.label, statusCls: cfg.cls,
    timestamp: p.updated_at, href: `/analysis/projects/${p.module_type}/${p.id}`, raw: p,
  }
}
```

- [x] **Step 2: `typeFilter`가 프로젝트형 모듈 값을 가질 수 있도록 상태/쿼리 분기 추가**

기존:
```typescript
const { data, isLoading } = useQuery({
  queryKey: queryKeys.analysisTasksList(search, typeFilter, statusFilter, page),
  queryFn: () => listAnalysisTasks({
    search: search || undefined,
    analysisType: typeFilter === 'all' ? undefined : typeFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
    page, pageSize: PAGE_SIZE,
  }),
  staleTime: 5_000,
})

const items = data?.items ?? []
const total = data?.total ?? 0
```
를 다음으로 교체:
```typescript
const isProjectFilter = PROJECT_MODULES.some((m) => m.type === typeFilter)

const quickQuery = useQuery({
  queryKey: queryKeys.analysisTasksList(search, isProjectFilter ? 'all' : typeFilter, statusFilter, page),
  queryFn: () => listAnalysisTasks({
    search: search || undefined,
    analysisType: (typeFilter === 'all' || isProjectFilter) ? undefined : typeFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
    page, pageSize: PAGE_SIZE,
  }),
  enabled: !isProjectFilter,
  staleTime: 5_000,
})

const projectQuery = useQuery({
  queryKey: queryKeys.analysisProjects(isProjectFilter ? typeFilter : 'all'),
  queryFn: async () => {
    if (isProjectFilter) return listAnalysisProjects(typeFilter)
    const all = await Promise.all(PROJECT_MODULES.map((m) => listAnalysisProjects(m.type)))
    return all.flat()
  },
  enabled: typeFilter === 'all' || isProjectFilter,
  staleTime: 5_000,
})

const isLoading = quickQuery.isLoading || projectQuery.isLoading

// "전체": quick(현재 페이지분) + 모든 프로젝트를 합쳐 날짜순 정렬 후 클라이언트에서 페이지네이션.
// 특정 quick 유형/상태 필터: 기존과 동일하게 백엔드 페이지네이션 그대로 사용.
// 특정 프로젝트형 유형: 프로젝트 목록 전체(비페이지네이션, 프로젝트 수가 적어 무해)를 보여준다.
const rows: UnifiedHistoryRow[] = (() => {
  if (isProjectFilter) {
    return (projectQuery.data ?? []).map((p) => toUnifiedRow(p, 'project'))
  }
  if (typeFilter !== 'all') {
    return (quickQuery.data?.items ?? []).map((t) => toUnifiedRow(t, 'quick'))
  }
  const quickRows = (quickQuery.data?.items ?? []).map((t) => toUnifiedRow(t, 'quick'))
  const projectRows = (projectQuery.data ?? []).map((p) => toUnifiedRow(p, 'project'))
  return [...quickRows, ...projectRows].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
})()

const total = isProjectFilter ? rows.length : (quickQuery.data?.total ?? 0)
```

- [x] **Step 3: 유형 필터 드롭다운에 프로젝트형 모듈 옵션 추가**

```tsx
<SelectContent>
  <SelectItem value="all">전체 유형</SelectItem>
  {QUICK_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}
</SelectContent>
```
를:
```tsx
<SelectContent>
  <SelectItem value="all">전체 유형</SelectItem>
  {QUICK_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}
  {PROJECT_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}
</SelectContent>
```

- [x] **Step 4: 테이블 렌더링을 `rows`(통합 행) 기반으로 교체**

```tsx
{items.map((t: AnalysisTaskListItem) => (
  <tr key={t.id} onClick={() => navigate(`/analysis/${t.id}`)} ...>
    <td ...>{t.id}</td>
    <td ...>{t.device_name} / {t.device_ip}</td>
    <td ...>{ANALYSIS_TYPE_LABELS[t.task_type] ?? t.task_type}</td>
    <td ...><StatusBadge status={t.task_status} /></td>
    <td ...>{formatDate(t.created_at)}</td>
    <td ...>{t.completed_at ? formatDate(t.completed_at) : '-'}</td>
    <td ...><button onClick={(e) => handleDelete(e, t)} ...>...</button></td>
  </tr>
))}
```
를 다음으로 교체(project 행은 삭제 버튼을 숨기고 `완료일` 대신 `-` 표시 — 프로젝트 삭제는 상세 페이지/`ProjectListPage`에서 처리):
```tsx
{rows.map((row) => (
  <tr key={row.id} onClick={() => navigate(row.href)} className="border-b border-ds-outline-variant/10 hover:bg-black/[0.02] cursor-pointer">
    <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">{row.raw.id}</td>
    <td className="py-2.5 px-4">
      <div className="font-medium text-ds-on-surface text-[13px]">{row.deviceName}</div>
      <div className="text-[11px] text-ds-on-surface-variant">{row.deviceIp}</div>
    </td>
    <td className="py-2.5 px-4 text-[13px] text-ds-on-surface">{row.label}</td>
    <td className="py-2.5 px-4"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.statusCls}`}>{row.statusLabel}</span></td>
    <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">{formatDate(row.timestamp)}</td>
    <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">
      {row.kind === 'quick' && (row.raw as AnalysisTaskListItem).completed_at ? formatDate((row.raw as AnalysisTaskListItem).completed_at!) : '-'}
    </td>
    <td className="py-2.5 px-4">
      {row.kind === 'quick' && (
        <button
          onClick={(e) => handleDelete(e, row.raw as AnalysisTaskListItem)}
          disabled={(row.raw as AnalysisTaskListItem).task_status === 'in_progress'}
          className="p-1 rounded text-ds-on-surface-variant/60 hover:text-ds-error hover:bg-ds-error/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="삭제"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </td>
  </tr>
))}
```
`items.length === 0`(빈 상태 조건)와 하단 페이지네이션(`totalPages`)의 기준도 `items`→`rows`로 교체.

- [x] **Step 5: 페이지네이션을 프로젝트형/전체 뷰에서 비활성화**

프로젝트형 필터나 "전체" 병합 뷰는 서버 페이지네이션이 아니므로, 페이지네이션 컨트롤은 quick 단일 유형 필터일 때만 노출한다:
```tsx
{total > 0 && !isProjectFilter && typeFilter !== 'all' && (
  <div className="flex items-center justify-center gap-3"> ... </div>
)}
```
(`전체`/프로젝트형 뷰는 현재 페이지 하나에 모두 표시 — 데이터量이 적은 내부 도구 특성상 실사용 문제 없음을 스펙에서 이미 확인함.)

- [x] **Step 6: 빌드 + lint 검증**

```bash
cd /Users/hoon/Code/firewall-analysis-tool/frontend && npm run build 2>&1 | tail -20 && npm run lint 2>&1 | tail -40
```
Expected: 에러 없음.

- [x] **Step 7: 수동 회귀 확인**

`npm run dev` 후 `/analysis`에서: "전체" 필터에 quick 실행과 deletion_workflow 프로젝트가 날짜순으로 섞여 나오는지, "삭제 워크플로우" 필터를 선택하면 프로젝트 행만(1프로젝트=1행) 나오는지, 프로젝트 행 클릭 시 위저드로 이동하는지 확인. `kill %1`.

- [x] **Step 8: Commit**

```bash
git add frontend/src/components/pages/AnalysisListPage.tsx
git commit -m "feat: 이력 목록에 프로젝트형 모듈 필터 + 전체 병합 뷰 추가"
```

---

## Task 15: 문서화

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/DATABASE.md`

**Interfaces:** 없음(문서 전용)

- [x] **Step 1: `CLAUDE.md` 갱신**

"핵심 서브시스템" 표의 "삭제 워크플로우" 행을 다음으로 교체:
```
| 삭제 워크플로우 | `app/services/deletion_workflow/` | Config 기반 프로세서 파이프라인. 프로젝트/파일 저장소는 `analysis_projects`/`analysis_project_files`(module_type='deletion_workflow')로 다른 프로젝트형 분석 모듈과 공유. 실행 오케스트레이션(`tasks.py`)은 analysis의 `AnalysisTask` 패턴 사용. UI는 Analysis 페이지(`/analysis/projects/deletion_workflow`)에 통합됨. DB→Excel 변환은 `export_service.py`, 설정 연동은 `config_bridge.py`, 태스크 메타는 `task_meta.py` |
```

"확장 패턴" 섹션의 "새 분석 엔진 추가" 항목을 다음으로 교체:
```
- **새 분석 엔진 추가(quick형)**: `app/services/analysis/`에 Analyzer 클래스 추가 → `models/analysis.py`의 `AnalysisTaskType`에 항목 추가 → `analysis/tasks.py`에 run_xxx/_run_xxx 쌍 추가 → `endpoints/analysis.py`에 라우트 추가 → 프론트 `components/pages/analysis-modules/`에 모듈 파일 추가 후 `index.ts` 레지스트리에 등록(다른 파일 수정 불필요 — `AnalysisListPage`/`AnalysisDetailPage`가 레지스트리를 순회함).
- **새 분석 모듈 추가(프로젝트형, deletion_workflow 참고)**: `models/analysis.py`의 `AnalysisTaskType`에 항목 추가, `AnalysisProject.module_type`에 새 값 사용(테이블/스키마 변경 불필요 — `analysis_projects`/`analysis_project_files`를 그대로 공유) → 모듈 전용 서비스 패키지(`app/services/<module>/`)에 파이프라인 로직 + `tasks.py`(백그라운드 실행, `services/deletion_workflow/tasks.py` 패턴 복제) 작성 → 모듈 전용 실행 엔드포인트(`endpoints/<module>.py`) 추가(프로젝트 CRUD는 공용 `endpoints/analysis_projects.py` 재사용, 라우트 추가 불필요) → 프론트 `analysis-modules/`에 `kind: 'project'` 모듈 파일 추가 후 레지스트리 등록 → 위저드 UI는 모듈 전용 컴포넌트로 직접 작성(공통화되어 있지 않음).
```

- [x] **Step 2: `docs/DATABASE.md` 갱신**

"6. 삭제 워크플로우" 섹션 제목과 설명을 다음으로 교체:
```markdown
## 6. 프로젝트형 분석 모듈 (deletion_workflow 등)

> `analysis_projects`/`analysis_project_files`는 "프로젝트형" 분석 모듈(장비별로 프로젝트를
> 만들고 여러 단계를 순차 실행하는 방식 — 현재는 deletion_workflow만 존재)이 공유하는
> 데이터 계층이다. `module_type` 컬럼으로 어느 모듈의 프로젝트인지 구분한다. 파이프라인
> 실행 로직 자체(어떤 단계가 있고 각 단계가 무엇을 하는지)는 모듈마다 독립적이며 이
> 테이블에는 담기지 않는다 — 실행 상태 추적은 `analysistasks`(`AnalysisTask`,
> `task_type='deletion_workflow'`, `pipeline_task_id`=단계 번호, `analysis_project_id`=소속
> 프로젝트)를 통해 이루어진다.

### `analysis_projects` Table
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `module_type` | `VARCHAR` | `NOT NULL, INDEX` | 소속 모듈 (예: `deletion_workflow`) |
| `device_id` | `INTEGER` | `FOREIGN KEY (devices.id)` | 장비 참조 |
| `name` | `VARCHAR` | `NOT NULL` | 프로젝트 이름 |
| `status` | `VARCHAR` | `DEFAULT 'draft'` | 상태 (draft, running, completed) |
| `memo` | `VARCHAR` | `NULLABLE` | 메모 |
| `reference_date` | `DATE` | `NULLABLE` | 기준일 |
| `created_at` | `DATETIME` | `NOT NULL` | 생성 시간 |
| `updated_at` | `DATETIME` | `NOT NULL` | 마지막 수정 시간 |

### `analysis_project_files` Table
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | 식별자 |
| `project_id` | `INTEGER` | `FOREIGN KEY (analysis_projects.id)` | 프로젝트 참조 (CASCADE) |
| `task_id` | `INTEGER` | `NOT NULL` | 모듈 내부 단계 번호 (모듈마다 의미가 다름) |
| `slot` | `VARCHAR` | `NOT NULL` | 파일 슬롯 (output_0, output_1, external_1, external_2) |
| `filename` | `VARCHAR` | `NOT NULL` | 파일명 |
| `file_data` | `BLOB` | `NOT NULL` | 파일 바이너리 데이터 |
| `created_at` | `DATETIME` | `NOT NULL` | 생성 시간 |
| `analysis_task_id` | `INTEGER` | `FOREIGN KEY (analysistasks.id), NULLABLE` | 이 파일을 생성한 실행(AnalysisTask) 참조 (SET NULL) |

> `(project_id, task_id, slot)` 조합이 UNIQUE 제약.
```

`analysistasks` 테이블 설명에서 `deletion_workflow_project_id` 언급이 있다면 `analysis_project_id`로 갱신(이전 세션에서 추가한 설명 참고).

- [x] **Step 3: Commit**

```bash
git add CLAUDE.md docs/DATABASE.md
git commit -m "docs: analysis_projects 일반화 및 모듈형 확장 패턴 반영"
```

---

## Self-Review 체크리스트 (실행 전 참고용)

- **스펙 커버리지**: 스펙의 "① 백엔드"(Task 1~5), "② 프론트엔드 모듈 레지스트리/페이지"(Task 6~12, 14), "③ 라우팅/마이그레이션 순서"(Task 13, 그리고 Task 1~15의 순서 자체가 스펙의 구현 순서 1~5와 대응) 모두 태스크로 커버됨. "명시적 비범위" 3항목(파이프라인 실행 공통화, 신규 모듈 실제 구현, `/deletion-workflow/legacy` 통합)은 어떤 태스크에서도 건드리지 않음.
- **타입/시그니처 일관성**: `AnalysisProject`/`AnalysisProjectFile`(백엔드 모델, Task 1) ↔ `crud_analysis_project`(Task 2) ↔ `analysis_projects.py` 엔드포인트(Task 3) ↔ 프론트 `AnalysisProject`/`AnalysisProjectDetail`(Task 6) ↔ `ProjectListPage`/`DeletionWorkflowDetailPage`(Task 11~12) 전 구간에서 필드명(`module_type`, `analysis_project_id`, `pipeline_task_id`) 일치 확인됨. `QuickAnalysisModule`/`ProjectAnalysisModule`(Task 6) 인터페이스가 Task 7~8(quick 모듈)과 Task 11(deletion_workflow 모듈)에서 동일하게 구현됨.
- **순서 의존성**: Task 9(ProjectListPage 라우팅 연결)는 실제로는 Task 13에서 이루어지도록 Task 11 Step 3~5에서 명시적으로 범위를 조정함(DeletionWorkflowListPage 삭제가 App.tsx 갱신과 같은 커밋이어야 빌드가 깨지지 않으므로) — 각 태스크 종료 시점에 빌드가 깨지지 않도록 재배치 완료.
