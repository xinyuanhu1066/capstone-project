import os
import torch
import threading
import queue
import types
import functools
import sys
from typing import Any, Dict, Optional
from audit_sdk.hashing_engine.engine import HashingEngine

class TrainingWatcher:
    """
    Completely Non-Invasive Watcher: Uses global monkey-patching to capture training data.
    Aligns with "Zero-Footprint" philosophy by requiring zero changes to the training loop.
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(TrainingWatcher, cls).__new__(cls)
        return cls._instance

    def __init__(self, dataset_dir: Optional[str] = None, step_interval: int = 100):
        if hasattr(self, '_initialized') and self._initialized:
            return
        
        self.dataset_dir = dataset_dir or os.path.join(os.getcwd(), 'data')
        self.step_interval = step_interval
        self.hashing_engine = HashingEngine()
        self.buffer = queue.Queue()
        self.is_running = True
        self.global_step = 0
        self.current_loss = 0.0
        self.dataset_merkle_root = self._calculate_initial_merkle_root()
        self.hyperparams = {}
        self._initialized = True

        # Start background processing thread
        self.processor_thread = threading.Thread(target=self._process_buffer, daemon=True)
        self.processor_thread.start()
        
        self._apply_global_patches()

    def _calculate_initial_merkle_root(self) -> str:
        if not os.path.exists(self.dataset_dir):
            return ""
        file_paths = []
        for root, _, files in os.walk(self.dataset_dir):
            for file in files:
                file_paths.append(os.path.join(root, file))
        return self.hashing_engine.calculate_merkle_root(file_paths)

    def _apply_global_patches(self):
        """
        Invasively patch PyTorch internals to capture data non-invasively for the user.
        """
        # 1. Patch Tensor.backward to capture loss values automatically
        original_backward = torch.Tensor.backward
        watcher_self = self

        @functools.wraps(original_backward)
        def patched_backward(tensor_self, *args, **kwargs):
            if tensor_self.dim() == 0:  # Usually a loss scalar
                watcher_self.current_loss = float(tensor_self.item())
            return original_backward(tensor_self, *args, **kwargs)

        torch.Tensor.backward = patched_backward

        # 2. Patch Optimizer.step logic
        # Instead of patching every subclass (which is risky as seen), 
        # let's patch the base class's __init__ to intercept all optimizer instances.
        
        original_opt_init = torch.optim.Optimizer.__init__

        @functools.wraps(original_opt_init)
        def patched_opt_init(opt_self, *args, **kwargs):
            original_opt_init(opt_self, *args, **kwargs)
            
            # Wrap the instance's step method
            original_step = opt_self.step
            
            @functools.wraps(original_step)
            def hooked_step(*s_args, **s_kwargs):
                result = original_step(*s_args, **s_kwargs)
                
                watcher_self.global_step += 1
                if watcher_self.global_step % watcher_self.step_interval == 0:
                    watcher_self._capture_snapshot(opt_self)
                
                return result
            
            # Use __setattr__ to avoid any potential recursion or class-level issues
            object.__setattr__(opt_self, 'step', hooked_step)

        torch.optim.Optimizer.__init__ = patched_opt_init
        print(f"[Watcher] Global non-invasive instance-level patching enabled. Interval: {self.step_interval}")
        sys.stdout.flush()

    def _capture_snapshot(self, optimizer):
        """Extracts model weights from optimizer parameters and queues for hashing."""
        weights_repr = ""
        try:
            for group in optimizer.param_groups:
                for p in group['params']:
                    weights_repr += str(float(p.data.mean()))
        except Exception:
            weights_repr = "error_capturing_weights"
        
        weights_hash = self.hashing_engine.calculate_sha256(weights_repr.encode('utf-8'))
        
        self.buffer.put({
            "step_id": self.global_step,
            "weights_hash": weights_hash,
            "metrics": {"loss": self.current_loss},
            "hyperparams": self.hyperparams
        })

    def configure(self, hyperparams: Dict[str, Any]):
        """Optional explicit config for hyperparams."""
        self.hyperparams.update(hyperparams)

    def _process_buffer(self):
        while self.is_running:
            try:
                data = self.buffer.get(timeout=1.0)
                audit_packet = self.hashing_engine.create_audit_packet(
                    step_id=data["step_id"],
                    weights_hash=data["weights_hash"],
                    hyperparams=data["hyperparams"],
                    metrics=data["metrics"],
                    dataset_merkle_root=self.dataset_merkle_root
                )
                print(f"[Audit Log] Step {audit_packet['step_id']} | Packet Hash: {audit_packet['packet_hash'][:12]}...")
                sys.stdout.flush()
                self.buffer.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                print(f"[Watcher Error] {e}")
                sys.stdout.flush()

    def stop(self):
        self.is_running = False
        if self.processor_thread.is_alive():
            self.processor_thread.join(timeout=2.0)

def init(dataset_dir: Optional[str] = None, step_interval: int = 100, hyperparams: Optional[Dict[str, Any]] = None):
    """
    The only call needed by the user.
    """
    watcher = TrainingWatcher(dataset_dir=dataset_dir, step_interval=step_interval)
    if hyperparams:
        watcher.configure(hyperparams)
    return watcher
