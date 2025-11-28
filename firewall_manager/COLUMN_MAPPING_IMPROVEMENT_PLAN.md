# 컬럼 매핑 개선 방안

## 현재 문제점

1. JSON 설정 파일에 수동으로 컬럼 매핑 정의가 불편함
2. 정규화 로직이 복잡하고 제대로 작동하지 않음
3. 매핑 실패 시 디버깅이 어려움
4. 매핑 설정을 변경하려면 설정 파일을 수정해야 함

## 개선 방안

### 방안 1: 2단계 프로세스 (권장) ⭐

#### Step 4-1: 컬럼 분석 및 매핑 제안
- 엑셀 파일 업로드
- 컬럼 목록 추출
- 자동 매핑 제안 (여러 전략 조합)
- 매핑 히스토리에서 이전 매핑 제안

#### Step 4-2: 매핑 확인 및 처리
- 사용자가 매핑 확인/수정
- 매핑 설정을 받아서 실제 처리
- 성공한 매핑을 히스토리에 저장

### 방안 2: 개선된 자동 매핑

#### 다중 전략 조합
1. **정확 일치** (100점)
2. **정규화 일치** (90점) - 공백/언더스코어/대소문자 무시
3. **키워드 매칭** (70점) - 주요 키워드 포함 여부
4. **유사도 매칭** (50점) - 문자열 유사도 (Levenshtein)
5. **부분 포함** (30점) - 한쪽이 다른 쪽에 포함

#### 점수 기반 제안
- 각 매핑에 점수 부여
- 높은 점수 순으로 제안
- 사용자가 선택하거나 수정

### 방안 3: 매핑 히스토리 저장

#### 저장 위치
- `DeletionWorkflow` 모델에 `column_mapping` 필드 추가 (JSON)
- 또는 `Settings` 테이블에 `column_mapping_history` 저장

#### 활용
- 같은 형식의 파일이 올 때 이전 매핑 자동 제안
- 매핑 템플릿 저장 및 재사용

## 구현 계획

### Phase 1: API 추가

1. **컬럼 분석 API**
   ```
   POST /deletion-workflow/{device_id}/step/4/analyze-columns
   - 엑셀 파일 업로드
   - 응답: { sheets: [{ name, columns: [...] }] }
   ```

2. **자동 매핑 제안 API**
   ```
   POST /deletion-workflow/{device_id}/step/4/suggest-mapping
   - 엑셀 컬럼 목록 전송
   - 응답: { mappings: [{ excel_col, standard_col, score, strategy }] }
   ```

3. **매핑 설정으로 Step 4 실행**
   ```
   POST /deletion-workflow/{device_id}/step/4/execute
   - 엑셀 파일 + 매핑 설정 (JSON)
   - 매핑 설정: { "엑셀컬럼명": "표준컬럼명", ... }
   ```

### Phase 2: 자동 매핑 알고리즘 개선

```python
class ColumnMapper:
    def suggest_mapping(self, excel_columns, standard_columns):
        suggestions = []
        for excel_col in excel_columns:
            best_match = None
            best_score = 0
            
            for std_col in standard_columns:
                score = self._calculate_score(excel_col, std_col)
                if score > best_score:
                    best_score = score
                    best_match = std_col
            
            if best_score > 30:  # 최소 점수
                suggestions.append({
                    'excel_column': excel_col,
                    'standard_column': best_match,
                    'score': best_score
                })
        
        return suggestions
    
    def _calculate_score(self, excel_col, std_col):
        scores = []
        
        # 1. 정확 일치
        if excel_col == std_col:
            scores.append(100)
        
        # 2. 정규화 일치
        norm_excel = self._normalize(excel_col)
        norm_std = self._normalize(std_col)
        if norm_excel == norm_std:
            scores.append(90)
        
        # 3. 키워드 매칭
        keywords = ['ID', 'DATE', 'EMAIL', 'NAME', 'DEPT']
        excel_keywords = [k for k in keywords if k in norm_excel]
        std_keywords = [k for k in keywords if k in norm_std]
        if excel_keywords == std_keywords:
            scores.append(70)
        
        # 4. 유사도 매칭
        similarity = self._similarity(norm_excel, norm_std)
        scores.append(int(similarity * 50))
        
        # 5. 부분 포함
        if norm_excel in norm_std or norm_std in norm_excel:
            scores.append(30)
        
        return max(scores) if scores else 0
```

### Phase 3: 프론트엔드 UI

1. **컬럼 분석 화면**
   - 엑셀 파일 업로드
   - 컬럼 목록 표시
   - 자동 매핑 제안 표시

2. **매핑 편집 화면**
   - 표 형식으로 매핑 표시
   - 드롭다운으로 표준 컬럼 선택
   - 자동 제안 표시 (점수와 함께)

3. **매핑 저장**
   - "이 매핑 저장" 버튼
   - 다음에 같은 형식 파일 올 때 자동 제안

## 데이터베이스 변경

### DeletionWorkflow 모델에 필드 추가
```python
column_mapping = Column(JSON, nullable=True)  # { "엑셀컬럼": "표준컬럼" }
```

또는 Settings 테이블에 저장
```python
# Settings 테이블에
key = "column_mapping_history"
value = JSON  # [{ "excel_columns": [...], "mapping": {...}, "created_at": ... }]
```

## 장점

1. ✅ 사용자 친화적: UI에서 매핑 확인 및 수정 가능
2. ✅ 자동화: 자동 매핑 제안으로 수동 작업 최소화
3. ✅ 재사용: 매핑 히스토리로 반복 작업 감소
4. ✅ 유연성: 매핑 실패 시 수동 보정 가능
5. ✅ 디버깅 용이: 매핑 과정을 시각적으로 확인 가능

