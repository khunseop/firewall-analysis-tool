#!/usr/bin/env python3
"""
Palo Alto Parameter Checker 실행 스크립트
"""

if __name__ == '__main__':
    from app import ParameterCheckerApp
    print("=" * 60)
    print("🛡️  Palo Alto Parameter Checker v2.0")
    print("=" * 60)
    
    try:
        app = ParameterCheckerApp()
        app.mainloop()
    except KeyboardInterrupt:
        print("\n👋 프로그램을 종료합니다.")
    except Exception as e:
        print(f"❌ 프로그램 시작 오류: {e}")