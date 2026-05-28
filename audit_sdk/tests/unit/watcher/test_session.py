import audit_sdk.watcher.watcher as sdk

def test_session_id_format():
    watcher = sdk.init(dataset_dir="/tmp/data", step_interval=100, dataset_name="test", log_path="./watcher.log", hyperparams={})
    parts = watcher.session_id.split('-')
    assert parts[0] == 'session'
    assert parts[1].isdigit()
    watcher.stop()