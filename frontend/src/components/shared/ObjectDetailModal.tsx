import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getObjectDetails } from '@/api/firewall'

interface Props {
  deviceId: number
  name: string
  onClose: () => void
}

export function ObjectDetailModal({ deviceId, name, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['object-detail', deviceId, name],
    queryFn: () => getObjectDetails(deviceId, name),
    staleTime: 60_000,
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>오브젝트 상세: {name}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">데이터를 찾을 수 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(data as unknown as Record<string, unknown>)
                .filter(([k]) => !['id', 'device_id', 'is_active', 'last_seen_at'].includes(k))
                .map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-sm">
                    <span className="text-muted-foreground min-w-24 shrink-0">{k}</span>
                    <span className="font-medium break-all">{String(v ?? '-')}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
