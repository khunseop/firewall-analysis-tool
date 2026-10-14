import { addPendingChange, removePendingChange, type PendingPolicyChange } from '@/api/policyBuilder'

/** 기존 정책들의 비활성화/활성화를 대기중 변경사항으로 반영한다.
 *  이미 걸려 있던 disable 변경과 반대 방향으로 토글하면 원래 상태로 돌아가는 것이므로
 *  기존 변경만 제거하고 새로 추가하지 않는다(불필요한 `disabled no` CLI 방지). */
export async function setPoliciesDisabled(
  deviceId: number, policyIds: number[], disabled: boolean, pendingChanges: PendingPolicyChange[],
): Promise<void> {
  const idSet = new Set(policyIds)
  const existing = pendingChanges.filter((c) => c.change_type === 'disable' && c.target_policy_id != null && idSet.has(c.target_policy_id))
  await Promise.all(existing.map((c) => removePendingChange(deviceId, c.id)))
  const revertedIds = new Set(existing.filter((c) => c.payload.disabled !== disabled).map((c) => c.target_policy_id))
  const timestamp = Date.now()
  await Promise.all(policyIds.filter((id) => !revertedIds.has(id)).map((policyId) => addPendingChange(deviceId, {
    change_type: 'disable', target_policy_id: policyId, client_key: `disable-${policyId}-${timestamp}`, payload: { disabled },
  })))
}
