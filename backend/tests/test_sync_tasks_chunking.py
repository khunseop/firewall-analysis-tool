from app.services.sync.tasks import _chunked


def test_chunked_splits_into_expected_sizes():
    items = list(range(2001))
    chunks = list(_chunked(items, 800))
    assert [len(c) for c in chunks] == [800, 800, 401]
    assert [x for c in chunks for x in c] == items


def test_chunked_handles_empty_list():
    assert list(_chunked([], 800)) == []


def test_chunked_handles_list_smaller_than_chunk_size():
    items = [1, 2, 3]
    assert list(_chunked(items, 800)) == [[1, 2, 3]]
