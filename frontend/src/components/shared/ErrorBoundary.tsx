import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 라우트 레벨 렌더 에러 폴백.
 * 렌더 중 예외가 발생해도 화이트스크린 대신 복구 UI를 보여준다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ error: null })
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center">
          <div className="p-4 bg-red-50 rounded-full mb-4">
            <AlertTriangle className="w-7 h-7 text-ds-error" />
          </div>
          <p className="text-sm font-semibold text-ds-on-surface">화면을 표시하는 중 오류가 발생했습니다.</p>
          <p className="text-xs text-ds-on-surface-variant mt-1 max-w-md break-all">
            {this.state.error.message}
          </p>
          <button
            onClick={this.handleReload}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-ds-tertiary rounded-lg border border-ds-outline-variant/30 hover:bg-ds-tertiary/10 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            새로고침
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
