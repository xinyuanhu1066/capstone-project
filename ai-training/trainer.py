import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, transforms
from torch.utils.data import DataLoader
import os
import sys

# Ensure audit_sdk is in the path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import audit_sdk.watcher.watcher as audit_sdk

# Hyperparameters
BATCH_SIZE = 64
EPOCHS = 5
LEARNING_RATE = 0.01
MOMENTUM = 0.5
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Model Definition
class MNISTNet(nn.Module):
    def __init__(self):
        super(MNISTNet, self).__init__()
        self.conv1 = nn.Conv2d(1, 10, kernel_size=5)
        self.conv2 = nn.Conv2d(10, 20, kernel_size=5)
        self.conv2_drop = nn.Dropout2d()
        self.fc1 = nn.Linear(320, 50)
        self.fc2 = nn.Linear(50, 10)

    def forward(self, x):
        x = torch.relu(torch.max_pool2d(self.conv1(x), 2))
        x = torch.relu(torch.max_pool2d(self.conv2_drop(self.conv2(x)), 2))
        x = x.view(-1, 320)
        x = torch.relu(self.fc1(x))
        x = torch.dropout(x, train=self.training, p=0.5)
        x = self.fc2(x)
        return torch.log_softmax(x, dim=1)

def train(model, device, train_loader, optimizer, epoch):
    model.train()
    for batch_idx, (data, target) in enumerate(train_loader):
        data, target = data.to(device), target.to(device)
        optimizer.zero_grad()
        output = model(data)
        loss = nn.functional.nll_loss(output, target)
        loss.backward()
        optimizer.step()

        if batch_idx % 100 == 0:
            print(f'Train Epoch: {epoch} [{batch_idx * len(data)}/{len(train_loader.dataset)} '
                  f'({100. * batch_idx / len(train_loader):.0f}%)]\tLoss: {loss.item():.6f}')

def test(model, device, test_loader):
    model.eval()
    test_loss = 0
    correct = 0
    with torch.no_grad():
        for data, target in test_loader:
            data, target = data.to(device), target.to(device)
            output = model(data)
            test_loss += nn.functional.nll_loss(output, target, reduction='sum').item()
            pred = output.argmax(dim=1, keepdim=True)
            correct += pred.eq(target.view_as(pred)).sum().item()

    test_loss /= len(test_loader.dataset)
    accuracy = 100. * correct / len(test_loader.dataset)
    print(f'\nTest set: Average loss: {test_loss:.4f}, Accuracy: {correct}/{len(test_loader.dataset)} '
          f'({accuracy:.2f}%)\n')

def main():
    # Set paths
    base_path = os.path.dirname(__file__)
    data_path = os.path.join(base_path, 'data')
    model_path = os.path.join(base_path, 'model')

    # Ensure directories exist
    os.makedirs(data_path, exist_ok=True)
    os.makedirs(model_path, exist_ok=True)

    # Completely Non-Invasive Initialization
    # One line of code to enable full auditing
    hyperparams = {"lr": LEARNING_RATE, "momentum": MOMENTUM, "batch_size": BATCH_SIZE}
    watcher = audit_sdk.init(
        dataset_dir=data_path,
        step_interval=100,
        hyperparams=hyperparams,
        dataset_name="MNIST",
        exclude=["*.gz"])

    # Data Transformations
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.1307,), (0.3081,))
    ])

    # Dataset Loading with explicit download
    print(f"Loading and downloading (if necessary) MNIST dataset to {data_path}...")
    train_dataset = datasets.MNIST(data_path, train=True, download=True, transform=transform)
    test_dataset = datasets.MNIST(data_path, train=False, download=True, transform=transform)
    print("Dataset loaded successfully.")

    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE, shuffle=False)

    model = MNISTNet().to(DEVICE)
    optimizer = optim.SGD(model.parameters(), lr=LEARNING_RATE, momentum=MOMENTUM)

    try:
        for epoch in range(1, EPOCHS + 1):
            train(model, DEVICE, train_loader, optimizer, epoch)
            test(model, DEVICE, test_loader)
    finally:
        save_path = os.path.join(model_path, "mnist_model.pth")
        torch.save(model.state_dict(), save_path)
        print(f"Training complete. Model saved to {save_path}")
        # Ensure watcher stops and flushes its buffer
        print("Stopping Watcher...")
        watcher.stop(save_path)


if __name__ == '__main__':
    main()
