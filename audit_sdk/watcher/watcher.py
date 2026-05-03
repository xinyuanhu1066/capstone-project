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
import io
import hashlib
import zstandard as zstd
from typing import Any, Dict, Optional, List, Tuple
from audit_sdk.hashing_engine.engine import HashingEngine

# Configuration
CONTROLLER_URL = os.getenv("AUDIT_CONTROLLER_URL", "http://localhost:3000")
PACKET_API_URL = f"{CONTROLLER_URL}/audit/packet"
BLOB_API_URL = f"{CONTROLLER_URL}/audit/blob"

class TrainingWatcher:
    """
    Completely Non-Invasive Watcher: Uses global monkey-patching to capture training data.
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(TrainingWatcher, cls).__new__(cls)
        return cls._instance

    def __init__(self, dataset_dir: Optional[str] = None, step_interval: int = 100, dataset_name: str = "Unknown"):
        if hasattr(self, '_initialized') and self._initialized:
            return
        
        self.dataset_dir = dataset_dir or os.path.join(os.getcwd(), 'data')
        self.dataset_name = dataset_name
        self.step_interval = step_interval
        self.hashing_engine = HashingEngine()
        self.buffer = queue.Queue()
        self.blob_buffer = queue.Queue()
        self.is_running = True
        self.global_step = 0
        self.current_loss = 0.0
        self.current_epoch = 0
        self.hyperparams = {}
        
        # Risk Mitigation: Step-level metrics tracking for anomaly detection
        self.step_metrics: List[float] = []

        # Generate a unique session ID for this training run
        self.session_id = f"session-{int(time.time())}-{str(uuid.uuid4())[:8]}"
        
        # Dataset Strategy (Plan Section 2.A): Map CID to OrbitDB
        self.dataset_merkle_root = self._calculate_initial_merkle_root()
        self.dataset_cid = self._snapshot_dataset()
        
        # Identifier Refactor: Resolve semantic version
        self.dataset_version = self._resolve_dataset_version()
        
        self._loader_sizes: Dict[int, int] = {}
        self._train_loader_id: Optional[int] = None
        self._last_optimizer: Optional[Any] = None
        
        self._initialized = True

        # Start background processing threads
        self.processor_thread = threading.Thread(target=self._process_buffer, daemon=True)
        self.processor_thread.start()

        self.blob_processor_thread = threading.Thread(target=self._process_blob_buffer, daemon=True)
        self.blob_processor_thread.start()
        
        self._apply_global_patches()
        print(f"[Watcher] Started session: {self.session_id} | Dataset: {self.dataset_name} ({self.dataset_version})")
        sys.stdout.flush()

    def _resolve_dataset_version(self) -> str:
        """Resolve semantic version from OrbitDB via Audit Controller (Identifier Refactor 1.B)."""
        try:
            payload = {
                "dataset_name": self.dataset_name,
                "merkle_root": self.dataset_merkle_root
            }
            response = requests.post(f"{CONTROLLER_URL}/audit/dataset/version", json=payload, timeout=5)
            if response.status_code == 200:
                return response.json().get("version", "v1.0")
        except Exception as e:
            print(f"[Watcher Error] Version resolution failed: {e}")
        return "v1.0"

    def _snapshot_dataset(self) -> str:
        """Upload dataset to IPFS to get a Root CID (Plan Section 2.A)."""
        if not os.path.exists(self.dataset_dir):
            return "no-dataset-found"
        
        print(f"[Watcher] Taking IPFS snapshot of dataset: {self.dataset_dir}...")
        
        files_to_upload = []
        for root, _, files in os.walk(self.dataset_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, self.dataset_dir)
                with open(full_path, 'rb') as f:
                    content = f.read()
                    file_cid = self._upload_blob(content)
                    if file_cid:
                        files_to_upload.append({
                            "path": rel_path,
                            "cid": file_cid
                        })
        try:
            payload = {
                "dataset_name": self.dataset_name,
                "files": files_to_upload
            }
            response = requests.post(f"{CONTROLLER_URL}/audit/dataset/directory", json=payload, timeout=30)
            if response.status_code == 201:
                return response.json().get("root_cid", "snapshot-failed")
        except Exception as e:
            print(f"[Watcher Error] Directory snapshot failed: {e}")
            
        return "snapshot-failed"

    def _calculate_initial_merkle_root(self) -> str:
        if not os.path.exists(self.dataset_dir):
            return ""
        file_paths = []
        for root, _, files in os.walk(self.dataset_dir):
            for file in files:
                file_paths.append(os.path.join(root, file))
        return self.hashing_engine.calculate_merkle_root(file_paths)

    def _apply_global_patches(self):
        # 1. Patch Tensor.backward to capture loss values automatically
        original_backward = torch.Tensor.backward
        watcher_self = self

        @functools.wraps(original_backward)
        def patched_backward(tensor_self, *args, **kwargs):
            if tensor_self.dim() == 0:
                watcher_self.current_loss = float(tensor_self.item())
            return original_backward(tensor_self, *args, **kwargs)

        torch.Tensor.backward = patched_backward

        # 2. Patch Optimizer.step logic
        original_opt_init = torch.optim.Optimizer.__init__

        @functools.wraps(original_opt_init)
        def patched_opt_init(opt_self, *args, **kwargs):
            original_opt_init(opt_self, *args, **kwargs)
            original_step = opt_self.step
            
            @functools.wraps(original_step)
            def hooked_step(*s_args, **s_kwargs):
                watcher_self._last_optimizer = opt_self
                result = original_step(*s_args, **s_kwargs)
                
                watcher_self.global_step += 1
                # Accumulate metrics for anomaly detection
                watcher_self.step_metrics.append(watcher_self.current_loss)
                
                if watcher_self.global_step % watcher_self.step_interval == 0:
                    watcher_self._capture_snapshot(opt_self)
                
                return result
            
            object.__setattr__(opt_self, 'step', hooked_step)

        torch.optim.Optimizer.__init__ = patched_opt_init

        # 3. Patch DataLoader.__iter__
        original_iter = torch.utils.data.DataLoader.__iter__
        watcher = self

        @functools.wraps(original_iter)
        def patched_iter(loader_self):
            loader_id = id(loader_self)
            try:
                dataset_len = len(loader_self.dataset)
            except (AttributeError, TypeError):
                dataset_len = 0

            watcher._loader_sizes[loader_id] = dataset_len
            if watcher._train_loader_id is None or \
               dataset_len > watcher._loader_sizes.get(watcher._train_loader_id, 0):
                watcher._train_loader_id = loader_id

            inner_iter = original_iter(loader_self)
            return _SentinelIter(inner_iter, loader_id, watcher)

        torch.utils.data.DataLoader.__iter__ = patched_iter
        sys.stdout.flush()

    def _on_dataloader_exhausted(self, loader_id: int):
        if loader_id != self._train_loader_id:
            return

        self.current_epoch += 1
        epoch = self.current_epoch

        # Perform Full Checkpoint Persistence (As per plan Section 2.C)
        checkpoint_data = self._capture_full_checkpoint()
        checkpoint_hash = self.hashing_engine.calculate_sha256(checkpoint_data)

        self.buffer.put({
            "type": "epoch",
            "epoch_id": epoch,
            "step_id": self.global_step,
            "checkpoint_hash": checkpoint_hash,
            "checkpoint": checkpoint_data
        })

        print(f"[Watcher] Epoch {epoch} boundary reached. Global Step: {self.global_step}")
        sys.stdout.flush()

    def _capture_full_checkpoint(self) -> Optional[bytes]:
        """Save full model weights to a binary buffer and compress with Zstd."""
        if self._last_optimizer is None:
            return None
        
        buffer = io.BytesIO()
        try:
            state = {
                'step': self.global_step,
                'param_groups': self._last_optimizer.param_groups,
                'state': self._last_optimizer.state
            }
            torch.save(state, buffer)
            raw_data = buffer.getvalue()
            
            # Zstd Compression (Plan Section 4, Task 3)
            cctx = zstd.ZstdCompressor(level=3)
            compressed_data = cctx.compress(raw_data)
            
            print(f"[Watcher] Checkpoint compressed: {len(raw_data)} -> {len(compressed_data)} bytes")
            return compressed_data
        except Exception as e:
            print(f"[Watcher Error] Full checkpoint capture/compression failed: {e}")
            return None

    def _capture_snapshot(self, optimizer):
        """Standard step snapshot: Binary hash + metrics."""        
        # Multi-step metrics for anomaly detection (Plan 3.B)
        metrics = {
            "loss": self.current_loss,
            "step_metrics": self.step_metrics.copy()
        }
        self.step_metrics = [] # Reset for next interval

        self.buffer.put({
            "type": "step",
            "step_id": self.global_step,
            "metrics": metrics,
        })

    def configure(self, hyperparams: Dict[str, Any]):
        self.hyperparams.update(hyperparams)

    def _process_buffer(self):
        while self.is_running:
            try:
                data = self.buffer.get(timeout=1.0)

                # Obtain latest packet hash from controller to link chain (may be empty)
                prev_hash = self._get_latest_packet_hash(self.session_id)

                if data["type"] == "session":
                    level = "Session"
                    if data["action"] == "start":
                        payload = {
                            "dataset_name": self.dataset_name,
                            "dataset_version": self.dataset_version,
                            "dataset_merkle_root": self.dataset_merkle_root,
                            "dataset_cid": self.dataset_cid,
                            "hyperparams": self.hyperparams,
                        }
                    elif data["action"] == "end":
                        payload = {
                            "model_cid": data["model_cid"],
                            "model_hash": data["model_hash"],
                        }
                    else:
                        self.buffer.task_done()
                        continue
                elif data["type"] == "epoch":
                    level = f"Epoch {data['epoch_id']}"
                    cid = None
                    if data["checkpoint"]:
                        cid = self._upload_blob(data["checkpoint"])
                    payload = {
                        "id": data["epoch_id"],
                        "step_id": data["step_id"],
                        "checkpoint_hash": data["checkpoint_hash"],
                        "checkpoint_cid": cid,
                    }
                elif data["type"] == "step":
                    level = "Step"
                    payload = {
                        "id": data["step_id"],
                        "metrics": data["metrics"]
                    }
                else:
                    self.buffer.task_done()
                    continue
                
                packet, packet_hash = self._create_audit_packet(
                    session_id=self.session_id,
                    packet_type=data["type"],
                    payload=payload,
                    prev_hash=prev_hash,
                    action=data.get("action", "")
                )

                self._dispatch(
                    {"packet": packet, "packet_hash": packet_hash},
                    PACKET_API_URL,
                    level=level
                )
                self.buffer.task_done()
            except queue.Empty:
                continue

    def _process_blob_buffer(self):
        """Asynchronous blob upload processor."""
        while self.is_running:
            try:
                data = self.blob_buffer.get(timeout=1.0)
                self._upload_blob(data)
                self.blob_buffer.task_done()
            except queue.Empty:
                continue

    def _upload_blob(self, blob: bytes) -> Optional[str]:
        """Upload binary data to the Audit Controller and return the CID."""
        try:
            response = requests.post(
                BLOB_API_URL, 
                data=blob, 
                headers={'Content-Type': 'application/octet-stream'},
                timeout=30
            )
            if response.status_code == 201:
                return response.json().get("cid")
        except Exception as e:
            print(f"[Watcher Error] Blob upload failed: {e}")
        return None

    def _get_latest_packet_hash(self, session_id: str) -> str:
        """Query Audit Controller for the on-chain/latest packet hash for a session."""
        try:
            resp = requests.get(f"{CONTROLLER_URL}/audit/sessions/{session_id}", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                # Support multiple key name formats returned by controller
                for k in ["latestPacketHash", "latest_packet_hash", "latestPacketHash", "latest_packetHash"]:
                    if isinstance(data.get(k), str) and data.get(k):
                        return data.get(k)
        except Exception:
            pass
        return ""

    def _dispatch(self, payload: Dict[str, Any], url: str, level: str = ""):
        try:
            response = requests.post(url, json=payload, timeout=5)
            if response.status_code == 201:
                res_data = response.json()
                print(
                    f"[Audit Log] {level} {payload['packet']['payload'].get('step_id','')} | "
                    f"Hash: {payload['packet_hash'][:10]}... | CID: {res_data.get('cid', 'N/A')[:10]}..."
                )
            sys.stdout.flush()
        except Exception as e:
            print(f"[Watcher Error] dispatch to {url}: {e}")

    def _create_audit_packet(
            self, session_id: str, packet_type: str,
            payload: Dict[str, Any], prev_hash: str,
            action: str="") -> Tuple[Dict[str, Any], str]:
        packet = {
            "session_id": session_id,
            "type": packet_type,
            "payload": payload,
            "prev_hash": prev_hash,
            "action": action
        }
        packet_hash = self.hashing_engine.calculate_sha256(packet)
        return packet, packet_hash
    
    def stop(self, final_model_path: Optional[str] = None):
        """Risk Mitigation: Mandatory final capture (Plan 3.A)"""
        print("[Watcher] Training end detected. Capturing final state...")

        if self.global_step % self.step_interval != 0 and self._last_optimizer:
            self._capture_snapshot(self._last_optimizer)
        
        if final_model_path and os.path.exists(final_model_path):
            with open(final_model_path, 'rb') as f:
                model_bytes = f.read()
            
            print(f"[Watcher] Uploading final model {final_model_path} to IPFS...")

            model_cid = self._upload_blob(model_bytes)
            model_hash = self.hashing_engine.calculate_sha256(model_bytes)

            self.buffer.put({
                "type": "session",
                "action": "end",
                "model_cid": model_cid,
                "model_hash": model_hash
            })

        # Flush buffers
        timeout = time.time() + 10
        while not self.buffer.empty() and time.time() < timeout:
            time.sleep(0.1)
        
        self.is_running = False
        for thread_name in ['processor_thread', 'blob_processor_thread']:
            if hasattr(self, thread_name):
                t = getattr(self, thread_name)
                if t.is_alive():
                    t.join(timeout=2.0)

class _SentinelIter:
    __slots__ = ('_inner', '_loader_id', '_watcher', '_exhausted')
    def __init__(self, inner, loader_id: int, watcher: TrainingWatcher):
        self._inner = inner
        self._loader_id = loader_id
        self._watcher = watcher
        self._exhausted = False
    def __iter__(self): return self
    def __next__(self):
        try:
            return next(self._inner)
        except StopIteration:
            if not self._exhausted:
                self._exhausted = True
                threading.Thread(target=self._watcher._on_dataloader_exhausted, args=(self._loader_id,), daemon=True).start()
            raise
    def __len__(self):
        try: return len(self._inner)
        except: return 0

def init(dataset_dir: Optional[str] = None, step_interval: int = 100, hyperparams: Optional[Dict[str, Any]] = None, dataset_name: str = "Unknown"):
    watcher = TrainingWatcher(dataset_dir=dataset_dir, step_interval=step_interval, dataset_name=dataset_name)
    if hyperparams:
        watcher.configure(hyperparams)
    watcher.buffer.put({"type": "session", "action": "start"})
    return watcher
