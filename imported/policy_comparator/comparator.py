import pandas as pd
from .utils import parse_multivalue

class PolicyComparator:
    def __init__(self, policy_old, policy_new, object_old, object_new):
        self.policy_old_path = policy_old
        self.policy_new_path = policy_new
        self.object_old_path = object_old
        self.object_new_path = object_new

        self.object_diffs = {}
        self.changed_obj_names = {'Source': set(), 'Destination': set(), 'Service': set()}
        self.added_df = pd.DataFrame()
        self.removed_df = pd.DataFrame()
        self.modified_list = []
        self.df_old = None  # 정책 비교 전 상태 저장용

    def compare_objects(self, df_old, df_new, key_field, compare_fields, is_group=False):
        df_old = df_old.set_index(key_field)
        df_new = df_new.set_index(key_field)
        all_keys = set(df_old.index).union(df_new.index)

        added, removed, modified, changed_keys = [], [], [], set()

        for key in all_keys:
            if key not in df_old.index:
                added.append({'Name': key, **df_new.loc[key].to_dict()})
                changed_keys.add(key)
            elif key not in df_new.index:
                removed.append({'Name': key, **df_old.loc[key].to_dict()})
                changed_keys.add(key)
            else:
                diffs = {}
                for field in compare_fields:
                    val1 = df_old.at[key, field]
                    val2 = df_new.at[key, field]
                    if is_group:
                        set1 = parse_multivalue(val1)
                        set2 = parse_multivalue(val2)
                        if set1 != set2:
                            diffs[field] = {
                                'from': ', '.join(sorted(set1)),
                                'to': ', '.join(sorted(set2)),
                                'added': ', '.join(sorted(set2 - set1)),
                                'removed': ', '.join(sorted(set1 - set2))
                            }
                    else:
                        if str(val1) != str(val2):
                            diffs[field] = {
                                'from': val1,
                                'to': val2,
                                'added': '',
                                'removed': ''
                            }
                if diffs:
                    for field, diff in diffs.items():
                        modified.append({'Name': key, 'Field': field, **diff})
                    changed_keys.add(key)

        return added, removed, modified, changed_keys

    def compare_all_objects(self):
        sheet_defs = {
            'address':       ('Name', ['Value'], False),
            'address_group': ('Group Name', ['Entry'], True),
            'service':       ('Name', ['Protocol', 'Port'], False),
            'service_group': ('Group Name', ['Entry'], True),
        }

        for sheet, (key, fields, is_group) in sheet_defs.items():
            try:
                df_old = pd.read_excel(self.object_old_path, sheet_name=sheet)
                df_new = pd.read_excel(self.object_new_path, sheet_name=sheet)
            except Exception:
                continue

            added, removed, modified, changed_keys = self.compare_objects(df_old, df_new, key, fields, is_group)
            self.object_diffs[f'{sheet}_diff'] = (added, removed, modified)

            if 'address' in sheet:
                self.changed_obj_names['Source'].update(changed_keys)
                self.changed_obj_names['Destination'].update(changed_keys)
            elif 'service' in sheet:
                self.changed_obj_names['Service'].update(changed_keys)

    def compare_policies(self):
        df_old = pd.read_excel(self.policy_old_path, sheet_name='policy')
        df_new = pd.read_excel(self.policy_new_path, sheet_name='policy')
        self.df_old = df_old

        df_old = df_old.set_index('Rule Name')
        df_new = df_new.set_index('Rule Name')

        multivalue_fields = ['Source', 'User', 'Destination', 'Service', 'Application']
        indirect_fields = ['Source', 'Destination', 'Service']
        ignore_fields = ['Seq', 'Rule Name']

        added_df = df_new[~df_new.index.isin(df_old.index)].reset_index()
        removed_df = df_old[~df_old.index.isin(df_new.index)].reset_index()
        modified = []

        for key in set(df_old.index).intersection(df_new.index):
            diff_fields = {}
            indirect = False
            indirect_impacted_fields = []

            for col in df_old.columns:
                if col in ignore_fields:
                    continue

                val1 = df_old.at[key, col]
                val2 = df_new.at[key, col]

                if col in multivalue_fields:
                    set1 = parse_multivalue(val1)
                    set2 = parse_multivalue(val2)
                    if set1 != set2:
                        diff_fields[col] = {
                            'from': sorted(set1),
                            'to': sorted(set2),
                            'added': sorted(set2 - set1),
                            'removed': sorted(set1 - set2)
                        }
                    if col in indirect_fields:
                        changed_refs = set1 & self.changed_obj_names.get(col, set())
                        if changed_refs:
                            indirect = True
                            indirect_impacted_fields.append((col, changed_refs))
                else:
                    if pd.isna(val1) and pd.isna(val2):
                        continue
                    if str(val1) != str(val2):
                        diff_fields[col] = {
                            'from': val1,
                            'to': val2,
                            'added': '',
                            'removed': ''
                        }

            if diff_fields or indirect:
                modified.append({
                    'Rule Name': key,
                    'Changes': diff_fields,
                    'Indirect Change': indirect,
                    'Indirect Fields': indirect_impacted_fields
                })

        self.added_df = added_df
        self.removed_df = removed_df
        self.modified_list = modified
