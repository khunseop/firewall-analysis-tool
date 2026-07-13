"""
여러 방화벽에서 뽑은 동일 카테고리의 통보파일(예: 장기미사용정책(공지용).xlsx)을
서로 비교해서, 식별용 컬럼(Rule Name/규칙명, Seq 등)만 다르고 나머지가 전부 동일한
'공통 정책'을 찾는다.

vf(마스터 정책) 파일 하나로 합쳐서 비교하던 이전 방식과 달리, 입력 파일 각각에 대해
"공통 정책만 남긴 새 버전"을 개별적으로 생성한다 — 그래야 결과 파일에서 Rule Name만
보고도 어느 장비(어느 파일)의 정책인지 바로 알 수 있다.

사용법:
    python scripts/vf_common_policy_finder.py
        → 현재 디렉터리에서 .xlsx 파일을 찾아 선택하게 함

    python scripts/vf_common_policy_finder.py file1.xlsx file2.xlsx ...
        → 지정한 파일들로 바로 실행

결과:
    입력 파일마다 "{원본파일명}_공통.xlsx" 생성 (입력이 6개면 결과도 최대 6개.
    특정 파일의 정책이 전부 공통에서 빠지면 그 파일의 공통정책 시트는 0건이 될 수 있다)
        - 공통정책 시트: 모든 입력 파일에 동일 키(식별 컬럼 제외 전부 일치)를 가진
          행이 존재하는 정책들 — 원본 행 데이터(Rule Name 등 포함) 그대로 유지
        - 예외정책 시트: 이 파일에만 있거나 일부 파일에서만 공통되어 제외된 정책들.
          "존재하는_파일" / "없는_파일" 컬럼으로 어디에 있고 없는지 표시
"""

import sys
from pathlib import Path

import pandas as pd

# vf/통보파일에서 시트 이름 (0이면 첫 번째 시트 사용)
SHEET_NAME = 0

# 통보파일은 1행이 제목 등 부가정보이고 헤더가 2행부터 시작 (0-indexed)
HEADER_ROW = 1

# 정책 식별용/비교 제외 컬럼(공통정책 판단 기준에서 제외) — 원본/번역본 컬럼명을 모두 포함
ID_COLUMNS = {"Rule Name", "규칙명", "Seq", "순번", "No", "No.", "Description", "설명"}

OUTPUT_SUFFIX = "_공통"

# 콤마로 여러 객체가 나열되는 컬럼 — 객체 순서가 달라도 같은 값으로 취급
MULTI_VALUE_COLUMNS = {
    "Source", "출발지",
    "User", "사용자",
    "Destination", "목적지",
    "Service", "서비스",
    "Application", "애플리케이션",
}


def select_files_in_cwd() -> list[Path]:
    candidates = sorted(Path.cwd().glob("*.xlsx"))
    if not candidates:
        print("현재 디렉터리에 .xlsx 파일이 없습니다.")
        sys.exit(1)

    print("현재 디렉터리에서 발견한 xlsx 파일:")
    for i, path in enumerate(candidates, 1):
        print(f"  [{i}] {path.name}")

    raw = input("\n비교할 통보파일 번호를 쉼표로 구분해서 입력하세요 (예: 1,2,3,4,5,6): ").strip()
    indices = [int(x) for x in raw.split(",") if x.strip()]
    selected = [candidates[i - 1] for i in indices]

    if len(selected) < 2:
        print("비교하려면 최소 2개 이상의 파일을 선택해야 합니다.")
        sys.exit(1)

    return selected


def normalize_value(value, column: str = "") -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    if column in MULTI_VALUE_COLUMNS and "," in text:
        tokens = sorted(t.strip() for t in text.split(",") if t.strip())
        return ",".join(tokens)
    return text


def load_file(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=SHEET_NAME, header=HEADER_ROW)
    df.attrs["source_name"] = path.name
    return df


def output_path_for(path: Path) -> Path:
    return path.with_name(f"{path.stem}{OUTPUT_SUFFIX}{path.suffix}")


def main():
    args = sys.argv[1:]
    raw_files = [Path(a) for a in args] if args else select_files_in_cwd()

    for f in raw_files:
        if not f.exists():
            print(f"파일을 찾을 수 없습니다: {f}")
            sys.exit(1)

    # 절대경로로 정규화 + 딕셔너리 키를 파일명(basename)이 아닌 전체경로로 사용
    # (서로 다른 폴더에 있는 파일들이 같은 이름을 쓰면 basename 키가 충돌해
    #  일부 파일 데이터가 다른 파일 것으로 덮어써지는 문제를 방지)
    files = [f.resolve() for f in raw_files]
    keys = [str(p) for p in files]

    # 사람이 보기 좋은 표시용 라벨 — basename이 겹치면 상위 폴더명을 붙여 구분
    name_counts: dict[str, int] = {}
    for p in files:
        name_counts[p.name] = name_counts.get(p.name, 0) + 1
    labels = {
        str(p): (p.name if name_counts[p.name] == 1 else f"{p.parent.name}/{p.name}")
        for p in files
    }

    print(f"\n비교 대상 {len(files)}개 파일:")
    for p in files:
        print(f"  - {labels[str(p)]}")

    dataframes = {str(p): load_file(p) for p in files}

    # 모든 파일에 공통으로 존재하는 컬럼(식별용 컬럼 제외)을 매칭 기준으로 자동 판단
    common_columns = set.intersection(*(set(df.columns) for df in dataframes.values()))
    match_columns = sorted(common_columns - ID_COLUMNS)

    if not match_columns:
        print("모든 파일에 공통으로 존재하는 비교 가능한 컬럼이 없습니다.")
        sys.exit(1)

    all_columns = set.union(*(set(df.columns) for df in dataframes.values()))
    uncommon = all_columns - common_columns - ID_COLUMNS
    if uncommon:
        print(f"\n⚠ 일부 파일에만 존재해 비교에서 제외된 컬럼: {sorted(uncommon)}")

    print(f"\n공통 판단 기준 컬럼 ({len(match_columns)}개): {match_columns}")

    def make_key(row) -> tuple:
        return tuple(normalize_value(row[col], col) for col in match_columns)

    key_sets: dict[str, set] = {}
    for key, df in dataframes.items():
        df["__KEY__"] = df.apply(make_key, axis=1)
        key_sets[key] = set(df["__KEY__"])

    common_keys = set.intersection(*key_sets.values())
    print(f"\n{len(keys)}개 파일 모두에 존재하는 공통 정책 키: {len(common_keys)}건")

    # 각 키가 어느 파일들에 존재하는지 미리 계산 (예외정책 시트용)
    presence: dict[tuple, list[str]] = {}
    for key, s in key_sets.items():
        for policy_key in s:
            presence.setdefault(policy_key, []).append(key)

    for path in files:
        key = str(path)
        label = labels[key]
        df = dataframes[key]

        common_df = df[df["__KEY__"].isin(common_keys)].drop(columns=["__KEY__"])

        exception_df = df[~df["__KEY__"].isin(common_keys)].copy()
        exception_df["존재하는_파일"] = exception_df["__KEY__"].map(
            lambda k: ", ".join(labels[fk] for fk in presence.get(k, []))
        )
        exception_df["없는_파일"] = exception_df["__KEY__"].map(
            lambda k: ", ".join(labels[fk] for fk in keys if fk not in presence.get(k, []))
        )
        exception_df = exception_df.drop(columns=["__KEY__"])

        out_path = output_path_for(path)
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            common_df.to_excel(writer, sheet_name="공통정책", index=False)
            exception_df.to_excel(writer, sheet_name="예외정책", index=False)

        print(
            f"\n{label} → {out_path.name}"
            f"\n  - 공통정책: {len(common_df)} rows"
            f"\n  - 예외정책: {len(exception_df)} rows"
        )


if __name__ == "__main__":
    main()
