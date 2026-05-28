import pytest
import audit_sdk.watcher.watcher as sdk

@pytest.fixture(autouse=True)
def reset_singleton():
    """Reset the singleton before each test to ensure
    that the test cases do not interfere with each other.
    """
    sdk.TrainingWatcher._instance = None
    yield
    sdk.TrainingWatcher._instance = None


@pytest.fixture(autouse=True)
def mock_network(mocker):
    """Block all outbound HTTP calls from the watcher."""
    mocker.patch.object(sdk.TrainingWatcher, '_get_latest_packet_hash', return_value="")
    mocker.patch.object(sdk.TrainingWatcher, '_dispatch')
    mocker.patch.object(sdk.TrainingWatcher, '_upload_blob', return_value="mock-cid")
    mocker.patch.object(sdk.TrainingWatcher, '_snapshot_dataset', return_value="mock-cid")
    mocker.patch.object(sdk.TrainingWatcher, '_resolve_dataset_version', return_value="v1.0")
    mocker.patch.object(sdk.TrainingWatcher, '_calculate_initial_merkle_root', return_value="mock-merkle")
