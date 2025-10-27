import pandas as pd
from typing import Tuple, Dict

class PolicyResolver:
    def __init__(self):
        self.cache: Dict[str, Tuple[str, str, str, str]] = {}

    def resolve_groupname_to_entry(self, name: str, network_group_dict: dict, resolved_cache: dict, depth: int = 0, max_depth: int = 10) -> str:
        if depth > max_depth or name in resolved_cache:
            return resolved_cache.get(name, name)

        entry = network_group_dict.get(name)
        if entry and entry != name:
            resolved_entries = [self.resolve_groupname_to_entry(n.strip(), network_group_dict, resolved_cache, depth + 1) for n in entry.split(',')]
            resolved_name = ','.join(set(resolved_entries))
            resolved_cache[name] = resolved_name
            return resolved_name

        resolved_cache[name] = name
        return name

    def process_cell(self, cell: str, network_group_dict: dict) -> str:
        resolved_cache = {}
        names = [name.strip() for name in str(cell).split(',')]
        resolved_names = [self.resolve_groupname_to_entry(name, network_group_dict, resolved_cache) for name in names]
        flattened_resolved = set(','.join(resolved_names).split(','))
        return ','.join(flattened_resolved)

    def replace_object_to_value(self, resolved_source: str, network_dict: dict) -> str:
        replaced_names = [str(network_dict.get(name, name)) for name in str(resolved_source).split(',')]
        return ','.join(set(replaced_names))


    def combine_protocol_port(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Protocol + Port 정보를 기반으로 Value 컬럼 생성
        - Protocol은 항상 대문자로 변환
        - Port에 *은 '0-65535'로 처리
        - Port에 ,가 있을 경우 row 분리

        Args:
            df (pd.DataFrame): 'Name', 'Protocol', 'Port' 컬럼 포함한 DataFrame

        Returns:
            pd.DataFrame: 'Value' 컬럼 추가 및 필요시 row 분리된 DataFrame
        """
        rows = []

        for _, row in df.iterrows():
            name = row['Name']
            protocol = str(row['Protocol']).upper()
            port_raw = str(row['Port']).replace(' ', '')

            # '*' 처리 → '0-65535'
            if port_raw == '*':
                ports = ['0-65535']
            else:
                ports = port_raw.split(',')

            for port in ports:
                port = port.strip()
                value = f"{protocol}/{port}"
                rows.append({'Name': name, 'Protocol': protocol, 'Port': port, 'Value': value})

        return pd.DataFrame(rows)

    def resolve(self, rules_df, network_object_df, network_group_object_df, service_object_df, service_group_object_df) -> pd.DataFrame:
        try:

            network_group_dict = network_group_object_df.set_index('Group Name')['Entry'].to_dict()
            network_dict = network_object_df.set_index('Name')['Value'].to_dict()

            if service_group_object_df is None or service_group_object_df.empty:
                service_group_object_df = pd.DataFrame(columns=['Group Name', 'Entry'])

            service_group_dict = service_group_object_df.set_index('Group Name')['Entry'].to_dict()
            service_object_df = self.combine_protocol_port(service_object_df)
            service_dict = service_object_df.set_index('Name')['Value'].to_dict()

            rules_df['Resolved Source'] = rules_df['Source'].apply(lambda x: self.process_cell(x, network_group_dict))
            rules_df['Resolved Destination'] = rules_df['Destination'].apply(lambda x: self.process_cell(x, network_group_dict))
            rules_df['Resolved Service'] = rules_df['Service'].apply(lambda x: self.process_cell(x, service_group_dict))

            rules_df['Extracted Source'] = rules_df['Resolved Source'].apply(lambda x: self.replace_object_to_value(x, network_dict))
            rules_df['Extracted Destination'] = rules_df['Resolved Destination'].apply(lambda x: self.replace_object_to_value(x, network_dict))
            rules_df['Extracted Service'] = rules_df['Resolved Service'].apply(lambda x: self.replace_object_to_value(x, service_dict))
            
            rules_df.drop(columns=['Resolved Source', 'Resolved Destination', 'Resolved Service'], inplace=True)

            return rules_df
        except Exception as e:
            return f"데이터 처리 중 오류 발생: {e}"
