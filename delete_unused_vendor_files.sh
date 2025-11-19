#!/bin/bash

# 미참조 외부 라이브러리 파일 삭제 스크립트
# 사용 전에 반드시 백업을 권장합니다.

set -e

VENDOR_DIR="firewall_manager/app/static/vendor"

echo "=========================================="
echo "미참조 외부 라이브러리 파일 삭제 스크립트"
echo "=========================================="
echo ""
echo "⚠️  주의: 이 스크립트는 미사용 파일을 삭제합니다."
echo "   삭제 전에 vendor 폴더를 백업하는 것을 권장합니다."
echo ""
read -p "계속하시겠습니까? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "취소되었습니다."
    exit 1
fi

echo ""
echo "삭제를 시작합니다..."
echo ""

# AG-Grid 미사용 파일 삭제
echo "[1/2] AG-Grid 미사용 파일 삭제 중..."
rm -f "$VENDOR_DIR/ag-grid/ag-grid-community.min.js"
rm -f "$VENDOR_DIR/ag-grid/ag-grid-community.min.noStyle.js"
rm -rf "$VENDOR_DIR/ag-grid/styles"
echo "  ✓ AG-Grid 미사용 파일 삭제 완료"

# Bulma 미사용 파일 삭제
echo "[2/2] Bulma 미사용 파일 삭제 중..."
# SASS 소스 파일 삭제
rm -rf "$VENDOR_DIR/bulma/sass"
rm -rf "$VENDOR_DIR/bulma/versions"
rm -f "$VENDOR_DIR/bulma/bulma.scss"
# 기타 파일 삭제
rm -f "$VENDOR_DIR/bulma/LICENSE"
rm -f "$VENDOR_DIR/bulma/package.json"
rm -f "$VENDOR_DIR/bulma/README.md"
# 미사용 CSS 파일 삭제
rm -f "$VENDOR_DIR/bulma/css/bulma.css"
rm -f "$VENDOR_DIR/bulma/css/bulma.css.map"
rm -f "$VENDOR_DIR/bulma/css/bulma.min.css"
# versions 폴더의 미사용 CSS 파일 삭제
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-prefixed.css"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-prefixed.css.map"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-prefixed.min.css"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-helpers.css"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-helpers.css.map"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-helpers.min.css"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-helpers-prefixed.css"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-helpers-prefixed.css.map"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-helpers-prefixed.min.css"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-dark-mode.css"
rm -f "$VENDOR_DIR/bulma/css/versions/bulma-no-dark-mode.css.map"
echo "  ✓ Bulma 미사용 파일 삭제 완료"

echo ""
echo "=========================================="
echo "삭제 완료!"
echo "=========================================="
echo ""
echo "다음 단계:"
echo "1. 애플리케이션을 실행하여 정상 작동 확인"
echo "2. git status로 변경사항 확인"
echo "3. git commit으로 변경사항 커밋"
echo ""
