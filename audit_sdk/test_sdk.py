import torch
import torch.nn as nn
import torch.optim as optim
import time
import os
import sys

# Ensure audit_sdk is in the path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import audit_sdk.watcher.watcher as audit_sdk

class SimpleModel(nn.Module):
    def __init__(self):
        super(SimpleModel, self).__init__()
        self.fc = nn.Linear(10, 2)

    def forward(self, x):
        return self.fc(x)

def test_integration():
    # Setup dummy data directory
    data_dir = "ai-training/data"
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, "dummy.txt"), "w") as f:
        f.write("test data")

    print("Initializing Watcher (Non-Invasive Mode)...")
    hyperparams = {"lr": 0.01, "batch_size": 32}
    watcher = audit_sdk.init(dataset_dir=data_dir, step_interval=1, hyperparams=hyperparams)
    
    model = SimpleModel()
    optimizer = optim.SGD(model.parameters(), lr=0.01)
    criterion = nn.MSELoss()
    
    print("Simulating training loop with ZERO explicit logging calls...")
    for step in range(3):
        # Dummy forward/backward
        inputs = torch.randn(32, 10)
        targets = torch.randn(32, 2)
        
        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, targets)
        
        # This call should automatically update watcher.current_loss
        loss.backward()
        
        # This call should automatically trigger watcher._on_optimizer_step
        optimizer.step()
        
        print(f"  Step {step} completed. Loss: {loss.item():.4f}")
        time.sleep(1.0)  # Increased time for background processing
    
    print("Waiting for buffer to clear...")
    time.sleep(2.0)
    
    print("Stopping Watcher...")
    watcher.stop()
    print("Non-invasive integration test complete.")

if __name__ == "__main__":
    test_integration()
