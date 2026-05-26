import torch
import audit_sdk.watcher.watcher as sdk
import pytest


def test_backward_patch_captures_loss():
    watcher = sdk.init(dataset_dir="/tmp/data", step_interval=1, dataset_name="test", log_path="./watcher.log", hyperparams={})
    tensor = torch.tensor(0.42, requires_grad=True)
    tensor.backward()
    assert watcher.current_loss == pytest.approx(0.42, abs=1e-5)
    watcher.stop()

def test_optimizer_step_increments_global_step():
    watcher = sdk.init(dataset_dir="/tmp/data", step_interval=100, dataset_name="test", log_path="./watcher.log", hyperparams={})
    initial = watcher.global_step
    model = torch.nn.Linear(2, 1)
    opt = torch.optim.SGD(model.parameters(), lr=0.01)
    loss = model(torch.randn(2)).sum()
    loss.backward()
    opt.step()
    assert watcher.global_step == initial + 1
    watcher.stop()

def test_step_interval_triggers_snapshot(mocker):
    """_capture_snapshot should fire exactly once per step_interval steps."""
    watcher = sdk.init(dataset_dir="/tmp/data", step_interval=3, dataset_name="test", log_path="./watcher.log", hyperparams={})
    spy = mocker.patch.object(watcher, '_capture_snapshot')
    model = torch.nn.Linear(2, 1)
    opt = torch.optim.SGD(model.parameters(), lr=0.01)
    for _ in range(6):
        loss = model(torch.randn(2)).sum()
        loss.backward()
        opt.step()
    assert spy.call_count == 2  # fired at step 3 and step 6
    watcher.stop()