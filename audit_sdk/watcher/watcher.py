import os
import torch
import threading
import queue
import types
import functools
import sys
import requests
import uuid
import time
from typing import Any, Dict, Optional
from audit_sdk.hashing_engine.engine import HashingEngine

# Configuration
CONTROLLER_URL = os.getenv("AUDIT_CONTROLLER_URL", "http://localhost:3000")
PACKET_API_URL = f"{CONTROLLER_URL}/audit/packet"
EPOCH_API_URL = f"{CONTROLLER_URL}/audit/epoch"

class TrainingWatcher:
    """
    Completely Non-Invasive Watcher: Uses global monkey-patching to capture training data.
    Aligns with "Zero-Footprint" philosophy by requiring zero changes to the training loop.
    
    Epoch detection strategy
    ────────────────────────
    We patch DataLoader.__iter__ at the *class* level (not the instance level).
    Each call to __iter__ returns a generator-like _SingleProcessDataLoaderIter
    or _MultiProcessingDataLoaderIter. We wrap the returned iterator with a
    thin sentinel iterator that fires _on_dataloader_exhausted() the moment
    StopIteration is raised — i.e. exactly when one full pass over the dataset
    completes.

    To distinguish the *training* DataLoader from the *test* DataLoader we use
    a simple heuristic: the loader whose dataset is larger is the training
    loader. The first time each loader is iterated we register it; afterwards
    exhaustion of the training loader → epoch boundary.
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
        self.epoch_buffer = queue.Queue()
        self.is_running = True
        self.global_step = 0
        self.current_loss = 0.0
        self.current_epoch = 0
        self.dataset_merkle_root = self._calculate_initial_merkle_root()
        self.hyperparams = {}

        # Generate a unique session ID for this training run
        self.session_id = f"session-{int(time.time())}-{str(uuid.uuid4())[:8]}"
        
        # DataLoader tracking
        # We keep a weak-key mapping: id(loader) → dataset length
        # so we can identify which loader is which without holding
        # a hard reference (avoids memory leaks).
        self._loader_sizes: Dict[int, int] = {}
        self._train_loader_id: Optional[int] = None   # id() of training DataLoader
        self._last_optimizer: Optional[Any] = None    # for weight snapshot at epoch end
        
        self._initialized = True

        # Start background processing threads
        self.processor_thread = threading.Thread(target=self._process_buffer, daemon=True)
        self.processor_thread.start()
        
        # BUG FIX: Start the epoch processor thread!
        self.epoch_processor_thread = threading.Thread(target=self._process_epoch_buffer, daemon=True)
        self.epoch_processor_thread.start()
        
        self._apply_global_patches()
        print(f"[Watcher] Started session: {self.session_id}")
        sys.stdout.flush()

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
                # BUG FIX: Capture the optimizer instance so we can take snapshots at epoch end
                watcher_self._last_optimizer = opt_self
                
                result = original_step(*s_args, **s_kwargs)
                
                watcher_self.global_step += 1
                if watcher_self.global_step % watcher_self.step_interval == 0:
                    watcher_self._capture_snapshot(opt_self)
                
                return result
            
            # Use __setattr__ to avoid any potential recursion or class-level issues
            object.__setattr__(opt_self, 'step', hooked_step)

        torch.optim.Optimizer.__init__ = patched_opt_init

        # 3. Patch DataLoader.__iter__ to detect epoch boundaries
        original_iter = torch.utils.data.DataLoader.__iter__
        watcher = self

        @functools.wraps(original_iter)
        def patched_iter(loader_self):
            loader_id = id(loader_self)
            try:
                dataset_len = len(loader_self.dataset)
            except (AttributeError, TypeError):
                dataset_len = 0

            # Register this loader
            watcher._loader_sizes[loader_id] = dataset_len

            # Identify training loader: largest dataset we've seen
            if watcher._train_loader_id is None or \
               dataset_len > watcher._loader_sizes.get(watcher._train_loader_id, 0):
                watcher._train_loader_id = loader_id

            inner_iter = original_iter(loader_self)
            return _SentinelIter(inner_iter, loader_id, watcher)

        torch.utils.data.DataLoader.__iter__ = patched_iter

        print(f"[Watcher] Global non-invasive instance-level patching enabled. Interval: {self.step_interval}")
        sys.stdout.flush()

    def _on_dataloader_exhausted(self, loader_id: int):
        """
        Called the moment a DataLoader is fully consumed (StopIteration).
        Only fires the epoch packet when the TRAINING loader is exhausted.
        """
        if loader_id != self._train_loader_id:
            # This is the test/val loader finishing — not an epoch boundary.
            return

        self.current_epoch += 1
        epoch = self.current_epoch

        # Capture weight snapshot for this epoch
        weights_hash = self._capture_weights_hash()

        self.epoch_buffer.put({
            "epoch":        epoch,
            "step_id":      self.global_step,
            "weights_hash": weights_hash,
            "loss":         self.current_loss,
        })

        print(
            f"[Watcher] Epoch {epoch} boundary detected via DataLoader patch "
            f"| step={self.global_step} | loss={self.current_loss:.4f}"
        )
        sys.stdout.flush()
    
    def _capture_weights_hash(self) -> str:
        if self._last_optimizer is None:
            return "no-optimizer-captured"
        weights_repr = ""
        try:
            for group in self._last_optimizer.param_groups:
                for p in group['params']:
                    weights_repr += str(float(p.data.mean()))
        except Exception:
            weights_repr = "error_capturing_weights"
        return self.hashing_engine.calculate_sha256(weights_repr.encode('utf-8'))

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
                    session_id=self.session_id,
                    weights_hash=data["weights_hash"],
                    hyperparams=self.hyperparams,
                    metrics=data["metrics"],
                    dataset_merkle_root=self.dataset_merkle_root
                )
                
                # Send packet to Audit Controller
                self._dispatch(audit_packet, PACKET_API_URL, level="Step")
                
                self.buffer.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                print(f"[Watcher Error] Step buffer: {e}")
                sys.stdout.flush()
    
    def _process_epoch_buffer(self):
        """Background thread: epoch-level packets → /audit/epoch."""
        while self.is_running:
            try:
                data = self.epoch_buffer.get(timeout=1.0)
                epoch_packet = self.hashing_engine.create_audit_packet(
                    step_id=data["step_id"],
                    session_id=self.session_id,
                    weights_hash=data["weights_hash"],
                    hyperparams=self.hyperparams,
                    metrics={"loss": data["loss"], "epoch": data["epoch"]},
                    dataset_merkle_root=self.dataset_merkle_root,
                )
                # Tag so the backend can filter it separately
                epoch_packet["packet_type"] = "epoch"
                epoch_packet["epoch"] = data["epoch"]

                self._dispatch(epoch_packet, EPOCH_API_URL, level=f"Epoch {data['epoch']}")
                self.epoch_buffer.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                print(f"[Watcher Error] Epoch buffer: {e}")
                sys.stdout.flush()

    def _dispatch(self, packet: Dict[str, Any], url: str, level: str = ""):
        try:
            response = requests.post(url, json=packet, timeout=5)
            if response.status_code == 201:
                res_data = response.json()
                print(
                    f"[Audit Log] {level} {packet.get('step_id','')} "
                    f"| Hash: {packet['packet_hash'][:12]}... "
                    f"| CID: {res_data.get('cid', 'N/A')[:12]}..."
                )
            else:
                print(f"[Watcher Warning] {url} → {response.status_code}: {response.text}")
            sys.stdout.flush()
        except requests.exceptions.RequestException as e:
            print(f"[Watcher Error] dispatch to {url}: {e}")
            sys.stdout.flush()

    def stop(self):
        self.is_running = False
        if hasattr(self, 'processor_thread') and self.processor_thread.is_alive():
            self.processor_thread.join(timeout=2.0)
        if hasattr(self, 'epoch_processor_thread') and self.epoch_processor_thread.is_alive():
            self.epoch_processor_thread.join(timeout=2.0)


class _SentinelIter:
    """
    Wraps a DataLoader iterator and fires a callback the instant the
    underlying iterator raises StopIteration (i.e. one full epoch ends).
    """

    __slots__ = ('_inner', '_loader_id', '_watcher', '_exhausted')

    def __init__(self, inner, loader_id: int, watcher: TrainingWatcher):
        self._inner = inner
        self._loader_id = loader_id
        self._watcher = watcher
        self._exhausted = False

    def __iter__(self):
        return self

    def __next__(self):
        try:
            return next(self._inner)
        except StopIteration:
            if not self._exhausted:
                self._exhausted = True
                # Fire on a background thread to avoid blocking the training loop
                threading.Thread(
                    target=self._watcher._on_dataloader_exhausted,
                    args=(self._loader_id,),
                    daemon=True,
                ).start()
            raise

    def __len__(self):
        try:
            return len(self._inner)
        except (AttributeError, TypeError):
            return 0


def init(dataset_dir: Optional[str] = None, step_interval: int = 100, hyperparams: Optional[Dict[str, Any]] = None):
    """
    The only call needed by the user.
    """
    watcher = TrainingWatcher(dataset_dir=dataset_dir, step_interval=step_interval)
    if hyperparams:
        watcher.configure(hyperparams)
    return watcher
