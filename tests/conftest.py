import pytest
import audit_sdk.watcher.watcher as sdk

@pytest.fixture(autouse=True)
def reset_singleton():
    """Reset the singleton before each test to ensure
    that the test cases do not interfere with each other.
    """
    sdk._instance = None
    yield
    try:
        sdk._instance and sdk._instance.stop()
    except Exception:
        pass
    sdk._instance = None