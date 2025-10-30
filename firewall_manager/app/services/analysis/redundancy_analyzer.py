"""
중복 정책 분석을 위한 클래스입니다.
"""

import pandas as pd
import logging
from typing import List
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from app import crud, models, schemas

class RedundancyAnalyzer:
    """중복 정책 분석을 위한 클래스"""

    def __init__(self, db: AsyncSession):
        """RedundancyAnalyzer 초기화"""
        self.logger = logging.getLogger(__name__)
        self.db = db
        self.vendor_columns = {
            'paloalto': ['enable', 'action', 'source', 'user', 'destination', 'service', 'application', 'security_profile','category', 'vsys'],
            'ngf': ['enable', 'action', 'source', 'user', 'destination', 'service', 'application'],
            'default': ['enable', 'action', 'source', 'user', 'destination', 'service', 'application']
        }
        self.extracted_columns = {
             'paloalto': ['enable', 'action', 'source', 'user', 'destination', 'service', 'application', 'security_profile', 'category', 'vsys'],
            'ngf': ['enable', 'action', 'source', 'user', 'destination', 'service', 'application'],
            'default': ['enable', 'action', 'source', 'user', 'destination', 'service', 'application']
        }

    def _normalize_policy(self, policy_series: pd.Series) -> tuple:
        """
        정책 데이터를 정규화합니다.
        """
        if 'enable' in policy_series.index:
            policy_series['enable'] = 'Y' if policy_series['enable'] else 'N'

        normalized_policy = policy_series.apply(lambda x: ','.join(sorted(str(x).split(','))) if isinstance(x, str) else x)
        return tuple(normalized_policy)

    def _prepare_data(self, policies: List[models.Policy], vendor: str) -> pd.DataFrame:
        """
        분석을 위해 데이터를 준비합니다.
        """
        policies_dict = [p.__dict__ for p in policies]
        df = pd.DataFrame(policies_dict)
        df_filtered = df[(df['enable'] == True) & (df['action'] == 'allow')].copy()

        if vendor == 'paloalto':
            df_filtered['service'] = df_filtered['service'].str.replace('_', '-')

        return df_filtered

    async def analyze(self, device: models.Device) -> List[schemas.RedundancyPolicySetCreate]:
        """
        중복 정책을 분석합니다.
        """
        self.logger.info(f"[{device.name}] 중복 정책 분석 시작")

        vendor = device.vendor
        all_policies = await crud.policy.get_policies_by_device(self.db, device_id=device.id)

        df_filtered = self._prepare_data(all_policies, vendor)
        if df_filtered.empty:
            self.logger.info(f"[{device.name}] 분석할 정책이 없습니다.")
            return []

        columns_to_check = self.vendor_columns.get(vendor, self.vendor_columns['default'])

        for col in columns_to_check:
            if col not in df_filtered.columns:
                df_filtered[col] = ''

        df_check = df_filtered[columns_to_check]

        policy_map = defaultdict(list)
        results_list = []
        current_no = 1

        self.logger.info(f"[{device.name}] 총 {len(df_filtered)}개의 정책에 대해 중복 여부 확인 중...")
        for i in range(len(df_filtered)):
            try:
                current_policy_key = self._normalize_policy(df_check.iloc[i])
                original_policy_row = df_filtered.iloc[i]

                if current_policy_key in policy_map:
                    set_no = policy_map[current_policy_key]
                    row_dict = {
                        "set_number": set_no,
                        "type": "Lower",
                        "policy_id": original_policy_row.get('id'),
                        **original_policy_row[columns_to_check].to_dict()
                    }
                    results_list.append(row_dict)
                else:
                    policy_map[current_policy_key] = current_no
                    set_no = current_no
                    row_dict = {
                        "set_number": set_no,
                        "type": "Upper",
                        "policy_id": original_policy_row.get('id'),
                        **original_policy_row[columns_to_check].to_dict()
                    }
                    results_list.append(row_dict)
                    current_no += 1
            except Exception as e:
                self.logger.warning(f"정책 {i} 분석 중 오류 발생: {e}")
                continue

        results_df = pd.DataFrame(results_list)

        valid_indices = results_df.groupby('set_number')['type'].transform(lambda x: 'Upper' in x.values and 'Lower' in x.values)
        duplicated_results_df = results_df[valid_indices]

        if duplicated_results_df.empty:
            self.logger.info(f"[{device.name}] 중복 정책이 발견되지 않았습니다.")
            return []

        duplicated_results_df['set_number'] = duplicated_results_df.groupby('set_number').ngroup() + 1

        final_results = []
        for _, row in duplicated_results_df.iterrows():
            enable_val = row.get('enable')
            if isinstance(enable_val, bool):
                 row['enable'] = 'Y' if enable_val else 'N'

            final_results.append(schemas.RedundancyPolicySetCreate(**row.to_dict()))

        self.logger.info(f"[{device.name}] 중복 정책 분석 완료. {len(duplicated_results_df)}개의 중복 항목 발견.")
        return final_results
