"""용도별 전용 스레드 풀.

기본 executor(None)를 동기화 네트워크 I/O와 분석 CPU 연산이 공유하면
대량 동시 실행 시 서로를 굶길 수 있어 풀을 분리한다.

- IO_EXECUTOR: 장비 수집(SSH/API) 등 네트워크 대기 위주 작업.
  동기화 병렬 세마포어(기본 4) × 장비당 HA 포함 2연결을 감안해 8.
- CPU_EXECUTOR: 분석 비교 연산 등 CPU 바운드 작업.
  GIL 특성상 스레드를 늘려도 이득이 없고, 다른 작업을 굶기지 않도록 2로 제한.
"""
from concurrent.futures import ThreadPoolExecutor

IO_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="fat-io")
CPU_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="fat-cpu")
