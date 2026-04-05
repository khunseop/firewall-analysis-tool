import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { getSettings, updateSetting, getDeletionWorkflowConfig, updateDeletionWorkflowConfig } from '@/api/settings'

function GeneralSettings() {
  const queryClient = useQueryClient()
  const { data: settings = [], isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings.length > 0) {
      const map: Record<string, string> = {}
      settings.forEach((s) => { map[s.key] = s.value })
      setValues(map)
    }
  }, [settings])

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateSetting(key, value),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('설정이 저장되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = (key: string) => {
    updateMutation.mutate({ key, value: values[key] ?? '' })
  }

  if (isLoading) return <p className="text-sm text-muted-foreground py-4">로딩 중...</p>

  return (
    <div className="space-y-4">
      {settings.map((s) => (
        <div key={s.key} className="space-y-1.5">
          <Label htmlFor={s.key} className="text-sm font-medium">
            {s.key}
          </Label>
          {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
          <div className="flex gap-2">
            <Input
              id={s.key}
              value={values[s.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
              className="max-w-sm"
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => handleSave(s.key)}
              disabled={updateMutation.isPending}
            >
              <Save className="h-3 w-3" /> 저장
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function WorkflowConfigSettings() {
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({
    queryKey: ['workflow-config'],
    queryFn: getDeletionWorkflowConfig,
  })
  const [rawJson, setRawJson] = useState('')
  const [jsonError, setJsonError] = useState('')

  useEffect(() => {
    if (config) setRawJson(JSON.stringify(config, null, 2))
  }, [config])

  const updateMutation = useMutation({
    mutationFn: (cfg: Record<string, unknown>) => updateDeletionWorkflowConfig(cfg),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workflow-config'] }); toast.success('설정이 저장되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = () => {
    try {
      const parsed = JSON.parse(rawJson)
      setJsonError('')
      updateMutation.mutate(parsed)
    } catch {
      setJsonError('유효하지 않은 JSON 형식입니다.')
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground py-4">로딩 중...</p>

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">삭제 워크플로우 설정을 JSON 형식으로 수정합니다.</p>
      <Textarea
        value={rawJson}
        onChange={(e) => { setRawJson(e.target.value); setJsonError('') }}
        rows={20}
        className="font-mono text-xs"
      />
      {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
      <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-1.5">
        <Save className="h-4 w-4" /> 저장
      </Button>
    </div>
  )
}

export function SettingsPage() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">설정</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="general">
          <TabsList className="mb-4">
            <TabsTrigger value="general">일반 설정</TabsTrigger>
            <TabsTrigger value="workflow">삭제 워크플로우 설정</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="workflow">
            <WorkflowConfigSettings />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
