const fs = require('fs');
const g = require('/Users/hoon/Code/firewall-analysis-tool/.ua/tmp/classified.json');

const layers = [
  {
    id: 'layer:api',
    name: 'API 레이어',
    description: 'FastAPI 라우트 핸들러(app/api)와 프론트엔드 axios API 클라이언트(src/api)로 구성된 요청/응답 진입점 계층',
    nodeIds: g.api,
  },
  {
    id: 'layer:service',
    name: '서비스 레이어',
    description: '멀티 벤더 방화벽 연동, 동기화 오케스트레이션, 정책 인덱싱, 분석 엔진, 삭제 워크플로우, 정책 빌더 등 핵심 비즈니스 로직',
    nodeIds: g.service,
  },
  {
    id: 'layer:data',
    name: '데이터 레이어',
    description: 'SQLAlchemy ORM 모델, CRUD 계층, DB 세션, Alembic 마이그레이션으로 구성된 영속성 계층',
    nodeIds: g.data,
  },
  {
    id: 'layer:types',
    name: '타입/스키마 레이어',
    description: 'Pydantic 요청/응답 스키마(backend/app/schemas)와 프론트엔드 TypeScript 타입 정의(frontend/src/types)',
    nodeIds: g.types,
  },
  {
    id: 'layer:ui',
    name: 'UI 레이어',
    description: 'React 페이지·컴포넌트, 라우팅/레이아웃, Zustand 스토어, 커스텀 훅, 클라이언트 유틸리티로 구성된 프론트엔드 프레젠테이션 계층',
    nodeIds: g.ui,
  },
  {
    id: 'layer:config',
    name: '설정/인프라 레이어',
    description: '앱 핵심 설정(app/core), 빌드/린트/타입스크립트 설정, alembic.ini, 배포 스크립트 등 프로젝트 구성 및 실행 환경 파일',
    nodeIds: g.config,
  },
  {
    id: 'layer:scripts',
    name: '운영 스크립트 레이어',
    description: '중복 정책/객체 검사, 데이터 정리, 디버깅, 관리자 생성 등 일회성 운영·유지보수용 독립 실행 스크립트',
    nodeIds: g.scripts,
  },
  {
    id: 'layer:documentation',
    name: '문서 레이어',
    description: '아키텍처, 개발 가이드, 삭제 워크플로우 운영 매뉴얼, README 등 프로젝트 및 서브시스템 문서',
    nodeIds: g.documentation,
  },
];

let total = 0;
for (const l of layers) total += l.nodeIds.length;
console.log('total assigned', total);

fs.writeFileSync('/Users/hoon/Code/firewall-analysis-tool/.ua/intermediate/layers.json', JSON.stringify(layers, null, 2));
console.log('written');
