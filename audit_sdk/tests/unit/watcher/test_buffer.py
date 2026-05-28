import audit_sdk.watcher.watcher as sdk

def test_stop_flushes_buffer(mocker):
    """stop() must drain the queue before returning."""
    watcher = sdk.init(dataset_dir="/tmp/data", step_interval=100, dataset_name="test", log_path="./watcher.log", hyperparams={})
    watcher.buffer.put({"type": "session", "action": "end", "model_cid": None, "model_hash": ""})
    watcher.stop()
    assert watcher.buffer.empty()