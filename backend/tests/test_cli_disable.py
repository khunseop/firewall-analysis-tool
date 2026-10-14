from app.services.policy_builder.cli_generator import generate_rule_disable_command


def test_disable_command():
    assert generate_rule_disable_command("r1", True, None) == ("set rulebase security rules r1 disabled yes", None)


def test_enable_command_with_vsys_and_quoting():
    cmd, err = generate_rule_disable_command("my rule", False, "vsys1")
    assert err is None
    assert cmd == 'set vsys vsys1 rulebase security rules "my rule" disabled no'


def test_empty_name_errors():
    cmd, err = generate_rule_disable_command("  ", True, None)
    assert cmd is None and err
