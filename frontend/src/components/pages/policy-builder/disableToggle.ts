import { addPendingChange, removePendingChange, type PendingPolicyChange } from '@/api/policyBuilder'

/** 기존 정책들의 비활성화/활성화를 대기중 변경사항으로 반영한다.
 *  같은 정책에 이미 걸려 있던 disable 변경은 먼저 제거해 최종 상태 1건만 남긴다. */
export async function setPoliciesDisabled(
  deviceId: number, policyIds: number[], disabled: boolean, pendingChanges: PendingPolicyChange[],
): Promise<void> {
  const idSet = new Set(policyIds)
  const stale = pendingChanges.filter((c) => c.change_type === 'disable' && c.target_policy_id != null && idSet.has(c.target_policy_id))
  await Promise.all(stale.map((c) => removePendingChange(deviceId, c.id)))
  const timestamp = Date.now()
  await Promise.all(policyIds.map((policyId) => addPendingChange(deviceId, {
    change_type: 'disable', target_policy_id: policyId, client_key: `disable-${policyId}-${timestamp}`, payload: { disabled },
  })))
}
