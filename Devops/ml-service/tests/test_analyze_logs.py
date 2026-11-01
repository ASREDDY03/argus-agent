"""Tests for the /analyze-logs endpoint."""


def test_missing_body_returns_400(client):
    r = client.post('/analyze-logs', content_type='application/json')
    assert r.status_code == 400


def test_empty_logs_returns_empty_causes(client):
    r = client.post('/analyze-logs', json={'logs': ''})
    assert r.status_code == 200
    assert r.get_json()['root_causes'] == []


def test_oversized_payload_returns_413(client):
    # ~6 MB — exceeds the 5 MB limit
    big_log = 'error ' * (1024 * 1024)
    r = client.post('/analyze-logs', json={'logs': big_log})
    assert r.status_code == 413


def test_oom_detected(client):
    r = client.post('/analyze-logs', json={
        'logs': 'java.lang.OutOfMemoryError: Java heap space\n'
    })
    assert r.status_code == 200
    assert 'OutOfMemory' in r.get_json()['root_causes']


def test_connection_error_detected(client):
    r = client.post('/analyze-logs', json={
        'logs': 'ERROR: Connection refused: 127.0.0.1:5432'
    })
    assert r.status_code == 200
    assert 'ConnectionError' in r.get_json()['root_causes']


def test_null_pointer_detected(client):
    r = client.post('/analyze-logs', json={
        'logs': 'Exception in thread "main" java.lang.NullPointerException'
    })
    assert r.status_code == 200
    assert 'NullPointer' in r.get_json()['root_causes']


def test_multiple_categories_returned(client):
    # Each line must match error|exception|fail|warn to pass the error_lines filter.
    logs = (
        'ERROR: java.lang.OutOfMemoryError: heap space\n'
        'ERROR: Connection refused: could not connect to host\n'
        'ERROR: java.lang.NullPointerException at com.example.Foo'
    )
    r = client.post('/analyze-logs', json={'logs': logs})
    assert r.status_code == 200
    causes = r.get_json()['root_causes']
    assert 'OutOfMemory'     in causes
    assert 'ConnectionError' in causes
    assert 'NullPointer'     in causes


def test_clean_log_no_causes(client):
    r = client.post('/analyze-logs', json={
        'logs': 'Build successful. All tests passed. Deployment complete.'
    })
    assert r.status_code == 200
    assert r.get_json()['root_causes'] == []


def test_error_lines_capped_at_20(client):
    logs = '\n'.join([f'ERROR: something went wrong on line {i}' for i in range(30)])
    r = client.post('/analyze-logs', json={'logs': logs})
    assert r.status_code == 200
    assert len(r.get_json()['error_lines']) <= 20


def test_compile_error_detected(client):
    r = client.post('/analyze-logs', json={
        'logs': 'error: cannot find symbol\n  symbol: class Foo'
    })
    assert r.status_code == 200
    assert 'CompileError' in r.get_json()['root_causes']


def test_timeout_detected(client):
    # Line must match the error_lines filter (error|exception|fail|warn) to be scanned.
    r = client.post('/analyze-logs', json={
        'logs': 'ERROR: Read timed out after 30000ms waiting for response'
    })
    assert r.status_code == 200
    assert 'Timeout' in r.get_json()['root_causes']
