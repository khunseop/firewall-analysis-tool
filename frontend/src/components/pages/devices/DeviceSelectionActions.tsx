import { RefreshCw, Wifi, Pencil, Settings2, Tag, FileDown, Trash2, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionMenu } from '@/components/shared/ActionMenu'

/**
 * 장비를 선택했을 때 나타나는 작업 — 자주 쓰는 "동기화"와 "연결 테스트"만 앞에 두고,
 * 나머지는 "더 보기"로 접었으며, 되돌릴 수 없는 "삭제"는 구분선 뒤에 따로 둔다.
 */
export function DeviceSelectionActions({
  count, onSync, onTestConnection, onEdit, onOptions, onGroup, onExport, onDelete,
}: {
  count: number
  onSync: () => void
  onTestConnection: () => void
  onEdit: () => void
  onOptions: () => void
  onGroup: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const isSingle = count === 1
  return (
    <>
      <span className="text-11 font-semibold text-ds-tertiary tabular-nums shrink-0" aria-live="polite">{count}개 선택</span>
      <Button variant="subtle" size="auto" onClick={onSync} className="gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg">
        <RefreshCw className="!w-3 !h-3" />동기화
      </Button>
      <Button variant="subtle" size="auto" onClick={onTestConnection} className="gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg">
        <Wifi className="!w-3 !h-3" />연결 테스트
      </Button>
      <ActionMenu
        label="더 보기"
        ariaLabel="선택한 장비에 대한 더 많은 작업"
        icon={<MoreHorizontal className="!w-3.5 !h-3.5" />}
        className="!px-2.5 !text-xs"
        items={[
          { key: 'edit', label: '수정', icon: <Pencil className="w-3.5 h-3.5" />, onSelect: onEdit, disabled: !isSingle, title: isSingle ? undefined : '수정은 장비를 1대만 선택했을 때 사용할 수 있습니다.' },
          { key: 'options', label: '수집 옵션', icon: <Settings2 className="w-3.5 h-3.5" />, onSelect: onOptions },
          { key: 'group', label: '그룹 설정', icon: <Tag className="w-3.5 h-3.5" />, onSelect: onGroup },
          { key: 'export', label: '직접 추출', icon: <FileDown className="w-3.5 h-3.5" />, onSelect: onExport },
        ]}
      />
      <span className="w-px h-4 bg-ds-outline-variant/30 shrink-0" aria-hidden="true" />
      <Button
        variant="subtle" size="auto" onClick={onDelete}
        className="gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg !text-ds-error border-ds-error/20 hover:!bg-ds-error/10"
      >
        <Trash2 className="!w-3 !h-3" />삭제
      </Button>
    </>
  )
}
