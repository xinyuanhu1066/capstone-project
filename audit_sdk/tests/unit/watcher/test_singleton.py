import audit_sdk.watcher.watcher as sdk

def test_singleton():
    a = sdk.init(dataset_dir="/tmp/data", step_interval=100, dataset_name="test", log_path="./watcher.log", hyperparams={})
    b = sdk.init(dataset_dir="/tmp/data", step_interval=100, dataset_name="test", log_path="./watcher.log", hyperparams={})
    assert a is b