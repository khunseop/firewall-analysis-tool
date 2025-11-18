import pandas as pd

def parse_multivalue(value: str) -> set:
    if pd.isna(value):
        return set()
    return set(x.strip() for x in str(value).split(','))

def check_indirect_change(policy_value: str, changed_names: set) -> bool:
    if pd.isna(policy_value):
        return False
    policy_set = set(x.strip() for x in str(policy_value).split(','))
    return not policy_set.isdisjoint(changed_names)
