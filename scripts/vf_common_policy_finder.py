"""
6개 방화벽의 삭제 워크플로우 최종 정책 파일(vf)을 비교해서,
Seq/Rule Name만 다르고 나머지는 동일한 '공통 정책'(6개 장비 모두에 존재)을 찾는다.

사용법:
    python scripts/vf_common_policy_finder.py
        → 현재 디렉터리에서 .xlsx 파일을 찾아 선택하게 함

    python scripts/vf_common_policy_finder.py file1.xlsx file2.xlsx ... file6.xlsx
        → 지정한 파일들로 바로 실행

결과:
    ./vf_common_policy_result.xlsx 생성
        - 공통정책: 6개 파일 모두에 동일 키(MATCH_COLUMNS)를 가진 row가 있는 정책들
        - 예외정책: 일부 파일에만 존재하는 정책들 (어느 파일에 없는지 표시)
"""

import sys
from pathlib import Path

import pandas as pd

# vf 파일에서 시트 이름 (0이면 첫 번째 시트 사용)
SHEET_NAME = 0

# 정책 식별에 사용할 컬럼 (Seq, Rule Name은 의도적으로 제외)
MATCH_COLUMNS = [
    "Source",
    "Destination",
    "Service",
    "Application",
    "REQUEST_ID",
    "REQUEST_START_DATE",
    "REQUEST_END_DATE",
    "REQUESTER_ID",
    "MIS_ID",
    "통보대상",
]

OUTPUT_PATH = Path("vf_common_policy_result.xlsx")


def select_files_in_cwd() -> list[Path]:
    candidates = sorted(Path.cwd().glob("*.xlsx"))
    if not candidates:
        print("현재 디렉터리에 .xlsx 파일이 없습니다.")
        sys.exit(1)

    print("현재 디렉터리에서 발견한 xlsx 파일:")
    for i, path in enumerate(candidates, 1):
        print(f"  [{i}] {path.name}")

    raw = input("\n비교할 파일 번호를 쉼표로 구분해서 입력하세요 (예: 1,2,3,4,5,6): ").strip()
    indices = [int(x) for x in raw.split(",") if x.strip()]
    selected = [candidates[i - 1] for i in indices]

    if len(selected) < 2:
        print("비교하려면 최소 2개 이상의 파일을 선택해야 합니다.")
        sys.exit(1)

    return selected


def normalize_value(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def load_file(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=SHEET_NAME)

    missing = [col for col in MATCH_COLUMNS if col not in df.columns]
    if missing:
        raise ValueError(f"{path.name}: 다음 컬럼을 찾을 수 없습니다: {missing}")

    df = df.copy()
    df["__KEY__"] = df[MATCH_COLUMNS].apply(
        lambda row: tuple(normalize_value(v) for v in row), axis=1
    )
    df["__SOURCE_FILE__"] = path.name
    return df


def main():
    args = sys.argv[1:]
    files = [Path(a) for a in args] if args else select_files_in_cwd()

    for f in files:
        if not f.exists():
            print(f"파일을 찾을 수 없습니다: {f}")
            sys.exit(1)

    print(f"\n비교 대상 {len(files)}개 파일:")
    for f in files:
        print(f"  - {f.name}")

    dataframes = {f.name: load_file(f) for f in files}
    file_names = list(dataframes.keys())

    key_sets = {name: set(df["__KEY__"]) for name, df in dataframes.items()}
    common_keys = set.intersection(*key_sets.values())

    print(f"\n총 정책 키 후보: {sum(len(s) for s in key_sets.values())}건 (중복 포함)")
    print(f"{len(file_names)}개 파일 모두에 존재하는 공통 정책 키: {len(common_keys)}건")

    common_rows = []
    for name, df in dataframes.items():
        matched = df[df["__KEY__"].isin(common_keys)]
        common_rows.append(matched)
    common_df = pd.concat(common_rows, ignore_index=True) if common_rows else pd.DataFrame()

    all_keys = set.union(*key_sets.values())
    exception_keys = all_keys - common_keys

    exception_records = []
    for key in exception_keys:
        present_in = [name for name, s in key_sets.items() if key in s]
        missing_in = [name for name in file_names if name not in present_in]
        record = dict(zip(MATCH_COLUMNS, key))
        record["존재하는_파일"] = ", ".join(present_in)
        record["없는_파일"] = ", ".join(missing_in)
        exception_records.append(record)
    exception_df = pd.DataFrame(exception_records)

    with pd.ExcelWriter(OUTPUT_PATH, engine="openpyxl") as writer:
        common_df.drop(columns=["__KEY__"], errors="ignore").to_excel(
            writer, sheet_name="공통정책", index=False
        )
        exception_df.to_excel(writer, sheet_name="예외정책", index=False)

    print(f"\n결과 저장 완료: {OUTPUT_PATH.resolve()}")
    print(f"  - 공통정책 시트: {len(common_df)} rows")
    print(f"  - 예외정책 시트: {len(exception_df)} rows")


if __name__ == "__main__":
    main()
