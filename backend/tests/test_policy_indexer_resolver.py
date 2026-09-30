from types import SimpleNamespace as NS

from app.services.policy_indexer import Resolver


def test_simple_group_expands_to_member_values():
    net_objects = [
        NS(name="H1", ip_address="10.0.0.1"),
        NS(name="H2", ip_address="10.0.0.2"),
    ]
    net_groups = [NS(name="G1", members="H1,H2")]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects(net_objects, net_groups, [], [])

    assert addr_map["G1"] == {"10.0.0.1", "10.0.0.2"}
    assert addr_map["H1"] == {"10.0.0.1"}


def test_nested_group_expands_recursively():
    net_objects = [
        NS(name="H1", ip_address="10.0.0.1"),
        NS(name="H2", ip_address="10.0.0.2"),
    ]
    # G2는 G1(그룹)과 H3(존재하지 않는 객체)을 멤버로 갖는다.
    net_groups = [
        NS(name="G1", members="H1,H2"),
        NS(name="G2", members="G1,H3"),
    ]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects(net_objects, net_groups, [], [])

    # G1의 확장값 + 존재하지 않는 H3은 리터럴 이름 그대로 폴백
    assert addr_map["G2"] == {"10.0.0.1", "10.0.0.2", "H3"}


def test_empty_group_gets_marker_value():
    net_groups = [NS(name="EMPTY", members="")]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects([], net_groups, [], [])

    assert addr_map["EMPTY"] == {"__GROUP__:EMPTY"}


def test_circular_group_reference_terminates_without_error():
    # A -> B -> A 순환 참조. 무한 재귀 없이 종료해야 한다.
    net_groups = [
        NS(name="A", members="B"),
        NS(name="B", members="A"),
    ]

    resolver = Resolver()
    addr_map, _ = resolver.pre_resolve_objects([], net_groups, [], [])

    assert set(addr_map.keys()) == {"A", "B"}
    # 순환 참조 시 두 그룹 모두 같은 폴백 값(둘 중 하나의 이름) 하나로 수렴한다.
    assert addr_map["A"] == addr_map["B"]
    assert len(addr_map["A"]) == 1
    assert next(iter(addr_map["A"])) in {"A", "B"}


def test_service_group_expands_protocol_port_values():
    svc_objects = [NS(name="S1", protocol="tcp", port="80")]
    svc_groups = [NS(name="SG1", members="S1")]

    resolver = Resolver()
    _, svc_map = resolver.pre_resolve_objects([], [], svc_objects, svc_groups)

    assert svc_map["SG1"] == {"tcp/80"}
    assert svc_map["S1"] == {"tcp/80"}
